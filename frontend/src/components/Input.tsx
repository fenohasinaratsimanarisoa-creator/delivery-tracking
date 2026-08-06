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
            className={`${styles.input}${error ? ` ${styles.inputError}` : ''}`}
            style={{
              width: fullWidth ? '100%' : undefined,
              paddingLeft: prefixIcon ? 32 : 12,
              paddingRight: suffixIcon ? 32 : 12,
              ...style,
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