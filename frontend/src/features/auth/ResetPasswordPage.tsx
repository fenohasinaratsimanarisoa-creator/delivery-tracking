import { useState, useMemo, type FormEvent } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Eye, EyeOff, Loader2, AlertCircle, CheckCircle2, ArrowLeft, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../../services/api/client';
import styles from './ResetPasswordPage.module.css';

const MIN_LEN = 12;
const RULES = [
  { key: 'auth.resetPassword.passwordRules.minLength', test: (v: string) => v.length >= MIN_LEN },
  { key: 'auth.resetPassword.passwordRules.uppercase', test: (v: string) => /[A-Z]/.test(v) },
  { key: 'auth.resetPassword.passwordRules.lowercase', test: (v: string) => /[a-z]/.test(v) },
  { key: 'auth.resetPassword.passwordRules.digit', test: (v: string) => /\d/.test(v) },
  { key: 'auth.resetPassword.passwordRules.special', test: (v: string) => /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(v) },
];

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
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || t('auth.resetPassword.errorInvalid'));
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.card}>
          <Link to="/forgot-password" className={styles.backLink}>
            <ArrowLeft size={14} /> {t('auth.resetPassword.requestNewLink')}
          </Link>
          <div className={styles.errorBox}>
            <XCircle size={14} />
            <span>{t('auth.resetPassword.errorNoToken')}</span>
          </div>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.card}>
          <div className={styles.successBox}>
            <div className={styles.successIcon}>
              <CheckCircle2 size={24} color="#059669" />
            </div>
            <h2 className={styles.successTitle}>
              {t('auth.resetPassword.successTitle')}
            </h2>
            <p className={styles.successMessage}>
              {t('auth.resetPassword.successMessage')}
            </p>
            <Link
              to="/login"
              className={styles.loginLink}
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
      <div className={styles.wrapper}>
        <div className={styles.card}>
          <h1 className={styles.title}>{t('auth.resetPassword.title')}</h1>
          <p className={styles.subtitle}>{t('auth.resetPassword.subtitle')}</p>

          {error && (
            <div className={styles.errorBox}>
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className={styles.fieldGroup}>
              <div className={`${styles.inputOuter} ${focused === 'password' ? styles.inputFocus : ''}`}>
                <label className={`${styles.label} ${(password || focused) ? styles.labelUp : ''}`} htmlFor="reset-password">
                  {t('auth.resetPassword.newPassword')}
                </label>
                <input
                  id="reset-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  className={styles.input}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setFocused('password')}
                  onBlur={() => { setFocused(null); setTouched(true); }}
                  autoFocus
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

              <div className={styles.ruleList}>
                {rules.map((r) => (
                  <div key={r.key} className={`${styles.ruleItem} ${r.passed ? styles.ruleItemValid : styles.ruleItemInvalid}`}>
                    {r.passed ? <CheckCircle2 size={12} /> : <div className={styles.placeholder} />}
                    {t(r.key)}
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.fieldGroup}>
              <div className={`${styles.inputOuter} ${focused === 'confirm' ? styles.inputFocus : ''}`}>
                <label className={`${styles.label} ${(confirm || focused) ? styles.labelUp : ''}`} htmlFor="reset-confirm">
                  {t('auth.resetPassword.confirmPassword')}
                </label>
                <input
                  id="reset-confirm"
                  type={showConfirm ? 'text' : 'password'}
                  autoComplete="new-password"
                  className={styles.input}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  onFocus={() => setFocused('confirm')}
                  onBlur={() => { setFocused(null); setTouched(true); }}
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
              {touched && confirm.length > 0 && !passwordsMatch && (
                <div className={styles.errorMessage}>
                  {t('auth.resetPassword.passwordMismatch')}
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || !allPassed || !passwordsMatch}
              className={`${styles.submitBtn} ${loading || !allPassed || !passwordsMatch ? styles.submitBtnDisabled : styles.submitBtnActive}`}
            >
              {loading ? (
                <>
                  <Loader2 size={18} className={styles.spinner} />
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
