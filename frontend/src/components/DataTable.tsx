import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pencil,
  Trash2,
  CheckSquare,
  Square,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Inbox,
} from 'lucide-react';
import { useIsMobile } from '../hooks/useIsMobile';
import Skeleton from './Skeleton';
import EmptyState from './EmptyState';
import Pagination from './Pagination';
import styles from './DataTable.module.css';

interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
  sortable?: boolean;
  /** Alignement selon le TYPE de donnée. `right` active aussi `tabular-nums`. */
  align?: 'left' | 'right' | 'center';
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

function alignClass(align?: Column<unknown>['align']): string {
  if (align === 'right') return `${styles.alignRight} ${styles.numeric}`;
  if (align === 'center') return styles.alignCenter;
  return '';
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

  // Tri client sur la page courante (inchangé — le tri serveur sera une décision
  // séparée). Ne PAS supprimer / muter `data`.
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
    const next = new Set(selectedIds);
    if (allSelectedOnPage) data.forEach((row) => next.delete(keyExtractor(row)));
    else data.forEach((row) => next.add(keyExtractor(row)));
    onSelectionChange(next);
  };

  const handleRowSelect = (id: string) => {
    if (!onSelectionChange || !selectedIds) return;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  };

  if (loading) {
    const colCount = columns.length + (selectable ? 1 : 0) + (onEdit || onDelete ? 1 : 0);
    return (
      <div className={styles.tableContainer} aria-busy="true">
        <span className={styles.srOnly}>{t('components.dataTable.loading')}</span>
        <div className={styles.skeletonWrap}>
          {Array.from({ length: 6 }).map((_, r) => (
            <div key={r} className={styles.skeletonRow}>
              {Array.from({ length: Math.max(colCount, 3) }).map((_, c) => (
                <Skeleton key={c} variant="text" width={c === 0 ? '55%' : '80%'} />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className={styles.tableContainer}>
        <EmptyState
          size="inline"
          icon={<Inbox size={20} />}
          title={emptyMessage ?? t('components.dataTable.emptyData')}
        />
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
                  <button onClick={() => handleRowSelect(rowId)} className={styles.iconButton} aria-label={t('components.dataTable.select', 'Sélectionner')}>
                    {selectedIds?.has(rowId) ? <CheckSquare size={18} /> : <Square size={18} />}
                  </button>
                </div>
              )}
              {columns.map((col) => (
                <div key={col.key} className={styles.mobileColumnRow}>
                  <span className={styles.mobileLabel}>{col.label}</span>
                  <span className={`${styles.mobileValue} ${alignClass(col.align)}`}>
                    {col.render ? col.render(row) : (row as any)[col.key] ?? '-'}
                  </span>
                </div>
              ))}
              {(onEdit || onDelete) && (
                <div className={styles.mobileActions}>
                  {onEdit && (
                    <button onClick={() => onEdit(row)} className={styles.actionBtnLg} aria-label={t('components.dataTable.editAria')}>
                      <Pencil size={16} />
                    </button>
                  )}
                  {onDelete && (
                    <button onClick={() => onDelete(row)} className={styles.actionBtnLg} aria-label={t('components.dataTable.deleteAria')}>
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {totalPages > 1 && (
          <Pagination
            className={styles.mobilePagination}
            page={page}
            totalPages={totalPages}
            onPageChange={onPageChange}
          />
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
                <th className={`${styles.headerCell} ${styles.headerCellSelect} ${styles.stickyLeft}`}>
                  <button
                    onClick={handleSelectAll}
                    className={styles.iconButton}
                    aria-label={allSelectedOnPage ? t('components.dataTable.deselectAll', 'Tout désélectionner') : t('components.dataTable.selectAll', 'Tout sélectionner')}
                  >
                    {allSelectedOnPage ? <CheckSquare size={16} /> : someSelectedOnPage ? <Square size={16} opacity={0.5} /> : <Square size={16} />}
                  </button>
                </th>
              )}
              {columns.map((col) => {
                const active = sortKey === col.key;
                return (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col)}
                    aria-sort={col.sortable ? (active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}
                    className={[
                      styles.headerCell,
                      col.sortable ? styles.sortableCell : '',
                      alignClass(col.align),
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <span className={styles.headerLabel}>
                      {col.label}
                      {col.sortable && (
                        <span className={`${styles.sortIcon}${active ? ` ${styles.sortIconActive}` : ''}`} aria-hidden="true">
                          {active ? (
                            sortDir === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />
                          ) : (
                            <ChevronsUpDown size={13} />
                          )}
                        </span>
                      )}
                    </span>
                  </th>
                );
              })}
              {(onEdit || onDelete) && (
                <th className={`${styles.headerCell} ${styles.headerActionsCell} ${styles.stickyRight}`}>
                  {t('common.actions')}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const rowId = keyExtractor(row);
              const isSelected = selectedIds?.has(rowId);
              return (
                <tr key={rowId} className={`${styles.dataRow}${isSelected ? ` ${styles.dataRowSelected}` : ''}`}>
                  {selectable && (
                    <td className={`${styles.dataCell} ${styles.dataCellSelect} ${styles.stickyLeft}`}>
                      <button onClick={() => handleRowSelect(rowId)} className={styles.iconButton} aria-label={t('components.dataTable.select', 'Sélectionner')}>
                        {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                      </button>
                    </td>
                  )}
                  {columns.map((col) => (
                    <td key={col.key} className={`${styles.dataCell} ${alignClass(col.align)}`}>
                      {col.render ? col.render(row) : (row as any)[col.key] ?? '-'}
                    </td>
                  ))}
                  {(onEdit || onDelete) && (
                    <td className={`${styles.dataCell} ${styles.actionsCell} ${styles.stickyRight}`}>
                      <div className={styles.actionsRow}>
                        {onEdit && (
                          <button onClick={() => onEdit(row)} className={styles.actionBtn} aria-label={t('components.dataTable.editAria')}>
                            <Pencil size={14} />
                          </button>
                        )}
                        {onDelete && (
                          <button onClick={() => onDelete(row)} className={styles.actionBtn} aria-label={t('components.dataTable.deleteAria')}>
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
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={limit}
            onPageChange={onPageChange}
          />
        </div>
      )}
    </div>
  );
}
