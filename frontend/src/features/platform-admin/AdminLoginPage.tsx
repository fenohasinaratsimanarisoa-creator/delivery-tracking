import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Shield, Loader2, Key, Smartphone } from 'lucide-react';
import axios from 'axios';
import { setAdminToken } from '../../services/auth/adminTokenStore';
import styles from './AdminLoginPage.module.css';

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
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.logoBox}>
            <Shield size={28} />
          </div>
          <h1 className={styles.cardTitle}>
            {t('admin.login.title')}
          </h1>
          <p className={styles.cardSubtitle}>
            {step === 'setup-2fa' ? t('admin.login.twoFactor.setupTitle') :
             step === '2fa' ? t('admin.login.twoFactor.verifyTitle') :
             t('admin.login.subtitle')}
          </p>
        </div>

        {error && (
          <div className={styles.errorBanner}>
            {error}
          </div>
        )}

        {step === 'setup-2fa' && (
          <div>
            <div className={styles.infoBanner}>
              <Smartphone size={18} className={styles.infoBannerIcon} />
              {t('admin.login.twoFactor.setupDesc')}
            </div>

            {qrCode && (
              <div className={styles.qrContainer}>
                <img src={qrCode} alt="QR Code 2FA" className={styles.qrImage} />
              </div>
            )}

            {otpauthUrl && !qrCode && (
              <div className={styles.otpUrlBox}>
                {otpauthUrl}
              </div>
            )}

            <form onSubmit={handleSetup2fa}>
              <div className={styles.formField}>
                <label className={styles.formLabel}>
                  {t('admin.login.twoFactor.codeLabel')}
                </label>
                <div className={styles.inputWrapper}>
                  <Key size={16} className={styles.inputIcon} />
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder={t('admin.login.twoFactor.codePlaceholder')}
                    value={twoFactorCode}
                    onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, ''))}
                    className={`${styles.inputField} ${styles.inputFieldWithIcon} ${styles.inputFieldCenter}`}
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={loading || twoFactorCode.length !== 6}
                className={styles.submitBtn}
              >
                {loading && <Loader2 size={16} className="spin" />}
                {t('admin.login.twoFactor.enableAndContinue')}
              </button>
            </form>
          </div>
        )}

        {step === '2fa' && (
          <form onSubmit={handleVerify2fa}>
            <div className={styles.formField}>
              <label className={styles.formLabel}>
                {t('admin.login.twoFactor.codeLabel')}
              </label>
              <div className={styles.inputWrapper}>
                <Key size={16} className={styles.inputIcon} />
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder={t('admin.login.twoFactor.verifyPlaceholder')}
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, ''))}
                  className={`${styles.inputField} ${styles.inputFieldWithIcon} ${styles.inputFieldCenter}`}
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={loading || twoFactorCode.length !== 6}
              className={styles.submitBtn}
            >
              {loading && <Loader2 size={16} className="spin" />}
              {t('admin.login.twoFactor.verify')}
            </button>
          </form>
        )}

        {step === 'login' && (
          <form onSubmit={handleLogin}>
            <div className={styles.formField}>
              <label className={styles.formLabel}>
                {t('admin.login.email')}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('admin.login.emailPlaceholder')}
                required
                className={styles.inputField}
              />
            </div>
            <div className={styles.formFieldLast}>
              <label className={styles.formLabel}>
                {t('admin.login.password')}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('admin.login.passwordPlaceholder')}
                required
                minLength={6}
                className={styles.inputField}
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className={styles.submitBtn}
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
