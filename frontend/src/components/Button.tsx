import { type ButtonHTMLAttributes, type ReactNode } from 'react';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
  fullWidth?: boolean;
}

const sizeMap: Record<string, React.CSSProperties> = {
  sm: { padding: 'var(--space-xs, 4px) var(--space-sm, 8px)', fontSize: 'var(--text-xs, 0.625rem)', minHeight: 28, gap: 4 },
  md: { padding: 'var(--space-sm, 8px) var(--space-lg, 16px)', fontSize: 'var(--text-sm, 0.875rem)', minHeight: 36, gap: 6 },
  lg: { padding: '12px 24px', fontSize: 'var(--text-md, 1rem)', minHeight: 44, gap: 8 },
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
        opacity: disabled ? 0.5 : 1,
        fontFamily: 'var(--font-body, Inter, sans-serif)',
        transition: `background var(--duration-base, 200ms) var(--ease-smooth, ease), color var(--duration-base, 200ms) var(--ease-smooth, ease), border-color var(--duration-base, 200ms) var(--ease-smooth, ease), box-shadow var(--duration-base, 200ms) var(--ease-smooth, ease), transform var(--duration-fast, 120ms) var(--ease-snappy, ease)`,
        width: fullWidth ? '100%' : undefined,
        whiteSpace: 'nowrap',
        position: 'relative',
        overflow: 'hidden',
        ...sizeMap[size],
        ...variantMap[variant],
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!disabled && !loading) {
          e.currentTarget.style.transform = 'translateY(-1px)';
          if (variant === 'primary') {
            e.currentTarget.style.boxShadow = 'var(--shadow-glow, 0 0 12px rgba(242,169,60,0.35))';
          } else if (variant === 'danger') {
            e.currentTarget.style.boxShadow = 'var(--shadow-glow-danger, 0 0 12px rgba(232,84,76,0.35))';
          } else if (variant === 'secondary') {
            e.currentTarget.style.boxShadow = 'var(--shadow-md, 0 4px 12px rgba(0,0,0,0.4))';
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
          e.currentTarget.style.transform = '';
          e.currentTarget.style.boxShadow = variantMap[variant]?.boxShadow || '';
          if (variant === 'secondary') e.currentTarget.style.background = 'var(--color-surface-alt, #182339)';
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
        <span style={{
          width: size === 'sm' ? 12 : 16,
          height: size === 'sm' ? 12 : 16,
          borderRadius: '50%',
          border: '2px solid currentColor',
          borderTopColor: 'transparent',
          animation: 'dt-spin 0.6s linear infinite',
          display: 'inline-block',
          flexShrink: 0,
        }} />
      ) : icon ? (
        <span style={{ display: 'inline-flex', flexShrink: 0 }}>{icon}</span>
      ) : null}
      {children}
    </button>
  );
}