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
import AppearanceSection from '../features/settings/sections/AppearanceSection';
import styles from './SettingsPage.module.css';

type ApiError = { response?: { data?: { message?: string } } };

interface Session {
  id: string;
  device?: string;
  ip?: string;
  lastActivity?: string;
  isCurrent?: boolean;
}

function PasswordStrength({ password }: { password: string }) {
  const { t } = useTranslation();
  const score = password.length < 8 ? 0 : (
    [/[a-z]/, /[A-Z]/, /\d/, /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/].filter(r => r.test(password)).length
  );
  const bars = [0, 0, 0, 0].map((_, i) => i < score);
  const colors = ['var(--color-red)', 'var(--color-accent)', 'var(--color-blue)', 'var(--color-teal)'];
  const labels = [t('settingsSecurity.passwordVeryWeak'), t('settingsSecurity.passwordWeak'), t('settingsSecurity.passwordMedium'), t('settingsSecurity.passwordStrong')];
  return (
    <div className={styles.pwStrength}>
      <div className={styles.pwBars}>
        {bars.map((active, i) => (
          <div key={i} className={styles.pwBar} style={{ background: active ? colors[score - 1] : 'var(--color-border-subtle)' }} />
        ))}
      </div>
      {password.length > 0 && <div className={styles.pwLabel} style={{ color: colors[Math.max(0, score - 1)] }}>{labels[Math.max(0, score - 1)]}</div>}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className={styles.toggleRow}
      onClick={() => onChange(!checked)}>
      <span>{label}</span>
      <div className={styles.toggleTrack} style={{ background: checked ? 'var(--color-accent)' : 'var(--color-input-border)' }}>
        <div className={styles.toggleThumb} style={{ left: checked ? 21 : 3 }} />
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
    <div className={styles.pageContainer}>
      <h1 className={styles.pageTitle}>{t('settings.title')}</h1>

      <div className={styles.tabsContainer}>
        {tabs.map(tb => (
          <button
            key={tb.key}
            onClick={() => setActiveTab(tb.key)}
            className={`${styles.tabButton} ${activeTab === tb.key ? styles.tabActive : styles.tabInactive}`}
          >
            <tb.icon size={16} />
            {t(tb.labelKey)}
          </button>
        ))}
      </div>

      {activeTab === 'profile' && (
        <div className={styles.sectionGap}>
          <ProfileSection user={user} updateUser={updateUser} t={t} toast={toast} key="profile" />
          <AppearanceSection />
        </div>
      )}
      {activeTab === 'security' && <SecuritySection t={t} toast={toast} key="security" />}
      {activeTab === 'notifications' && <NotificationsSection t={t} toast={toast} key="notifications" />}
      {activeTab === 'language' && <LanguageSection t={t} key="language" />}
    </div>
  );
}

function ProfileSection({ user, updateUser, t, toast }: {
  user: { firstName?: string; lastName?: string } | null;
  updateUser: (data: { firstName: string; lastName: string }) => void;
  t: (key: string) => string;
  toast: (msg: string, type?: 'error' | 'success' | 'info') => void;
}) {
  const [firstName, setFirstName] = useState(user?.firstName || '');
  const [lastName, setLastName] = useState(user?.lastName || '');

  const profileMutation = useMutation({
    mutationFn: (body: { firstName: string; lastName: string }) => api.patch('/users/me/profile', body),
    onSuccess: () => {
      updateUser({ firstName, lastName });
      toast(t('settingsProfile.updated'));
    },
    onError: (err: ApiError) => toast(err?.response?.data?.message || t('common.error'), 'error'),
  });

  return (
    <section className={styles.settingsSection}>
      <h2 className={styles.sectionTitle} style={{ marginBottom: 'var(--space-lg)' }}>{t('settings.profile')}</h2>
      <div className={styles.flexColumn}>
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

function SecuritySection({ t, toast }: {
  t: (key: string) => string;
  toast: (msg: string, type?: 'error' | 'success' | 'info') => void;
}) {
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [tfaSecret, setTfaSecret] = useState('');
  const [tfaQr, setTfaQr] = useState('');
  const [tfaEnabled, setTfaEnabled] = useState(false);

  const pwMutation = useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string; confirmPassword: string }) => api.patch('/users/me/password', body),
    onSuccess: () => { toast(t('settingsSecurity.passwordChanged')); setPwCurrent(''); setPwNew(''); setPwConfirm(''); },
    onError: (err: ApiError) => toast(err?.response?.data?.message || t('common.error'), 'error'),
  });

  const tfaEnableMutation = useMutation({
    mutationFn: (token: string) => api.post('/auth/2fa/verify', { token }),
    onSuccess: () => { toast(t('settingsSecurity.twoFactorEnabledToast')); setTfaEnabled(true); },
    onError: (err: ApiError) => toast(err?.response?.data?.message || t('settingsSecurity.twoFactorInvalidCode'), 'error'),
  });

  const tfaDisableMutation = useMutation({
    mutationFn: (token: string) => api.post('/auth/2fa/disable', { token }),
    onSuccess: () => { toast(t('settingsSecurity.twoFactorDisabledToast')); setTfaEnabled(false); setTfaSecret(''); setTfaQr(''); },
    onError: (err: ApiError) => toast(err?.response?.data?.message || t('settingsSecurity.twoFactorInvalidCode'), 'error'),
  });

  const sessionRevoke = useMutation({
    mutationFn: (id: string) => api.delete(`/auth/sessions/${id}`),
    onSuccess: () => { fetchSessions(); toast(t('settingsSecurity.sessionRevoked')); },
    onError: (err: ApiError) => toast(err?.response?.data?.message || t('common.error'), 'error'),
  });

  const sessionRevokeAll = useMutation({
    mutationFn: () => api.post('/auth/sessions/revoke-all'),
    onSuccess: () => { fetchSessions(); toast(t('settingsSecurity.allSessionsRevoked')); },
    onError: (err: ApiError) => toast(err?.response?.data?.message || t('common.error'), 'error'),
  });

  const fetchSessions = async () => { try { const r = await api.get('/auth/sessions'); setSessions(r.data); } catch {} };
  const loadTfa = async () => { try { const r = await api.get('/auth/2fa/generate'); setTfaSecret(r.data.secret); setTfaQr(r.data.qrCode); } catch {} };

  return (
    <div className={styles.sectionGap}>
      <section className={styles.settingsSection}>
        <h2 className={styles.sectionTitle}>{t('settingsSecurity.passwordTitle')}</h2>
        <p className={styles.sectionSubtitle}>{t('settingsSecurity.passwordSubtitle')}</p>
        <div className={styles.flexColumn}>
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

      <section className={styles.settingsSection}>
        <h2 className={styles.sectionTitle}>{t('settingsSecurity.twoFactorTitle')}</h2>
        <p className={styles.sectionSubtitle}>{t('settingsSecurity.twoFactorSubtitle')}</p>
        {!tfaSecret ? (
          <Button variant="secondary" size="sm" onClick={loadTfa}>🛡️ {t('settingsSecurity.setupTwoFactor')}</Button>
        ) : (
          <div className={styles.twoFactorForm}>
            {tfaQr && <img src={tfaQr} alt="QR Code" className={styles.qrCode} />}
            {tfaSecret && <div className={styles.tfaSecret}>{tfaSecret}</div>}
            <div className={styles.flexRowGap}>
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

      <section className={styles.settingsSection}>
        <div className={styles.sectionHeaderRow}>
          <div>
            <h2 className={styles.sectionHeaderTitle}>{t('settingsSecurity.sessionTitle')}</h2>
            <p className={styles.sectionHeaderSubtitle}>{t('settingsSecurity.sessionSubtitle')}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={fetchSessions}>{t('settingsSecurity.loadSessions') || 'Charger'}</Button>
        </div>
        {sessions.length === 0 && <p className={styles.noSessions}>{t('settingsSecurity.noSessions') || 'Aucune session'}</p>}
        {sessions.map((s: Session) => (
          <div key={s.id} className={styles.sessionItem}>
            <div>
              <div className={styles.sessionDevice}>{s.device || 'Unknown'} {s.isCurrent && <span className={styles.sessionCurrent}>({t('settingsSecurity.currentSession')})</span>}</div>
              <div className={styles.sessionMeta}>{s.ip} · {s.lastActivity ? formatDateTime(s.lastActivity) : ''}</div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => sessionRevoke.mutate(s.id)} disabled={s.isCurrent}><LogOut size={12} /></Button>
          </div>
        ))}
        {sessions.length > 1 && <Button variant="danger" size="sm" style={{ marginTop: 'var(--space-md)' }} onClick={() => sessionRevokeAll.mutate()}>{t('settingsSecurity.revokeAll')}</Button>}
      </section>
    </div>
  );
}

function NotificationsSection({ t, toast }: {
  t: (key: string) => string;
  toast: (msg: string, type?: 'error' | 'success' | 'info') => void;
}) {
  const { data: prefs, refetch: refetchPrefs } = useQuery({ queryKey: ['notification-prefs'], queryFn: () => api.get('/users/me/preferences').then(r => r.data) });
  const prefMutation = useMutation({
    mutationFn: (body: Record<string, boolean>) => api.patch('/users/me/preferences', body),
    onSuccess: () => { refetchPrefs(); toast(t('settingsNotifications.toastUpdated'), 'success'); },
    onError: () => toast(t('settingsNotifications.toastError'), 'error'),
  });

  const toggle = (key: string) => prefMutation.mutate({ [key]: !(prefs?.[key] ?? true) });

  const notifKeys = ['deliveryStatus', 'fuelAnomaly', 'deliveryDelayed', 'maintenanceDue', 'system'] as const;

  if (!prefs) return <div className={styles.loadingState}>{t('common.loading')}</div>;

  return (
    <section className={styles.settingsSection}>
      <h2 className={styles.sectionTitle}>{t('settingsNotifications.title')}</h2>
      <p className={styles.sectionSubtitle}>{t('settingsNotifications.subtitle')}</p>

      <h3 className={styles.sectionHeader3}>
        {t('settingsNotifications.emailSection')}
      </h3>
      {notifKeys.map(key => (
        <Toggle key={`email${key}`} checked={prefs?.[`email${key.charAt(0).toUpperCase() + key.slice(1)}`] ?? true}
          onChange={() => toggle(`email${key.charAt(0).toUpperCase() + key.slice(1)}`)}
          label={t(`settingsNotifications.preferences.${key}`)} />
      ))}

      <h3 className={styles.sectionHeader3Gap}>
        {t('settingsNotifications.inAppSection')}
      </h3>
      {notifKeys.map(key => (
        <Toggle key={`inApp${key}`} checked={prefs?.[`inApp${key.charAt(0).toUpperCase() + key.slice(1)}`] ?? true}
          onChange={() => toggle(`inApp${key.charAt(0).toUpperCase() + key.slice(1)}`)}
          label={t(`settingsNotifications.preferences.${key}`)} />
      ))}
    </section>
  );
}

function LanguageSection({ t }: { t: (key: string) => string }) {
  const [lang, setLang] = useState(getLanguage());
  return (
    <section className={styles.settingsSection}>
      <h2 className={styles.sectionTitle} style={{ marginBottom: 'var(--space-lg)' }}>{t('settings.language')}</h2>
      <div className={styles.languageButtons}>
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
      <label className={styles.fieldLabel}>{label}</label>
      {children}
    </div>
  );
}
