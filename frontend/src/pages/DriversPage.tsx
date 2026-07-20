import { useEffect, useState } from 'react';
import api from '../services/api/client';

interface Driver {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  licenseNumber: string;
  isActive: boolean;
}

export default function DriversPage() {
  const [data, setData] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/drivers?limit=50')
      .then((res) => setData(res.data.data ?? res.data))
      .catch(() => setError('Erreur lors du chargement des chauffeurs'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={centerStyle}>Chargement...</div>;
  if (error) return <div style={{ ...centerStyle, color: 'red' }}>{error}</div>;

  return (
    <div style={{ padding: 20 }}>
      <h1>Chauffeurs</h1>
      {data.length === 0 && <p style={{ color: '#888' }}>Aucun chauffeur pour le moment.</p>}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#f5f5f5', textAlign: 'left' }}>
            <th style={thStyle}>Nom</th>
            <th style={thStyle}>Email</th>
            <th style={thStyle}>Téléphone</th>
            <th style={thStyle}>Permis</th>
            <th style={thStyle}>Actif</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.id} style={{ borderBottom: '1px solid #eee' }}>
              <td style={tdStyle}>{d.firstName} {d.lastName}</td>
              <td style={tdStyle}>{d.email ?? '-'}</td>
              <td style={tdStyle}>{d.phone ?? '-'}</td>
              <td style={tdStyle}>{d.licenseNumber}</td>
              <td style={tdStyle}>
                <span style={{
                  background: d.isActive ? '#28a745' : '#6c757d',
                  color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: '0.8rem',
                }}>
                  {d.isActive ? 'Oui' : 'Non'}
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
