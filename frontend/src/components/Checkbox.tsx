import { type InputHTMLAttributes, forwardRef, useId, type ReactNode } from 'react';
import { Check, Minus } from 'lucide-react';
import styles from './Checkbox.module.css';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label?: ReactNode;
  hint?: string;
  indeterminate?: boolean;
}

const Checkbox = forwardRef<HTMLInputElement, Props>(
  ({ label, hint, indeterminate, className, id, disabled, ...rest }, ref) => {
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
            ref={(node) => {
              if (node) node.indeterminate = !!indeterminate;
              if (typeof ref === 'function') ref(node);
              else if (ref) ref.current = node;
            }}
            id={fieldId}
            type="checkbox"
            disabled={disabled}
            className={styles.input}
            {...rest}
          />
          <span className={styles.box} aria-hidden="true">
            {indeterminate ? <Minus size={12} strokeWidth={3} /> : <Check size={12} strokeWidth={3} />}
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

Checkbox.displayName = 'Checkbox';
export default Checkbox;
