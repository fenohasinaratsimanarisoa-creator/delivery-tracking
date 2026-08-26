import type { ReactNode } from 'react';
import styles from './Badge.module.css';

export type BadgeVariant = 'accent' | 'teal' | 'red' | 'blue' | 'purple' | 'orange' | 'neutral';

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
  accent: styles.variantAccent,
  teal: styles.variantTeal,
  red: styles.variantRed,
  blue: styles.variantBlue,
  purple: styles.variantPurple,
  orange: styles.variantOrange,
  neutral: styles.variantNeutral,
};

const sizeClassMap: Record<'sm' | 'md', string> = {
  sm: styles.sizeSm,
  md: styles.sizeMd,
};

export default function Badge({ variant = 'neutral', size = 'md', dot, icon, children, className, style }: Props) {
  return (
    <span
      className={`${styles.root} ${sizeClassMap[size]} ${variantClassMap[variant]}${className ? ` ${className}` : ''}`}
      style={style}
    >
      {dot && <span className={styles.dot} />}
      {icon}
      {children}
    </span>
  );
}
