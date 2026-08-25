import { useState, useMemo, useEffect, type FormEvent } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Eye, EyeOff, AlertCircle, CheckCircle2, Loader2, UserPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../../services/api/client';
import Button from '../../components/Button';
import styles from './AcceptInvitePage.module.css';

const MIN_LEN = 12;
const RULES = [
  { key: 'auth.acceptInvite.passwordRules.minLength', test: (v: string) => v.length >= MIN_LEN },
  { key: 'auth.acceptInvite.passwordRules.uppercase', test: (v: string) => /[A-Z]/.test(v) },
  { key: 'auth.acceptInvite.passwordRules.lowercase', test: (v: string) => /[a-z]/.test(v) },
  { key: 'auth.acceptInvite.passwordRules.digit', test: (v: string) => /\d/.test(v) },
  { key: 'auth.acceptInvite.passwordRules.special', test: (v: string) => /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(v) },
];

interface InvitationInfo {
  email: string;
  role: string;
  companyName: string;
  expiresAt: string;
}

export default function AcceptInvitePage() {
  const { t } = useTranslation();
  const { token } = useParams<{ token: string }>();

  const [invitation, setInvitation] = useState<InvitationInfo | null>(null);
  const [invitationError, setInvitationError] = useState('');
  const [checkingInvitation, setCheckingInvitation] = useState(true);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setCheckingInvitation(false);
      return;
    }
    api
      .get<InvitationInfo>(`/invitations/${token}`)
      .then((res) => setInvitation(res.data))
      .catch((err: unknown) => {
        const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
        setInvitationError(msg || t('auth.acceptInvite.errorInvalid'));
      })
      .finally(() => setCheckingInvitation(false));
  }, [token, t]);

  const rules = useMemo(() => RULES.map((r) => ({ ...r, passed: r.test(password) })), [password]);
  const allPassed = rules.every((r) => r.passed);
  const passwordsMatch = password === confirm && confirm.length > 0;
  const isFormValid = firstName.length > 0 && lastName.length > 0 && allPassed && passwordsMatch;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isFormValid || !token) return;
    setLoading(true);
    setError('');
    try {
      await api.post(`/invitations/${token}/accept`, {
        password,
        firstName,
        lastName,
        phone: phone || undefined,
      });
      setSuccess(true);
    } catch (err: unknown) {
      const apiErr = err as { response?: { status?: number; data?: { message?: string | string[] } } };
      const status = apiErr?.response?.status;
      const rawMsg = apiErr?.response?.data?.message;
      const msg = Array.isArray(rawMsg) ? rawMsg[0] : rawMsg;
      if (status === 429) {
        setError(t('auth.acceptInvite.error429'));
      } else if (msg) {
        setError(msg);
      } else {
        setError(t('auth.acceptInvite.errorGeneric'));
      }
    } finally {
      setLoading(false);
    }
  };

  if (checkingInvitation) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.card}>
          <div className={styles.centerState}>
            <Loader2 size={20} className={styles.spinner} />
          </div>
        </div>
      </div>
    );
  }

  if (invitationError || !invitation) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.card}>
          <div className={styles.errorBox}>
            <AlertCircle size={14} />
            <span>{invitationError || t('auth.acceptInvite.errorInvalid')}</span>
          </div>
          <Link to="/login" className={styles.loginLink}>
            {t('auth.acceptInvite.backToLogin')}
          </Link>
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
            <h2 className={styles.successTitle}>{t('auth.acceptInvite.successTitle')}</h2>
            <p className={styles.successMessage}>{t('auth.acceptInvite.successMessage')}</p>
            <Link to="/login" className={styles.loginLink}>
              {t('auth.acceptInvite.login')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <div className={styles.brandIcon}>DT</div>
          <span className={styles.brandName}>DeliveryTrack</span>
        </div>

        <h1 className={styles.title}>{t('auth.acceptInvite.title')}</h1>
        <p className={styles.subtitle}>{t('auth.acceptInvite.subtitle')}</p>

        <div className={styles.inviteBanner}>
          {t('auth.acceptInvite.invitedAs', {
            company: invitation.companyName,
            role: t(`users.roles.${invitation.role}`, { defaultValue: invitation.role }),
          })}
        </div>

        {error && (
          <div className={styles.errorBox}>
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className={styles.fieldGroup}>
            <div className={`${styles.inputOuter} ${styles.disabled}`}>
              <label className={`${styles.label} ${styles.labelUp}`} htmlFor="invite-email">
                {t('auth.acceptInvite.email')}
              </label>
              <input id="invite-email" type="email" className={styles.input} value={invitation.email} disabled readOnly />
            </div>
          </div>

          <div className={styles.row}>
            <div className={styles.halfField}>
              <div className={`${styles.inputOuter} ${focused === 'firstName' ? styles.inputFocus : ''}`}>
                <label className={`${styles.label} ${(firstName || focused === 'firstName') ? styles.labelUp : ''}`} htmlFor="invite-first">
                  {t('auth.acceptInvite.firstName')}
                </label>
                <input
                  id="invite-first"
                  type="text"
                  autoComplete="given-name"
                  className={styles.input}
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  onFocus={() => setFocused('firstName')}
                  onBlur={() => setFocused(null)}
                  autoFocus
                />
              </div>
            </div>
            <div className={styles.halfField}>
              <div className={`${styles.inputOuter} ${focused === 'lastName' ? styles.inputFocus : ''}`}>
                <label className={`${styles.label} ${(lastName || focused === 'lastName') ? styles.labelUp : ''}`} htmlFor="invite-last">
                  {t('auth.acceptInvite.lastName')}
                </label>
                <input
                  id="invite-last"
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
            <div className={`${styles.inputOuter} ${focused === 'phone' ? styles.inputFocus : ''}`}>
              <label className={`${styles.label} ${(phone || focused === 'phone') ? styles.labelUp : ''}`} htmlFor="invite-phone">
                {t('auth.acceptInvite.phone')}
              </label>
              <input
                id="invite-phone"
                type="tel"
                autoComplete="tel"
                className={styles.input}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onFocus={() => setFocused('phone')}
                onBlur={() => setFocused(null)}
              />
            </div>
          </div>

          <div className={styles.fieldGroup}>
            <div className={`${styles.inputOuter} ${focused === 'password' ? styles.inputFocus : ''}`}>
              <label className={`${styles.label} ${(password || focused === 'password') ? styles.labelUp : ''}`} htmlFor="invite-password">
                {t('auth.acceptInvite.password')}
              </label>
              <input
                id="invite-password"
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
              <label className={`${styles.label} ${(confirm || focused === 'confirm') ? styles.labelUp : ''}`} htmlFor="invite-confirm">
                {t('auth.acceptInvite.confirmPassword')}
              </label>
              <input
                id="invite-confirm"
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
              <div className={styles.errorMessage}>{t('auth.acceptInvite.passwordMismatch')}</div>
            )}
          </div>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            fullWidth
            loading={loading}
            disabled={!isFormValid}
            icon={<UserPlus size={18} />}
          >
            {loading ? t('auth.acceptInvite.submitting') : t('auth.acceptInvite.submit')}
          </Button>
        </form>
      </div>
    </div>
  );
}
