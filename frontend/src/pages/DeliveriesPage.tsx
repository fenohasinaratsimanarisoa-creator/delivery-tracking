import { useEffect, useState } from 'react';
import api from '../services/api/client';
import type { Delivery } from '../types';

export default function DeliveriesPage() {
  const [data, setData] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/deliveries?limit=50')
      .then((res) => setData(res.data.data ?? res.data))
      .catch(() => setError('Erreur lors du chargement des livraisons'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={centerStyle}>Chargement...</div>;
  if (error) return <div style={{ ...centerStyle, color: 'red' }}>{error}</div>;

  return (
    <div style={{ padding: 20 }}>
      <h1>Livraisons</h1>
      {data.length === 0 && <p style={{ color: '#888' }}>Aucune livraison pour le moment.</p>}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#f5f5f5', textAlign: 'left' }}>
            <th style={thStyle}>Titre</th>
            <th style={thStyle}>Statut</th>
            <th style={thStyle}>Adresse livraison</th>
            <th style={thStyle}>Date</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.id} style={{ borderBottom: '1px solid #eee' }}>
              <td style={tdStyle}>{d.title}</td>
              <td style={tdStyle}><StatusBadge status={d.status} /></td>
              <td style={tdStyle}>{d.deliveryAddress}</td>
              <td style={tdStyle}>{new Date(d.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: '#ffc107', assigned: '#17a2b8', in_progress: '#007bff',
    delivered: '#28a745', failed: '#dc3545', cancelled: '#6c757d',
  };
  return (
    <span style={{
      background: colors[status] || '#888', color: '#fff',
      padding: '2px 8px', borderRadius: 4, fontSize: '0.8rem',
    }}>
      {status.replace('_', ' ')}
    </span>
  );
}

const centerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  height: '100%', fontSize: '1.1rem', color: '#666',
};
const thStyle: React.CSSProperties = { padding: '10px 12px', fontWeight: 600, fontSize: '0.85rem' };
const tdStyle: React.CSSProperties = { padding: '10px 12px', fontSize: '0.9rem' };
