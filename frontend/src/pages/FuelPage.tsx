import { useEffect, useState } from 'react';
import api from '../services/api/client';

interface FuelLog {
  id: string;
  liters: number;
  kilometers: number;
  cost: number;
  fillDate: string;
  anomalyFlag: boolean;
  calculatedConsumption: number | null;
  vehicle: { licensePlate: string };
}

export default function FuelPage() {
  const [data, setData] = useState<FuelLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/fuel-consumption?limit=50')
      .then((res) => setData(res.data.data ?? res.data))
      .catch(() => setError('Erreur lors du chargement des données carburant'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={centerStyle}>Chargement...</div>;
  if (error) return <div style={{ ...centerStyle, color: 'red' }}>{error}</div>;

  return (
    <div style={{ padding: 20 }}>
      <h1>Carburant</h1>
      {data.length === 0 && <p style={{ color: '#888' }}>Aucun relevé carburant pour le moment.</p>}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#f5f5f5', textAlign: 'left' }}>
            <th style={thStyle}>Véhicule</th>
            <th style={thStyle}>Litres</th>
            <th style={thStyle}>Km</th>
            <th style={thStyle}>L/100km</th>
            <th style={thStyle}>Coût</th>
            <th style={thStyle}>Date</th>
            <th style={thStyle}>Anomalie</th>
          </tr>
        </thead>
        <tbody>
          {data.map((l) => (
            <tr key={l.id} style={{ borderBottom: '1px solid #eee' }}>
              <td style={tdStyle}>{l.vehicle?.licensePlate ?? '-'}</td>
              <td style={tdStyle}>{l.liters}</td>
              <td style={tdStyle}>{l.kilometers}</td>
              <td style={tdStyle}>{l.calculatedConsumption?.toFixed(1) ?? '-'}</td>
              <td style={tdStyle}>{l.cost.toFixed(2)} €</td>
              <td style={tdStyle}>{new Date(l.fillDate).toLocaleDateString()}</td>
              <td style={tdStyle}>
                {l.anomalyFlag
                  ? <span style={{ color: '#dc3545', fontWeight: 600 }}>⚠️ Anomalie</span>
                  : <span style={{ color: '#28a745' }}>✓ Normal</span>}
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
