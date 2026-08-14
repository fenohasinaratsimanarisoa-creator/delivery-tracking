import { useState, useRef, useEffect, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, AlertCircle, ArrowLeft } from 'lucide-react';
import Button from '../../../components/Button';
import styles from './LoginForm.module.css';

interface Props {
  email: string;
  error: string;
  loading: boolean;
  onVerify: (code: string) => Promise<void>;
  onBack: () => void;
}

export default function TwoFactorForm({ email, error, loading, onVerify, onBack }: Props) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [touched, setTouched] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => { codeRef.current?.focus(); }, []);

  const codeErr = touched && !/^\d{6}$/.test(code);
  const isFormValid = /^\d{6}$/.test(code);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!isFormValid) return;
    onVerify(code);
  };

  return (
    <div className={styles.form}>
      <div className={styles.brand}>
        <div className={styles.brandIcon}>D</div>
        <span className={styles.brandName}>{t('auth.login.brand')}</span>
        <span className={styles.brandBadge}>PRO</span>
      </div>

      <div>
        <h2 className={styles.welcome}>{t('auth.login.twoFactorTitle')}</h2>
        <p className={styles.subtitle}>{t('auth.login.twoFactorDesc')}</p>
        <p className={styles.subtitle}><ShieldCheck size={12} /> {email}</p>
      </div>

      {error && (
        <div className={styles.generalError}>
          <AlertCircle size={16} className={styles.alertIcon} />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <div className={styles.fieldGroup}>
          <div className={`${styles.inputOuter} ${codeErr ? styles.inputOuterError : ''}`}>
            <label className={`${styles.label} ${code ? styles.labelUp : ''}`} htmlFor="login-2fa-code">
              {t('auth.login.twoFactorCode')}
            </label>
            <input
              ref={codeRef}
              id="login-2fa-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className={styles.input}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onBlur={() => setTouched(true)}
            />
          </div>
          {codeErr && (
            <div className={styles.fieldError}>
              <AlertCircle size={12} />
              <span>{t('auth.login.twoFactorCode')}</span>
            </div>
          )}
        </div>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          loading={loading}
          disabled={!isFormValid}
        >
          {loading ? t('auth.login.submitting') : t('auth.login.twoFactorSubmit')}
        </Button>
      </form>

      <button type="button" className={styles.backLink} onClick={onBack} disabled={loading}>
        <ArrowLeft size={14} /> {t('auth.login.twoFactorBack')}
      </button>
    </div>
  );
}