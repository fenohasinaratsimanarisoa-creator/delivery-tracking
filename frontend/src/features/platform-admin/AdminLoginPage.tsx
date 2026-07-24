import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Shield, Loader2, Key, Smartphone } from 'lucide-react';
import axios from 'axios';
import { setAdminToken } from '../../services/auth/adminTokenStore';

export default function AdminLoginPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState<'login' | '2fa' | 'setup-2fa'>('login');
  const [tempToken, setTempToken] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [otpauthUrl, setOtpauthUrl] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await axios.post('/api/platform-admin/auth/login', { email, password });
      if (res.data.requires2faSetup) {
        setTempToken(res.data.tempToken);
        setQrCode(res.data.qrCode || '');
        setOtpauthUrl(res.data.otpauthUrl || '');
        setStep('setup-2fa');
      } else if (res.data.requiresTwoFactor) {
        setTempToken(res.data.tempToken);
        setStep('2fa');
      } else if (res.data.accessToken) {
        setAdminToken(res.data.accessToken);
        navigate('/admin');
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || t('admin.login.error'));
    } finally {
      setLoading(false);
    }
  };

  const handleVerify2fa = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await axios.post('/api/platform-admin/auth/verify-2fa', {
        tempToken,
        token: twoFactorCode,
      });
      setAdminToken(res.data.accessToken);
      navigate('/admin');
    } catch (err: any) {
      setError(err?.response?.data?.message || t('admin.login.twoFactor.invalidCode'));
    } finally {
      setLoading(false);
    }
  };

  const handleSetup2fa = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await axios.post('/api/platform-admin/auth/setup-2fa', {
        tempToken,
        token: twoFactorCode,
      });
      setAdminToken(res.data.accessToken);
      navigate('/admin');
    } catch (err: any) {
      setError(err?.response?.data?.message || t('admin.login.twoFactor.setupError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--color-bg)', fontFamily: 'var(--font-body)',
    }}>
      <div style={{
        width: 420, maxWidth: '90vw', padding: 'var(--space-2xl)',
        background: 'var(--color-surface)', borderRadius: 'var(--radius-xl)',
        border: '1px solid var(--color-border)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-xl)' }}>
          <div style={{
            width: 56, height: 56, borderRadius: 'var(--radius-full)',
            background: 'var(--color-accent-muted)', color: 'var(--color-accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 12px',
          }}>
            <Shield size={28} />
          </div>
          <h1 style={{
            fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', fontWeight: 700,
            color: 'var(--color-text)', margin: 0,
          }}>
            {t('admin.login.title')}
          </h1>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)', marginTop: 4 }}>
            {step === 'setup-2fa' ? t('admin.login.twoFactor.setupTitle') :
             step === '2fa' ? t('admin.login.twoFactor.verifyTitle') :
             t('admin.login.subtitle')}
          </p>
        </div>

        {error && (
          <div style={{
            padding: 'var(--space-sm) var(--space-md)', borderRadius: 'var(--radius-md)',
            background: 'var(--color-red-muted)', color: 'var(--color-red)',
            fontSize: 'var(--text-sm)', marginBottom: 'var(--space-md)',
          }}>
            {error}
          </div>
        )}

        {step === 'setup-2fa' && (
          <div>
            <div style={{
              padding: 'var(--space-md)', borderRadius: 'var(--radius-md)',
              background: 'var(--color-accent-muted)', color: 'var(--color-accent)',
              fontSize: 'var(--text-sm)', marginBottom: 'var(--space-lg)',
              textAlign: 'center',
            }}>
              <Smartphone size={18} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              {t('admin.login.twoFactor.setupDesc')}
            </div>

            {qrCode && (
              <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
                <img src={qrCode} alt="QR Code 2FA" style={{
                  width: 180, height: 180, borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                }} />
              </div>
            )}

            {otpauthUrl && !qrCode && (
              <div style={{
                marginBottom: 'var(--space-lg)', padding: 'var(--space-sm) var(--space-md)',
                background: 'var(--color-bg)', borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-xs)', wordBreak: 'break-all',
                color: 'var(--color-text-secondary)',
                border: '1px solid var(--color-border)',
              }}>
                {otpauthUrl}
              </div>
            )}

            <form onSubmit={handleSetup2fa}>
              <div style={{ marginBottom: 'var(--space-md)' }}>
                <label style={{
                  display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600,
                  color: 'var(--color-text-secondary)', marginBottom: 6,
                }}>
                  {t('admin.login.twoFactor.codeLabel')}
                </label>
                <div style={{ position: 'relative' }}>
                  <Key size={16} style={{
                    position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                    color: 'var(--color-text-tertiary)',
                  }} />
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder={t('admin.login.twoFactor.codePlaceholder')}
                    value={twoFactorCode}
                    onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, ''))}
                    style={{
                      width: '100%', padding: '10px 12px 10px 36px',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--color-bg)',
                      color: 'var(--color-text)',
                      fontSize: 'var(--text-md)',
                      fontFamily: 'var(--font-body)',
                      outline: 'none', boxSizing: 'border-box',
                      textAlign: 'center', letterSpacing: 8,
                    }}
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={loading || twoFactorCode.length !== 6}
                style={{
                  width: '100%', padding: '10px',
                  background: 'var(--color-accent)',
                  color: '#fff', border: 'none',
                  borderRadius: 'var(--radius-md)',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  fontWeight: 600, fontSize: 'var(--text-sm)',
                  fontFamily: 'var(--font-body)',
                  opacity: loading ? 0.7 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                {loading && <Loader2 size={16} className="spin" />}
                {t('admin.login.twoFactor.enableAndContinue')}
              </button>
            </form>
          </div>
        )}

        {step === '2fa' && (
          <form onSubmit={handleVerify2fa}>
            <div style={{ marginBottom: 'var(--space-md)' }}>
              <label style={{
                display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600,
                color: 'var(--color-text-secondary)', marginBottom: 6,
              }}>
                {t('admin.login.twoFactor.codeLabel')}
              </label>
              <div style={{ position: 'relative' }}>
                <Key size={16} style={{
                  position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                  color: 'var(--color-text-tertiary)',
                }} />
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                    placeholder={t('admin.login.twoFactor.verifyPlaceholder')}
                    value={twoFactorCode}
                    onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, ''))}
                    style={{
                      width: '100%', padding: '10px 12px 10px 36px',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--color-bg)',
                      color: 'var(--color-text)',
                      fontSize: 'var(--text-md)',
                      fontFamily: 'var(--font-body)',
                      outline: 'none', boxSizing: 'border-box',
                      textAlign: 'center', letterSpacing: 8,
                    }}
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={loading || twoFactorCode.length !== 6}
                style={{
                  width: '100%', padding: '10px',
                  background: 'var(--color-accent)',
                  color: '#fff', border: 'none',
                  borderRadius: 'var(--radius-md)',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  fontWeight: 600, fontSize: 'var(--text-sm)',
                  fontFamily: 'var(--font-body)',
                  opacity: loading ? 0.7 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                {loading && <Loader2 size={16} className="spin" />}
                {t('admin.login.twoFactor.verify')}
            </button>
          </form>
        )}

        {step === 'login' && (
          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: 'var(--space-md)' }}>
              <label style={{
                display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600,
                color: 'var(--color-text-secondary)', marginBottom: 6,
              }}>
                {t('admin.login.email')}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('admin.login.emailPlaceholder')}
                required
                style={{
                  width: '100%', padding: '10px 12px',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--color-bg)',
                  color: 'var(--color-text)',
                  fontSize: 'var(--text-sm)',
                  fontFamily: 'var(--font-body)',
                  outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ marginBottom: 'var(--space-lg)' }}>
              <label style={{
                display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600,
                color: 'var(--color-text-secondary)', marginBottom: 6,
              }}>
                {t('admin.login.password')}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('admin.login.passwordPlaceholder')}
                required
                minLength={6}
                style={{
                  width: '100%', padding: '10px 12px',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--color-bg)',
                  color: 'var(--color-text)',
                  fontSize: 'var(--text-sm)',
                  fontFamily: 'var(--font-body)',
                  outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%', padding: '10px',
                background: 'var(--color-accent)',
                color: '#fff', border: 'none',
                borderRadius: 'var(--radius-md)',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontWeight: 600, fontSize: 'var(--text-sm)',
                fontFamily: 'var(--font-body)',
                opacity: loading ? 0.7 : 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              {loading && <Loader2 size={16} className="spin" />}
              {t('admin.login.submit')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
