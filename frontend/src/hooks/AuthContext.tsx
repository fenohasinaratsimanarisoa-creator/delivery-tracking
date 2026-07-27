import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import axios from 'axios';
import { fetchCsrfToken, getCsrfHeaders } from '../services/api/client';
import type { User } from '../types';
import { setAccessToken, getAccessToken } from '../services/auth/tokenStore';
import { disconnectSocket } from '../services/socket/socket';
import { parseToken } from '../services/jwt';
import { setSentryUser } from '../services/monitoring/sentry';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isInitializing: boolean;
  login: (user: User, accessToken: string) => void;
  logout: () => void;
  updateUser: (fields: Partial<Pick<User, 'firstName' | 'lastName' | 'email'>>) => void;
}

const AuthContext = createContext<AuthState | null>(null);

function userFromToken(token: string): User | null {
  const payload = parseToken(token);
  if (!payload) return null;
  return {
    id: (payload.sub || payload.id) as string,
    email: payload.email as string,
    role: payload.role as User['role'],
    companyId: payload.companyId as string,
    firstName: (payload.firstName || payload.given_name || '') as string,
    lastName: (payload.lastName || payload.family_name || '') as string,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const initialisedRef = useRef(false);

  useEffect(() => {
    if (initialisedRef.current) return;
    initialisedRef.current = true;

    const currentToken = getAccessToken();
    if (currentToken) {
      const u = userFromToken(currentToken);
      if (u) {
        setUser(u);
        setIsInitializing(false);
      }
    }

    (async () => {
      try {
        await fetchCsrfToken();
        let res;
        try {
          res = await axios.post('/api/auth/refresh', {}, { headers: getCsrfHeaders(), withCredentials: true });
        } catch (firstErr: unknown) {
          const err = firstErr as { response?: { status?: number } };
          if (err?.response?.status === 403) {
            await fetchCsrfToken();
            res = await axios.post('/api/auth/refresh', {}, { headers: getCsrfHeaders(), withCredentials: true });
          } else {
            throw firstErr;
          }
        }
        const token = res.data.accessToken;
        setAccessToken(token);
        const u = userFromToken(token);
        if (u) setUser(u);
      } catch {
        const storedToken = getAccessToken();
        if (!storedToken) {
          setAccessToken(null);
          setUser(null);
        }
      } finally {
        setIsInitializing(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!user) {
      setSentryUser(null);
    } else {
      setSentryUser({
        id: user.id,
        email: user.email,
        companyId: user.companyId,
        role: user.role,
      });
    }
  }, [user]);

  const login = useCallback((userData: User, accessToken: string) => {
    setAccessToken(accessToken);
    setUser(userData);
  }, []);

  const logout = useCallback(async () => {
    try {
      await axios.post('/api/auth/logout', {}, { withCredentials: true });
    } catch {
      // ignore
    }
    setAccessToken(null);
    setUser(null);
    disconnectSocket();
  }, []);

  const updateUser = useCallback((fields: Partial<Pick<User, 'firstName' | 'lastName' | 'email'>>) => {
    setUser((prev) => prev ? { ...prev, ...fields } : prev);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isInitializing, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
