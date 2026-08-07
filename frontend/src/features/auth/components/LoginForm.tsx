import { useState, useRef, useEffect, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  Eye, EyeOff, LogIn, AlertCircle, Lock, ShieldCheck,
  MapPin, FileCheck, Radio,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isNativeApp, openGoogleOAuthInNative } from '../../../services/native/nativeAuth';
import Button from '../../../components/Button';
import styles from './LoginForm.module.css';

interface Props {
  onSubmit: (email: string, password: string) => Promise<void>;
  error: string;
  loading: boolean;
  cachedName?: string;
  cachedEmail?: string;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function animate(delay: number): React.CSSProperties {
  return {
    animation: prefersReducedMotion() ? 'none' : `dt-fade-in-up ${'400ms'} ease-out ${delay}s both`,
  };
}

export default function LoginForm({ onSubmit, error, loading, cachedName, cachedEmail }: Props) {
  const { t } = useTranslation();
  const [email, setEmail] = useState(cachedEmail || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [focused, setFocused] = useState<'email' | 'password' | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  const [googleConfigured, setGoogleConfigured] = useState<boolean | null>(null);

  useEffect(() => { emailRef.current?.focus(); }, []);

  useEffect(() => {
    fetch('/api/auth/google/status')
      .then(r => r.json())
      .then(d => setGoogleConfigured(d.configured))
      .catch(() => setGoogleConfigured(false));
  }, []);

  const emailErr = touched.email && email.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const passwordErr = touched.password && password.length === 0;
  const isFormValid = email.length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && password.length > 0;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setTouched({ email: true, password: true });
    if (!isFormValid) return;
    onSubmit(email, password);
  };

  return (
    <>
      <div className={styles.form}>
        <div style={animate(0)}>
          <div className={styles.brand}>
            <div className={styles.brandIcon}>D</div>
            <span className={styles.brandName}>{t('auth.login.brand')}</span>
            <span className={styles.brandBadge}>PRO</span>
          </div>
          <div className={styles.socialProof}>
            <ShieldCheck size={12} className={styles.shieldIcon} />
            <span>{t('auth.login.secure')}</span>
            <span className={styles.socialDot} />
            <span>{t('auth.login.uptime')}</span>
          </div>
        </div>

        <div style={animate(0.04)}>
          <h2 className={styles.welcome}>
            {cachedName ? t('auth.login.welcomeBack', { name: cachedName }) : t('auth.login.welcome')}
          </h2>
          <p className={styles.subtitle}>
            {cachedEmail
              ? t('auth.login.enterPassword')
              : t('auth.login.loginPrompt')}
          </p>
        </div>

        {error && (
          <div style={animate(0.08)}>
            <div className={styles.generalError}>
              <AlertCircle size={16} className={styles.alertIcon} />
              <span>{error}</span>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className={styles.fieldGroup} style={animate(0.1)}>
            <div className={`${styles.inputOuter} ${focused === 'email' ? styles.inputFocus : ''} ${emailErr ? styles.inputOuterError : ''}`}>
              <label
                className={`${styles.label} ${(email || focused === 'email' || focused === 'password') ? styles.labelUp : ''}`}
                htmlFor="login-email"
              >
                {t('auth.login.email')}
              </label>
              <input
                ref={emailRef}
                id="login-email"
                type="email"
                autoComplete="email"
                className={styles.input}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={() => setFocused('email')}
                onBlur={() => { setFocused(null); setTouched((p) => ({ ...p, email: true })); }}
              />
            </div>
            {emailErr && (
              <div className={styles.fieldError}>
                <AlertCircle size={12} />
                <span>{t('auth.login.invalidEmail')}</span>
              </div>
            )}
          </div>

          <div className={styles.fieldGroup} style={animate(0.14)}>
            <div className={`${styles.inputOuter} ${focused === 'password' ? styles.inputFocus : ''} ${passwordErr ? styles.inputOuterError : ''}`}>
              <label
                className={`${styles.label} ${(password || focused === 'email' || focused === 'password') ? styles.labelUp : ''}`}
                htmlFor="login-password"
              >
                {t('auth.login.password')}
              </label>
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                className={styles.input}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setFocused('password')}
                onBlur={() => { setFocused(null); setTouched((p) => ({ ...p, password: true })); }}
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
            {passwordErr && (
              <div className={styles.fieldError}>
                <AlertCircle size={12} />
                <span>{t('auth.login.passwordRequired')}</span>
              </div>
            )}
          </div>

          <div style={animate(0.18)}>
            <div className={styles.options}>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                <span className={styles.checkboxMark} aria-hidden />
                {t('auth.login.rememberMe')}
              </label>
              <Link to="/forgot-password" className={styles.forgotLink}>
                {t('auth.login.forgotPassword')}
              </Link>
            </div>
          </div>

          <div style={animate(0.22)}>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              loading={loading}
              disabled={!isFormValid}
              icon={<LogIn size={18} />}
            >
              {loading ? t('auth.login.submitting') : t('auth.login.submit')}
            </Button>
          </div>
        </form>

        <div style={animate(0.26)}>
          <div className={styles.securityRow}>
            <Lock size={12} />
            <span>{t('auth.login.secureConnection')}</span>
          </div>
        </div>

        {googleConfigured === true && (
          <div style={animate(0.3)}>
            <div className={styles.divider}>
              <span className={styles.dividerLine} />
              <span className={styles.dividerText}>{t('common.or')}</span>
              <span className={styles.dividerLine} />
            </div>
            <Button
              type="button"
              variant="outline"
              size="lg"
              fullWidth
              onClick={() => {
                if (isNativeApp()) {
                  openGoogleOAuthInNative().catch((err) => {
                    console.error('[login] native Google OAuth failed to start:', err);
                  });
                  return;
                }
                window.location.href = '/api/auth/google';
              }}
            >
              <span className={styles.googleG}>G</span>
              {t('auth.login.googleLogin')}
            </Button>
          </div>
        )}

        <div className={styles.featuresRow} style={animate(0.3)}>
          <span className={styles.featureItem}>
            <MapPin size={13} />
            {t('auth.login.features.gps')}
          </span>
          <span className={styles.featureItem}>
            <FileCheck size={13} />
            {t('auth.login.features.proofs')}
          </span>
          <span className={styles.featureItem}>
            <Radio size={13} />
            {t('auth.login.features.live')}
          </span>
        </div>

        <div className={styles.footerText} style={animate(0.34)}>
          {t('auth.login.noAccount')}{' '}
          <Link to="/register" className={styles.signupLink}>
            {t('auth.login.createAccount')}
          </Link>
        </div>
      </div>
    </>
  );
}