import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './features/auth/LoginPage';
import DashboardPage from './features/dashboard/DashboardPage';
import PublicTrackingPage from './features/map/PublicTrackingPage';
import NotificationBell from './components/NotificationBell';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('accessToken');
  if (!token) return <Navigate to="/login" replace />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header style={{
        display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
        padding: '8px 20px', background: '#fff', borderBottom: '1px solid #ddd',
        position: 'sticky', top: 0, zIndex: 100, gap: '12px',
      }}>
        <NotificationBell />
        <button
          onClick={() => {
            localStorage.removeItem('accessToken');
            localStorage.removeItem('refreshToken');
            window.location.href = '/login';
          }}
          style={{
            background: 'none', border: '1px solid #dc3545', color: '#dc3545',
            borderRadius: '4px', padding: '4px 12px', cursor: 'pointer', fontSize: '0.85rem',
          }}
        >
          Logout
        </button>
      </header>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {children}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/tracking/:token" element={<PublicTrackingPage />} />
      <Route
        path="/dashboard"
        element={<PrivateRoute><DashboardPage /></PrivateRoute>}
      />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
