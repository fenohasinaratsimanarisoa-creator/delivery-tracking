import { type InputHTMLAttributes, type ReactNode, forwardRef } from 'react';
import styles from './Input.module.css';

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
      <div className={styles.field} style={{ width: fullWidth ? '100%' : undefined }}>
        {label && (
          <label htmlFor={inputId} className={styles.label}>
            {label}
          </label>
        )}
        <div className={styles.inputWrap}>
          {prefixIcon && (
            <span className={styles.prefixIcon}>
              {prefixIcon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={styles.input}
            style={{
              width: fullWidth ? '100%' : undefined,
              paddingLeft: prefixIcon ? 32 : 12,
              paddingRight: suffixIcon ? 32 : 12,
              border: `1px solid ${error ? 'var(--color-red, #E8544C)' : 'var(--color-input-border, #1E2A45)'}`,
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
            <span className={styles.suffixIcon}>
              {suffixIcon}
            </span>
          )}
        </div>
        {error && (
          <span className={styles.error}>{error}</span>
        )}
        {hint && !error && (
          <span className={styles.hint}>{hint}</span>
        )}
      </div>
    );
  },
);

Input.displayName = 'Input';
export default Input;