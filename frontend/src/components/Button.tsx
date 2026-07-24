import { type ButtonHTMLAttributes, type ReactNode } from 'react';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
  fullWidth?: boolean;
}

const sizeMap: Record<string, React.CSSProperties> = {
  sm: { padding: 'var(--space-xs, 4px) var(--space-sm, 8px)', fontSize: 'var(--text-xs, 0.625rem)' },
  md: { padding: 'var(--space-sm, 8px) var(--space-lg, 16px)', fontSize: 'var(--text-sm, 0.875rem)' },
  lg: { padding: '11px 24px', fontSize: 'var(--text-md, 1rem)' },
};

const variantMap: Record<string, React.CSSProperties> = {
  primary: {
    background: 'var(--color-accent, #F2A93C)',
    color: 'var(--color-bg, #0B1220)',
    border: 'none',
  },
  secondary: {
    background: 'var(--color-surface-alt, #182339)',
    color: 'var(--color-text, #E8ECF3)',
    border: '1px solid var(--color-input-border, rgba(232,236,243,0.15))',
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
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        fontWeight: 600,
        borderRadius: 'var(--radius-md, 6px)',
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        fontFamily: 'var(--font-body, Inter, sans-serif)',
        transition: 'background var(--transition-fast, 150ms) ease, color var(--transition-fast, 150ms) ease, border-color var(--transition-fast, 150ms) ease, box-shadow var(--transition-fast, 150ms) ease, transform var(--transition-fast, 150ms) ease',
        width: fullWidth ? '100%' : undefined,
        whiteSpace: 'nowrap',
        ...sizeMap[size],
        ...variantMap[variant],
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!disabled && !loading) {
          if (variant === 'primary') {
            e.currentTarget.style.transform = 'translateY(-1px)';
            e.currentTarget.style.boxShadow = 'var(--shadow-sm, 0 4px 24px rgba(0,0,0,0.4))';
          }
          if (variant === 'outline') {
            e.currentTarget.style.background = 'var(--color-accent-muted, rgba(242,169,60,0.15))';
          }
          if (variant === 'secondary') {
            e.currentTarget.style.background = 'var(--color-surface-hover, #1E2A45)';
          }
        }
      }}
      onMouseLeave={(e) => {
        if (variant === 'primary') {
          e.currentTarget.style.transform = '';
          e.currentTarget.style.boxShadow = '';
        }
        if (variant === 'outline') {
          e.currentTarget.style.background = 'transparent';
        }
        if (variant === 'secondary') {
          e.currentTarget.style.background = 'var(--color-surface-alt, #182339)';
        }
      }}
      {...rest}
    >
      {loading ? (
        <span style={{
          width: size === 'sm' ? 12 : 16,
          height: size === 'sm' ? 12 : 16,
          borderRadius: '50%',
          border: '2px solid currentColor',
          borderTopColor: 'transparent',
          animation: 'dt-spin 0.6s linear infinite',
          display: 'inline-block',
        }} />
      ) : icon}
      {children}
    </button>
  );
}