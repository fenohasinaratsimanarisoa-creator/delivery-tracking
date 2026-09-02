import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api/client';
import { fetchCsrfToken } from '../../services/api/csrf';
import { useAuth } from '../../hooks/AuthContext';
import { resetServiceWorkerAndReload } from '../../services/pwa/reset';
import type { User } from '../../types';
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
const SW_CACHE_WARNING_AGE_MS = 30_000; // 30 secondes

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

/**
 * Détecte si un reset de SW a récemment eu lieu (dt_chunk_reload ou dt_sw_reset
 * dans sessionStorage, datant de moins de 30 secondes). Si oui, le navigateur
 * a potentiellement un ancien SW en cache et l'utilisateur atterrit sur /login
 * juste après un login pourtant réussi.
 */
function detectSwCacheWarning(): boolean {
  try {
    const now = Date.now();
    const chunkReload = Number(sessionStorage.getItem('dt_chunk_reload') || 0);
    const swReset = Number(sessionStorage.getItem('dt_sw_reset') || 0);
    const latestEvent = Math.max(chunkReload, swReset);
    return latestEvent > 0 && now - latestEvent < SW_CACHE_WARNING_AGE_MS;
  } catch {
    return false;
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
  const [showSwCacheWarning, setShowSwCacheWarning] = useState(false);

  const cached = readSessionCache();

  useEffect(() => {
    let authError: string | null = null;
    try { authError = sessionStorage.getItem('dt_auth_error'); sessionStorage.removeItem('dt_auth_error'); } catch {}
    if (authError === 'session_expired') {
      setError(t('auth.login.sessionExpired'));
    }
  }, [t]);

  // Détecter le cas où on atterrit sur /login après un reset de SW récent
  useEffect(() => {
    if (detectSwCacheWarning()) {
      setShowSwCacheWarning(true);
      console.warn(
        '[app] LoginPage : reset SW récent détecté dans sessionStorage — affichage du message diagnostic',
      );
    }
  }, []);

  useEffect(() => {
    if (!isInitializing && isAuthenticated && user) {
      const target = ROLE_REDIRECT[user.role] || '/dashboard';
      navigate(target, { replace: true });
    }
  }, [isInitializing, isAuthenticated, navigate, user]);

  const handleLogin = async (email: string, password: string, remember: boolean) => {
    setLoading(true);
    setError('');
    setShowSwCacheWarning(false);
    try {
      const res = await api.post('/auth/login', { email, password, remember });
      const data = res.data as
        | { accessToken?: string; user?: User | null; requiresTwoFactor?: boolean; tempToken?: string }
        | null
        | undefined;
      if (!data || typeof data !== 'object') {
        throw new Error('Malformed login response (not an object)');
      }
      const { accessToken, user, requiresTwoFactor, tempToken } = data;
      if (requiresTwoFactor) {
        if (!user || !user.email || typeof tempToken !== 'string' || !tempToken) {
          throw new Error('Malformed 2FA step-1 response (missing user or tempToken)');
        }
        setTwoFactor({
          tempToken,
          email: user.email,
          firstName: user.firstName || cached.name || '',
        });
        return;
      }
      if (typeof accessToken !== 'string' || !accessToken || !user || typeof user !== 'object') {
        throw new Error('Malformed login response (missing accessToken or user)');
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
      const data = res.data as { accessToken?: string; user?: User | null } | null | undefined;
      if (!data || typeof data.accessToken !== 'string' || !data.accessToken || !data.user || typeof data.user !== 'object') {
        throw new Error('Malformed 2FA response (missing accessToken or user)');
      }
      const { accessToken, user } = data;
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

  const handleResetApp = () => {
    console.warn('[app] LoginPage : bouton "Réinitialiser l\'application" cliqué');
    void resetServiceWorkerAndReload();
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

      {/* Message diagnostic : ancien SW en cache détecté */}
      {showSwCacheWarning && (
        <div
          role="alert"
          style={{
            marginTop: '16px',
            padding: '12px 16px',
            backgroundColor: '#fef3c7',
            border: '1px solid #f59e0b',
            borderRadius: '8px',
            fontSize: '13px',
            lineHeight: '1.5',
            color: '#92400e',
          }}
        >
          <p style={{ margin: '0 0 8px 0', fontWeight: 600 }}>
            ⚠️ {t('auth.login.swCacheWarning')}
          </p>
          <p style={{ margin: '0 0 12px 0' }}>
            {t('auth.login.swCacheHint')}
          </p>
          <button
            type="button"
            onClick={handleResetApp}
            style={{
              padding: '8px 16px',
              backgroundColor: '#dc2626',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 600,
            }}
          >
            🔄 {t('auth.login.swCacheResetButton')}
          </button>
        </div>
      )}
    </LoginLayout>
  );
}
