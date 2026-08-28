import { useTranslation } from 'react-i18next';
import { AlertTriangle, RotateCw } from 'lucide-react';
import Button from './Button';
import styles from './ErrorState.module.css';

interface Props {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
  size?: 'page' | 'inline';
  className?: string;
}

export default function ErrorState({ title, description, onRetry, retryLabel, size = 'page', className }: Props) {
  const { t } = useTranslation();
  return (
    <div
      className={[styles.root, size === 'inline' ? styles.inline : styles.page, className]
        .filter(Boolean)
        .join(' ')}
      role="alert"
    >
      <div className={styles.icon} aria-hidden="true">
        <AlertTriangle size={size === 'inline' ? 18 : 22} />
      </div>
      <p className={styles.title}>{title ?? t('common.errorTitle', 'Une erreur est survenue')}</p>
      {description && <p className={styles.description}>{description}</p>}
      {onRetry && (
        <Button
          variant="secondary"
          size="sm"
          onClick={onRetry}
          icon={<RotateCw size={14} />}
        >
          {retryLabel ?? t('common.retry', 'Réessayer')}
        </Button>
      )}
    </div>
  );
}
