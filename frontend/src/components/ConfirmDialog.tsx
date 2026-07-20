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
  open, title, message, confirmLabel = 'Confirmer', cancelLabel = 'Annuler',
  variant = 'default', onConfirm, onCancel,
}: Props) {
  if (!open) return null;
  return (
    <div style={overlayStyle} onClick={onCancel}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 8px' }}>{title}</h3>
        <p style={{ margin: '0 0 20px', color: '#555', fontSize: '0.9rem' }}>{message}</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={btnSecondary}>{cancelLabel}</button>
          <button
            onClick={onConfirm}
            style={{
              ...btnPrimary,
              background: variant === 'danger' ? '#dc3545' : '#007bff',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 2000,
};
const dialogStyle: React.CSSProperties = {
  background: '#fff', borderRadius: 8, padding: 24, minWidth: 320,
  maxWidth: 480, boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
};
const btnSecondary: React.CSSProperties = {
  padding: '8px 16px', border: '1px solid #ccc', borderRadius: 4,
  background: '#fff', cursor: 'pointer', fontSize: '0.85rem',
};
const btnPrimary: React.CSSProperties = {
  padding: '8px 16px', border: 'none', borderRadius: 4,
  color: '#fff', cursor: 'pointer', fontSize: '0.85rem',
};
