import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

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
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'var(--color-overlay)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 5000,
        animation: 'dt-fade-in-up 0.15s ease-out',
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: 'var(--color-surface)',
          borderRadius: 'var(--radius-xl)',
          padding: 'var(--space-xl)',
          minWidth: 320, maxWidth: 440,
          boxShadow: 'var(--shadow-lg)',
          border: '1px solid var(--color-border)',
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <h3 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--text-lg)',
          fontWeight: 600,
          color: 'var(--color-text)',
          margin: '0 0 var(--space-sm)',
        }}>
          {title}
        </h3>
        <p style={{
          margin: '0 0 var(--space-xl)',
          color: 'var(--color-text-secondary)',
          fontSize: 'var(--text-base)',
          lineHeight: 1.5,
        }}>
          {message}
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={btnSecondary}
          >
            {resolvedCancel}
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            style={{
              ...btnPrimary,
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

const btnSecondary: React.CSSProperties = {
  padding: 'var(--space-sm) var(--space-lg)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  background: 'transparent',
  color: 'var(--color-text)',
  cursor: 'pointer',
  fontSize: 'var(--text-sm)',
  fontWeight: 500,
  fontFamily: 'var(--font-body)',
  transition: 'background 0.1s',
};

const btnPrimary: React.CSSProperties = {
  padding: 'var(--space-sm) var(--space-lg)',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
  fontSize: 'var(--text-sm)',
  fontWeight: 600,
  fontFamily: 'var(--font-body)',
  transition: 'opacity 0.1s',
};
