import { useState, useMemo, useEffect, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Loader2, AlertCircle, CheckCircle2, UserPlus } from 'lucide-react';
import { useTranslation, Trans } from 'react-i18next';
import { useAuth } from '../../hooks/AuthContext';
import api from '../../services/api/client';
import { isNativeApp, openGoogleOAuthInNative } from '../../services/native/nativeAuth';
import styles from './RegisterPage.module.css';

const MIN_LEN = 12;
const RULES = [
  { key: 'auth.register.passwordRules.minLength', test: (v: string) => v.length >= MIN_LEN },
  { key: 'auth.register.passwordRules.uppercase', test: (v: string) => /[A-Z]/.test(v) },
  { key: 'auth.register.passwordRules.lowercase', test: (v: string) => /[a-z]/.test(v) },
  { key: 'auth.register.passwordRules.digit', test: (v: string) => /\d/.test(v) },
  { key: 'auth.register.passwordRules.special', test: (v: string) => /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(v) },
];

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
  const [googleConfigured, setGoogleConfigured] = useState(true);

  useEffect(() => {
    fetch('/api/auth/google/status')
      .then(r => r.json())
      .then(d => setGoogleConfigured(d.configured))
      .catch(() => setGoogleConfigured(false));
  }, []);

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
    } catch (err: unknown) {
      const apiErr = err as { response?: { status?: number; data?: { message?: string } } };
      const status = apiErr?.response?.status;
      const msg = apiErr?.response?.data?.message;
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

  return (
    <>
      <div className={styles.wrapper}>
        <div className={styles.card}>
          <div className={styles.brand}>
            <div className={styles.brandIcon}>DT</div>
            <span className={styles.brandName}>DeliveryTrack</span>
          </div>

          <h1 className={styles.title}>{t('auth.register.title')}</h1>
          <p className={styles.subtitle}>{t('auth.register.subtitle')}</p>

          {error && (
            <div className={styles.errorBox}>
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className={styles.fieldGroup}>
              <div className={`${styles.inputOuter} ${focused === 'companyName' ? styles.inputFocus : ''}`}>
                <label className={`${styles.label} ${(companyName || focused === 'companyName') ? styles.labelUp : ''}`} htmlFor="reg-company">
                  {t('auth.register.companyName')}
                </label>
                <input
                  id="reg-company"
                  type="text"
                  autoComplete="organization"
                  className={styles.input}
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  onFocus={() => setFocused('companyName')}
                  onBlur={() => setFocused(null)}
                  autoFocus
                />
              </div>
            </div>

            <div className={styles.fieldGroup}>
              <div className={`${styles.inputOuter} ${focused === 'email' ? styles.inputFocus : ''}`}>
                <label className={`${styles.label} ${(email || focused === 'email') ? styles.labelUp : ''}`} htmlFor="reg-email">
                  {t('auth.register.email')}
                </label>
                <input
                  id="reg-email"
                  type="email"
                  autoComplete="email"
                  className={styles.input}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onFocus={() => setFocused('email')}
                  onBlur={() => setFocused(null)}
                />
              </div>
            </div>

            <div className={styles.row}>
              <div className={styles.halfField}>
                <div className={`${styles.inputOuter} ${focused === 'firstName' ? styles.inputFocus : ''}`}>
                  <label className={`${styles.label} ${(firstName || focused === 'firstName') ? styles.labelUp : ''}`} htmlFor="reg-first">
                    {t('auth.register.firstName')}
                  </label>
                  <input
                    id="reg-first"
                    type="text"
                    autoComplete="given-name"
                    className={styles.input}
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    onFocus={() => setFocused('firstName')}
                    onBlur={() => setFocused(null)}
                  />
                </div>
              </div>
              <div className={styles.halfField}>
                <div className={`${styles.inputOuter} ${focused === 'lastName' ? styles.inputFocus : ''}`}>
                  <label className={`${styles.label} ${(lastName || focused === 'lastName') ? styles.labelUp : ''}`} htmlFor="reg-last">
                    {t('auth.register.lastName')}
                  </label>
                  <input
                    id="reg-last"
                    type="text"
                    autoComplete="family-name"
                    className={styles.input}
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    onFocus={() => setFocused('lastName')}
                    onBlur={() => setFocused(null)}
                  />
                </div>
              </div>
            </div>

            <div className={styles.fieldGroup}>
              <div className={`${styles.inputOuter} ${focused === 'password' ? styles.inputFocus : ''}`}>
                <label className={`${styles.label} ${(password || focused === 'password') ? styles.labelUp : ''}`} htmlFor="reg-password">
                  {t('auth.register.password')}
                </label>
                <input
                  id="reg-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  className={styles.input}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setFocused('password')}
                  onBlur={() => setFocused(null)}
                />
                <button
                  type="button"
                  className={styles.passwordToggle}
                  onClick={() => setShowPassword((p) => !p)}
                  tabIndex={-1}
                  aria-label={showPassword ? t('common.hide') : t('common.show')}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {password.length > 0 && (
                <div className={styles.ruleList}>
                  {rules.map((r) => (
                    <div key={r.key} className={`${styles.ruleItem} ${r.passed ? styles.ruleItemValid : styles.ruleItemInvalid}`}>
                      {r.passed ? <CheckCircle2 size={12} /> : <div className={styles.placeholder} />}
                      {t(r.key)}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className={styles.fieldGroup}>
              <div className={`${styles.inputOuter} ${focused === 'confirm' ? styles.inputFocus : ''}`}>
                <label className={`${styles.label} ${(confirm || focused === 'confirm') ? styles.labelUp : ''}`} htmlFor="reg-confirm">
                  {t('auth.register.confirmPassword')}
                </label>
                <input
                  id="reg-confirm"
                  type={showConfirm ? 'text' : 'password'}
                  autoComplete="new-password"
                  className={styles.input}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  onFocus={() => setFocused('confirm')}
                  onBlur={() => setFocused(null)}
                />
                <button
                  type="button"
                  className={styles.passwordToggle}
                  onClick={() => setShowConfirm((p) => !p)}
                  tabIndex={-1}
                  aria-label={showConfirm ? t('common.hide') : t('common.show')}
                >
                  {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {confirm.length > 0 && !passwordsMatch && (
                <div className={styles.errorMessage}>
                  {t('auth.register.passwordMismatch')}
                </div>
              )}
            </div>

            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={acceptTerms}
                onChange={(e) => setAcceptTerms(e.target.checked)}
              />
              <Trans i18nKey="auth.register.acceptCgu">
                J'accepte les{' '}
                <a href="/cgu" className={styles.footerLink} target="_blank" rel="noopener noreferrer">
                  conditions générales d'utilisation
                </a>
              </Trans>
            </label>

            <button
              type="submit"
              disabled={loading || !isFormValid}
              className={`${styles.submitBtn} ${loading || !isFormValid ? styles.submitBtnDisabled : styles.submitBtnActive}`}
            >
              {loading ? (
                <>
                  <Loader2 size={18} className={styles.spinner} />
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

          {googleConfigured && (
            <>
              <div className={styles.divider}>
                <span className={styles.dividerLine} />
                <span className={styles.dividerText}>{t('common.or')}</span>
                <span className={styles.dividerLine} />
              </div>

              <button
                type="button"
                onClick={() => {
                  if (isNativeApp()) {
                    void openGoogleOAuthInNative();
                    return;
                  }
                  window.location.href = '/api/auth/google';
                }}
                className={styles.ssoButton}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--color-accent)';
                  e.currentTarget.style.background = 'var(--color-accent-muted)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--color-input-border)';
                  e.currentTarget.style.background = 'var(--color-input-bg)';
                }}
              >
                <span className={styles.googleG}>G</span>
                {t('auth.register.googleLogin')}
              </button>
            </>
          )}

          <div className={styles.footer}>
            {t('auth.register.haveAccount')}{' '}
            <Link to="/login" className={styles.footerLink}>
              {t('auth.register.login')}
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
