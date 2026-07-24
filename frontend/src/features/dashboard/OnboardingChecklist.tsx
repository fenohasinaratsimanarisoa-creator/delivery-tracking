import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronRight, X, Truck, UserPlus, Bell, MapPin } from 'lucide-react';
import api from '../../services/api/client';
import { useAuth } from '../../hooks/AuthContext';

const STEPS = [
  { key: 'add_vehicle', i18nKey: 'onboarding.steps.addVehicle', icon: Truck, link: '/vehicles' },
  { key: 'invite_driver', i18nKey: 'onboarding.steps.inviteDriver', icon: UserPlus, link: '/drivers' },
  { key: 'create_delivery', i18nKey: 'onboarding.steps.createDelivery', icon: MapPin, link: '/deliveries' },
  { key: 'configure_notifications', i18nKey: 'onboarding.steps.configureNotifications', icon: Bell, link: '/settings' },
];

const ONBOARDING_DISMISSED_KEY = 'dt-onboarding-dismissed';
const ONBOARDING_COMPLETED_KEY = 'dt-onboarding-completed';

export default function OnboardingChecklist() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [steps, setSteps] = useState(() => STEPS.map((s) => ({ ...s, done: false })));
  const [visible, setVisible] = useState(false);
  const [minimized, setMinimized] = useState(false);

  useEffect(() => {
    if (!user?.companyId) return;

    const dismissed = localStorage.getItem(`${ONBOARDING_DISMISSED_KEY}-${user.companyId}`);
    const completed = localStorage.getItem(`${ONBOARDING_COMPLETED_KEY}-${user.companyId}`);
    if (dismissed || completed) return;

    const checkSteps = async () => {
      try {
        const res = await api.get(`/onboarding/status?companyId=${user.companyId}`);
        const status = res.data;
        const updated = STEPS.map((s) => ({ ...s, done: !!status[s.key] }));
        setSteps(updated);
        if (updated.every((s) => s.done)) {
          localStorage.setItem(`${ONBOARDING_COMPLETED_KEY}-${user.companyId}`, 'true');
          return;
        }
        setVisible(true);
      } catch {
        setVisible(true);
      }
    };
    checkSteps();
  }, [user?.companyId]);

  const handleStepClick = useCallback((link: string) => {
    window.location.href = link;
  }, []);

  const handleDismiss = useCallback(() => {
    if (user?.companyId) {
      localStorage.setItem(`${ONBOARDING_DISMISSED_KEY}-${user.companyId}`, 'true');
    }
    setVisible(false);
  }, [user?.companyId]);

  if (!visible) return null;

  const allDone = steps.every((s) => s.done);

  return (
    <div style={{
      position: 'absolute', bottom: 'var(--space-xl)',
      right: 'var(--space-xl)',
      zIndex: 100,
      pointerEvents: 'auto',
      maxWidth: 300,
    }}>
      <div style={{
        background: 'var(--color-glass)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid var(--color-glass-border)',
        borderRadius: 'var(--radius-xl)',
        padding: minimized ? 'var(--space-sm) var(--space-lg)' : 'var(--space-lg)',
        boxShadow: 'var(--shadow-lg)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', marginBottom: minimized ? 0 : 'var(--space-md)',
        }}>
          {!minimized && (
            <div>
              <div style={{
                fontWeight: 600, fontSize: 'var(--text-sm)',
                color: 'var(--color-text)',
                fontFamily: 'var(--font-display)',
                marginBottom: 2,
              }}>
                {t('onboarding.welcome')}
              </div>
              <div style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-secondary)',
              }}>
                {allDone ? t('onboarding.completed') : t('onboarding.progress', { done: steps.filter((s) => s.done).length, total: steps.length })}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={() => setMinimized(!minimized)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--color-text-tertiary)', padding: 2,
                display: 'flex',
              }}
              aria-label={minimized ? t('onboarding.expand') : t('onboarding.collapse')}
            >
              {minimized ? (
                <ChevronRight size={16} />
              ) : (
                <span style={{ fontSize: 14 }}>—</span>
              )}
            </button>
            <button
              onClick={handleDismiss}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--color-text-tertiary)', padding: 2,
                display: 'flex',
              }}
              aria-label={t('onboarding.close')}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {!minimized && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
            {steps.map((step) => (
              <button
                key={step.key}
                onClick={() => handleStepClick(step.link)}
                disabled={step.done}
                style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--space-sm)',
                  padding: 'var(--space-sm) var(--space-md)',
                  borderRadius: 'var(--radius-md)',
                  background: step.done ? 'var(--color-teal-muted)' : 'var(--color-surface-alt)',
                  border: '1px solid var(--color-border-subtle)',
                  cursor: step.done ? 'default' : 'pointer',
                  color: step.done ? 'var(--color-teal)' : 'var(--color-text)',
                  fontSize: 'var(--text-sm)',
                  textAlign: 'left',
                  transition: 'background 0.1s',
                  opacity: step.done ? 0.7 : 1,
                  width: '100%',
                }}
              >
                <div style={{
                  width: 20, height: 20,
                  borderRadius: 'var(--radius-sm)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: step.done ? 'var(--color-teal)' : 'var(--color-border)',
                  flexShrink: 0,
                }}>
                  {step.done ? (
                    <Check size={12} style={{ color: '#fff' }} />
                  ) : (
                    <step.icon size={12} style={{ color: 'var(--color-text-tertiary)' }} />
                  )}
                </div>
                <span style={{ flex: 1 }}>{t(step.i18nKey)}</span>
                {!step.done && <ChevronRight size={14} style={{ color: 'var(--color-text-tertiary)' }} />}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
