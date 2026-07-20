import RealTimeMap from '../map/RealTimeMap';

export default function DashboardPage() {
  return (
    <div style={{ padding: '20px', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <h1>Dashboard</h1>
      <div style={{ flex: 1, minHeight: '400px' }}>
        <RealTimeMap />
      </div>
    </div>
  );
}
