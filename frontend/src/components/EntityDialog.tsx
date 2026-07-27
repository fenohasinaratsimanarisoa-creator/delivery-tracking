import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Loader2 } from 'lucide-react';
import styles from './EntityDialog.module.css';

interface EntityDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}

const dialogKeyframes = `
@keyframes dt-dialog-overlay-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes dt-dialog-overlay-out {
  from { opacity: 1; }
  to { opacity: 0; }
}
@keyframes dt-dialog-in {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes dt-dialog-out {
  from { opacity: 1; transform: scale(1); }
  to { opacity: 0; transform: scale(0.96); }
}
.dialog-input, .dialog-select {
  width: 100%;
  padding: var(--space-sm) var(--space-md);
  background: var(--color-input-bg);
  border: 1px solid var(--color-input-border);
  border-radius: var(--radius-md);
  color: var(--color-text);
  font-size: var(--text-sm);
  font-family: var(--font-body);
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  box-sizing: border-box;
}
.dialog-input:focus, .dialog-select:focus {
  border-color: var(--color-input-focus);
  box-shadow: 0 0 0 3px var(--color-accent-muted);
}
.dialog-input.--error, .dialog-select.--error {
  border-color: var(--color-red);
}
.dialog-input.--error:focus, .dialog-select.--error:focus {
  border-color: var(--color-red);
  box-shadow: 0 0 0 3px var(--color-red-muted);
}
@media (max-width: 640px) {
  .dt-dialog-card {
    width: calc(100vw - 16px) !important;
    max-height: calc(100vh - 16px) !important;
    border-radius: var(--radius-lg) !important;
  }
}
`;

export default function EntityDialog({ open, onClose, title, subtitle, children, footer, width = 600 }: EntityDialogProps) {
  const { t } = useTranslation();
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [closing, setClosing] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (!document.getElementById('dt-dialog-keyframes')) {
      const style = document.createElement('style');
      style.id = 'dt-dialog-keyframes';
      style.textContent = dialogKeyframes;
      document.head.appendChild(style);
    }
  }, []);

  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      requestAnimationFrame(() => setMounted(true));
    } else {
      setMounted(false);
      setClosing(false);
    }
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { handleClose(); return; }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    const timer = setTimeout(() => {
      const first = dialogRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      first?.focus();
    }, 150);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearTimeout(timer);
    };
  }, [mounted]);

  const handleClose = () => {
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      setMounted(false);
      previousFocusRef.current?.focus();
      onClose();
    }, 200);
  };

  if (!open && !closing) return null;

  return (
    <div
      ref={overlayRef}
      style={{
        position: 'fixed', inset: 0,
        zIndex: 6000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: closing
          ? 'dt-dialog-overlay-out 0.2s ease-out forwards'
          : 'dt-dialog-overlay-in 0.2s ease-out',
      }}
    >
      <div
        onClick={handleClose}
        className={styles.backdrop}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`dt-dialog-card ${styles.dialogCard}`}
        style={{
          width,
          animation: closing
            ? 'dt-dialog-out 0.2s ease-in forwards'
            : 'dt-dialog-in 0.25s ease-out',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}
          style={{ position: 'sticky', top: 0, zIndex: 10 }}>
          <div className={styles.titleWrap}>
            <h2 className={styles.title}>
              {title}
            </h2>
            {subtitle && (
              <p className={styles.subtitle}>
                {subtitle}
              </p>
            )}
          </div>
          <button
            onClick={handleClose}
            aria-label={t('components.entityDialog.closeAria')}
            className={styles.closeBtn}
          >
            <X size={16} />
          </button>
        </div>

        <div className={styles.body}>
          {children}
        </div>

        {footer && (
          <div className={styles.footer}
            style={{ position: 'sticky', bottom: 0, zIndex: 10 }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function DialogField({ label, error, children, required }: {
  label: string; error?: string | null; children: ReactNode; required?: boolean;
}) {
  const id = `df-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className={styles.field}>
      <label
        htmlFor={id}
        className={styles.label}
        style={{ color: error ? 'var(--color-red)' : 'var(--color-text-secondary)' }}
      >
        {label}{required && <span className={styles.requiredStar}>*</span>}
      </label>
      {React.Children.map(children, (child, index) => {
        if (index === 0) {
          return React.cloneElement(child as React.ReactElement, {
            id,
            className: `${(child as any).props?.className || ''} ${error ? '--error' : ''}`.trim(),
          });
        }
        return child;
      })}
      {error && (
        <p className={styles.errorText}>
          {error}
        </p>
      )}
    </div>
  );
}

export function DialogSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>
        {title}
      </h3>
      {children}
    </div>
  );
}

export function DialogSubmitBar({ loading, onCancel, submitLabel, error, form }: {
  loading: boolean; onCancel: () => void; submitLabel: string; error?: string | null; form?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.submitBar}>
      {error && (
        <p className={styles.submitError}>
          {error}
        </p>
      )}
      <div className={styles.submitActions}>
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className={styles.cancelBtn}
          style={{ cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.5 : 1 }}
        >
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          form={form}
          disabled={loading}
          className={styles.submitBtn}
          style={{ cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.7 : 1 }}
        >
          {loading && <Loader2 size={14} style={{ animation: 'dt-spin 0.6s linear infinite' }} />}
          {loading ? t('common.saving') : submitLabel}
        </button>
      </div>
    </div>
  );
}
