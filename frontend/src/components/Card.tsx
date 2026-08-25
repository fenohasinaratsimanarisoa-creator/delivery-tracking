import type { ReactNode } from 'react';
import styles from './Card.module.css';

interface Props {
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  /** Panel entrance animation (dt-fade-in-up) — off by default, opt-in for pages
   * that stagger multiple cards in on load. */
  animated?: boolean;
  /** Lift + shadow on hover — for cards that are themselves interactive (e.g. clickable). */
  hoverable?: boolean;
  /** Remove the body's internal padding — for content that manages its own spacing
   * (e.g. a table that needs full-bleed rows). */
  flush?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export default function Card({ header, footer, children, animated, hoverable, flush, className, style }: Props) {
  return (
    <div
      className={`${styles.root}${animated ? ` ${styles.animated}` : ''}${hoverable ? ` ${styles.hoverable}` : ''}${className ? ` ${className}` : ''}`}
      style={style}
    >
      {header && <div className={styles.header}>{header}</div>}
      <div className={flush ? styles.bodyFlush : styles.body}>{children}</div>
      {footer && <div className={styles.footer}>{footer}</div>}
    </div>
  );
}
