import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronRight, X, Truck, UserPlus, Bell, MapPin } from 'lucide-react';
import api from '../../services/api/client';
import { useAuth } from '../../hooks/AuthContext';
import styles from './OnboardingChecklist.module.css';

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
    <div className={styles.container}>
      <div className={`${styles.panel} ${minimized ? styles.panelMinimized : styles.panelExpanded}`}>
        {/* Header */}
        <div className={`${styles.header} ${!minimized ? styles.headerWithMargin : ''}`}>
          {!minimized && (
            <div>
              <div className={styles.welcomeTitle}>
                {t('onboarding.welcome')}
              </div>
              <div className={styles.welcomeSubtitle}>
                {allDone ? t('onboarding.completed') : t('onboarding.progress', { done: steps.filter((s) => s.done).length, total: steps.length })}
              </div>
            </div>
          )}
          <div className={styles.headerButtons}>
            <button
              onClick={() => setMinimized(!minimized)}
              className={styles.iconButton}
              aria-label={minimized ? t('onboarding.expand') : t('onboarding.collapse')}
            >
              {minimized ? (
                <ChevronRight size={16} />
              ) : (
                <span className={styles.collapseIcon}>&mdash;</span>
              )}
            </button>
            <button
              onClick={handleDismiss}
              className={styles.iconButton}
              aria-label={t('onboarding.close')}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {!minimized && (
          <div className={styles.stepsList}>
            {steps.map((step) => (
              <button
                key={step.key}
                onClick={() => handleStepClick(step.link)}
                disabled={step.done}
                className={`${styles.stepButton} ${step.done ? styles.stepButtonDone : styles.stepButtonPending}`}
              >
                <div className={`${styles.stepIconBox} ${step.done ? styles.stepIconBoxDone : styles.stepIconBoxPending}`}>
                  {step.done ? (
                    <Check size={12} style={{ color: '#fff' }} />
                  ) : (
                    <step.icon size={12} style={{ color: 'var(--color-text-tertiary)' }} />
                  )}
                </div>
                <span className={styles.stepLabel}>{t(step.i18nKey)}</span>
                {!step.done && <ChevronRight size={14} style={{ color: 'var(--color-text-tertiary)' }} />}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
