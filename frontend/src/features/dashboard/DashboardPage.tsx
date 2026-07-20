import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend,
} from 'recharts';
import RealTimeMap from '../map/RealTimeMap';
import api from '../../services/api/client';

interface Kpis {
  deliveriesToday: number;
  totalDeliveries: number;
  activeVehicles: number;
  activeDrivers: number;
  anomalies: number;
  fuelStats: {
    totalLiters: number;
    totalKilometers: number;
    averageConsumption: number;
  };
}

interface DeliveryStat {
  status: string;
  count: number;
}

interface FuelChartPoint {
  date: string;
  consumption: number;
  vehicle: string;
  anomaly: boolean;
}

export default function DashboardPage() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [deliveryStats, setDeliveryStats] = useState<DeliveryStat[]>([]);
  const [fuelData, setFuelData] = useState<FuelChartPoint[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/dashboard/kpis'),
      api.get('/dashboard/delivery-stats'),
      api.get('/dashboard/fuel-chart'),
    ])
      .then(([kpiRes, statsRes, fuelRes]) => {
        setKpis(kpiRes.data);
        setDeliveryStats(statsRes.data);
        setFuelData(fuelRes.data);
      })
      .catch(() => setError('Failed to load dashboard data'));
  }, []);

  if (error) return <div style={{ padding: 20, color: 'red' }}>{error}</div>;

  return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column' }}>
      <h1>Dashboard</h1>

      {/* KPI Cards */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <KpiCard label="Deliveries Today" value={kpis?.deliveriesToday ?? 0} color="#007bff" />
        <KpiCard label="Total Deliveries" value={kpis?.totalDeliveries ?? 0} color="#28a745" />
        <KpiCard label="Active Vehicles" value={kpis?.activeVehicles ?? 0} color="#ffc107" />
        <KpiCard label="Active Drivers" value={kpis?.activeDrivers ?? 0} color="#17a2b8" />
        <KpiCard label="Anomalies" value={kpis?.anomalies ?? 0} color="#dc3545" />
        <KpiCard
          label="Avg Consumption"
          value={`${kpis?.fuelStats.averageConsumption.toFixed(1) ?? 0} L/100km`}
          color="#6f42c1"
        />
      </div>

      {/* Charts Row */}
      <div style={{ display: 'flex', gap: '20px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '300px', background: '#fff', padding: '16px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <h3>Delivery Status</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={deliveryStats}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="status" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="count" fill="#007bff" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={{ flex: 1, minWidth: '300px', background: '#fff', padding: '16px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <h3>Fuel Consumption (L/100km)</h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={fuelData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="consumption" stroke="#28a745" name="L/100km" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Map */}
      <div style={{ flex: 1, minHeight: '400px', marginBottom: '20px' }}>
        <RealTimeMap />
      </div>
    </div>
  );
}

function KpiCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div style={{
      flex: 1, minWidth: '150px', padding: '20px', borderRadius: '8px',
      borderLeft: `4px solid ${color}`, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    }}>
      <div style={{ fontSize: '0.85em', color: '#666', marginBottom: '8px' }}>{label}</div>
      <div style={{ fontSize: '1.8em', fontWeight: 'bold', color }}>{value}</div>
    </div>
  );
}
