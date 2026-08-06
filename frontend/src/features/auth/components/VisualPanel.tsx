import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Star, ShieldCheck, Activity } from 'lucide-react';
import styles from './VisualPanel.module.css';

function useCountUp(target: number, duration = 1300, decimals = 0) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (typeof window === 'undefined' || (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
      setValue(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(decimals > 0 ? parseFloat((target * eased).toFixed(decimals)) : Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, decimals]);
  return value;
}

const AVATARS = [
  'avatarA',
  'avatarB',
  'avatarC',
  'avatarD',
  'avatarE',
];

export default function VisualPanel() {
  const { t } = useTranslation();
  const delivered = useCountUp(78);
  const onTime = useCountUp(98.6, 1400, 1);

  return (
    <div className={styles.panel}>
      <div className={styles.professionalGlow} />
      <div className={styles.orbGlow} />
      <div className={styles.gridLayer} />

      <div className={styles.content}>
        <div className={styles.badges}>
          <span className={styles.tagline}>
            <span className={styles.liveDot} />
            {t('visualPanel.tagline')}
          </span>
          <span className={styles.safeBadge}>
            <ShieldCheck size={12} />
            {t('auth.login.secure')}
          </span>
        </div>

        <h1 className={styles.title}>
          {t('visualPanel.title')}
        </h1>
        <p className={styles.subtitle}>
          {t('visualPanel.subtitle')}
        </p>

        <div className={styles.mockCard}>
          <div className={styles.mockHeader}>
            <span className={styles.mockTitle}>
              <Activity size={13} />
              {t('visualPanel.kpiLabel')}
            </span>
            <span className={styles.mockLive}>
              <span className={styles.liveDot} />
              {t('visualPanel.live')}
            </span>
          </div>

          <div className={styles.mapZone}>
            <svg
              className={styles.routeSvg}
              viewBox="0 0 200 90"
              preserveAspectRatio="none"
              aria-hidden
            >
              <path
                d="M 12 72 C 45 66, 60 34, 95 38 S 150 60, 188 22"
                fill="none"
                stroke="var(--color-accent)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray="7 7"
                className={styles.routePath}
              />
              <circle cx="12" cy="72" r="5.5" fill="var(--color-teal)" className={styles.pinOrigin} />
              <circle cx="188" cy="22" r="5.5" fill="var(--color-accent)" className={styles.pinDest} />
            </svg>
            <div className={styles.truck}>
              <span className={styles.truckIcon}>D</span>
            </div>
          </div>

          <div className={styles.mockStats}>
            <div className={styles.mockStat}>
              <span className={styles.mockStatLabel}>{t('visualPanel.deliveriesToday')}</span>
              <span className={styles.mockStatValue}>{delivered}</span>
            </div>
            <div className={styles.mockStat}>
              <span className={styles.mockStatLabel}>{t('visualPanel.kpiGoal')}</span>
              <span className={styles.mockStatValue}>100</span>
            </div>
            <div className={styles.mockStat}>
              <span className={styles.mockStatLabel}>{t('visualPanel.kpiAchieved')}</span>
              <span className={`${styles.mockStatValue} ${styles.onTimeValue}`}>{onTime}%</span>
            </div>
          </div>

          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: '78%' }} />
          </div>
        </div>

        <div className={styles.socialRow}>
          <div className={styles.avatarStack}>
            {AVATARS.map((cls, i) => (
              <span key={i} className={`${styles.avatarItem} ${styles[cls]}`} style={{ zIndex: 10 - i }}>
                {['A', 'M', 'S', 'R', 'K'][i]}
              </span>
            ))}
          </div>
          <div className={styles.ratingBlock}>
            <span className={styles.stars}>
              {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} size={12} fill="currentColor" stroke="none" />
              ))}
            </span>
            <span className={styles.ratingText}>{t('visualPanel.rating')}</span>
          </div>
        </div>

        <div className={styles.socialProof}>
          <span>{t('visualPanel.socialProof')}</span>
          <span className={styles.dot} />
          <span>{t('visualPanel.uptime')}</span>
        </div>
      </div>
    </div>
  );
}