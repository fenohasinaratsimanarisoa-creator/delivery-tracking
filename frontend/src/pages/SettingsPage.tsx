import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { setLanguage, getLanguage } from '../services/i18n/i18n';
import { formatDateTime } from '../services/i18n/formatDate';
import { useAuth } from '../hooks/AuthContext';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Smartphone, Shield, Key, Eye, X, LogOut } from 'lucide-react';
import Button from '../components/Button';
import api from '../services/api/client';
import { useToast } from '../components/Toast';
import AppearanceSection from '../features/settings/sections/AppearanceSection';

function PasswordStrength({ password }: { password: string }) {
  const { t } = useTranslation();
  const score = password.length < 8 ? 0 : (
    [/[a-z]/, /[A-Z]/, /\d/, /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/].filter(r => r.test(password)).length
  );
  const bars = [0, 0, 0, 0].map((_, i) => i < score);
  const colors = ['#ef4444', '#f59e0b', '#3b82f6', '#22c55e'];
  const labels = [t('settingsSecurity.passwordVeryWeak'), t('settingsSecurity.passwordWeak'), t('settingsSecurity.passwordMedium'), t('settingsSecurity.passwordStrong')];

  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ display: 'flex', gap: 3 }}>
        {bars.map((active, i) => (
          <div key={i} style={{
            flex: 1, height: 3, borderRadius: 2,
            background: active ? colors[score - 1] : 'var(--color-border-subtle)',
            transition: 'background 0.15s',
          }} />
        ))}
      </div>
      {password.length > 0 && (
        <div style={{ fontSize: '0.65rem', color: colors[Math.max(0, score - 1)], marginTop: 2, fontWeight: 600 }}>
          {labels[Math.max(0, score - 1)]}
        </div>
      )}
    </div>
  );
}

function SectionCard({ title, children, subtitle }: { title: string; children: React.ReactNode; subtitle?: string }) {
  return (
    <section style={{
      background: 'var(--color-surface, #121B2E)',
      border: '1px solid var(--color-border-subtle, rgba(232,236,243,0.08))',
      borderRadius: 'var(--radius-xl, 12px)',
      padding: 'var(--space-xl, 20px)',
      marginBottom: 'var(--space-xl, 20px)',
    }}>
      <h2 style={{
        fontFamily: 'var(--font-display, Space Grotesk, sans-serif)',
        fontSize: 'var(--text-lg, 1.125rem)',
        fontWeight: 600, color: 'var(--color-text, #E8ECF3)',
        margin: '0 0 var(--space-xs, 4px)',
      }}>
        {title}
      </h2>
      {subtitle && (
        <p style={{ color: 'var(--color-text-secondary, #9BA6B9)', fontSize: 'var(--text-sm, 0.875rem)', margin: '0 0 var(--space-lg, 16px)' }}>
          {subtitle}
        </p>
      )}
      {children}
    </section>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: 'var(--space-sm, 8px) 0', cursor: 'pointer',
      borderBottom: '1px solid var(--color-border-subtle, rgba(232,236,243,0.08))',
      fontSize: 'var(--text-sm, 0.875rem)',
      color: 'var(--color-text, #E8ECF3)',
    }}>
      <span>{label}</span>
      <div style={{
        width: 40, height: 22, borderRadius: 11,
        background: checked ? 'var(--color-accent, #F2A93C)' : 'var(--color-border, rgba(242,169,60,0.2))',
        position: 'relative', transition: 'background 0.15s', flexShrink: 0,
      }}>
        <div style={{
          width: 18, height: 18, borderRadius: '50%',
          background: '#fff', position: 'absolute', top: 2,
          transition: 'left 0.15s',
          left: checked ? 20 : 2,
        }} />
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
          style={{ position: 'absolute', opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
      </div>
    </label>
  );
}

export default function SettingsPage() {
  const { t } = useTranslation();
  const { user, updateUser } = useAuth();
  const { toast } = useToast();
  const [lang, setLang] = useState(getLanguage());
  const [firstName, setFirstName] = useState(user?.firstName || '');
  const [lastName, setLastName] = useState(user?.lastName || '');

  // Password change
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);

  // 2FA
  const [qrCode, setQrCode] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [twoFactorStep, setTwoFactorStep] = useState<'idle' | 'setup' | 'disable'>('idle');

  // Sessions
  const [sessions, setSessions] = useState<any[]>([]);

  const handleLanguageChange = (l: 'fr' | 'en') => { setLanguage(l); setLang(l); };

  // Profile mutation
  const profileMutation = useMutation({
    mutationFn: (body: { firstName: string; lastName: string }) =>
      api.patch('/users/me/profile', body),
    onSuccess: () => {
      updateUser({ firstName: firstName.trim(), lastName: lastName.trim() });
      toast(t('settingsProfile.updated'));
    },
    onError: (err: any) => toast(err?.response?.data?.message || t('common.error'), 'error'),
  });

  const handleSaveProfile = () => {
    if (!firstName.trim() || !lastName.trim()) { toast(t('settingsProfile.nameRequired'), 'error'); return; }
    profileMutation.mutate({ firstName: firstName.trim(), lastName: lastName.trim() });
  };

  const hasProfileChanges = firstName !== (user?.firstName || '') || lastName !== (user?.lastName || '');

  // Password mutation
  const pwMutation = useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string; confirmPassword: string }) =>
      api.patch('/users/me/password', body),
    onSuccess: () => {
      toast(t('settingsSecurity.passwordChanged'));
      setPwCurrent(''); setPwNew(''); setPwConfirm('');
    },
    onError: (err: any) => toast(err?.response?.data?.message || t('common.error'), 'error'),
  });

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pwCurrent) { toast(t('settingsSecurity.currentPasswordRequired'), 'error'); return; }
    if (pwNew.length < 8) { toast(t('settingsSecurity.newPasswordLengthError'), 'error'); return; }
    if (pwNew !== pwConfirm) { toast(t('settingsSecurity.passwordMismatch'), 'error'); return; }
    pwMutation.mutate({ currentPassword: pwCurrent, newPassword: pwNew, confirmPassword: pwConfirm });
  };

  // 2FA generate
  const generate2faMutation = useMutation({
    mutationFn: () => api.get('/auth/2fa/generate'),
    onSuccess: (res) => {
      setQrCode(res.data.qrCode);
      setTwoFactorStep('setup');
    },
    onError: (err: any) => toast(err?.response?.data?.message || t('common.error'), 'error'),
  });

  // 2FA verify
  const verify2faMutation = useMutation({
    mutationFn: (token: string) => api.post('/auth/2fa/verify', { token }),
    onSuccess: () => {
      toast(t('settingsSecurity.twoFactorEnabledToast'));
      setTwoFactorStep('idle');
      setQrCode('');
      setTwoFactorCode('');
    },
    onError: (err: any) => toast(err?.response?.data?.message || t('settingsSecurity.twoFactorInvalidCode'), 'error'),
  });

  const handleVerify2fa = (e: React.FormEvent) => {
    e.preventDefault();
    if (twoFactorCode.length !== 6) { toast(t('settingsSecurity.twoFactorCodeRequired'), 'error'); return; }
    verify2faMutation.mutate(twoFactorCode);
  };

  // 2FA disable (requires TOTP code)
  const disable2faMutation = useMutation({
    mutationFn: (token: string) => api.post('/auth/2fa/disable', { token }),
    onSuccess: () => {
      toast(t('settingsSecurity.twoFactorDisabledToast'));
      setTwoFactorStep('idle');
      setTwoFactorCode('');
    },
    onError: (err: any) => toast(err?.response?.data?.message || t('settingsSecurity.twoFactorInvalidCode'), 'error'),
  });

  const handleDisable2fa = (e: React.FormEvent) => {
    e.preventDefault();
    if (twoFactorCode.length !== 6) { toast(t('settingsSecurity.twoFactorCodeRequired'), 'error'); return; }
    disable2faMutation.mutate(twoFactorCode);
  };

  // Sessions
  const fetchSessions = useCallback(async () => {
    try {
      const res = await api.get('/auth/sessions');
      setSessions(res.data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  const revokeSessionMutation = useMutation({
    mutationFn: (sessionId: string) => api.delete(`/auth/sessions/${sessionId}`),
    onSuccess: () => { fetchSessions(); toast(t('settingsSecurity.sessionRevoked')); },
    onError: (err: any) => toast(err?.response?.data?.message || t('common.error'), 'error'),
  });

  const revokeAllMutation = useMutation({
    mutationFn: () => api.post('/auth/sessions/revoke-all'),
    onSuccess: () => { fetchSessions(); toast(t('settingsSecurity.allSessionsRevoked')); },
    onError: (err: any) => toast(err?.response?.data?.message || t('common.error'), 'error'),
  });

  // Notification preferences
  const { data: prefs, refetch: refetchPrefs } = useQuery({
    queryKey: ['user-preferences'],
    queryFn: () => api.get('/users/me/preferences').then(r => r.data),
  });

  const prefMutation = useMutation({
    mutationFn: (body: Record<string, boolean>) => api.patch('/users/me/preferences', body),
    onSuccess: () => { refetchPrefs(); toast(t('settingsNotifications.preferenceUpdated'), 'success'); },
    onError: () => toast(t('settingsNotifications.updateError'), 'error'),
  });

  const togglePref = (key: string, value: boolean) => {
    prefMutation.mutate({ [key]: value });
  };

  const is2faEnabled = !!(user as any)?.totpEnabled;

  return (
    <div style={{
      position: 'absolute', inset: 0, overflow: 'auto',
      padding: 'var(--space-2xl, 32px) var(--space-xl, 20px)',
    }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <h1 style={{
          fontFamily: 'var(--font-display, Space Grotesk, sans-serif)',
          fontSize: 'var(--text-2xl, 1.5rem)', fontWeight: 700,
          color: 'var(--color-text, #E8ECF3)', marginBottom: 'var(--space-xs, 4px)',
        }}>
          {t('settings.title')}
        </h1>
        <p style={{
          color: 'var(--color-text-secondary, #9BA6B9)', fontSize: 'var(--text-sm, 0.875rem)',
          marginBottom: 'var(--space-2xl, 32px)',
        }}>
          {t('settings.subtitle')}
        </p>

        {/* Profile */}
        <SectionCard title={t('settings.profile')}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md, 12px)' }}>
            <div style={{ display: 'flex', gap: 'var(--space-lg, 16px)' }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>{t('settings.firstName')}</label>
                <input value={firstName} onChange={(e) => setFirstName(e.target.value)} style={inputStyle} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>{t('settings.lastName')}</label>
                <input value={lastName} onChange={(e) => setLastName(e.target.value)} style={inputStyle} />
              </div>
            </div>
            <div>
              <label style={labelStyle}>{t('settings.email')}</label>
              <div style={{ ...inputStyle, background: 'var(--color-surface-alt, #182339)', opacity: 0.6 }}>
                {user?.email || '—'}
              </div>
            </div>
            <div>
              <label style={labelStyle}>{t('settings.role')}</label>
              <div style={{ ...inputStyle, background: 'var(--color-surface-alt, #182339)', opacity: 0.6, textTransform: 'capitalize' }}>
                {user?.role || '—'}
              </div>
            </div>
            {hasProfileChanges && (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button variant="primary" size="sm" icon={<Check size={14} />}
                  loading={profileMutation.isPending} onClick={handleSaveProfile}>
                  {t('settingsProfile.saveButton')}
                </Button>
              </div>
            )}
          </div>
        </SectionCard>

        {/* Security - Password */}
        <SectionCard title={t('settingsSecurity.passwordTitle')} subtitle={t('settingsSecurity.passwordSubtitle')}>
          <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md, 12px)' }}>
            <div>
              <label style={labelStyle}>{t('settingsSecurity.currentPassword')}</label>
              <div style={{ position: 'relative' }}>
                <input type={showPw ? 'text' : 'password'} value={pwCurrent}
                  onChange={(e) => setPwCurrent(e.target.value)} style={inputStyle}
                  placeholder={t('settingsSecurity.currentPasswordPlaceholder')} />
              </div>
            </div>
            <div>
              <label style={labelStyle}>{t('settingsSecurity.newPassword')}</label>
              <div style={{ position: 'relative' }}>
                <input type={showPw ? 'text' : 'password'} value={pwNew}
                  onChange={(e) => setPwNew(e.target.value)} style={inputStyle}
                  placeholder={t('settingsSecurity.newPasswordPlaceholder')} />
              </div>
              <PasswordStrength password={pwNew} />
            </div>
            <div>
              <label style={labelStyle}>{t('settingsSecurity.confirmPassword')}</label>
              <div style={{ position: 'relative' }}>
                <input type={showPw ? 'text' : 'password'} value={pwConfirm}
                  onChange={(e) => setPwConfirm(e.target.value)} style={inputStyle}
                  placeholder={t('settingsSecurity.confirmPasswordPlaceholder')} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{
                display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                fontSize: '0.75rem', color: 'var(--color-text-secondary, #9BA6B9)',
              }}>
                <input type="checkbox" checked={showPw} onChange={(e) => setShowPw(e.target.checked)} />
                <Eye size={12} /> {t('settingsSecurity.showPassword')}
              </label>
              <Button type="submit" variant="primary" size="sm" icon={<Key size={14} />}
              loading={pwMutation.isPending}
              disabled={!pwCurrent || !pwNew || !pwConfirm}>
                {t('settingsSecurity.changePassword')}
              </Button>
            </div>
          </form>
        </SectionCard>

        {/* Security - 2FA */}
        <SectionCard title={t('settingsSecurity.twoFactorTitle')} subtitle={t('settingsSecurity.twoFactorSubtitle')}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16,
            padding: 'var(--space-md, 12px)', borderRadius: 'var(--radius-md, 6px)',
            background: is2faEnabled ? 'var(--color-teal-muted, rgba(63,167,150,0.1))' : 'var(--color-surface-alt, #182339)',
            border: '1px solid ' + (is2faEnabled ? 'var(--color-teal, #3FA796)' : 'var(--color-border-subtle, rgba(232,236,243,0.08))'),
          }}>
            <Shield size={20} style={{ color: is2faEnabled ? 'var(--color-teal, #3FA796)' : 'var(--color-text-tertiary, #7A8BA3)' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: '0.875rem', color: is2faEnabled ? 'var(--color-teal, #3FA796)' : 'var(--color-text, #E8ECF3)' }}>
                {is2faEnabled ? t('settingsSecurity.twoFactorEnabled') : t('settingsSecurity.twoFactorDisabled')}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary, #7A8BA3)' }}>
                {is2faEnabled ? t('settingsSecurity.twoFactorEnabledDescription') : t('settingsSecurity.twoFactorDisabledDescription')}
              </div>
            </div>
            {!is2faEnabled && twoFactorStep !== 'setup' && (
              <Button variant="primary" size="sm" icon={<Smartphone size={14} />}
                loading={generate2faMutation.isPending}
                onClick={() => generate2faMutation.mutate()}>
                {t('settingsSecurity.twoFactorEnable')}
              </Button>
            )}
            {is2faEnabled && twoFactorStep !== 'disable' && (
              <Button variant="danger" size="sm" onClick={() => setTwoFactorStep('disable')}>
                {t('settingsSecurity.twoFactorDisable')}
              </Button>
            )}
          </div>

          {twoFactorStep === 'setup' && (
            <div style={{
              padding: 'var(--space-lg, 16px)', background: 'var(--color-surface-alt, #182339)',
              borderRadius: 'var(--radius-md, 6px)', marginBottom: 12,
            }}>
              <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary, #9BA6B9)', marginTop: 0 }}>
                {t('settingsSecurity.twoFactorSetupStep1')}
              </p>
              {qrCode && (
                <div style={{ textAlign: 'center', marginBottom: 16 }}>
                  <img src={qrCode} alt="QR Code 2FA" style={{
                    width: 160, height: 160, borderRadius: 'var(--radius-md, 6px)',
                    border: '1px solid var(--color-border, rgba(242,169,60,0.2))',
                  }} />
                </div>
              )}
              <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary, #9BA6B9)' }}>
                {t('settingsSecurity.twoFactorSetupStep2')}
              </p>
              <form onSubmit={handleVerify2fa} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <input type="text" inputMode="numeric" maxLength={6} placeholder={t('settingsSecurity.twoFactorCodePlaceholder')}
                  value={twoFactorCode} onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, ''))}
                  style={{
                    ...inputStyle, width: 140, textAlign: 'center', letterSpacing: 6,
                    fontFamily: 'var(--font-mono, monospace)', fontSize: '1rem',
                  }} />
                <Button type="submit" variant="primary" size="sm"
                  loading={verify2faMutation.isPending}
                  disabled={twoFactorCode.length !== 6}>
                  {t('settingsSecurity.twoFactorConfirm')}
                </Button>
                <Button variant="ghost" size="sm"
                  onClick={() => { setTwoFactorStep('idle'); setTwoFactorCode(''); }}>
                  {t('settingsSecurity.twoFactorCancel')}
                </Button>
              </form>
            </div>
          )}

          {twoFactorStep === 'disable' && (
            <div style={{
              padding: 'var(--space-lg, 16px)', background: 'var(--color-red-muted, rgba(232,84,76,0.08))',
              borderRadius: 'var(--radius-md, 6px)', border: '1px solid var(--color-red, #E8544C)', marginBottom: 12,
            }}>
              <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary, #9BA6B9)', margin: '0 0 8px' }}>
                {t('settingsSecurity.twoFactorDisableConfirmText')}
              </p>
              <form onSubmit={handleDisable2fa} style={{ display: 'flex', gap: 8 }}>
                <input type="text" inputMode="numeric" maxLength={6} placeholder={t('settingsSecurity.twoFactorCodePlaceholder')}
                  value={twoFactorCode} onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, ''))}
                  style={{
                    ...inputStyle, width: 140, textAlign: 'center', letterSpacing: 6,
                    fontFamily: 'var(--font-mono, monospace)', fontSize: '1rem',
                  }} />
                <Button type="submit" variant="danger" size="sm"
                  loading={disable2faMutation.isPending}
                  disabled={twoFactorCode.length !== 6}>
                  {t('settingsSecurity.twoFactorDisable')}
                </Button>
                <Button variant="ghost" size="sm"
                  onClick={() => { setTwoFactorStep('idle'); setTwoFactorCode(''); }}>
                  {t('settingsSecurity.twoFactorCancel')}
                </Button>
              </form>
            </div>
          )}
        </SectionCard>

        {/* Security - Sessions */}
        <SectionCard title={t('settingsSecurity.sessionTitle')} subtitle={t('settingsSecurity.sessionSubtitle')}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sessions.length === 0 && (
              <div style={{ fontSize: '0.85rem', color: 'var(--color-text-tertiary, #7A8BA3)', textAlign: 'center', padding: 16 }}>
                {t('settingsSecurity.sessionEmpty')}
              </div>
            )}
            {sessions.map((s: any) => (
              <div key={s.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: 'var(--space-sm, 8px) var(--space-md, 12px)',
                background: s.isCurrent ? 'var(--color-accent-muted, rgba(242,169,60,0.08))' : 'var(--color-surface-alt, #182339)',
                borderRadius: 'var(--radius-md, 6px)',
                border: '1px solid ' + (s.isCurrent ? 'var(--color-accent, #F2A93C)' : 'var(--color-border-subtle, rgba(232,236,243,0.08))'),
              }}>
                <Smartphone size={16} style={{ color: 'var(--color-text-tertiary, #7A8BA3)', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text, #E8ECF3)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {s.device || s.ip || t('settingsSecurity.sessionUnknownDevice')}
                    {s.isCurrent && <span style={{ color: 'var(--color-accent, #F2A93C)', marginLeft: 6, fontSize: '0.65rem', fontWeight: 700 }}>{t('settingsSecurity.sessionCurrent')}</span>}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary, #7A8BA3)' }}>
                    {s.ip && `${t('settingsSecurity.sessionIp')}: ${s.ip} • `}
                    {t('settingsSecurity.sessionLastActivity')} {formatDateTime(s.lastActivity || s.createdAt)}
                  </div>
                </div>
                {!s.isCurrent && (
                  <Button variant="ghost" size="sm"
                    icon={<X size={12} />}
                    loading={revokeSessionMutation.isPending}
                    onClick={() => revokeSessionMutation.mutate(s.id)}>
                    {t('settingsSecurity.sessionRevoke')}
                  </Button>
                )}
              </div>
            ))}
          </div>
          {sessions.length > 1 && (
            <Button variant="outline" size="sm" icon={<LogOut size={14} />}
              loading={revokeAllMutation.isPending}
              onClick={() => revokeAllMutation.mutate()}>
              {t('settingsSecurity.sessionRevokeAll')}
            </Button>
          )}
        </SectionCard>

        {/* Appearance */}
        <SectionCard title={t('settings.appearance')}>
          <AppearanceSection onDirtyChange={() => {}} />
        </SectionCard>

        {/* Language */}
        <SectionCard title={t('settings.language')}>
          <div style={{ display: 'flex', gap: 'var(--space-md, 12px)' }}>
            {(['fr', 'en'] as const).map((l) => (
              <button key={l} onClick={() => handleLanguageChange(l)} style={{
                flex: 1, padding: 'var(--space-md, 12px)',
                border: '2px solid ' + (lang === l ? 'var(--color-accent, #F2A93C)' : 'var(--color-border-subtle, rgba(232,236,243,0.08))'),
                borderRadius: 'var(--radius-lg, 8px)',
                background: lang === l ? 'var(--color-accent-bg, rgba(242,169,60,0.08))' : 'transparent',
                color: 'var(--color-text, #E8ECF3)', cursor: 'pointer',
                fontSize: 'var(--text-sm, 0.875rem)',
                fontFamily: 'var(--font-body, Inter, sans-serif)',
                fontWeight: lang === l ? 600 : 400,
              }}>
                {t(`settings.language${l === 'fr' ? 'Fr' : 'En'}`)}
              </button>
            ))}
          </div>
        </SectionCard>

        {/* Notifications */}
        <SectionCard title={t('settingsNotifications.title')} subtitle={t('settingsNotifications.subtitle')}>
          {prefs && (
            <div>
              <div style={{
                fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase',
                letterSpacing: '0.04em', color: 'var(--color-text-tertiary, #7A8BA3)',
                marginBottom: 4, marginTop: 8,
              }}>
                {t('settingsNotifications.inAppSection')}
              </div>
              <Toggle label={t('settingsNotifications.preferences.deliveryStatus')}
                checked={prefs.inAppDeliveryStatus}
                onChange={(v) => togglePref('inAppDeliveryStatus', v)} />
              <Toggle label={t('settingsNotifications.preferences.fuelAnomaly')}
                checked={prefs.inAppFuelAnomaly}
                onChange={(v) => togglePref('inAppFuelAnomaly', v)} />
              <Toggle label={t('settingsNotifications.preferences.deliveryDelayed')}
                checked={prefs.inAppDeliveryDelayed}
                onChange={(v) => togglePref('inAppDeliveryDelayed', v)} />
              <Toggle label={t('settingsNotifications.preferences.maintenanceDue')}
                checked={prefs.inAppMaintenanceDue}
                onChange={(v) => togglePref('inAppMaintenanceDue', v)} />
              <Toggle label={t('settingsNotifications.preferences.system')}
                checked={prefs.inAppSystem}
                onChange={(v) => togglePref('inAppSystem', v)} />

              <div style={{
                fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase',
                letterSpacing: '0.04em', color: 'var(--color-text-tertiary, #7A8BA3)',
                marginBottom: 4, marginTop: 16,
              }}>
                {t('settingsNotifications.emailSection')}
              </div>
              <Toggle label={t('settingsNotifications.preferences.deliveryStatus')}
                checked={prefs.emailDeliveryStatus}
                onChange={(v) => togglePref('emailDeliveryStatus', v)} />
              <Toggle label={t('settingsNotifications.preferences.fuelAnomaly')}
                checked={prefs.emailFuelAnomaly}
                onChange={(v) => togglePref('emailFuelAnomaly', v)} />
              <Toggle label={t('settingsNotifications.preferences.deliveryDelayed')}
                checked={prefs.emailDeliveryDelayed}
                onChange={(v) => togglePref('emailDeliveryDelayed', v)} />
              <Toggle label={t('settingsNotifications.preferences.maintenanceDue')}
                checked={prefs.emailMaintenanceDue}
                onChange={(v) => togglePref('emailMaintenanceDue', v)} />
              <Toggle label={t('settingsNotifications.preferences.system')}
                checked={prefs.emailSystem}
                onChange={(v) => togglePref('emailSystem', v)} />
            </div>
          )}
        </SectionCard>

      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 'var(--text-xs, 0.75rem)',
  fontWeight: 500, color: 'var(--color-text-secondary, #9BA6B9)',
  textTransform: 'uppercase', letterSpacing: '0.04em',
  marginBottom: 'var(--space-xs, 4px)',
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: 'var(--space-sm, 8px) var(--space-md, 12px)',
  background: 'var(--color-input-bg, #121B2E)',
  border: '1px solid var(--color-input-border, rgba(232,236,243,0.15))',
  borderRadius: 'var(--radius-md, 6px)',
  color: 'var(--color-text, #E8ECF3)',
  fontSize: 'var(--text-sm, 0.875rem)',
  fontFamily: 'var(--font-body, Inter, sans-serif)',
  outline: 'none',
  boxSizing: 'border-box',
};
