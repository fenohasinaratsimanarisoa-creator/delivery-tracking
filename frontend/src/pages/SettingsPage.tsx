import { useState, useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { setLanguage, getLanguage } from '../services/i18n/i18n';
import { formatDateTime } from '../services/i18n/formatDate';
import { useAuth } from '../hooks/AuthContext';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  User, Shield, BellRing, Globe, Check, Smartphone, KeyRound, LogOut,
  RefreshCw, Lock, Package, Fuel, Clock, Wrench, Mail, Laptop, Cookie,
} from 'lucide-react';
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

const notifIcons: Record<string, ReactNode> = {
  deliveryStatus: <Package size={16} />,
  fuelAnomaly: <Fuel size={16} />,
  deliveryDelayed: <Clock size={16} />,
  maintenanceDue: <Wrench size={16} />,
  system: <SettingsCore />,
};

function SettingsCore() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>;
}

function PasswordStrength({ password }: { password: string }) {
  const { t } = useTranslation();
  const score = password.length < 8 ? 0 : (
    [/[a-z]/, /[A-Z]/, /\d/, /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/].filter(r => r.test(password)).length
  );
  const index = Math.max(0, score - 1);
  const colors = ['var(--color-red, #E8544C)', 'var(--color-accent, #F2A93C)', 'var(--color-blue, #4A90E2)', 'var(--color-teal, #3FA796)'];
  const labels = [
    t('settingsSecurity.passwordStrength.veryWeak'),
    t('settingsSecurity.passwordStrength.weak'),
    t('settingsSecurity.passwordStrength.medium'),
    t('settingsSecurity.passwordStrength.strong'),
  ];
  return (
    <div className={styles.pwStrength}>
      <div className={styles.pwBars}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} className={`${styles.pwBar} ${i < score ? styles.pwBarActive : ''}`} style={i < score ? { background: colors[score - 1] } : undefined}>
            <span style={{ color: colors[score - 1] }} />
          </div>
        ))}
      </div>
      {password.length > 0 && (
        <div className={styles.pwLabel} style={{ color: colors[index] }}>{labels[index]}</div>
      )}
    </div>
  );
}

function Toggle({ checked, onChange, icon, label }: { checked: boolean; onChange: (v: boolean) => void; icon?: ReactNode; label: string }) {
  return (
    <label className={styles.toggleRow}>
      <span className={styles.toggleInfo}>
        {icon && <span className={styles.toggleIcon}>{icon}</span>}
        <span className={styles.toggleLabel}>{label}</span>
      </span>
      <span className={`${styles.toggleTrack} ${checked ? styles.toggleTrackOn : ''}`} onClick={() => onChange(!checked)}>
        <span className={styles.toggleThumb} />
      </span>
    </label>
  );
}

const tabs = [
  { key: 'profile', icon: User, labelKey: 'settings.profile', descKey: 'settings.profileDesc' },
  { key: 'security', icon: Shield, labelKey: 'settings.security', descKey: 'settings.securityDesc' },
  { key: 'notifications', icon: BellRing, labelKey: 'settings.notifications', descKey: 'settings.notificationsDesc' },
  { key: 'language', icon: Globe, labelKey: 'settings.language', descKey: 'settings.languageDesc' },
] as const;

export default function SettingsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user, updateUser } = useAuth();
  const [activeTab, setActiveTab] = useState<string>('profile');

  return (
    <div className={styles.pageContainer}>
      <header className={styles.pageHeader}>
        <div className={styles.titleIconChip}><SettingsCore /></div>
        <div className={styles.headerText}>
          <h1 className={styles.pageTitle}>{t('settings.title')}</h1>
          <p className={styles.pageSubtitle}>{t('settings.subtitle')}</p>
        </div>
        <div className={styles.headerMeter}>
          <span className={styles.meterDot} />
          <span className={styles.meterLabel}>{t('settings.security')}</span>
        </div>
      </header>

      <nav className={styles.tabsGrid} aria-label="Paramètres">
        {tabs.map(tb => {
          const Icon = tb.icon;
          const active = activeTab === tb.key;
          return (
            <button
              key={tb.key}
              onClick={() => setActiveTab(tb.key)}
              className={`${styles.tabCard} ${active ? styles.tabActive : ''}`}
              aria-pressed={active}
            >
              <span className={styles.tabIcon}>{active ? <Check size={16} /> : <Icon size={18} />}</span>
              <span className={styles.tabText}>
                <span className={styles.tabLabel}>{t(tb.labelKey)}</span>
                <span className={styles.tabDesc}>{t(tb.descKey)}</span>
              </span>
            </button>
          );
        })}
      </nav>

      <div className={styles.contentArea}>
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
      toast(t('settingsProfile.toastUpdated'), 'success');
    },
    onError: (err: ApiError) => toast(err?.response?.data?.message || t('common.error'), 'error'),
  });

  return (
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.cardIcon}><User size={18} /></span>
        <div>
          <h2 className={styles.cardTitle}>{t('settings.profile')}</h2>
          <p className={styles.cardDesc}>{t('settings.profileDesc')}</p>
        </div>
      </div>
      <div className={styles.flexColumn}>
        <Field label={t('settings.firstName')}>
          <input className={styles.input} value={firstName} onChange={e => setFirstName(e.target.value)} />
        </Field>
        <Field label={t('settings.lastName')}>
          <input className={styles.input} value={lastName} onChange={e => setLastName(e.target.value)} />
        </Field>
        <div className={styles.rowEnd}>
          <Button variant="primary" size="md" loading={profileMutation.isPending} onClick={() => {
            if (!firstName.trim() || !lastName.trim()) { toast(t('settingsProfile.toastNameRequired'), 'error'); return; }
            profileMutation.mutate({ firstName, lastName });
          }}>
            <Check size={14} /> {t('settingsProfile.saveButton')}
          </Button>
        </div>
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
    onSuccess: () => { toast(t('settingsPassword.toastChanged'), 'success'); setPwCurrent(''); setPwNew(''); setPwConfirm(''); },
    onError: (err: ApiError) => toast(err?.response?.data?.message || t('settingsPassword.toastError'), 'error'),
  });

  const tfaEnableMutation = useMutation({
    mutationFn: (token: string) => api.post('/auth/2fa/verify', { token }),
    onSuccess: () => { toast(t('settingsSecurity.toastTwoFactorEnabled'), 'success'); setTfaEnabled(true); },
    onError: (err: ApiError) => toast(err?.response?.data?.message || t('settingsSecurity.toastTwoFactorCodeRequired'), 'error'),
  });

  const tfaDisableMutation = useMutation({
    mutationFn: (token: string) => api.post('/auth/2fa/disable', { token }),
    onSuccess: () => { toast(t('settingsSecurity.toastTwoFactorDisabled'), 'success'); setTfaEnabled(false); setTfaSecret(''); setTfaQr(''); },
    onError: (err: ApiError) => toast(err?.response?.data?.message || t('settingsSecurity.toastTwoFactorCodeRequired'), 'error'),
  });

  const sessionRevoke = useMutation({
    mutationFn: (id: string) => api.delete(`/auth/sessions/${id}`),
    onSuccess: () => { fetchSessions(); toast(t('settingsSecurity.toastSessionRevoked'), 'success'); },
    onError: (err: ApiError) => toast(err?.response?.data?.message || t('common.error'), 'error'),
  });

  const sessionRevokeAll = useMutation({
    mutationFn: () => api.post('/auth/sessions/revoke-all'),
    onSuccess: () => { fetchSessions(); toast(t('settingsSecurity.toastSessionRevokeAll'), 'success'); },
    onError: (err: ApiError) => toast(err?.response?.data?.message || t('common.error'), 'error'),
  });

  const [sessionsLoading, setSessionsLoading] = useState(false);

  const fetchSessions = async () => {
    setSessionsLoading(true);
    try { const r = await api.get('/auth/sessions'); setSessions(r.data); } catch {}
    finally { setSessionsLoading(false); }
  };

  useEffect(() => { fetchSessions(); }, []);

  const loadTfa = async () => { try { const r = await api.get('/auth/2fa/generate'); setTfaSecret(r.data.secret); setTfaQr(r.data.qrCode); } catch {} };

  return (
    <div className={styles.sectionGap}>
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <span className={styles.cardIcon}><KeyRound size={18} /></span>
          <div>
            <h2 className={styles.cardTitle}>{t('settingsSecurity.passwordTitle')}</h2>
            <p className={styles.cardDesc}>{t('settingsSecurity.passwordSubtitle')}</p>
          </div>
        </div>
        <div className={styles.flexColumn}>
          <Field label={t('settingsSecurity.currentPassword')}>
            <input className={styles.input} type="password" value={pwCurrent} onChange={e => setPwCurrent(e.target.value)} placeholder={t('settingsSecurity.currentPasswordPlaceholder')} />
          </Field>
          <Field label={t('settingsSecurity.newPassword')}>
            <input className={styles.input} type="password" value={pwNew} onChange={e => setPwNew(e.target.value)} placeholder={t('settingsSecurity.newPasswordPlaceholder')} />
            <PasswordStrength password={pwNew} />
          </Field>
          <Field label={t('settingsSecurity.confirmPassword')}>
            <input className={styles.input} type="password" value={pwConfirm} onChange={e => setPwConfirm(e.target.value)} placeholder={t('settingsSecurity.confirmPasswordPlaceholder')} />
          </Field>
          <div className={styles.rowEnd}>
            <Button variant="primary" size="md" loading={pwMutation.isPending} onClick={() => {
              if (!pwCurrent) { toast(t('settingsPassword.toastCurrentRequired'), 'error'); return; }
              if (pwNew.length < 8) { toast(t('settingsPassword.toastMinLength'), 'error'); return; }
              if (pwNew !== pwConfirm) { toast(t('settingsPassword.toastMismatch'), 'error'); return; }
              pwMutation.mutate({ currentPassword: pwCurrent, newPassword: pwNew, confirmPassword: pwConfirm });
            }}>
              <Lock size={14} /> {t('settingsSecurity.changePassword')}
            </Button>
          </div>
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <span className={styles.cardIcon}><Shield size={18} /></span>
          <div>
            <h2 className={styles.cardTitle}>{t('settingsSecurity.twoFactorTitle')}</h2>
            <p className={styles.cardDesc}>{t('settingsSecurity.twoFactorSubtitle')}</p>
          </div>
          <span className={`${styles.statusBadge} ${tfaSecret ? styles.statusOn : styles.statusOff}`}>
            <span className={styles.statusDot} />
            {tfaEnabled ? t('settingsSecurity.twoFactorEnabled') : t('settingsSecurity.twoFactorDisabled')}
          </span>
        </div>

        {!tfaSecret ? (
          <div className={styles.tfaEmpty}>
            <p className={styles.tfaEmptyText}>{t('settingsSecurity.twoFactorEnabledDesc')}</p>
            <Button variant="secondary" size="md" onClick={loadTfa}>{t('settingsSecurity.twoFactorEnable')}</Button>
          </div>
        ) : (
          <div className={styles.twoFactorForm}>
            <div className={styles.qrFrame}>
              {tfaQr && <img src={tfaQr} alt="QR Code" className={styles.qrCode} />}
            </div>
            {tfaSecret && <code className={styles.tfaSecret}>{tfaSecret}</code>}
            <ol className={styles.stepsList}>
              <li>{t('settingsSecurity.twoFactorSetupStep1')}</li>
              <li>{t('settingsSecurity.twoFactorSetupStep2')}</li>
            </ol>
            <div className={styles.twoFactorRow}>
              <Field label={t('settingsSecurity.twoFactorCode')}>
                <input className={styles.input} value={twoFactorCode} maxLength={6} onChange={e => setTwoFactorCode(e.target.value.replace(/\D/g, ''))} placeholder={t('settingsSecurity.twoFactorCodePlaceholder')} inputMode="numeric" />
              </Field>
              <Button variant="primary" size="md" loading={tfaEnableMutation.isPending} onClick={() => { if (twoFactorCode.length !== 6) { toast(t('settingsSecurity.toastTwoFactorCodeRequired'), 'error'); return; } tfaEnableMutation.mutate(twoFactorCode); }}>
                <Check size={14} /> {t('settingsSecurity.twoFactorConfirm')}
              </Button>
            </div>
            {tfaEnabled && (
              <Button variant="danger" size="md" loading={tfaDisableMutation.isPending} onClick={() => { if (twoFactorCode.length !== 6) { toast(t('settingsSecurity.toastTwoFactorCodeRequired'), 'error'); return; } tfaDisableMutation.mutate(twoFactorCode); }}>
                {t('settingsSecurity.twoFactorDisable')}
              </Button>
            )}
          </div>
        )}
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <span className={styles.cardIcon}><Smartphone size={18} /></span>
          <div>
            <h2 className={styles.cardTitle}>{t('settingsSecurity.sessionTitle')}</h2>
            <p className={styles.cardDesc}>{t('settingsSecurity.sessionSubtitle')}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={fetchSessions} loading={sessionsLoading}>
            <RefreshCw size={14} /> {t('settingsSecurity.loadSessions')}
          </Button>
        </div>
        {sessions.length === 0 && !sessionsLoading && <div className={styles.noSessions}><Cookie size={16} /> {t('settingsSecurity.sessionEmpty')}</div>}
        {sessions.map((s: Session) => (
          <div key={s.id} className={styles.sessionItem}>
            <span className={s.isCurrent ? styles.sessionIconCurrent : styles.sessionIcon}><Laptop size={16} /></span>
            <div className={styles.sessionInfo}>
              <div className={styles.sessionDevice}>
                {s.device || t('settingsSecurity.sessionUnknownDevice')}
                {s.isCurrent && <span className={styles.sessionCurrent}>{t('settingsSecurity.sessionCurrent')}</span>}
              </div>
              <div className={styles.sessionMeta}>{s.ip || '—'} · {s.lastActivity ? formatDateTime(s.lastActivity) : ''}</div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => sessionRevoke.mutate(s.id)} disabled={s.isCurrent}>
              <LogOut size={12} />
            </Button>
          </div>
        ))}
        {sessions.length > 1 && (
          <div className={styles.rowEnd}>
            <Button variant="danger" size="sm" onClick={() => sessionRevokeAll.mutate()}>{t('settingsSecurity.sessionRevokeAll')}</Button>
          </div>
        )}
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
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.cardIcon}><BellRing size={18} /></span>
        <div>
          <h2 className={styles.cardTitle}>{t('settingsNotifications.title')}</h2>
          <p className={styles.cardDesc}>{t('settingsNotifications.subtitle')}</p>
        </div>
      </div>

      <h3 className={styles.sectionHeader3}>
        <Mail size={14} /> {t('settingsNotifications.emailSection')}
      </h3>
      <div className={styles.toggleGroup}>
        {notifKeys.map(key => (
          <Toggle key={`email${key}`} checked={prefs?.[`email${key.charAt(0).toUpperCase() + key.slice(1)}`] ?? true}
            onChange={() => toggle(`email${key.charAt(0).toUpperCase() + key.slice(1)}`)}
            icon={notifIcons[key]}
            label={t(`settingsNotifications.preferences.${key}`)} />
        ))}
      </div>

      <h3 className={styles.sectionHeader3Gap}>
        <Smartphone size={14} /> {t('settingsNotifications.inAppSection')}
      </h3>
      <div className={styles.toggleGroup}>
        {notifKeys.map(key => (
          <Toggle key={`inApp${key}`} checked={prefs?.[`inApp${key.charAt(0).toUpperCase() + key.slice(1)}`] ?? true}
            onChange={() => toggle(`inApp${key.charAt(0).toUpperCase() + key.slice(1)}`)}
            icon={notifIcons[key]}
            label={t(`settingsNotifications.preferences.${key}`)} />
        ))}
      </div>
    </section>
  );
}

function LanguageSection({ t }: { t: (key: string) => string }) {
  const [lang, setLang] = useState(getLanguage());
  return (
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.cardIcon}><Globe size={18} /></span>
        <div>
          <h2 className={styles.cardTitle}>{t('settings.language')}</h2>
          <p className={styles.cardDesc}>{t('settings.languageDesc')}</p>
        </div>
      </div>
      <div className={styles.languageButtons}>
        {(['fr', 'en'] as const).map(l => {
          const active = lang === l;
          return (
            <button key={l} className={`${styles.langCard} ${active ? styles.langActive : ''}`} onClick={() => { setLang(l); setLanguage(l); }} role="radio" aria-checked={active}>
              <span className={styles.flag}>{l === 'fr' ? '🇫🇷' : '🇬🇧'}</span>
              <span className={styles.langText}>
                <span className={styles.langLabel}>{l === 'fr' ? t('settings.languageFr') : t('settings.languageEn')}</span>
                <span className={styles.langDesc}>{l === 'fr' ? 'Français' : 'English'}</span>
              </span>
              {active && <span className={styles.langCheck}><Check size={14} /></span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.fieldWrap}>
      <label className={styles.fieldLabel}>{label}</label>
      {children}
    </div>
  );
}