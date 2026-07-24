import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Trash2 } from 'lucide-react';
import { useIsMobile } from '../hooks/useIsMobile';

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
}

export default function DataTable<T>({
  columns, data, total, page, limit,
  onPageChange, onEdit, onDelete, loading, emptyMessage, keyExtractor,
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

  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'var(--space-4xl)',
        color: 'var(--color-text-secondary)',
        fontSize: 'var(--text-base)',
      }}>
        <div style={{
          width: 20, height: 20, borderRadius: 'var(--radius-full)',
          border: '2px solid var(--color-border)',
          borderTopColor: 'var(--color-accent)',
          animation: 'dt-spin 0.6s linear infinite',
          marginRight: 'var(--space-sm)',
        }} />
        {t('components.dataTable.loading')}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'var(--space-4xl)',
        flexDirection: 'column', gap: 'var(--space-md)',
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: 'var(--radius-full)',
          background: 'var(--color-accent-muted)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--color-accent)', fontSize: 20, opacity: 0.6,
        }}>
          <Pencil size={20} />
        </div>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-base)', margin: 0, textAlign: 'center' }}>
          {emptyMessage ?? t('components.dataTable.emptyData')}
        </p>
      </div>
    );
  }

  if (isMobile) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)',
      }}>
        {sorted.map((row) => (
          <div key={keyExtractor(row)} style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-lg)',
            padding: 'var(--space-md)',
          }}>
            {columns.map((col) => (
              <div key={col.key} style={{
                display: 'flex', justifyContent: 'space-between',
                padding: 'var(--space-xs) 0',
                fontSize: 'var(--text-sm)',
                borderBottom: '1px solid var(--color-border-subtle)',
                gap: 'var(--space-sm)',
              }}>
                <span style={{
                  fontWeight: 600,
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-text-secondary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  flexShrink: 0,
                  minWidth: 80,
                }}>
                  {col.label}
                </span>
                <span style={{
                  textAlign: 'right',
                  color: 'var(--color-text)',
                  wordBreak: 'break-word',
                  overflowWrap: 'break-word',
                  hyphens: 'auto',
                }}>
                  {col.render ? col.render(row) : (row as any)[col.key] ?? '-'}
                </span>
              </div>
            ))}
            {(onEdit || onDelete) && (
              <div style={{
                display: 'flex', gap: 'var(--space-sm)',
                justifyContent: 'flex-end',
                paddingTop: 'var(--space-sm)',
                marginTop: 'var(--space-xs)',
              }}>
                {onEdit && (
                  <button
                    onClick={() => onEdit(row)}
                    style={{ ...actionBtn, minWidth: 44, minHeight: 44 }}
                    aria-label={t('components.dataTable.editAria')}
                  >
                    <Pencil size={16} />
                  </button>
                )}
                {onDelete && (
                  <button
                    onClick={() => onDelete(row)}
                    style={{ ...actionBtn, minWidth: 44, minHeight: 44 }}
                    aria-label={t('components.dataTable.deleteAria')}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        {totalPages > 1 && (
          <div style={{
            display: 'flex', justifyContent: 'center', alignItems: 'center',
            gap: 'var(--space-xs)',
            padding: 'var(--space-md) 0',
          }}>
            <button
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              style={pageBtnStyle(page <= 1)}
              aria-label={t('common.previousPage')}
            >
              ←
            </button>
            <span style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-secondary)',
              fontFamily: 'var(--font-mono)',
              padding: '0 var(--space-sm)',
            }}>
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
    <div style={{
      background: 'var(--color-surface)',
      borderRadius: 'var(--radius-lg)',
      border: '1px solid var(--color-border-subtle)',
      overflow: 'hidden',
    }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{
          width: '100%', borderCollapse: 'collapse',
          fontSize: 'var(--text-sm)',
        }}>
          <thead>
            <tr style={{
              background: 'var(--color-surface-alt)',
              borderBottom: '1px solid var(--color-border-subtle)',
            }}>
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col)}
                  style={{
                    padding: 'var(--space-md) var(--space-lg)',
                    fontWeight: 600, fontSize: 'var(--text-xs)',
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                    color: 'var(--color-text-secondary)',
                    cursor: col.sortable ? 'pointer' : 'default',
                    userSelect: 'none', textAlign: 'left',
                    whiteSpace: 'nowrap',
                  }}
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
                <th style={{
                  padding: 'var(--space-md) var(--space-lg)',
                  fontWeight: 600, fontSize: 'var(--text-xs)',
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                  color: 'var(--color-text-secondary)',
                  width: 100, textAlign: 'right',
                }}>
                  {t('common.actions')}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
              {sorted.map((row, ri) => (
                <tr
                  key={keyExtractor(row)}
                  style={{
                    borderBottom: ri < sorted.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
                    transition: 'background 0.15s ease',
                    cursor: 'default',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  {columns.map((col) => (
                    <td key={col.key} style={{
                      padding: 'var(--space-md) var(--space-lg)',
                      fontSize: 'var(--text-sm)',
                      color: 'var(--color-text)',
                      whiteSpace: 'nowrap',
                    }}>
                    {col.render ? col.render(row) : (row as any)[col.key] ?? '-'}
                  </td>
                ))}
                {(onEdit || onDelete) && (
                  <td style={{
                    padding: 'var(--space-md) var(--space-lg)',
                    textAlign: 'right',
                  }}>
                    <div style={{ display: 'flex', gap: 'var(--space-xs)', justifyContent: 'flex-end' }}>
                      {onEdit && (
                        <button
                          onClick={() => onEdit(row)}
                          style={actionBtn}
                          aria-label={t('components.dataTable.editAria')}
                        >
                          <Pencil size={14} />
                        </button>
                      )}
                      {onDelete && (
                        <button
                          onClick={() => onDelete(row)}
                          style={actionBtn}
                          aria-label={t('components.dataTable.deleteAria')}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          gap: 'var(--space-xs)',
          padding: 'var(--space-md) var(--space-lg)',
          borderTop: '1px solid var(--color-border-subtle)',
        }}>
          <button
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            style={pageBtnStyle(page <= 1)}
            aria-label={t('common.previousPage')}
          >
            ←
          </button>
          <span style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-secondary)',
            fontFamily: 'var(--font-mono)',
            padding: '0 var(--space-sm)',
          }}>
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

const actionBtn: React.CSSProperties = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  padding: 6, borderRadius: 'var(--radius-md)',
  color: 'var(--color-text-tertiary)',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  transition: 'background 0.15s ease, color 0.15s ease',
};

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
