import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './hooks/AuthContext';
import QueryProvider from './components/QueryProvider';
import { ToastProvider } from './components/Toast';
import LoginPage from './features/auth/LoginPage';
import DashboardPage from './features/dashboard/DashboardPage';
import PublicTrackingPage from './features/map/PublicTrackingPage';
import Sidebar from './components/Sidebar';
import ProtectedRoute from './components/ProtectedRoute';
import NotFoundPage from './pages/NotFoundPage';
import AccessDeniedPage from './pages/AccessDeniedPage';
import DeliveriesPage from './pages/DeliveriesPage';
import FleetPage from './pages/FleetPage';
import DriversPage from './pages/DriversPage';
import MapPage from './pages/MapPage';
import FuelPage from './pages/FuelPage';
import ReportsPage from './pages/ReportsPage';
import UsersPage from './pages/UsersPage';
import SettingsPage from './pages/SettingsPage';
import MyDeliveriesPage from './pages/MyDeliveriesPage';
import MyPositionPage from './pages/MyPositionPage';
import MyVehiclePage from './pages/MyVehiclePage';
import MyOrdersPage from './pages/MyOrdersPage';
import ClientTrackingPage from './pages/ClientTrackingPage';

function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <Sidebar />
      <div style={{ flex: 1, overflow: 'auto' }}>
        {children}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <QueryProvider>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/tracking/:token" element={<PublicTrackingPage />} />
            <Route path="/403" element={<AccessDeniedPage />} />

            {/* Admin + Dispatcher routes */}
            <Route path="/dashboard" element={
              <ProtectedRoute roles={['admin', 'dispatcher']}>
                <AppLayout><DashboardPage /></AppLayout>
              </ProtectedRoute>
            } />
            <Route path="/deliveries" element={
              <ProtectedRoute roles={['admin', 'dispatcher']}>
                <AppLayout><DeliveriesPage /></AppLayout>
              </ProtectedRoute>
            } />
            <Route path="/vehicles" element={
              <ProtectedRoute roles={['admin', 'dispatcher']}>
                <AppLayout><FleetPage /></AppLayout>
              </ProtectedRoute>
            } />
            <Route path="/drivers" element={
              <ProtectedRoute roles={['admin', 'dispatcher']}>
                <AppLayout><DriversPage /></AppLayout>
              </ProtectedRoute>
            } />
            <Route path="/map" element={
              <ProtectedRoute roles={['admin', 'dispatcher']}>
                <AppLayout><MapPage /></AppLayout>
              </ProtectedRoute>
            } />

            {/* Admin-only routes */}
            <Route path="/fuel-consumption" element={
              <ProtectedRoute roles={['admin']}>
                <AppLayout><FuelPage /></AppLayout>
              </ProtectedRoute>
            } />
            <Route path="/reports" element={
              <ProtectedRoute roles={['admin']}>
                <AppLayout><ReportsPage /></AppLayout>
              </ProtectedRoute>
            } />
            <Route path="/users" element={
              <ProtectedRoute roles={['admin']}>
                <AppLayout><UsersPage /></AppLayout>
              </ProtectedRoute>
            } />
            <Route path="/settings" element={
              <ProtectedRoute roles={['admin']}>
                <AppLayout><SettingsPage /></AppLayout>
              </ProtectedRoute>
            } />

            {/* Driver routes */}
            <Route path="/my-deliveries" element={
              <ProtectedRoute roles={['driver']}>
                <AppLayout><MyDeliveriesPage /></AppLayout>
              </ProtectedRoute>
            } />
            <Route path="/my-position" element={
              <ProtectedRoute roles={['driver']}>
                <AppLayout><MyPositionPage /></AppLayout>
              </ProtectedRoute>
            } />
            <Route path="/my-vehicle" element={
              <ProtectedRoute roles={['driver']}>
                <AppLayout><MyVehiclePage /></AppLayout>
              </ProtectedRoute>
            } />

            {/* Client routes */}
            <Route path="/my-orders" element={
              <ProtectedRoute roles={['client']}>
                <AppLayout><MyOrdersPage /></AppLayout>
              </ProtectedRoute>
            } />
            <Route path="/tracking" element={
              <ProtectedRoute roles={['client']}>
                <AppLayout><ClientTrackingPage /></AppLayout>
              </ProtectedRoute>
            } />

            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </QueryProvider>
  );
}
