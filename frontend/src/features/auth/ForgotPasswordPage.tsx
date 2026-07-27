import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Mail, ArrowLeft, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import api from '../../services/api/client';
import styles from './ForgotPasswordPage.module.css';

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
      <div className={styles.wrapper}>
        <div className={styles.card}>
          <Link to="/login" className={styles.backLink}>
            <ArrowLeft size={14} /> {t('auth.forgotPassword.backToLogin')}
          </Link>
          <div className={styles.successBox}>
            <CheckCircle2 size={18} />
            <span>{t('auth.forgotPassword.success')}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.card}>
        <Link to="/login" className={styles.backLink}>
          <ArrowLeft size={14} /> {t('auth.forgotPassword.backToLogin')}
        </Link>
        <h1 className={styles.title}>{t('auth.forgotPassword.title')}</h1>
        <p className={styles.subtitle}>{t('auth.forgotPassword.description')}</p>

        {error && (
          <div className={styles.errorBox}>
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className={`${styles.inputOuter} ${focused ? styles.inputOuterFocused : ''}`}>
            <Mail size={16} color={'var(--color-text-tertiary)'} />
            <input
              type="email"
              placeholder={t('auth.forgotPassword.email')}
              autoComplete="email"
              className={styles.inputField}
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
            className={`${styles.submitBtn} ${styles.submitBtnWhiteText} ${loading || !email ? styles.submitBtnDisabled : styles.submitBtnEnabled}`}
          >
            {loading ? (
              <>
                <Loader2 size={18} className={styles.spinner} />
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
