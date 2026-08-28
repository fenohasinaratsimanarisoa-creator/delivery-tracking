import { useTranslation } from 'react-i18next';
import Modal from './Modal';
import Button from './Button';

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

/** Dialogue de décision, construit sur `Modal` (portal + focus-trap + scroll-lock). */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = 'default',
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  const resolvedConfirm = confirmLabel || t('components.confirmDialog.defaultConfirm');
  const resolvedCancel = cancelLabel || t('components.confirmDialog.defaultCancel');

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      description={message}
      width={420}
      hideClose
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {resolvedCancel}
          </Button>
          <Button variant={variant === 'danger' ? 'danger' : 'primary'} onClick={onConfirm}>
            {resolvedConfirm}
          </Button>
        </>
      }
    />
  );
}
