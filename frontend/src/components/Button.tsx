import { type ButtonHTMLAttributes, type ReactNode } from 'react';
import styles from './Button.module.css';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'success' | 'danger' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
  fullWidth?: boolean;
}

const sizeClassMap: Record<string, string> = {
  sm: styles.sizeSm,
  md: styles.sizeMd,
  lg: styles.sizeLg,
};

const variantClassMap: Record<string, string> = {
  primary: styles.variantPrimary,
  secondary: styles.variantSecondary,
  success: styles.variantSuccess,
  danger: styles.variantDanger,
  ghost: styles.variantGhost,
  outline: styles.variantOutline,
};

export default function Button({
  variant = 'primary',
  size = 'md',
  loading,
  icon,
  fullWidth,
  children,
  style,
  disabled,
  ...rest
}: Props) {
  return (
    <button
      disabled={disabled || loading}
      className={`${styles.root} ${sizeClassMap[size] ?? ''} ${variantClassMap[variant] ?? ''}`}
      style={{
        width: fullWidth ? '100%' : undefined,
        ...style,
      }}
      {...rest}
    >
      {loading ? (
        <span className={`${styles.loading}${size === 'sm' ? ` ${styles.loadingSm}` : ''}`} />
      ) : icon ? (
        <span className={styles.iconWrap}>{icon}</span>
      ) : null}
      {children}
    </button>
  );
}
