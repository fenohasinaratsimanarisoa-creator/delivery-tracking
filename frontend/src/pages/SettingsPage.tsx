import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { setLanguage, getLanguage } from '../services/i18n/i18n';
import { formatDateTime } from '../services/i18n/formatDate';
import { useAuth } from '../hooks/AuthContext';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Smartphone, Shield, Key, LogOut } from 'lucide-react';
import Button from '../components/Button';
import api from '../services/api/client';
import { useToast } from '../components/Toast';

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
          <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: active ? colors[score - 1] : 'var(--color-border-subtle)', transition: 'background 0.15s' }} />
        ))}
      </div>
      {password.length > 0 && <div style={{ fontSize: '0.65rem', color: colors[Math.max(0, score - 1)], marginTop: 2, fontWeight: 600 }}>{labels[Math.max(0, score - 1)]}</div>}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-sm, 8px) 0', cursor: 'pointer', borderBottom: '1px solid var(--color-border-subtle, rgba(232,236,243,0.08))', fontSize: 'var(--text-sm, 0.875rem)', color: 'var(--color-text, #E8ECF3)' }}
      onClick={() => onChange(!checked)}>
      <span>{label}</span>
      <div style={{ width: 40, height: 22, borderRadius: 11, background: checked ? 'var(--color-accent)' : 'var(--color-input-border)', position: 'relative', cursor: 'pointer', transition: 'background 0.15s', flexShrink: 0 }}>
        <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: checked ? 21 : 3, transition: 'left 0.15s' }} />
      </div>
    </label>
  );
}

const tabs = [
  { key: 'profile', icon: Smartphone, labelKey: 'settings.profile' },
  { key: 'security', icon: Shield, labelKey: 'settingsSecurity.passwordTitle' },
  { key: 'notifications', icon: Smartphone, labelKey: 'settingsNotifications.title' },
  { key: 'language', icon: Smartphone, labelKey: 'settings.language' },
] as const;

export default function SettingsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user, updateUser } = useAuth();
  const [activeTab, setActiveTab] = useState<string>('profile');

  return (
    <div style={{ padding: 'var(--space-xl)', maxWidth: 800, margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-text)', marginBottom: 24 }}>{t('settings.title')}</h1>

      <div style={{ display: 'flex', gap: 2, marginBottom: 24, borderBottom: '1px solid var(--color-border-subtle)', overflowX: 'auto' }}>
        {tabs.map(tb => (
          <button
            key={tb.key}
            onClick={() => setActiveTab(tb.key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 16px', fontSize: '0.85rem', fontWeight: activeTab === tb.key ? 600 : 400,
              color: activeTab === tb.key ? 'var(--color-accent)' : 'var(--color-text-secondary)',
              background: 'none', border: 'none', borderBottom: activeTab === tb.key ? '2px solid var(--color-accent)' : '2px solid transparent',
              cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', transition: 'color 0.15s, border-color 0.15s',
              marginBottom: -1,
            }}
          >
            <tb.icon size={16} />
            {t(tb.labelKey)}
          </button>
        ))}
      </div>

      {activeTab === 'profile' && <ProfileSection user={user} updateUser={updateUser} t={t} toast={toast} key="profile" />}
      {activeTab === 'security' && <SecuritySection t={t} toast={toast} key="security" />}
      {activeTab === 'notifications' && <NotificationsSection t={t} toast={toast} key="notifications" />}
      {activeTab === 'language' && <LanguageSection t={t} key="language" />}
    </div>
  );
}

function ProfileSection({ user, updateUser, t, toast }: any) {
  const [firstName, setFirstName] = useState(user?.firstName || '');
  const [lastName, setLastName] = useState(user?.lastName || '');

  const profileMutation = useMutation({
    mutationFn: (body: { firstName: string; lastName: string }) => api.patch('/users/me/profile', body),
    onSuccess: () => {
      updateUser({ firstName, lastName });
      toast(t('settingsProfile.updated'));
    },
    onError: (err: any) => toast(err?.response?.data?.message || t('common.error'), 'error'),
  });

  return (
    <section style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-xl)', padding: 20 }}>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: '0 0 16px', color: 'var(--color-text)' }}>{t('settings.profile')}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label={t('settings.firstName')}>
          <input className="dialog-input" value={firstName} onChange={e => setFirstName(e.target.value)} />
        </Field>
        <Field label={t('settings.lastName')}>
          <input className="dialog-input" value={lastName} onChange={e => setLastName(e.target.value)} />
        </Field>
        <Button variant="primary" size="sm" loading={profileMutation.isPending} onClick={() => { if (!firstName.trim() || !lastName.trim()) { toast(t('settingsProfile.nameRequired'), 'error'); return; } profileMutation.mutate({ firstName, lastName }); }}>
          {t('settingsProfile.save')}
        </Button>
      </div>
    </section>
  );
}

function SecuritySection({ t, toast }: any) {
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [sessions, setSessions] = useState<any[]>([]);
  const [tfaSecret, setTfaSecret] = useState('');
  const [tfaQr, setTfaQr] = useState('');
  const [tfaEnabled, setTfaEnabled] = useState(false);

  const pwMutation = useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string; confirmPassword: string }) => api.patch('/users/me/password', body),
    onSuccess: () => { toast(t('settingsSecurity.passwordChanged')); setPwCurrent(''); setPwNew(''); setPwConfirm(''); },
    onError: (err: any) => toast(err?.response?.data?.message || t('common.error'), 'error'),
  });

  const tfaEnableMutation = useMutation({
    mutationFn: (token: string) => api.post('/auth/2fa/verify', { token }),
    onSuccess: () => { toast(t('settingsSecurity.twoFactorEnabledToast')); setTfaEnabled(true); },
    onError: (err: any) => toast(err?.response?.data?.message || t('settingsSecurity.twoFactorInvalidCode'), 'error'),
  });

  const tfaDisableMutation = useMutation({
    mutationFn: (token: string) => api.post('/auth/2fa/disable', { token }),
    onSuccess: () => { toast(t('settingsSecurity.twoFactorDisabledToast')); setTfaEnabled(false); setTfaSecret(''); setTfaQr(''); },
    onError: (err: any) => toast(err?.response?.data?.message || t('settingsSecurity.twoFactorInvalidCode'), 'error'),
  });

  const sessionRevoke = useMutation({
    mutationFn: (id: string) => api.delete(`/auth/sessions/${id}`),
    onSuccess: () => { fetchSessions(); toast(t('settingsSecurity.sessionRevoked')); },
    onError: (err: any) => toast(err?.response?.data?.message || t('common.error'), 'error'),
  });

  const sessionRevokeAll = useMutation({
    mutationFn: () => api.post('/auth/sessions/revoke-all'),
    onSuccess: () => { fetchSessions(); toast(t('settingsSecurity.allSessionsRevoked')); },
    onError: (err: any) => toast(err?.response?.data?.message || t('common.error'), 'error'),
  });

  const fetchSessions = async () => { try { const r = await api.get('/auth/sessions'); setSessions(r.data); } catch {} };
  const loadTfa = async () => { try { const r = await api.get('/auth/2fa/generate'); setTfaSecret(r.data.secret); setTfaQr(r.data.qrCode); } catch {} };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-xl)', padding: 20 }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: '0 0 4px', color: 'var(--color-text)' }}>{t('settingsSecurity.passwordTitle')}</h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', margin: '0 0 16px' }}>{t('settingsSecurity.passwordSubtitle')}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label={t('settingsSecurity.currentPassword')}>
            <input className="dialog-input" type="password" value={pwCurrent} onChange={e => setPwCurrent(e.target.value)} />
          </Field>
          <Field label={t('settingsSecurity.newPassword')}>
            <input className="dialog-input" type="password" value={pwNew} onChange={e => setPwNew(e.target.value)} />
            <PasswordStrength password={pwNew} />
          </Field>
          <Field label={t('settingsSecurity.confirmPassword')}>
            <input className="dialog-input" type="password" value={pwConfirm} onChange={e => setPwConfirm(e.target.value)} />
          </Field>
          <Button variant="primary" size="sm" loading={pwMutation.isPending} onClick={() => {
            if (!pwCurrent) { toast(t('settingsSecurity.currentPasswordRequired'), 'error'); return; }
            if (pwNew.length < 8) { toast(t('settingsSecurity.newPasswordLengthError'), 'error'); return; }
            if (pwNew !== pwConfirm) { toast(t('settingsSecurity.passwordMismatch'), 'error'); return; }
            pwMutation.mutate({ currentPassword: pwCurrent, newPassword: pwNew, confirmPassword: pwConfirm });
          }}>
            <Key size={14} /> {t('settingsSecurity.changePassword')}
          </Button>
        </div>
      </section>

      <section style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-xl)', padding: 20 }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: '0 0 4px', color: 'var(--color-text)' }}>{t('settingsSecurity.twoFactorTitle')}</h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', margin: '0 0 16px' }}>{t('settingsSecurity.twoFactorSubtitle')}</p>
        {!tfaSecret ? (
          <Button variant="secondary" size="sm" onClick={loadTfa}>🛡️ {t('settingsSecurity.setupTwoFactor')}</Button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {tfaQr && <img src={tfaQr} alt="QR Code" style={{ width: 200, height: 200, borderRadius: 8 }} />}
            {tfaSecret && <div style={{ fontSize: '0.8rem', fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)', wordBreak: 'break-all' }}>{tfaSecret}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <Field label={t('settingsSecurity.twoFactorCode')}>
                <input className="dialog-input" value={twoFactorCode} maxLength={6} onChange={e => setTwoFactorCode(e.target.value)} />
              </Field>
              <Button variant="primary" size="sm" loading={tfaEnableMutation.isPending} onClick={() => { if (twoFactorCode.length !== 6) { toast(t('settingsSecurity.twoFactorCodeRequired'), 'error'); return; } tfaEnableMutation.mutate(twoFactorCode); }}>
                <Check size={14} /> {t('settingsSecurity.verify')}
              </Button>
            </div>
            {tfaEnabled && (
              <Button variant="danger" size="sm" loading={tfaDisableMutation.isPending} onClick={() => { if (twoFactorCode.length !== 6) { toast(t('settingsSecurity.twoFactorCodeRequired'), 'error'); return; } tfaDisableMutation.mutate(twoFactorCode); }}>
                {t('settingsSecurity.disableTwoFactor')}
              </Button>
            )}
          </div>
        )}
      </section>

      <section style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-xl)', padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: '0 0 4px', color: 'var(--color-text)' }}>{t('settingsSecurity.sessionTitle')}</h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', margin: 0 }}>{t('settingsSecurity.sessionSubtitle')}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={fetchSessions}>{t('settingsSecurity.loadSessions') || 'Charger'}</Button>
        </div>
        {sessions.length === 0 && <p style={{ fontSize: '0.8rem', color: 'var(--color-text-tertiary)' }}>{t('settingsSecurity.noSessions') || 'Aucune session'}</p>}
        {sessions.map((s: any) => (
          <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--color-border-subtle)', fontSize: '0.8rem' }}>
            <div>
              <div style={{ color: 'var(--color-text)' }}>{s.device || 'Unknown'} {s.isCurrent && <span style={{ color: 'var(--color-accent)', fontWeight: 600 }}>({t('settingsSecurity.currentSession')})</span>}</div>
              <div style={{ color: 'var(--color-text-tertiary)', fontSize: '0.7rem' }}>{s.ip} · {formatDateTime(s.lastActivity)}</div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => sessionRevoke.mutate(s.id)} disabled={s.isCurrent}><LogOut size={12} /></Button>
          </div>
        ))}
        {sessions.length > 1 && <Button variant="danger" size="sm" style={{ marginTop: 12 }} onClick={() => sessionRevokeAll.mutate()}>{t('settingsSecurity.revokeAll')}</Button>}
      </section>
    </div>
  );
}

function NotificationsSection({ t, toast }: any) {
  const { data: prefs, refetch: refetchPrefs } = useQuery({ queryKey: ['notification-prefs'], queryFn: () => api.get('/users/me/preferences').then(r => r.data) });
  const prefMutation = useMutation({
    mutationFn: (body: Record<string, boolean>) => api.patch('/users/me/preferences', body),
    onSuccess: () => { refetchPrefs(); toast(t('settingsNotifications.preferenceUpdated'), 'success'); },
    onError: () => toast(t('settingsNotifications.updateError'), 'error'),
  });

  const toggle = (key: string) => prefMutation.mutate({ [key]: !(prefs?.[key] ?? true) });

  if (!prefs) return <div style={{ padding: 20, color: 'var(--color-text-tertiary)' }}>{t('common.loading')}</div>;

  return (
    <section style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-xl)', padding: 20 }}>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: '0 0 4px', color: 'var(--color-text)' }}>{t('settingsNotifications.title')}</h2>
      <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', margin: '0 0 16px' }}>{t('settingsNotifications.subtitle')}</p>
      {['emailDeliveryStatus', 'emailFuelAnomaly', 'emailDeliveryDelayed', 'emailMaintenanceDue', 'emailSystem', 'inAppDeliveryStatus', 'inAppFuelAnomaly', 'inAppDeliveryDelayed', 'inAppMaintenanceDue', 'inAppSystem'].map(key => (
        <Toggle key={key} checked={prefs?.[key] ?? true} onChange={() => toggle(key)} label={t(`settingsNotifications.${key}`)} />
      ))}
    </section>
  );
}

function LanguageSection({ t }: any) {
  const [lang, setLang] = useState(getLanguage());
  return (
    <section style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-xl)', padding: 20 }}>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: '0 0 16px', color: 'var(--color-text)' }}>{t('settings.language')}</h2>
      <div style={{ display: 'flex', gap: 8 }}>
        {(['fr', 'en'] as const).map(l => (
          <Button key={l} variant={lang === l ? 'primary' : 'secondary'} size="sm" onClick={() => { setLang(l); setLanguage(l); }}>
            {l === 'fr' ? '🇫🇷 Français' : '🇬🇧 English'}
          </Button>
        ))}
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontWeight: 600, fontSize: '0.75rem', display: 'block', marginBottom: 4, color: 'var(--color-text-secondary)' }}>{label}</label>
      {children}
    </div>
  );
}
