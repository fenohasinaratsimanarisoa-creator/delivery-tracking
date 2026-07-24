import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/AuthContext';
import { Loader2, AlertCircle } from 'lucide-react';

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: 'auth.callback.googleRefused',
  email_not_verified: 'auth.callback.emailNotVerified',
  account_not_found: 'auth.callback.accountNotFound',
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
  const { isInitializing, isAuthenticated, user } = useAuth();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [redirected, setRedirected] = useState(false);

  useEffect(() => {
    const error = searchParams.get('error');
    if (error) {
      setStatus('error');
      setErrorMessage(t(ERROR_MESSAGES[error]) || t(ERROR_MESSAGES.google_auth_failed));
      return;
    }

    const statusParam = searchParams.get('status');
    if (statusParam !== 'success') {
      setStatus('error');
      setErrorMessage(t('auth.callback.invalidParams'));
      return;
    }

    if (isInitializing) return;

    if (isAuthenticated && user && !redirected) {
      setRedirected(true);
      setStatus('success');
      const target = ROLE_REDIRECT[user.role] || '/dashboard';
      navigate(target, { replace: true });
    } else if (!isInitializing && !isAuthenticated) {
      setStatus('error');
      setErrorMessage(t('auth.callback.finalizeError'));
    }
  }, [isInitializing, isAuthenticated, user, searchParams, navigate, redirected]);

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    height: '100vh',
    background: 'linear-gradient(180deg, #f8fafc, #ffffff)',
    gap: 16,
    padding: 24,
    textAlign: 'center',
  };

  return (
    <div style={containerStyle}>
      {status === 'loading' && (
        <>
          <Loader2 size={32} style={{ animation: 'dt-spin 0.8s linear infinite', color: '#1a56db' }} />
          <div style={{ color: '#6b7280', fontSize: 15 }}>{t('auth.callback.connecting')}</div>
        </>
      )}

      {status === 'success' && (
        <>
          <div style={{ fontSize: 14, color: '#6b7280' }}>{t('auth.callback.loginSuccess')}</div>
        </>
      )}

      {status === 'error' && (
        <div style={{
          maxWidth: 400,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
        }}>
          <div style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: '#fef2f2',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <AlertCircle size={24} style={{ color: '#dc2626' }} />
          </div>
          <p style={{ color: '#4b5563', fontSize: 14, lineHeight: 1.5, margin: 0 }}>
            {errorMessage}
          </p>
          <Link
            to="/login"
            style={{
              color: '#1a56db',
              fontWeight: 600,
              textDecoration: 'none',
              fontSize: 14,
            }}
          >
            {t('auth.callback.backToLogin')}
          </Link>
        </div>
      )}
    </div>
  );
}
