import type { ReactNode } from 'react';
import styles from './Badge.module.css';

/**
 * Variantes SÉMANTIQUES (à privilégier) : success / warning / danger / info /
 * neutral. Les variantes couleur brute (accent/teal/red/blue/purple/orange)
 * restent supportées pour la compatibilité mais sont dépréciées.
 */
export type BadgeVariant =
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'neutral'
  | 'accent'
  | 'teal'
  | 'red'
  | 'blue'
  | 'purple'
  | 'orange';

interface Props {
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  dot?: boolean;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

const variantClassMap: Record<BadgeVariant, string> = {
  success: styles.variantSuccess,
  warning: styles.variantWarning,
  danger: styles.variantDanger,
  info: styles.variantInfo,
  neutral: styles.variantNeutral,
  // compat couleurs brutes
  accent: styles.variantAccent,
  teal: styles.variantSuccess,
  red: styles.variantDanger,
  blue: styles.variantInfo,
  purple: styles.variantPurple,
  orange: styles.variantWarning,
};

const sizeClassMap: Record<'sm' | 'md', string> = {
  sm: styles.sizeSm,
  md: styles.sizeMd,
};

export default function Badge({ variant = 'neutral', size = 'md', dot, icon, children, className, style }: Props) {
  return (
    <span
      className={[styles.root, sizeClassMap[size], variantClassMap[variant], className ?? '']
        .filter(Boolean)
        .join(' ')}
      style={style}
    >
      {dot && <span className={styles.dot} aria-hidden="true" />}
      {icon}
      {children}
    </span>
  );
}
