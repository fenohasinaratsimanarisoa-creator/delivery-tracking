import { useState, useRef, useEffect, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  Eye, EyeOff, LogIn, Loader2, AlertCircle, Lock, ShieldCheck,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { keyframes } from '../../../styles/theme';

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

const raw = {
  form: {
    width: '100%',
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  brandIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    background: `linear-gradient(135deg, var(--color-accent), #1e40af)`,
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
    letterSpacing: '-0.01em',
  },
  socialProof: {
    fontSize: 12,
    color: 'var(--color-text-tertiary)',
    marginBottom: 24,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  socialDot: {
    width: 3,
    height: 3,
    borderRadius: '50%',
    background: 'var(--color-text-tertiary)',
    flexShrink: 0,
  },
  welcome: {
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
  fieldGroup: {
    marginBottom: 18,
    position: 'relative' as const,
  },
  inputOuter: {
    position: 'relative' as const,
    borderRadius: 'var(--radius-md)',
    border: `1px solid ${'var(--color-input-border)'}`,
    background: 'var(--color-input-bg)',
    transition: 'border-color var(--transition-normal), box-shadow var(--transition-normal)',
    overflow: 'hidden',
  },
  inputOuterFocus: {
    borderColor: 'var(--color-accent)',
    boxShadow: '0 0 0 3px var(--color-accent-muted)',
  },
  inputOuterError: {
    borderColor: 'var(--color-red)',
    boxShadow: '0 0 0 3px var(--color-red-muted)',
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
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'color var(--transition-fast)',
  },
  fieldError: {
    fontSize: 12,
    color: 'var(--color-red)',
    marginTop: 4,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  options: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    color: 'var(--color-text-secondary)',
    cursor: 'pointer',
    userSelect: 'none' as const,
  },
  checkbox: {
    width: 16,
    height: 16,
    accentColor: 'var(--color-accent)',
    cursor: 'pointer',
  },
  forgotLink: {
    fontSize: 13,
    color: 'var(--color-accent)',
    textDecoration: 'none',
    cursor: 'pointer',
    transition: 'opacity var(--transition-fast)',
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
    transition: 'transform var(--transition-fast), box-shadow var(--transition-fast), background var(--transition-normal)',
    position: 'relative' as const,
    overflow: 'hidden',
  },
  submitBtnActive: {
    background: `linear-gradient(180deg, var(--color-accent), #1648c0)`,
    color: 'var(--color-bg)',
    boxShadow: 'var(--shadow-sm)',
  },
  submitBtnDisabled: {
    background: '#94b9f8',
    color: 'var(--color-bg)',
    cursor: 'not-allowed',
  },
  securityRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 16,
    fontSize: 12,
    color: 'var(--color-text-tertiary)',
  },
  generalError: {
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
  divider: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginTop: 20,
    marginBottom: 16,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    background: 'var(--color-input-border)',
  },
  dividerText: {
    fontSize: 12,
    color: 'var(--color-text-tertiary)',
    fontWeight: 500,
  },
  ssoButton: {
    width: '100%',
    padding: '10px 24px',
    borderRadius: 'var(--radius-md)',
    border: `1px solid ${'var(--color-input-border)'}`,
    background: 'var(--color-input-bg)',
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--color-text-secondary)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    transition: `border-color ${'var(--transition-fast)'}, background ${'var(--transition-fast)'}`,
  },
};

function s<K extends keyof typeof raw>(k: K): (typeof raw)[K] {
  return raw[k];
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

  const inputOuterStyle = (field: 'email' | 'password', err: boolean) => ({
    ...s('inputOuter'),
    ...(focused === field ? s('inputOuterFocus') : {}),
    ...(err ? s('inputOuterError') : {}),
  });

  const labelStyle = (val: string) => ({
    ...s('label'),
    ...(val || focused === 'email' || focused === 'password' ? s('labelUp') : {}),
  });

  return (
    <>
      <style>{keyframes}</style>

      <div style={s('form')}>
        <div style={animate(0)}>
          <div style={s('brand')}>
            <div style={s('brandIcon')}>DT</div>
            <span style={s('brandName')}>DeliveryTrack</span>
          </div>
          <div style={s('socialProof')}>
            <ShieldCheck size={12} />
            <span>{t('auth.login.secure')}</span>
            <span style={s('socialDot')} />
            <span>{t('auth.login.uptime')}</span>
          </div>
        </div>

        <div style={animate(0.04)}>
          <h2 style={s('welcome')}>
            {cachedName ? t('auth.login.welcomeBack', { name: cachedName }) : t('auth.login.welcome')}
          </h2>
          <p style={s('subtitle')}>
            {cachedEmail
              ? t('auth.login.enterPassword')
              : t('auth.login.loginPrompt')}
          </p>
        </div>

        {error && (
          <div style={animate(0.08)}>
            <div style={s('generalError')}>
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div style={{ ...s('fieldGroup'), ...animate(0.1) } as React.CSSProperties}>
            <div style={inputOuterStyle('email', !!emailErr)}>
              <label
                style={labelStyle(email)}
                htmlFor="login-email"
              >
                {t('auth.login.email')}
              </label>
              <input
                ref={emailRef}
                id="login-email"
                type="email"
                autoComplete="email"
                style={s('input')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={() => setFocused('email')}
                onBlur={() => { setFocused(null); setTouched((p) => ({ ...p, email: true })); }}
              />
            </div>
            {emailErr && (
              <div style={s('fieldError')}>
                <AlertCircle size={12} />
                <span>{t('auth.login.invalidEmail')}</span>
              </div>
            )}
          </div>

          <div style={{ ...s('fieldGroup'), ...animate(0.14) } as React.CSSProperties}>
            <div style={inputOuterStyle('password', !!passwordErr)}>
              <label
                style={labelStyle(password)}
                htmlFor="login-password"
              >
                {t('auth.login.password')}
              </label>
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                style={s('input')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setFocused('password')}
                onBlur={() => { setFocused(null); setTouched((p) => ({ ...p, password: true })); }}
              />
              <button
                type="button"
                style={s('passwordToggle')}
                onClick={() => setShowPassword((p) => !p)}
                tabIndex={-1}
                aria-label={showPassword ? t('common.hide') : t('common.show')}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {passwordErr && (
              <div style={s('fieldError')}>
                <AlertCircle size={12} />
                <span>{t('auth.login.passwordRequired')}</span>
              </div>
            )}
          </div>

          <div style={animate(0.18)}>
            <div style={s('options')}>
              <label style={s('checkboxLabel')}>
                <input
                  type="checkbox"
                  style={s('checkbox')}
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                {t('auth.login.rememberMe')}
              </label>
              <Link to="/forgot-password" style={s('forgotLink')}>
                {t('auth.login.forgotPassword')}
              </Link>
            </div>
          </div>

          <div style={animate(0.22)}>
            <button
              type="submit"
              disabled={loading || !isFormValid}
              style={{
                ...s('submitBtn'),
                ...(loading || !isFormValid ? s('submitBtnDisabled') : s('submitBtnActive')),
              }}
              onMouseEnter={(e) => {
                if (!loading && isFormValid) {
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.boxShadow = 'var(--shadow-lg)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = '';
                e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
              }}
            >
              {loading ? (
                <>
                  <Loader2 size={18} style={{ animation: 'dt-spin 0.8s linear infinite' }} />
                  {t('auth.login.submitting')}
                </>
              ) : (
                <>
                  <LogIn size={18} />
                  {t('auth.login.submit')}
                </>
              )}
            </button>
          </div>
        </form>

        <div style={animate(0.26)}>
          <div style={s('securityRow')}>
            <Lock size={12} />
            <span>{t('auth.login.secureConnection')}</span>
          </div>
        </div>

        {googleConfigured === true && (
          <div style={animate(0.30)}>
            <div style={s('divider')}>
              <span style={s('dividerLine')} />
              <span style={s('dividerText')}>{t('common.or')}</span>
              <span style={s('dividerLine')} />
            </div>
            <button
              type="button"
              style={s('ssoButton')}
              onClick={() => { window.location.href = '/api/auth/google'; }}
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
              {t('auth.login.googleLogin')}
            </button>
          </div>
        )}

        <div style={{ ...animate(0.30), textAlign: 'center', marginTop: 20, fontSize: 13, color: 'var(--color-text-secondary)' } as React.CSSProperties}>
          {t('auth.login.noAccount')}{' '}
          <Link to="/register" style={{ color: 'var(--color-accent)', fontWeight: 600, textDecoration: 'none' }}>
            {t('auth.login.createAccount')}
          </Link>
        </div>
      </div>
    </>
  );
}
