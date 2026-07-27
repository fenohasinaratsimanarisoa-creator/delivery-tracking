import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './ConfirmDialog.module.css';

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'default';
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open, title, message, confirmLabel, cancelLabel,
  variant = 'default', onConfirm, onCancel,
}: Props) {
  const { t } = useTranslation();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const resolvedConfirm = confirmLabel || t('components.confirmDialog.defaultConfirm');
  const resolvedCancel = cancelLabel || t('components.confirmDialog.defaultCancel');

  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => confirmRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className={styles.overlay}
      onClick={onCancel}
    >
      <div className={styles.card}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <h3 className={styles.title}>
          {title}
        </h3>
        <p className={styles.message}>
          {message}
        </p>
        <div className={styles.actions}>
          <button
            onClick={onCancel}
            className={styles.btnSecondary}
          >
            {resolvedCancel}
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className={styles.btnPrimary}
            style={{
              background: variant === 'danger' ? 'var(--color-red)' : 'var(--color-accent)',
              color: variant === 'danger' ? '#fff' : 'var(--color-bg)',
            }}
          >
            {resolvedConfirm}
          </button>
        </div>
      </div>
    </div>
  );
}


