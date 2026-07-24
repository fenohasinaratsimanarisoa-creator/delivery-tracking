import { useState, useMemo, type FormEvent } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Eye, EyeOff, Loader2, AlertCircle, CheckCircle2, ArrowLeft, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { keyframes } from '../../styles/theme';
import api from '../../services/api/client';

const MIN_LEN = 12;
const RULES = [
  { key: 'auth.resetPassword.passwordRules.minLength', test: (v: string) => v.length >= MIN_LEN },
  { key: 'auth.resetPassword.passwordRules.uppercase', test: (v: string) => /[A-Z]/.test(v) },
  { key: 'auth.resetPassword.passwordRules.lowercase', test: (v: string) => /[a-z]/.test(v) },
  { key: 'auth.resetPassword.passwordRules.digit', test: (v: string) => /\d/.test(v) },
  { key: 'auth.resetPassword.passwordRules.special', test: (v: string) => /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(v) },
];

const styles = {
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
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: 'var(--color-text)',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: 'var(--color-text-secondary)',
    marginBottom: 24,
    lineHeight: 1.5,
  },
  inputOuter: {
    position: 'relative' as const,
    borderRadius: 'var(--radius-md)',
    border: `1px solid ${'var(--color-input-border)'}`,
    background: 'var(--color-input-bg)',
    transition: `border-color ${'var(--transition-normal)'}, box-shadow ${'var(--transition-normal)'}`,
  },
  inputFocus: {
    borderColor: 'var(--color-accent)',
    boxShadow: `0 0 0 3px ${'var(--color-accent-muted)'}`,
  },
  inputError: {
    borderColor: 'var(--color-red)',
    boxShadow: '0 0 0 3px rgba(220,38,38,0.10)',
  },
  input: {
    width: '100%',
    padding: '20px 40px 8px 14px',
    border: 'none',
    outline: 'none',
    background: 'transparent',
    fontSize: 14,
    color: 'var(--color-text)',
    boxSizing: 'border-box' as const,
    borderRadius: 'var(--radius-md)',
  },
  label: {
    position: 'absolute' as const,
    left: 14,
    top: 14,
    fontSize: 14,
    color: 'var(--color-text-tertiary)',
    pointerEvents: 'none' as const,
    transition: `all ${'var(--transition-fast)'}`,
    transformOrigin: 'left top',
  },
  labelUp: {
    transform: 'translateY(-8px) scale(0.85)',
    color: 'var(--color-text-secondary)',
  },
  passwordToggle: {
    position: 'absolute' as const,
    right: 10,
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 4,
    color: 'var(--color-text-tertiary)',
  },
  ruleList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
    marginTop: 8,
    marginBottom: 20,
  },
  ruleItem: (valid: boolean) => ({
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: valid ? '#059669' : 'var(--color-text-tertiary)',
    transition: 'color 0.15s',
  }),
  submitBtn: {
    width: '100%',
    padding: '11px 24px',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  errorBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 14px',
    borderRadius: 'var(--radius-md)',
    background: 'var(--color-red-muted)',
    border: `1px solid ${'var(--color-red)'}`,
    color: 'var(--color-red)',
    fontSize: 13,
    marginBottom: 20,
    lineHeight: 1.4,
  },
  successBox: {
    textAlign: 'center' as const,
  },
  successIcon: {
    width: 48,
    height: 48,
    borderRadius: '50%',
    background: '#f0fdf4',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 16px',
  },
  fieldGroup: {
    marginBottom: 16,
    position: 'relative' as const,
  },
};

export default function ResetPasswordPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [focused, setFocused] = useState<'password' | 'confirm' | null>(null);
  const [touched, setTouched] = useState(false);

  const rules = useMemo(() => RULES.map((r) => ({ ...r, passed: r.test(password) })), [password]);
  const allPassed = rules.every((r) => r.passed);
  const passwordsMatch = password === confirm && confirm.length > 0;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!allPassed || !passwordsMatch || !token) return;
    setLoading(true);
    setError('');
    try {
      await api.post('/auth/reset-password', { token, password });
      setSuccess(true);
    } catch (err: any) {
      const msg = err?.response?.data?.message;
      setError(msg || t('auth.resetPassword.errorInvalid'));
    } finally {
      setLoading(false);
    }
  };

  const inputOuterStyle = (field: 'password' | 'confirm') => ({
    ...styles.inputOuter,
    ...(focused === field ? styles.inputFocus : {}),
  });

  const labelStyle = (val: string) => ({
    ...styles.label,
    ...(val || focused ? styles.labelUp : {}),
  });

  if (!token) {
    return (
      <div style={styles.wrapper}>
        <div style={styles.card}>
          <Link to="/forgot-password" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--color-text-secondary)', textDecoration: 'none', marginBottom: 24 }}>
            <ArrowLeft size={14} /> {t('auth.resetPassword.requestNewLink')}
          </Link>
          <div style={styles.errorBox}>
            <XCircle size={14} />
            <span>{t('auth.resetPassword.errorNoToken')}</span>
          </div>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div style={styles.wrapper}>
        <div style={styles.card}>
          <div style={styles.successBox}>
            <div style={styles.successIcon}>
              <CheckCircle2 size={24} color="#059669" />
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text)', marginBottom: 8 }}>
              {t('auth.resetPassword.successTitle')}
            </h2>
            <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 24 }}>
              {t('auth.resetPassword.successMessage')}
            </p>
            <Link
              to="/login"
              style={{
                display: 'inline-block',
                padding: '11px 24px',
                background: 'var(--color-accent)',
                color: '#fff',
                borderRadius: 'var(--radius-md)',
                fontSize: 15,
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              {t('auth.resetPassword.login')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{keyframes}</style>
      <div style={styles.wrapper}>
        <div style={styles.card}>
          <h1 style={styles.title}>{t('auth.resetPassword.title')}</h1>
          <p style={styles.subtitle}>{t('auth.resetPassword.subtitle')}</p>

          {error && (
            <div style={styles.errorBox}>
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div style={styles.fieldGroup}>
              <div style={inputOuterStyle('password')}>
                <label style={labelStyle(password)} htmlFor="reset-password">
                  {t('auth.resetPassword.newPassword')}
                </label>
                <input
                  id="reset-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  style={styles.input}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setFocused('password')}
                  onBlur={() => { setFocused(null); setTouched(true); }}
                  autoFocus
                />
                <button
                  type="button"
                  style={styles.passwordToggle}
                  onClick={() => setShowPassword((p) => !p)}
                  tabIndex={-1}
                  aria-label={showPassword ? t('common.hide') : t('common.show')}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>

              <div style={styles.ruleList}>
                {rules.map((r) => (
                  <div key={r.key} style={styles.ruleItem(r.passed)}>
                    {r.passed ? <CheckCircle2 size={12} /> : <div style={{ width: 12, height: 12 }} />}
                    {t(r.key)}
                  </div>
                ))}
              </div>
            </div>

            <div style={styles.fieldGroup}>
              <div style={inputOuterStyle('confirm')}>
                <label style={labelStyle(confirm)} htmlFor="reset-confirm">
                  {t('auth.resetPassword.confirmPassword')}
                </label>
                <input
                  id="reset-confirm"
                  type={showConfirm ? 'text' : 'password'}
                  autoComplete="new-password"
                  style={styles.input}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  onFocus={() => setFocused('confirm')}
                  onBlur={() => { setFocused(null); setTouched(true); }}
                />
                <button
                  type="button"
                  style={styles.passwordToggle}
                  onClick={() => setShowConfirm((p) => !p)}
                  tabIndex={-1}
                  aria-label={showConfirm ? t('common.hide') : t('common.show')}
                >
                  {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {touched && confirm.length > 0 && !passwordsMatch && (
                <div style={{ fontSize: 12, color: 'var(--color-red)', marginTop: 4 }}>
                  {t('auth.resetPassword.passwordMismatch')}
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || !allPassed || !passwordsMatch}
              style={{
                ...styles.submitBtn,
                background: loading || !allPassed || !passwordsMatch ? 'var(--color-accent-muted)' : 'var(--color-accent)',
                color: '#fff',
              }}
            >
              {loading ? (
                <>
                  <Loader2 size={18} style={{ animation: 'dt-spin 0.8s linear infinite' }} />
                  {t('auth.resetPassword.submitting')}
                </>
              ) : (
                t('auth.resetPassword.submit')
              )}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
