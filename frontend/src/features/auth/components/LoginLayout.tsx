import { type ReactNode } from 'react';
import styles from './LoginLayout.module.css';

interface Props {
  children: ReactNode;
  visualPanel: ReactNode;
}

export default function LoginLayout({ children, visualPanel }: Props) {
  return (
    <div className={styles.container}>
      <div className={styles.formPanel}>
        <div className={styles.glassCard}>
          {children}
        </div>
      </div>
      <div className={styles.visualPanel}>
        {visualPanel}
      </div>
    </div>
  );
}
