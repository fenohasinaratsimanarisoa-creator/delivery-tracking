import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api/client';
import { fetchCsrfToken } from '../../services/api/csrf';
import { useAuth } from '../../hooks/AuthContext';
import LoginLayout from './components/LoginLayout';
import VisualPanel from './components/VisualPanel';
import LoginForm from './components/LoginForm';
import TwoFactorForm from './components/TwoFactorForm';
import styles from './LoginPage.module.css';

const ROLE_REDIRECT: Record<string, string> = {
  admin: '/dashboard',
  dispatcher: '/dashboard',
  driver: '/my-deliveries',
  client: '/my-orders',
};

const SESSION_KEY = 'dt_welcome';

function readSessionCache(): { name?: string; email?: string } {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeSessionCache(name: string, email: string) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ name, email }));
  } catch {
    /* noop */
  }
}

export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { login, isAuthenticated, isInitializing, user } = useAuth();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [twoFactor, setTwoFactor] = useState<{
    tempToken: string;
    email: string;
    firstName: string;
  } | null>(null);
  const [twoFactorError, setTwoFactorError] = useState('');
  const [twoFactorLoading, setTwoFactorLoading] = useState(false);

  const cached = readSessionCache();

  useEffect(() => {
    let authError: string | null = null;
    try { authError = sessionStorage.getItem('dt_auth_error'); sessionStorage.removeItem('dt_auth_error'); } catch {}
    if (authError === 'session_expired') {
      setError(t('auth.login.sessionExpired'));
    }
  }, [t]);

  useEffect(() => {
    if (!isInitializing && isAuthenticated && user) {
      const target = ROLE_REDIRECT[user.role] || '/dashboard';
      navigate(target, { replace: true });
    }
  }, [isInitializing, isAuthenticated, navigate, user]);

  const handleLogin = async (email: string, password: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/auth/login', { email, password });
      const { accessToken, user, requiresTwoFactor, tempToken } = res.data;
      if (requiresTwoFactor) {
        setTwoFactor({
          tempToken,
          email: user?.email || email,
          firstName: user?.firstName || cached.name || '',
        });
        return;
      }
      login(user, accessToken);
      writeSessionCache(user.firstName, user.email);
      const target = ROLE_REDIRECT[user.role] || '/dashboard';
      navigate(target, { replace: true });
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 401) {
        setError(t('auth.login.error401'));
      } else if (status === 429) {
        setError(t('auth.login.error429'));
      } else {
        setError(t('auth.login.errorGeneric'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerify2fa = async (code: string) => {
    if (!twoFactor) return;
    setTwoFactorLoading(true);
    setTwoFactorError('');
    try {
      const res = await api.post('/auth/2fa/authenticate', {
        token: code,
        tempToken: twoFactor.tempToken,
      });
      const { accessToken, user } = res.data;
      login(user, accessToken);
      writeSessionCache(user.firstName, user.email);
      // Le serveur a fait tourner le cookie csrf-token pendant l'étape 2 : on
      // resynchronise le token en mémoire du client, sinon la première mutation
      // déclencherait un 403 CSRF + retry inutile.
      await fetchCsrfToken();
      const target = ROLE_REDIRECT[user.role] || '/dashboard';
      navigate(target, { replace: true });
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 429) {
        setTwoFactorError(t('auth.login.error429'));
      } else {
        setTwoFactorError(t('auth.login.twoFactorInvalid'));
      }
    } finally {
      setTwoFactorLoading(false);
    }
  };

  if (isInitializing) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.loadingText}>{t('common.loading')}</div>
      </div>
    );
  }

  if (isAuthenticated) return null;

  return (
    <LoginLayout
      visualPanel={<VisualPanel />}
    >
      {twoFactor ? (
        <TwoFactorForm
          email={twoFactor.email}
          error={twoFactorError}
          loading={twoFactorLoading}
          onVerify={handleVerify2fa}
          onBack={() => {
            setTwoFactor(null);
            setTwoFactorError('');
          }}
        />
      ) : (
        <LoginForm
          onSubmit={handleLogin}
          error={error}
          loading={loading}
          cachedName={cached.name}
          cachedEmail={cached.email}
        />
      )}
    </LoginLayout>
  );
}