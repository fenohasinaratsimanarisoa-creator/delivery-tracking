import type { ReactNode } from 'react';
import styles from './EmptyState.module.css';

interface Props {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  /** `page` = pleine hauteur centrée, `inline` = compact dans une carte/table. */
  size?: 'page' | 'inline';
  className?: string;
}

export default function EmptyState({ icon, title, description, action, size = 'page', className }: Props) {
  return (
    <div
      className={[styles.root, size === 'inline' ? styles.inline : styles.page, className]
        .filter(Boolean)
        .join(' ')}
    >
      {icon && <div className={styles.icon} aria-hidden="true">{icon}</div>}
      <p className={styles.title}>{title}</p>
      {description && <p className={styles.description}>{description}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
