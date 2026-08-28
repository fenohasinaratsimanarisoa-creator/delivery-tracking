import { type InputHTMLAttributes, type ReactNode, forwardRef, useId } from 'react';
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
  ({ label, error, hint, prefixIcon, suffixIcon, fullWidth, className, id, required, ...rest }, ref) => {
    // id STABLE et unique (React.useId) : l'ancien id dérivé du texte du label
    // provoquait des collisions (2 champs même label) et cassait avec les
    // accents / l'i18n.
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const errorId = `${inputId}-error`;
    const hintId = `${inputId}-hint`;
    const describedBy = error ? errorId : hint ? hintId : undefined;

    return (
      <div className={`${styles.field}${fullWidth ? ` ${styles.fullWidth}` : ''}`}>
        {label && (
          <label htmlFor={inputId} className={styles.label}>
            {label}
            {required && <span className={styles.required} aria-hidden="true"> *</span>}
          </label>
        )}
        <div className={styles.inputWrap}>
          {prefixIcon && <span className={styles.prefixIcon} aria-hidden="true">{prefixIcon}</span>}
          <input
            ref={ref}
            id={inputId}
            required={required}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={[
              styles.input,
              prefixIcon ? styles.hasPrefix : '',
              suffixIcon ? styles.hasSuffix : '',
              error ? styles.inputError : '',
              className ?? '',
            ]
              .filter(Boolean)
              .join(' ')}
            {...rest}
          />
          {suffixIcon && <span className={styles.suffixIcon} aria-hidden="true">{suffixIcon}</span>}
        </div>
        {error && (
          <span id={errorId} className={styles.error} role="alert">
            {error}
          </span>
        )}
        {hint && !error && (
          <span id={hintId} className={styles.hint}>
            {hint}
          </span>
        )}
      </div>
    );
  },
);

Input.displayName = 'Input';
export default Input;
