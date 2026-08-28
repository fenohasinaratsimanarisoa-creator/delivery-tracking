import { type InputHTMLAttributes, forwardRef, useId, type ReactNode } from 'react';
import styles from './Switch.module.css';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label?: ReactNode;
  hint?: string;
}

const Switch = forwardRef<HTMLInputElement, Props>(
  ({ label, hint, className, id, disabled, ...rest }, ref) => {
    const generatedId = useId();
    const fieldId = id ?? generatedId;
    return (
      <label
        htmlFor={fieldId}
        className={[styles.root, disabled ? styles.disabled : '', className ?? '']
          .filter(Boolean)
          .join(' ')}
      >
        <span className={styles.control}>
          <input
            ref={ref}
            id={fieldId}
            type="checkbox"
            role="switch"
            disabled={disabled}
            className={styles.input}
            {...rest}
          />
          <span className={styles.track} aria-hidden="true">
            <span className={styles.thumb} />
          </span>
        </span>
        {(label || hint) && (
          <span className={styles.text}>
            {label && <span className={styles.label}>{label}</span>}
            {hint && <span className={styles.hint}>{hint}</span>}
          </span>
        )}
      </label>
    );
  },
);

Switch.displayName = 'Switch';
export default Switch;
