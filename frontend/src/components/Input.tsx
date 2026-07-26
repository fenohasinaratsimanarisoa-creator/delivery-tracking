import { type InputHTMLAttributes, type ReactNode, forwardRef } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  prefixIcon?: ReactNode;
  suffixIcon?: ReactNode;
  fullWidth?: boolean;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, prefixIcon, suffixIcon, fullWidth, style, id, ...rest }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: fullWidth ? '100%' : undefined }}>
        {label && (
          <label
            htmlFor={inputId}
            style={{
              fontSize: 'var(--text-sm, 0.75rem)',
              fontWeight: 500,
              color: 'var(--color-text-secondary, #9BA6B9)',
            }}
          >
            {label}
          </label>
        )}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          {prefixIcon && (
            <span style={{
              position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
              color: 'var(--color-text-tertiary, #7A8BA3)',
              display: 'flex', pointerEvents: 'none', fontSize: 'var(--text-sm, 0.75rem)',
            }}>
              {prefixIcon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            style={{
              width: fullWidth ? '100%' : undefined,
              padding: '8px 12px',
              paddingLeft: prefixIcon ? 32 : 12,
              paddingRight: suffixIcon ? 32 : 12,
              background: 'var(--color-input-bg, #0D1525)',
              border: `1px solid ${error ? 'var(--color-red, #E8544C)' : 'var(--color-input-border, #1E2A45)'}`,
              borderRadius: 'var(--radius-md, 6px)',
              color: 'var(--color-text, #E8ECF3)',
              fontSize: 'var(--text-sm, 0.875rem)',
              fontFamily: 'var(--font-body, Inter, sans-serif)',
              outline: 'none',
              transition: 'border-color var(--duration-base, 200ms) var(--ease-smooth, ease), box-shadow var(--duration-base, 200ms) var(--ease-smooth, ease)',
              ...style,
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = 'var(--color-input-focus, #F2A93C)';
              e.currentTarget.style.boxShadow = 'var(--shadow-glow, 0 0 8px rgba(242,169,60,0.2))';
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = error ? 'var(--color-red, #E8544C)' : 'var(--color-input-border, #1E2A45)';
              e.currentTarget.style.boxShadow = '';
            }}
            {...rest}
          />
          {suffixIcon && (
            <span style={{
              position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
              color: 'var(--color-text-tertiary, #7A8BA3)',
              display: 'flex', pointerEvents: 'none', fontSize: 'var(--text-sm, 0.75rem)',
            }}>
              {suffixIcon}
            </span>
          )}
        </div>
        {error && (
          <span style={{ fontSize: 'var(--text-xs, 0.625rem)', color: 'var(--color-red, #E8544C)' }}>{error}</span>
        )}
        {hint && !error && (
          <span style={{ fontSize: 'var(--text-xs, 0.625rem)', color: 'var(--color-text-tertiary, #7A8BA3)' }}>{hint}</span>
        )}
      </div>
    );
  },
);

Input.displayName = 'Input';
export default Input;