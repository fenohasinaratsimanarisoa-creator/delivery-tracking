import { type ReactNode } from 'react';

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
  const totalPages = Math.ceil(total / limit);

  if (loading) {
    return <div style={centerStyle}>Chargement...</div>;
  }

  if (data.length === 0) {
    return (
      <div style={centerStyle}>
        <p style={{ color: '#888' }}>{emptyMessage ?? 'Aucune donnée.'}</p>
      </div>
    );
  }

  return (
    <div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#f5f5f5', textAlign: 'left' }}>
            {columns.map((col) => (
              <th key={col.key} style={thStyle}>{col.label}</th>
            ))}
            {(onEdit || onDelete) && <th style={{ ...thStyle, width: 100 }}>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={keyExtractor(row)} style={{ borderBottom: '1px solid #eee' }}>
              {columns.map((col) => (
                <td key={col.key} style={tdStyle}>
                  {col.render ? col.render(row) : (row as any)[col.key] ?? '-'}
                </td>
              ))}
              {(onEdit || onDelete) && (
                <td style={tdStyle}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {onEdit && (
                      <button onClick={() => onEdit(row)} style={actionBtn}>
                        ✏️
                      </button>
                    )}
                    {onDelete && (
                      <button onClick={() => onDelete(row)} style={actionBtn}>
                        🗑️
                      </button>
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 16 }}>
          <button
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            style={pageBtnStyle(page <= 1)}
          >
            ←
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              style={{
                ...pageBtnStyle(p === page),
                fontWeight: p === page ? 700 : 400,
                background: p === page ? '#007bff' : '#fff',
                color: p === page ? '#fff' : '#333',
              }}
            >
              {p}
            </button>
          ))}
          <button
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            style={pageBtnStyle(page >= totalPages)}
          >
            →
          </button>
        </div>
      )}
    </div>
  );
}

const centerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 40, fontSize: '1.1rem', color: '#666',
};
const thStyle: React.CSSProperties = { padding: '10px 12px', fontWeight: 600, fontSize: '0.85rem' };
const tdStyle: React.CSSProperties = { padding: '10px 12px', fontSize: '0.9rem' };
const actionBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', padding: '2px 4px',
};
const pageBtnStyle = (disabled: boolean): React.CSSProperties => ({
  padding: '6px 12px', border: '1px solid #ddd', borderRadius: 4,
  cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
  background: '#fff',
});
