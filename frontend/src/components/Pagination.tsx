import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import styles from './Pagination.module.css';

interface Props {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /** Total d'éléments — affiche « X–Y sur Z » si fourni avec `pageSize`. */
  total?: number;
  pageSize?: number;
  className?: string;
}

export default function Pagination({ page, totalPages, onPageChange, total, pageSize, className }: Props) {
  const { t } = useTranslation();
  if (totalPages <= 1 && !total) return null;

  const showRange = total != null && pageSize != null && total > 0;
  const from = showRange ? (page - 1) * pageSize! + 1 : 0;
  const to = showRange ? Math.min(page * pageSize!, total!) : 0;

  return (
    <div className={[styles.root, className].filter(Boolean).join(' ')}>
      {showRange && (
        <span className={styles.range}>
          {t('common.pagination.range', '{{from}}–{{to}} sur {{total}}', { from, to, total })}
        </span>
      )}
      <div className={styles.controls}>
        <button
          type="button"
          className={styles.btn}
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label={t('common.previousPage')}
        >
          <ChevronLeft size={16} />
        </button>
        <span className={styles.pageNumber} aria-live="polite">
          {t('common.pagination.page', '{{page}} / {{totalPages}}', { page, totalPages })}
        </span>
        <button
          type="button"
          className={styles.btn}
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label={t('common.nextPage')}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
