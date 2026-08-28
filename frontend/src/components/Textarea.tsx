import { type TextareaHTMLAttributes, forwardRef, useId } from 'react';
import styles from './Textarea.module.css';

interface Props extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
  fullWidth?: boolean;
}

const Textarea = forwardRef<HTMLTextAreaElement, Props>(
  ({ label, error, hint, fullWidth, className, id, required, rows = 4, ...rest }, ref) => {
    const generatedId = useId();
    const fieldId = id ?? generatedId;
    const errorId = `${fieldId}-error`;
    const hintId = `${fieldId}-hint`;

    return (
      <div className={`${styles.field}${fullWidth ? ` ${styles.fullWidth}` : ''}`}>
        {label && (
          <label htmlFor={fieldId} className={styles.label}>
            {label}
            {required && <span className={styles.required} aria-hidden="true"> *</span>}
          </label>
        )}
        <textarea
          ref={ref}
          id={fieldId}
          rows={rows}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : hint ? hintId : undefined}
          className={[styles.textarea, error ? styles.textareaError : '', className ?? '']
            .filter(Boolean)
            .join(' ')}
          {...rest}
        />
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

Textarea.displayName = 'Textarea';
export default Textarea;
