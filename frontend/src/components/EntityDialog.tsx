import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Loader2 } from 'lucide-react';

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
        style={{
          position: 'absolute', inset: 0,
          background: 'var(--color-overlay)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
        }}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="dt-dialog-card"
        style={{
          position: 'relative',
          width, maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'calc(100vh - 64px)',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-dialog)',
          display: 'flex', flexDirection: 'column',
          animation: closing
            ? 'dt-dialog-out 0.2s ease-in forwards'
            : 'dt-dialog-in 0.25s ease-out',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{
          position: 'sticky', top: 0, zIndex: 10,
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          gap: 'var(--space-md)',
          padding: 'var(--space-xl) var(--space-xl) var(--space-lg)',
          borderBottom: '1px solid var(--color-border-subtle)',
          background: 'var(--color-surface)',
          borderTopLeftRadius: 'var(--radius-xl)',
          borderTopRightRadius: 'var(--radius-xl)',
        }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--text-lg)',
              fontWeight: 700,
              color: 'var(--color-text)',
              margin: 0,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {title}
            </h2>
            {subtitle && (
              <p style={{
                margin: 'var(--space-xs) 0 0',
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text-secondary)',
              }}>
                {subtitle}
              </p>
            )}
          </div>
          <button
            onClick={handleClose}
            aria-label={t('components.entityDialog.closeAria')}
            style={{
              background: 'var(--color-surface-alt)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              padding: 'var(--space-sm)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--color-text-secondary)',
              transition: 'background 0.1s, color 0.1s',
              flexShrink: 0,
            }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{
          flex: 1, overflow: 'auto',
          padding: 'var(--space-xl)',
        }}>
          {children}
        </div>

        {footer && (
          <div style={{
            position: 'sticky', bottom: 0, zIndex: 10,
            background: 'var(--color-surface)',
            borderTop: '1px solid var(--color-border-subtle)',
            borderBottomLeftRadius: 'var(--radius-xl)',
            borderBottomRightRadius: 'var(--radius-xl)',
          }}>
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
    <div style={{ marginBottom: 'var(--space-lg)' }}>
      <label
        htmlFor={id}
        style={{
          display: 'block',
          fontSize: 'var(--text-xs)',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: error ? 'var(--color-red)' : 'var(--color-text-secondary)',
          marginBottom: 'var(--space-sm)',
          fontFamily: 'var(--font-body)',
          transition: 'color 0.1s',
        }}
      >
        {label}{required && <span style={{ color: 'var(--color-red)', marginLeft: 2 }}>*</span>}
      </label>
      {React.cloneElement(React.Children.only(children) as React.ReactElement, {
        id,
        className: `${(children as any).props?.className || ''} ${error ? '--error' : ''}`.trim(),
      })}
      {error && (
        <p style={{
          margin: 'var(--space-xs) 0 0',
          fontSize: 'var(--text-xs)',
          color: 'var(--color-red)',
          fontFamily: 'var(--font-body)',
          lineHeight: 1.3,
        }}>
          {error}
        </p>
      )}
    </div>
  );
}

export function DialogSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 'var(--space-xl)' }}>
      <h3 style={{
        fontFamily: 'var(--font-display)',
        fontSize: 'var(--text-sm)',
        fontWeight: 600,
        color: 'var(--color-accent)',
        margin: '0 0 var(--space-md)',
        paddingBottom: 'var(--space-sm)',
        borderBottom: '1px solid var(--color-border-subtle)',
        letterSpacing: '-0.01em',
      }}>
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
    <div style={{
      padding: 'var(--space-lg) var(--space-xl)',
      display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)',
    }}>
      {error && (
        <p style={{
          margin: 0,
          fontSize: 'var(--text-sm)',
          color: 'var(--color-red)',
          fontFamily: 'var(--font-body)',
          lineHeight: 1.4,
          padding: 'var(--space-sm) var(--space-md)',
          background: 'var(--color-red-muted)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-red)',
        }}>
          {error}
        </p>
      )}
      <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          style={{
            padding: 'var(--space-sm) var(--space-lg)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            background: 'transparent',
            color: 'var(--color-text)',
            cursor: loading ? 'default' : 'pointer',
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
            fontFamily: 'var(--font-body)',
            opacity: loading ? 0.5 : 1,
            transition: 'background 0.1s',
          }}
        >
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          form={form}
          disabled={loading}
          style={{
            padding: 'var(--space-sm) var(--space-lg)',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-accent)',
            color: 'var(--color-bg)',
            cursor: loading ? 'default' : 'pointer',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            fontFamily: 'var(--font-body)',
            display: 'flex', alignItems: 'center', gap: 'var(--space-sm)',
            opacity: loading ? 0.7 : 1,
            transition: 'opacity 0.1s',
          }}
        >
          {loading && <Loader2 size={14} style={{ animation: 'dt-spin 0.6s linear infinite' }} />}
          {loading ? t('common.saving') : submitLabel}
        </button>
      </div>
    </div>
  );
}
