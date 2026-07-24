import { useState, useMemo, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Loader2, AlertCircle, CheckCircle2, UserPlus } from 'lucide-react';
import { useTranslation, Trans } from 'react-i18next';
import { keyframes } from '../../styles/theme';
import { useAuth } from '../../hooks/AuthContext';
import api from '../../services/api/client';

const MIN_LEN = 12;
const RULES = [
  { key: 'auth.register.passwordRules.minLength', test: (v: string) => v.length >= MIN_LEN },
  { key: 'auth.register.passwordRules.uppercase', test: (v: string) => /[A-Z]/.test(v) },
  { key: 'auth.register.passwordRules.lowercase', test: (v: string) => /[a-z]/.test(v) },
  { key: 'auth.register.passwordRules.digit', test: (v: string) => /\d/.test(v) },
  { key: 'auth.register.passwordRules.special', test: (v: string) => /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(v) },
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
    maxWidth: 440,
    background: 'var(--color-glass)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: '1px solid var(--color-glass-border)',
    borderRadius: 'var(--radius-xl)',
    boxShadow: 'var(--shadow-lg)',
    padding: '40px 36px',
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 24,
  },
  brandIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    background: 'linear-gradient(135deg, var(--color-accent), #1e40af)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontSize: 16,
    fontWeight: 700,
    flexShrink: 0,
  },
  brandName: {
    fontSize: 18,
    fontWeight: 700,
    color: 'var(--color-text)',
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
    border: '1px solid var(--color-input-border)',
    background: 'var(--color-input-bg)',
    transition: 'border-color var(--transition-normal), box-shadow var(--transition-normal)',
    overflow: 'hidden',
  },
  inputFocus: {
    borderColor: 'var(--color-accent)',
    boxShadow: '0 0 0 3px var(--color-accent-muted)',
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
    transition: 'all var(--transition-fast)',
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
    gap: 5,
    marginTop: 6,
    marginBottom: 16,
  },
  ruleItem: (valid: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: valid ? '#059669' : 'var(--color-text-tertiary)',
    transition: 'color 0.15s',
  }),
  fieldGroup: {
    marginBottom: 14,
    position: 'relative' as const,
  },
  row: {
    display: 'flex',
    gap: 12,
  },
  halfField: {
    flex: 1,
    position: 'relative' as const,
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    fontSize: 12,
    color: 'var(--color-text-secondary)',
    cursor: 'pointer',
    marginBottom: 20,
    marginTop: 4,
    lineHeight: 1.4,
  },
  checkbox: {
    width: 16,
    height: 16,
    accentColor: 'var(--color-accent)',
    marginTop: 2,
    cursor: 'pointer',
    flexShrink: 0,
  },
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
    border: '1px solid var(--color-red)',
    color: 'var(--color-red)',
    fontSize: 13,
    marginBottom: 16,
    lineHeight: 1.4,
  },
  footer: {
    textAlign: 'center' as const,
    marginTop: 20,
    fontSize: 13,
    color: 'var(--color-text-secondary)',
  },
  footerLink: {
    color: 'var(--color-accent)',
    textDecoration: 'none',
    fontWeight: 600,
  },
};

export default function RegisterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { login } = useAuth();

  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [focused, setFocused] = useState<string | null>(null);

  const rules = useMemo(() => RULES.map((r) => ({ ...r, passed: r.test(password) })), [password]);
  const allPassed = rules.every((r) => r.passed);
  const passwordsMatch = password === confirm && confirm.length > 0;
  const isFormValid = companyName.length > 0 && email.length > 0 && firstName.length > 0
    && lastName.length > 0 && allPassed && passwordsMatch && acceptTerms;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isFormValid) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/auth/register', {
        companyName, email, password, firstName, lastName,
      });
      const { accessToken, user } = res.data;
      login(user, accessToken);
      navigate('/dashboard', { replace: true });
    } catch (err: any) {
      const status = err?.response?.status;
      const msg = err?.response?.data?.message;
      if (status === 429) {
        setError(t('auth.register.error429'));
      } else if (status === 409) {
        setError(t('auth.register.error409'));
      } else if (msg) {
        setError(msg);
      } else {
        setError(t('auth.register.errorGeneric'));
      }
    } finally {
      setLoading(false);
    }
  };

  const inputOuterStyle = (name: string) => ({
    ...styles.inputOuter,
    ...(focused === name ? styles.inputFocus : {}),
  });

  const labelStyle = (val: string, name: string) => ({
    ...styles.label,
    ...(val || focused === name ? styles.labelUp : {}),
  });

  return (
    <>
      <style>{keyframes}</style>
      <div style={styles.wrapper}>
        <div style={styles.card}>
          <div style={styles.brand}>
            <div style={styles.brandIcon}>DT</div>
            <span style={styles.brandName}>DeliveryTrack</span>
          </div>

          <h1 style={styles.title}>{t('auth.register.title')}</h1>
          <p style={styles.subtitle}>{t('auth.register.subtitle')}</p>

          {error && (
            <div style={styles.errorBox}>
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div style={styles.fieldGroup}>
              <div style={inputOuterStyle('companyName')}>
                <label style={labelStyle(companyName, 'companyName')} htmlFor="reg-company">
                  {t('auth.register.companyName')}
                </label>
                <input
                  id="reg-company"
                  type="text"
                  autoComplete="organization"
                  style={styles.input}
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  onFocus={() => setFocused('companyName')}
                  onBlur={() => setFocused(null)}
                  autoFocus
                />
              </div>
            </div>

            <div style={styles.fieldGroup}>
              <div style={inputOuterStyle('email')}>
                <label style={labelStyle(email, 'email')} htmlFor="reg-email">
                  {t('auth.register.email')}
                </label>
                <input
                  id="reg-email"
                  type="email"
                  autoComplete="email"
                  style={styles.input}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onFocus={() => setFocused('email')}
                  onBlur={() => setFocused(null)}
                />
              </div>
            </div>

            <div style={styles.row}>
              <div style={styles.halfField}>
                <div style={inputOuterStyle('firstName')}>
                  <label style={labelStyle(firstName, 'firstName')} htmlFor="reg-first">
                    {t('auth.register.firstName')}
                  </label>
                  <input
                    id="reg-first"
                    type="text"
                    autoComplete="given-name"
                    style={styles.input}
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    onFocus={() => setFocused('firstName')}
                    onBlur={() => setFocused(null)}
                  />
                </div>
              </div>
              <div style={styles.halfField}>
                <div style={inputOuterStyle('lastName')}>
                  <label style={labelStyle(lastName, 'lastName')} htmlFor="reg-last">
                    {t('auth.register.lastName')}
                  </label>
                  <input
                    id="reg-last"
                    type="text"
                    autoComplete="family-name"
                    style={styles.input}
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    onFocus={() => setFocused('lastName')}
                    onBlur={() => setFocused(null)}
                  />
                </div>
              </div>
            </div>

            <div style={styles.fieldGroup}>
              <div style={inputOuterStyle('password')}>
                <label style={labelStyle(password, 'password')} htmlFor="reg-password">
                  {t('auth.register.password')}
                </label>
                <input
                  id="reg-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  style={styles.input}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setFocused('password')}
                  onBlur={() => setFocused(null)}
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
              {password.length > 0 && (
                <div style={styles.ruleList}>
                  {rules.map((r) => (
                    <div key={r.key} style={styles.ruleItem(r.passed)}>
                      {r.passed ? <CheckCircle2 size={12} /> : <div style={{ width: 12, height: 12 }} />}
                      {t(r.key)}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={styles.fieldGroup}>
              <div style={inputOuterStyle('confirm')}>
                <label style={labelStyle(confirm, 'confirm')} htmlFor="reg-confirm">
                  {t('auth.register.confirmPassword')}
                </label>
                <input
                  id="reg-confirm"
                  type={showConfirm ? 'text' : 'password'}
                  autoComplete="new-password"
                  style={styles.input}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  onFocus={() => setFocused('confirm')}
                  onBlur={() => setFocused(null)}
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
              {confirm.length > 0 && !passwordsMatch && (
                <div style={{ fontSize: 12, color: 'var(--color-red)', marginTop: 4 }}>
                  {t('auth.register.passwordMismatch')}
                </div>
              )}
            </div>

            <label style={styles.checkboxLabel}>
              <input
                type="checkbox"
                style={styles.checkbox}
                checked={acceptTerms}
                onChange={(e) => setAcceptTerms(e.target.checked)}
              />
              <Trans i18nKey="auth.register.acceptCgu">
                J'accepte les{' '}
                <a href="/cgu" style={{ color: 'var(--color-accent)' }} target="_blank" rel="noopener noreferrer">
                  conditions générales d'utilisation
                </a>
              </Trans>
            </label>

            <button
              type="submit"
              disabled={loading || !isFormValid}
              style={{
                ...styles.submitBtn,
                background: loading || !isFormValid ? 'var(--color-accent-muted)' : 'var(--color-accent)',
                color: '#fff',
              }}
            >
              {loading ? (
                <>
                  <Loader2 size={18} style={{ animation: 'dt-spin 0.8s linear infinite' }} />
                  {t('auth.register.submitting')}
                </>
              ) : (
                <>
                  <UserPlus size={18} />
                  {t('auth.register.submit')}
                </>
              )}
            </button>
          </form>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 20, marginBottom: 16 }}>
            <span style={{ flex: 1, height: 1, background: 'var(--color-input-border)' }} />
            <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)', fontWeight: 500 }}>{t('common.or')}</span>
            <span style={{ flex: 1, height: 1, background: 'var(--color-input-border)' }} />
          </div>

          <button
            type="button"
            onClick={() => { window.location.href = '/api/auth/google'; }}
            style={{
              width: '100%',
              padding: '10px 24px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-input-border)',
              background: 'var(--color-input-bg)',
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              transition: 'border-color 0.15s, background 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--color-accent)';
              e.currentTarget.style.background = 'var(--color-accent-muted)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--color-input-border)';
              e.currentTarget.style.background = 'var(--color-input-bg)';
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 15, color: '#4285f4' }}>G</span>
            {t('auth.register.googleLogin')}
          </button>

          <div style={styles.footer}>
            {t('auth.register.haveAccount')}{' '}
            <Link to="/login" style={styles.footerLink}>
              {t('auth.register.login')}
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
