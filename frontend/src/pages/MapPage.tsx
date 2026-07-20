import RealTimeMap from '../features/map/RealTimeMap';

export default function MapPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <h1 style={{ padding: '20px 20px 0', margin: 0 }}>Carte temps réel</h1>
      <div style={{ flex: 1, minHeight: 400, padding: 20 }}>
        <RealTimeMap />
      </div>
    </div>
  );
}
