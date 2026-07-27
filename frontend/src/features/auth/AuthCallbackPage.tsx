import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/AuthContext';
import { setAccessToken } from '../../services/auth/tokenStore';
import { parseToken } from '../../services/jwt';
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

const ROLE_REDIRECT: Record<string, string> = {
  admin: '/dashboard',
  dispatcher: '/dashboard',
  driver: '/my-deliveries',
  client: '/my-orders',
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
        const u: User = {
          id: (payload.sub || payload.id) as string,
          email: payload.email as string,
          role: payload.role as User['role'],
          companyId: payload.companyId as string,
          firstName: (payload.firstName || payload.given_name || '') as string,
          lastName: (payload.lastName || payload.family_name || '') as string,
        };
        processedRef.current = true;
        setAccessToken(tokenFromHash);
        loginRef.current(u, tokenFromHash);
        setStatus('success');
        const target = ROLE_REDIRECT[u.role] || '/dashboard';
        navigateRef.current(target, { replace: true });
        return;
      }
    }

    if (isInitializing) return;

    if (isAuthenticated && user) {
      processedRef.current = true;
      setStatus('success');
      const target = ROLE_REDIRECT[user.role] || '/dashboard';
      navigateRef.current(target, { replace: true });
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
