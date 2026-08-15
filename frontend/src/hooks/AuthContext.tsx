import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import axios from 'axios';
import api, { fetchCsrfToken, getCsrfHeaders } from '../services/api/client';
import { getApiBaseUrl } from '../services/api/config';
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

    // Mode impersonation (super-admin) : token passé en query string (?token=...).
    // On l'utilise directement comme session — SANS passer par /api/auth/refresh,
    // qui remplacerait le token d'impersonation par celui de l'utilisateur réel.
    // La route de destination (role home) est choisie par AdminDashboard.
    const urlToken = new URLSearchParams(window.location.search).get('token');
    if (urlToken) {
      const u = userFromToken(urlToken);
      if (u) {
        // Le token d'impersonation ne doit JAMAIS rester dans l'URL : l'historique
        // du navigateur, un referrer ou un screenshot le conserveraient sinon.
        // On le retire immédiatement après lecture (l'app reste fonctionnelle,
        // le token est déjà en sessionStorage).
        try {
          const url = new URL(window.location.href);
          if (url.searchParams.has('token')) {
            url.searchParams.delete('token');
            window.history.replaceState(null, '', url.toString());
          }
        } catch {
          // ignore
        }
        setAccessToken(urlToken);
        setUser(u);
        setIsInitializing(false);
        fetchCsrfToken().catch(() => {});
        return;
      }
    }

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
          res = await axios.post(`${getApiBaseUrl()}/auth/refresh`, {}, { headers: getCsrfHeaders(), withCredentials: true });
        } catch (firstErr: unknown) {
          const err = firstErr as { response?: { status?: number } };
          if (err?.response?.status === 403) {
            await fetchCsrfToken();
            res = await axios.post(`${getApiBaseUrl()}/auth/refresh`, {}, { headers: getCsrfHeaders(), withCredentials: true });
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
      await api.post('/auth/logout');
    } catch {
      // Le logout serveur échoue (réseau, token expiré) → on nettoie localement
      // et on tente quand même d'expirer le cookie de refresh.
      try {
        await axios.post(`${getApiBaseUrl()}/auth/logout`, {}, { headers: getCsrfHeaders(), withCredentials: true });
      } catch {
        // ignore
      }
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
