import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Trash2, CheckSquare, Square } from 'lucide-react';
import { useIsMobile } from '../hooks/useIsMobile';
import styles from './DataTable.module.css';

interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
  sortable?: boolean;
}

interface Props<T> {
  columns: Column<T>[];
  data: T[];
  total: number;
  page: number;
  limit: number;
  onPageChange: (page: number) => void;
  onEdit?: (row: T) => void;
  onDelete?: (row: T) => void;
  loading?: boolean;
  emptyMessage?: string;
  keyExtractor: (row: T) => string;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
}

export default function DataTable<T>({
  columns, data, total, page, limit,
  onPageChange, onEdit, onDelete, loading, emptyMessage, keyExtractor,
  selectable, selectedIds, onSelectionChange,
}: Props<T>) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const totalPages = Math.ceil(total / limit);

  const handleSort = (col: Column<T>) => {
    if (!col.sortable) return;
    if (sortKey === col.key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(col.key);
      setSortDir('asc');
    }
  };

  const sorted = [...data].sort((a, b) => {
    if (!sortKey) return 0;
    const aVal = (a as any)[sortKey];
    const bVal = (b as any)[sortKey];
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    const cmp = typeof aVal === 'string' ? aVal.localeCompare(bVal) : aVal - bVal;
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const allSelectedOnPage = selectable && data.length > 0 && data.every((row) => selectedIds?.has(keyExtractor(row)));
  const someSelectedOnPage = selectable && data.some((row) => selectedIds?.has(keyExtractor(row))) && !allSelectedOnPage;

  const handleSelectAll = () => {
    if (!onSelectionChange) return;
    if (allSelectedOnPage) {
      const next = new Set(selectedIds);
      data.forEach((row) => next.delete(keyExtractor(row)));
      onSelectionChange(next);
    } else {
      const next = new Set(selectedIds);
      data.forEach((row) => next.add(keyExtractor(row)));
      onSelectionChange(next);
    }
  };

  const handleRowSelect = (id: string) => {
    if (!onSelectionChange || !selectedIds) return;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  };

  if (loading) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.spinner} />
        {t('components.dataTable.loading')}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className={styles.emptyContainer}>
        <div className={styles.emptyIcon}>
          <Pencil size={20} />
        </div>
        <p className={styles.emptyMessage}>
          {emptyMessage ?? t('components.dataTable.emptyData')}
        </p>
      </div>
    );
  }

  if (isMobile) {
    return (
      <div className={styles.mobileCardContainer}>
        {sorted.map((row) => {
          const rowId = keyExtractor(row);
          return (
          <div key={rowId} className={styles.mobileCard}>
            {selectable && (
              <div className={styles.mobileSelectRow}>
                <button
                  onClick={() => handleRowSelect(rowId)}
                  className={styles.iconButton}
                  aria-label="Sélectionner"
                >
                  {selectedIds?.has(rowId) ? <CheckSquare size={18} /> : <Square size={18} />}
                </button>
              </div>
            )}
            {columns.map((col) => (
              <div key={col.key} className={styles.mobileColumnRow}>
                <span className={styles.mobileLabel}>
                  {col.label}
                </span>
                <span className={styles.mobileValue}>
                  {col.render ? col.render(row) : (row as any)[col.key] ?? '-'}
                </span>
              </div>
            ))}
            {(onEdit || onDelete) && (
              <div className={styles.mobileActions}>
                {onEdit && (
                  <button
                    onClick={() => onEdit(row)}
                    className={styles.actionBtn}
                    style={{ minWidth: 44, minHeight: 44 }}
                    aria-label={t('components.dataTable.editAria')}
                  >
                    <Pencil size={16} />
                  </button>
                )}
                {onDelete && (
                  <button
                    onClick={() => onDelete(row)}
                    className={styles.actionBtn}
                    style={{ minWidth: 44, minHeight: 44 }}
                    aria-label={t('components.dataTable.deleteAria')}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            )}
          </div>
          );
        })}
        {totalPages > 1 && (
          <div className={styles.mobilePagination}>
            <button
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              style={pageBtnStyle(page <= 1)}
              aria-label={t('common.previousPage')}
            >
              ←
            </button>
            <span className={styles.pageNumber}>
              {page} / {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              style={pageBtnStyle(page >= totalPages)}
              aria-label={t('common.nextPage')}
            >
              →
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.tableContainer}>
      <div className={styles.scrollWrapper}>
        <table className={styles.table}>
          <thead>
            <tr className={styles.headerRow}>
              {selectable && (
                <th className={styles.headerCellSelect}
                  style={{ position: 'sticky', left: 0, zIndex: 3, background: 'var(--color-surface-alt)' }}
                >
                  <button
                    onClick={handleSelectAll}
                    className={styles.iconButton}
                    aria-label={allSelectedOnPage ? 'Tout désélectionner' : 'Tout sélectionner'}
                  >
                    {allSelectedOnPage ? <CheckSquare size={16} /> : someSelectedOnPage ? <Square size={16} opacity={0.5} /> : <Square size={16} />}
                  </button>
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col)}
                  className={`${styles.headerCell}${col.sortable ? ` ${styles.sortableCell}` : ''}`}
                  style={{ cursor: col.sortable ? 'pointer' : 'default' }}
                >
                  {col.label}
                  {col.sortable && (
                    <span style={{
                      marginLeft: 'var(--space-xs)',
                      opacity: sortKey === col.key ? 1 : 0.25,
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-xs)',
                    }}>
                      {sortKey === col.key ? (sortDir === 'asc' ? '▲' : '▼') : '▲'}
                    </span>
                  )}
                </th>
              ))}
              {(onEdit || onDelete) && (
                <th className={styles.headerActionsCell}
                  style={{ position: 'sticky', right: 0, zIndex: 2, background: 'var(--color-surface-alt)' }}
                >
                  {t('common.actions')}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
              {sorted.map((row, ri) => {
                const rowId = keyExtractor(row);
                const isSelected = selectedIds?.has(rowId);
                return (
                <tr
                  key={rowId}
                  className={styles.dataRow}
                  style={{
                    borderBottom: ri < sorted.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
                    ...(isSelected ? { background: 'var(--color-accent-muted)' } : {}),
                  }}
                  onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--color-surface-hover)'; }}
                  onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                >
                  {selectable && (
                    <td className={styles.dataCellSelect}
                      style={{
                        position: 'sticky', left: 0, zIndex: 1,
                        background: isSelected ? 'var(--color-accent-muted)' : 'var(--color-surface)',
                      }}
                    >
                      <button
                        onClick={() => handleRowSelect(rowId)}
                        className={styles.iconButton}
                        aria-label="Sélectionner"
                      >
                        {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                      </button>
                    </td>
                  )}
                  {columns.map((col) => (
                    <td key={col.key} className={styles.dataCell}>
                    {col.render ? col.render(row) : (row as any)[col.key] ?? '-'}
                  </td>
                ))}
                {(onEdit || onDelete) && (
                  <td className={styles.actionsCell}
                    style={{
                      position: 'sticky', right: 0, zIndex: 1,
                      background: isSelected ? 'var(--color-accent-muted)' : 'var(--color-surface)',
                    }}
                  >
                    <div className={styles.actionsRow}>
                      {onEdit && (
                        <button
                          onClick={() => onEdit(row)}
                          className={styles.actionBtn}
                          aria-label={t('components.dataTable.editAria')}
                        >
                          <Pencil size={14} />
                        </button>
                      )}
                      {onDelete && (
                        <button
                          onClick={() => onDelete(row)}
                          className={styles.actionBtn}
                          aria-label={t('components.dataTable.deleteAria')}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className={styles.pagination}>
          <button
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            style={pageBtnStyle(page <= 1)}
            aria-label={t('common.previousPage')}
          >
            ←
          </button>
          <span className={styles.pageNumber}>
            {page} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            style={pageBtnStyle(page >= totalPages)}
            aria-label={t('common.nextPage')}
          >
            →
          </button>
        </div>
      )}
    </div>
  );
}

const pageBtnStyle = (disabled: boolean): React.CSSProperties => ({
  padding: 'var(--space-sm) var(--space-md)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-md)',
  cursor: disabled ? 'default' : 'pointer',
  opacity: disabled ? 0.35 : 1,
  background: disabled ? 'transparent' : 'var(--color-surface)',
  color: disabled ? 'var(--color-text-tertiary)' : 'var(--color-text-secondary)',
  fontSize: 'var(--text-sm)',
  fontFamily: 'var(--font-body)',
  fontWeight: 500,
  transition: 'background 0.15s ease, opacity 0.15s ease, color 0.15s ease',
});
