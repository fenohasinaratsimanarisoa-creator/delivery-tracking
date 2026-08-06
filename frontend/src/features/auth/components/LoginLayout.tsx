import { type ReactNode } from 'react';
import styles from './LoginLayout.module.css';

interface Props {
  children: ReactNode;
  visualPanel: ReactNode;
}

export default function LoginLayout({ children, visualPanel }: Props) {
  return (
    <div className={styles.container}>
      <div className={styles.auroraLayer} aria-hidden />
      <div className={styles.formPanel}>
        <div className={styles.glassCard}>
          <span className={styles.cardCornerTop} aria-hidden />
          <span className={styles.cardCornerBottom} aria-hidden />
          <div className={styles.cardGlowLine} aria-hidden />
          {children}
        </div>
        <div className={styles.footerMark}>
          © {new Date().getFullYear()} DeliveryTrack — Made with precision
        </div>
      </div>
      <div className={styles.visualPanel}>
        {visualPanel}
      </div>
    </div>
  );
}
