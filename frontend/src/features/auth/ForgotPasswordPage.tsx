import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Mail, ArrowLeft, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import api from '../../services/api/client';

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: 'flex',
    minHeight: '100vh',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--color-bg)',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    background: 'var(--color-glass)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: '1px solid var(--color-glass-border)',
    borderRadius: 'var(--radius-xl)',
    boxShadow: 'var(--shadow-lg)',
    padding: '40px 36px',
  },
  backLink: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 13,
    color: 'var(--color-text-secondary)',
    textDecoration: 'none',
    marginBottom: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: 'var(--color-text)',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: 'var(--color-text-secondary)',
    marginBottom: 28,
    lineHeight: 1.5,
  },
  inputOuter: {
    position: 'relative' as const,
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-input-border)',
    background: 'var(--color-bg)',
    transition: 'border-color var(--transition-normal), box-shadow var(--transition-normal)',
    display: 'flex',
    alignItems: 'center',
    paddingLeft: 12,
  },
  inputFocus: {
    borderColor: 'var(--color-primary)',
    boxShadow: '0 0 0 3px var(--color-input-focus-ring)',
  },
  input: {
    width: '100%',
    padding: '12px 12px 12px 8px',
    border: 'none',
    outline: 'none',
    background: 'transparent',
    fontSize: 14,
    color: 'var(--color-text)',
    borderRadius: 'var(--radius-md)',
  },
  submitBtn: {
    width: '100%',
    padding: '11px 24px',
    marginTop: 20,
    border: 'none',
    borderRadius: 'var(--radius-md)',
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    transition: 'background var(--transition-normal)',
  },
  successBox: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: '14px 16px',
    borderRadius: 'var(--radius-md)',
    background: '#f0fdf4',
    border: '1px solid #bbf7d0',
    color: '#166534',
    fontSize: 13,
    lineHeight: 1.5,
    marginBottom: 20,
  },
  errorBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 14px',
    borderRadius: 'var(--radius-md)',
    background: 'var(--color-error-bg)',
    border: '1px solid var(--color-error-border)',
    color: 'var(--color-error)',
    fontSize: 13,
    marginBottom: 20,
  },
};

export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [focused, setFocused] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    setLoading(true);
    setError('');
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch {
      setError(t('auth.forgotPassword.errorGeneric'));
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div style={styles.wrapper}>
        <div style={styles.card}>
          <Link to="/login" style={styles.backLink}>
            <ArrowLeft size={14} /> {t('auth.forgotPassword.backToLogin')}
          </Link>
          <div style={styles.successBox}>
            <CheckCircle2 size={18} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{t('auth.forgotPassword.success')}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        <Link to="/login" style={styles.backLink}>
          <ArrowLeft size={14} /> {t('auth.forgotPassword.backToLogin')}
        </Link>
        <h1 style={styles.title}>{t('auth.forgotPassword.title')}</h1>
        <p style={styles.subtitle}>{t('auth.forgotPassword.description')}</p>

        {error && (
          <div style={styles.errorBox}>
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div
            style={{
              ...styles.inputOuter,
              ...(focused ? styles.inputFocus : {}),
            }}
          >
            <Mail size={16} color={'var(--color-text-tertiary)'} />
            <input
              type="email"
              placeholder={t('auth.forgotPassword.email')}
              autoComplete="email"
              style={styles.input}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              autoFocus
            />
          </div>

          <button
            type="submit"
            disabled={loading || !email}
            style={{
              ...styles.submitBtn,
              background: loading || !email ? 'var(--color-accent-muted)' : 'var(--color-accent)',
              color: '#fff',
            }}
          >
            {loading ? (
              <>
                <Loader2 size={18} style={{ animation: 'dt-spin 0.8s linear infinite' }} />
                {t('auth.forgotPassword.sending')}
              </>
            ) : (
              t('auth.forgotPassword.submit')
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
