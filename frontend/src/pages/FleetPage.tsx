import { useEffect, useState } from 'react';
import api from '../services/api/client';
import type { Vehicle } from '../types';

export default function FleetPage() {
  const [data, setData] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/vehicles?limit=50')
      .then((res) => setData(res.data.data ?? res.data))
      .catch(() => setError('Erreur lors du chargement des véhicules'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={centerStyle}>Chargement...</div>;
  if (error) return <div style={{ ...centerStyle, color: 'red' }}>{error}</div>;

  return (
    <div style={{ padding: 20 }}>
      <h1>Flotte</h1>
      {data.length === 0 && <p style={{ color: '#888' }}>Aucun véhicule pour le moment.</p>}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#f5f5f5', textAlign: 'left' }}>
            <th style={thStyle}>Marque</th>
            <th style={thStyle}>Modèle</th>
            <th style={thStyle}>Année</th>
            <th style={thStyle}>Plaque</th>
            <th style={thStyle}>Actif</th>
          </tr>
        </thead>
        <tbody>
          {data.map((v) => (
            <tr key={v.id} style={{ borderBottom: '1px solid #eee' }}>
              <td style={tdStyle}>{v.brand}</td>
              <td style={tdStyle}>{v.model}</td>
              <td style={tdStyle}>{v.year}</td>
              <td style={tdStyle}>{v.licensePlate}</td>
              <td style={tdStyle}>
                <span style={{
                  background: v.isActive ? '#28a745' : '#6c757d',
                  color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: '0.8rem',
                }}>
                  {v.isActive ? 'Oui' : 'Non'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const centerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  height: '100%', fontSize: '1.1rem', color: '#666',
};
const thStyle: React.CSSProperties = { padding: '10px 12px', fontWeight: 600, fontSize: '0.85rem' };
const tdStyle: React.CSSProperties = { padding: '10px 12px', fontSize: '0.9rem' };
