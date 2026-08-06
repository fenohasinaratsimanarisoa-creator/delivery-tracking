import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/AuthContext';
import { setAccessToken } from '../../services/auth/tokenStore';
import { parseToken } from '../../services/jwt';
import { isNativeApp, isWebView, isMobileBrowser, relayTokenToNativeApp } from '../../services/native/nativeAuth';
import type { User } from '../../types';
import { Loader2, AlertCircle } from 'lucide-react';
import styles from './AuthCallbackPage.module.css';

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: 'auth.callback.googleRefused',
  email_not_verified: 'auth.callback.emailNotVerified',
  account_not_found: 'auth.callback.accountNotFound',
  account_deactivated: 'auth.callback.accountDeactivated',
  google_auth_failed: 'auth.callback.googleAuthFailed',
};

export default function AuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { isInitializing, isAuthenticated, user, login } = useAuth();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const processedRef = useRef(false);
  const loginRef = useRef(login);
  loginRef.current = login;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const applyLogin = (token: string, payload: ReturnType<typeof parseToken> & object) => {
    processedRef.current = true;
    const u: User = {
      id: (payload.sub || payload.id) as string,
      email: payload.email as string,
      role: payload.role as User['role'],
      companyId: payload.companyId as string,
      firstName: (payload.firstName || payload.given_name || '') as string,
      lastName: (payload.lastName || payload.family_name || '') as string,
    };
    setAccessToken(token);
    loginRef.current(u, token);
    setStatus('success');
    navigateRef.current('/', { replace: true });
  };

  useEffect(() => {
    if (processedRef.current) return;

    const error = searchParams.get('error');
    if (error) {
      processedRef.current = true;
      setStatus('error');
      setErrorMessage(t(ERROR_MESSAGES[error] || t(ERROR_MESSAGES.google_auth_failed)));
      return;
    }

    const hash = window.location.hash.slice(1);
    const hashParams = new URLSearchParams(hash);
    const tokenFromHash = hashParams.get('accessToken');

    if (tokenFromHash) {
      const payload = parseToken(tokenFromHash);
      if (payload) {
        // Custom tab / navigateur mobile (app non détectée) : renvoie le token
        // vers l'app native via le scheme logitrack://, avec repli web.
        if (!isNativeApp() && !isWebView() && isMobileBrowser()) {
          const schedule = window.setTimeout(() => {
            applyLogin(tokenFromHash, payload);
          }, 1200);
          try {
            relayTokenToNativeApp(tokenFromHash);
          } catch {
            window.clearTimeout(schedule);
            applyLogin(tokenFromHash, payload);
          }
          return;
        }
        applyLogin(tokenFromHash, payload);
        return;
      }
    }

    if (isInitializing) return;

    if (isAuthenticated && user) {
      processedRef.current = true;
      setStatus('success');
      navigateRef.current('/', { replace: true });
      return;
    }

    if (!isInitializing && !isAuthenticated) {
      processedRef.current = true;
      setStatus('error');
      setErrorMessage(t('auth.callback.finalizeError'));
    }
  }, [isInitializing, isAuthenticated, user, searchParams, t]);

  return (
    <div className={styles.container}>
      {status === 'loading' && (
        <>
          <Loader2 size={32} className={styles.loadingIcon} />
          <div className={styles.loadingText}>{t('auth.callback.connecting')}</div>
        </>
      )}

      {status === 'success' && (
        <>
          <div className={styles.successText}>{t('auth.callback.loginSuccess')}</div>
        </>
      )}

      {status === 'error' && (
        <div className={styles.errorCard}>
          <div className={styles.errorIconCircle}>
            <AlertCircle size={24} className={styles.errorIcon} />
          </div>
          <p className={styles.errorMessage}>
            {errorMessage}
          </p>
          <Link
            to="/login"
            className={styles.backLink}
          >
            {t('auth.callback.backToLogin')}
          </Link>
        </div>
      )}
    </div>
  );
}
