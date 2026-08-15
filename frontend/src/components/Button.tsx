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

const sizeMap: Record<string, React.CSSProperties> = {
  sm: { padding: 'var(--space-xs, 4px) var(--space-sm, 8px)', fontSize: 'var(--text-xs, 0.625rem)', gap: 4 },
  md: { padding: 'var(--space-sm, 8px) var(--space-lg, 16px)', fontSize: 'var(--text-sm, 0.875rem)', gap: 6 },
  lg: { padding: '12px 24px', fontSize: 'var(--text-md, 1rem)', gap: 8 },
};

const variantMap: Record<string, React.CSSProperties> = {
  primary: {
    background: 'var(--color-accent, #F2A93C)',
    color: 'var(--color-bg, #0B1220)',
    border: 'none',
    boxShadow: 'var(--shadow-xs, 0 1px 3px rgba(0,0,0,0.3))',
  },
  secondary: {
    background: 'var(--color-surface-alt, #182339)',
    color: 'var(--color-text, #E8ECF3)',
    border: '1px solid var(--color-input-border, rgba(232,236,243,0.15))',
    boxShadow: 'var(--shadow-xs, 0 1px 3px rgba(0,0,0,0.3))',
  },
  success: {
    background: 'var(--color-teal, #3FA796)',
    color: 'var(--color-bg, #0B1220)',
    border: 'none',
    boxShadow: 'var(--shadow-xs, 0 1px 3px rgba(0,0,0,0.3))',
  },
  danger: {
    background: 'var(--color-red-muted, rgba(232,84,76,0.15))',
    color: 'var(--color-red, #E8544C)',
    border: '1px solid var(--color-red-muted, rgba(232,84,76,0.15))',
  },
  ghost: {
    background: 'transparent',
    color: 'var(--color-text-secondary, #9BA6B9)',
    border: 'none',
  },
  outline: {
    background: 'transparent',
    color: 'var(--color-accent, #F2A93C)',
    border: '1px solid var(--color-accent, #F2A93C)',
  },
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
      className={`${styles.root} ${sizeClassMap[size] ?? ''}`}
      style={{
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        width: fullWidth ? '100%' : undefined,
        ...sizeMap[size],
        ...variantMap[variant],
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!disabled && !loading) {
          if (variant === 'primary') {
            e.currentTarget.style.background = 'var(--color-accent-hover, #1F4A37)';
          } else if (variant === 'success') {
            e.currentTarget.style.background = 'var(--color-teal-hover, #256B52)';
          } else if (variant === 'secondary') {
            e.currentTarget.style.background = 'var(--color-surface-hover, #1E2A45)';
          } else if (variant === 'outline') {
            e.currentTarget.style.background = 'var(--color-accent-muted, rgba(242,169,60,0.15))';
          } else if (variant === 'ghost') {
            e.currentTarget.style.background = 'var(--color-accent-muted, rgba(242,169,60,0.08))';
          }
        }
      }}
      onMouseLeave={(e) => {
        if (!disabled && !loading) {
          e.currentTarget.style.background = String(variantMap[variant]?.background || '');
          if (variant === 'outline') e.currentTarget.style.background = 'transparent';
          if (variant === 'ghost') e.currentTarget.style.background = 'transparent';
        }
      }}
      onMouseDown={(e) => {
        if (!disabled && !loading) {
          e.currentTarget.style.transform = 'scale(0.97)';
        }
      }}
      onMouseUp={(e) => {
        if (!disabled && !loading) {
          e.currentTarget.style.transform = '';
        }
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