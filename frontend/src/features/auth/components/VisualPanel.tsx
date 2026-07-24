const gradient = 'linear-gradient(135deg, var(--color-bg, #0B1220) 0%, #1a2a45 100%)';

const dotGrid = `
<svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <pattern id="dots" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
      <circle cx="20" cy="20" r="1.5" fill="rgba(255,255,255,0.12)" />
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#dots)" class="dt-dot-grid" />
</svg>`;

const styles: Record<string, React.CSSProperties> = {
  panel: {
    width: '100%',
    height: '100%',
    background: gradient,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 60,
    position: 'relative',
    overflow: 'hidden',
  },
  dotLayer: {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    opacity: 0.5,
  },
  glow: {
    position: 'absolute',
    inset: 0,
    background: 'radial-gradient(circle at 30% 50%, var(--color-accent-muted, rgba(242,169,60,0.15)) 0%, transparent 60%)',
    pointerEvents: 'none',
  },
  accentGlow: {
    position: 'absolute',
    bottom: '-20%',
    right: '-10%',
    width: '60%',
    height: '60%',
    background: 'radial-gradient(circle, rgba(242,169,60,0.08) 0%, transparent 70%)',
    pointerEvents: 'none',
  },
  content: {
    position: 'relative',
    zIndex: 1,
    width: '100%',
    maxWidth: 420,
  },
  tagline: {
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: 'rgba(255,255,255,0.5)',
    marginBottom: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: 700,
    lineHeight: 1.25,
    color: '#fff',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 1.6,
    color: 'rgba(255,255,255,0.6)',
    marginBottom: 40,
  },
  kpiCard: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 12,
    padding: '24px 28px',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
  },
  kpiLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    marginBottom: 4,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
  },
  kpiValue: {
    fontSize: 36,
    fontWeight: 700,
    color: '#fff',
    marginBottom: 12,
  },
  kpiBar: {
    height: 4,
    borderRadius: 2,
    background: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  kpiBarFill: {
    width: '78%',
    height: '100%',
    borderRadius: 2,
    background: 'linear-gradient(90deg, var(--color-accent, #F2A93C), #d4902e)',
  },
  kpiFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    marginTop: 12,
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
  },
  socialProof: {
    marginTop: 32,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    color: 'rgba(255,255,255,0.35)',
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.2)',
  },
};

import { useTranslation } from 'react-i18next';

export default function VisualPanel() {
  const { t } = useTranslation();
  return (
    <div style={styles.panel}>
      <div style={styles.dotLayer} dangerouslySetInnerHTML={{ __html: dotGrid }} />
      <div style={styles.glow} />
      <div style={styles.accentGlow} />
      <div style={styles.content}>
        <div style={styles.tagline}>{t('visualPanel.tagline')}</div>
        <h1 style={styles.title}>{t('visualPanel.title')}</h1>
        <p style={styles.subtitle}>
          {t('visualPanel.subtitle')}
        </p>

        <div style={styles.kpiCard}>
          <div style={styles.kpiLabel}>{t('visualPanel.kpiLabel')}</div>
          <div style={styles.kpiValue}>78</div>
          <div style={styles.kpiBar}>
            <div style={styles.kpiBarFill} />
          </div>
          <div style={styles.kpiFooter}>
            <span>{t('visualPanel.kpiGoal')}</span>
            <span>{t('visualPanel.kpiAchieved')}</span>
          </div>
        </div>

        <div style={styles.socialProof}>
          <span style={styles.dot} />
          <span>{t('visualPanel.socialProof')}</span>
          <span style={styles.dot} />
          <span>{t('visualPanel.uptime')}</span>
        </div>
      </div>
    </div>
  );
}
