import { Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { AuthProvider, useAuth } from './hooks/AuthContext';
import QueryProvider from './components/QueryProvider';
import { ToastProvider } from './components/Toast';
import { ThemeProvider } from './styles/ThemeContext';
import Sidebar from './components/Sidebar';
import ProtectedRoute from './components/ProtectedRoute';
import CookieConsentBanner from './components/CookieConsentBanner';
import ErrorBoundary from './components/ErrorBoundary';
import { useDataUpdates } from './hooks/useDataUpdates';
import styles from './App.module.css';

const LoginPage = lazy(() => import('./features/auth/LoginPage'));
const RegisterPage = lazy(() => import('./features/auth/RegisterPage'));
const ForgotPasswordPage = lazy(() => import('./features/auth/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./features/auth/ResetPasswordPage'));
const AuthCallbackPage = lazy(() => import('./features/auth/AuthCallbackPage'));
const DashboardPage = lazy(() => import('./features/dashboard/DashboardPage'));
const PublicTrackingPage = lazy(() => import('./features/map/PublicTrackingPage'));
const CguPage = lazy(() => import('./pages/CguPage'));
const PrivacyPolicyPage = lazy(() => import('./pages/PrivacyPolicyPage'));
const CookiesPage = lazy(() => import('./pages/CookiesPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const AccessDeniedPage = lazy(() => import('./pages/AccessDeniedPage'));
const DeliveriesPage = lazy(() => import('./pages/DeliveriesPage'));
const FleetPage = lazy(() => import('./pages/FleetPage'));
const DriversPage = lazy(() => import('./pages/DriversPage'));
const MapPage = lazy(() => import('./pages/MapPage'));
const FuelPage = lazy(() => import('./pages/FuelPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const AdminLoginPage = lazy(() => import('./features/platform-admin/AdminLoginPage'));
const AdminDashboard = lazy(() => import('./features/platform-admin/AdminDashboard'));
const MyDeliveriesPage = lazy(() => import('./pages/MyDeliveriesPage'));
const MyVehiclePage = lazy(() => import('./pages/MyVehiclePage'));
const DriverTrackingWrapper = lazy(() => import('./features/tracking/DriverTrackingWrapper'));
const MyOrdersPage = lazy(() => import('./pages/MyOrdersPage'));
const ClientTrackingPage = lazy(() => import('./pages/ClientTrackingPage'));
const TripReplayPage = lazy(() => import('./pages/TripReplayPage'));
const TripReportPage = lazy(() => import('./pages/TripReportPage'));
const AlertsPage = lazy(() => import('./pages/AlertsPage'));
const NotificationsPage = lazy(() => import('./features/notifications/NotificationsPage'));
const DeliveryDetailPage = lazy(() => import('./pages/DeliveryDetailPage'));
const DeliveryProofsPage = lazy(() => import('./pages/DeliveryProofsPage'));

function PageErrorBoundary({ children }: { children: React.ReactNode }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}

function SuspenseWrapper({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <Suspense fallback={
      <div className={styles.suspenseFallback}>
        <div className={styles.spinner} />
        {t('app.suspenseFallback')}
      </div>
    }>
      {children}
    </Suspense>
  );
}

const ROLE_HOME: Record<string, string> = {
  admin: '/dashboard',
  dispatcher: '/dashboard',
  driver: '/my-deliveries',
  client: '/my-orders',
};

function HomeRedirect() {
  const { user, isInitializing, isAuthenticated } = useAuth();
  if (isInitializing) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  const target = ROLE_HOME[user!.role] || '/dashboard';
  return <Navigate to={target} replace />;
}

function AppLayout({ children }: { children: React.ReactNode }) {
  useDataUpdates();
  return (
    <div className={styles.appLayoutRoot}>
      <Sidebar />
      <div className={styles.appLayoutContent}>
        <div className={styles.appLayoutMain}>
          {children}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
    <ThemeProvider>
      <QueryProvider>
        <AuthProvider>
          <ToastProvider>
                <CookieConsentBanner />
            <Routes>
              <Route path="/login" element={<SuspenseWrapper><LoginPage /></SuspenseWrapper>} />
              <Route path="/register" element={<SuspenseWrapper><RegisterPage /></SuspenseWrapper>} />
              <Route path="/forgot-password" element={<SuspenseWrapper><ForgotPasswordPage /></SuspenseWrapper>} />
              <Route path="/reset-password" element={<SuspenseWrapper><ResetPasswordPage /></SuspenseWrapper>} />
              <Route path="/auth/callback" element={<SuspenseWrapper><AuthCallbackPage /></SuspenseWrapper>} />
              <Route path="/cgu" element={<SuspenseWrapper><CguPage /></SuspenseWrapper>} />
              <Route path="/privacy" element={<SuspenseWrapper><PrivacyPolicyPage /></SuspenseWrapper>} />
              <Route path="/cookies" element={<SuspenseWrapper><CookiesPage /></SuspenseWrapper>} />
              <Route path="/tracking/:token" element={<SuspenseWrapper><PublicTrackingPage /></SuspenseWrapper>} />
              <Route path="/403" element={<SuspenseWrapper><AccessDeniedPage /></SuspenseWrapper>} />

              {/* Admin + Dispatcher routes */}
              <Route path="/dashboard" element={
                <ProtectedRoute roles={['admin', 'dispatcher']}>
                  <AppLayout><SuspenseWrapper><PageErrorBoundary><DashboardPage /></PageErrorBoundary></SuspenseWrapper></AppLayout>
                </ProtectedRoute>
              } />
              <Route path="/deliveries" element={
                <ProtectedRoute roles={['admin', 'dispatcher']}>
                  <AppLayout><SuspenseWrapper><DeliveriesPage /></SuspenseWrapper></AppLayout>
                </ProtectedRoute>
              } />
              <Route path="/deliveries/:id" element={
                <ProtectedRoute roles={['admin', 'dispatcher']}>
                  <AppLayout><SuspenseWrapper><DeliveryDetailPage /></SuspenseWrapper></AppLayout>
                </ProtectedRoute>
              } />
              <Route path="/vehicles" element={
                <ProtectedRoute roles={['admin', 'dispatcher']}>
                  <AppLayout><SuspenseWrapper><FleetPage /></SuspenseWrapper></AppLayout>
                </ProtectedRoute>
              } />
              <Route path="/drivers" element={
                <ProtectedRoute roles={['admin', 'dispatcher']}>
                  <AppLayout><SuspenseWrapper><DriversPage /></SuspenseWrapper></AppLayout>
                </ProtectedRoute>
              } />
              <Route path="/map" element={
                <ProtectedRoute roles={['admin', 'dispatcher']}>
                  <AppLayout><SuspenseWrapper><PageErrorBoundary><MapPage /></PageErrorBoundary></SuspenseWrapper></AppLayout>
                </ProtectedRoute>
              } />
              <Route path="/tracking/replay" element={
                <ProtectedRoute roles={['admin', 'dispatcher']}>
                  <AppLayout><SuspenseWrapper><TripReplayPage /></SuspenseWrapper></AppLayout>
                </ProtectedRoute>
              } />
              <Route path="/tracking/report" element={
                <ProtectedRoute roles={['admin', 'dispatcher']}>
                  <AppLayout><SuspenseWrapper><TripReportPage /></SuspenseWrapper></AppLayout>
                </ProtectedRoute>
              } />

              {/* Admin-only routes */}
              <Route path="/fuel-consumption" element={
                <ProtectedRoute roles={['admin']}>
                  <AppLayout><SuspenseWrapper><FuelPage /></SuspenseWrapper></AppLayout>
                </ProtectedRoute>
              } />
              <Route path="/reports" element={
                <ProtectedRoute roles={['admin']}>
                  <AppLayout><SuspenseWrapper><ReportsPage /></SuspenseWrapper></AppLayout>
                </ProtectedRoute>
              } />
              <Route path="/alerts" element={
                <ProtectedRoute roles={['admin', 'dispatcher']}>
                  <AppLayout><SuspenseWrapper><AlertsPage /></SuspenseWrapper></AppLayout>
                </ProtectedRoute>
              } />
              <Route path="/delivery-proofs" element={
                <ProtectedRoute roles={['admin', 'dispatcher']}>
                  <AppLayout><SuspenseWrapper><DeliveryProofsPage /></SuspenseWrapper></AppLayout>
                </ProtectedRoute>
              } />
              {/* All roles */}
              <Route path="/notifications" element={
                <ProtectedRoute roles={['admin', 'dispatcher', 'driver', 'client']}>
                  <AppLayout><SuspenseWrapper><NotificationsPage /></SuspenseWrapper></AppLayout>
                </ProtectedRoute>
              } />
              <Route path="/users" element={
                <ProtectedRoute roles={['admin']}>
                  <AppLayout><SuspenseWrapper><UsersPage /></SuspenseWrapper></AppLayout>
                </ProtectedRoute>
              } />
              <Route path="/settings" element={
                <ProtectedRoute roles={['admin']}>
                  <AppLayout><SuspenseWrapper><SettingsPage /></SuspenseWrapper></AppLayout>
                </ProtectedRoute>
              } />
              {/* Super Admin routes */}
              <Route path="/admin/login" element={<SuspenseWrapper><AdminLoginPage /></SuspenseWrapper>} />
              <Route path="/admin" element={<SuspenseWrapper><AdminDashboard /></SuspenseWrapper>} />

              {/* Driver routes */}
              <Route path="/my-deliveries" element={
                <ProtectedRoute roles={['driver']}>
                  <PageErrorBoundary><SuspenseWrapper><DriverTrackingWrapper><AppLayout><SuspenseWrapper><MyDeliveriesPage /></SuspenseWrapper></AppLayout></DriverTrackingWrapper></SuspenseWrapper></PageErrorBoundary>
                </ProtectedRoute>
              } />
              <Route path="/my-vehicle" element={
                <ProtectedRoute roles={['driver']}>
                  <PageErrorBoundary><SuspenseWrapper><DriverTrackingWrapper><AppLayout><SuspenseWrapper><MyVehiclePage /></SuspenseWrapper></AppLayout></DriverTrackingWrapper></SuspenseWrapper></PageErrorBoundary>
                </ProtectedRoute>
              } />

              {/* Client routes */}
              <Route path="/my-orders" element={
                <ProtectedRoute roles={['client']}>
                  <AppLayout><SuspenseWrapper><MyOrdersPage /></SuspenseWrapper></AppLayout>
                </ProtectedRoute>
              } />
              <Route path="/tracking" element={
                <ProtectedRoute roles={['client']}>
                  <AppLayout><SuspenseWrapper><PageErrorBoundary><ClientTrackingPage /></PageErrorBoundary></SuspenseWrapper></AppLayout>
                </ProtectedRoute>
              } />

              <Route path="/" element={<HomeRedirect />} />
              <Route path="*" element={<SuspenseWrapper><NotFoundPage /></SuspenseWrapper>} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </QueryProvider>
  </ThemeProvider>
  </ErrorBoundary>
  );
}
