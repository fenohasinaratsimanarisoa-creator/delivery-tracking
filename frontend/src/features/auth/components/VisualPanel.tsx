import { useTranslation } from 'react-i18next';
import styles from './VisualPanel.module.css';

const dotGrid = `
<svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <pattern id="dots" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
      <circle cx="20" cy="20" r="1.5" fill="rgba(255,255,255,0.12)" />
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#dots)" class="dt-dot-grid" />
</svg>`;

export default function VisualPanel() {
  const { t } = useTranslation();
  return (
    <div className={styles.panel}>
      <div className={styles.dotLayer} dangerouslySetInnerHTML={{ __html: dotGrid }} />
      <div className={styles.glow} />
      <div className={styles.accentGlow} />
      <div className={styles.content}>
        <div className={styles.tagline}>{t('visualPanel.tagline')}</div>
        <h1 className={styles.title}>{t('visualPanel.title')}</h1>
        <p className={styles.subtitle}>
          {t('visualPanel.subtitle')}
        </p>

        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>{t('visualPanel.kpiLabel')}</div>
          <div className={styles.kpiValue}>78</div>
          <div className={styles.kpiBar}>
            <div className={styles.kpiBarFill} />
          </div>
          <div className={styles.kpiFooter}>
            <span>{t('visualPanel.kpiGoal')}</span>
            <span>{t('visualPanel.kpiAchieved')}</span>
          </div>
        </div>

        <div className={styles.socialProof}>
          <span className={styles.dot} />
          <span>{t('visualPanel.socialProof')}</span>
          <span className={styles.dot} />
          <span>{t('visualPanel.uptime')}</span>
        </div>
      </div>
    </div>
  );
}
