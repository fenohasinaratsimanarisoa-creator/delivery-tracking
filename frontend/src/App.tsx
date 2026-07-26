import { Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { AuthProvider } from './hooks/AuthContext';
import QueryProvider from './components/QueryProvider';
import { ToastProvider } from './components/Toast';
import { ThemeProvider } from './styles/ThemeContext';
import Sidebar from './components/Sidebar';
import ProtectedRoute from './components/ProtectedRoute';
import CookieConsentBanner from './components/CookieConsentBanner';
import ErrorBoundary from './components/ErrorBoundary';
import { useDataUpdates } from './hooks/useDataUpdates';

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
const DeliveryDetailPage = lazy(() => import('./pages/DeliveryDetailPage'));
const DeliveryProofsPage = lazy(() => import('./pages/DeliveryProofsPage'));

function PageErrorBoundary({ children }: { children: React.ReactNode }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}

function SuspenseWrapper({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', width: '100%',
        color: 'var(--color-text-secondary, #9BA6B9)',
        fontSize: '0.875rem',
      }}>
        <div style={{
          width: 20, height: 20, borderRadius: '50%',
          border: '2px solid var(--color-border, rgba(242,169,60,0.2))',
          borderTopColor: 'var(--color-accent, #F2A93C)',
          animation: 'dt-spin 0.6s linear infinite',
          marginRight: 8,
        }} />
        Chargement...
      </div>
    }>
      {children}
    </Suspense>
  );
}

function AppLayout({ children }: { children: React.ReactNode }) {
  useDataUpdates();
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--color-bg)' }}>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, position: 'relative', overflow: 'auto' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function MobileResponsiveStyles() {
  return <style>{`
/* ─── Page wrappers: prevent horizontal scroll ─── */
@media (max-width: 640px) {
  .page-padding {
    padding: var(--space-md) !important;
  }
  .page-padding-lg {
    padding: var(--space-md) !important;
  }
  h1.page-title {
    font-size: var(--text-lg) !important;
  }
}

/* ─── Reports page mobile ─── */
@media (max-width: 640px) {
  .reports-header {
    flex-direction: column !important;
    align-items: stretch !important;
  }
  .reports-period-bar {
    flex-wrap: wrap;
  }
  .reports-grid-2 {
    grid-template-columns: 1fr !important;
  }
  .reports-tabs-wrap {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
}

/* ─── Settings page mobile ─── */
@media (max-width: 640px) {
  .settings-two-col {
    flex-direction: column !important;
  }
  .settings-pw-row {
    flex-direction: column !important;
    align-items: stretch !important;
    gap: var(--space-md) !important;
  }
  .settings-2fa-form {
    flex-direction: column !important;
    align-items: stretch !important;
  }
  .settings-2fa-form input {
    width: 100% !important;
    max-width: 200px;
    margin: 0 auto;
  }
  .settings-2fa-actions {
    justify-content: center !important;
  }
}

/* ─── Reports tables mobile ─── */
@media (max-width: 640px) {
  .reports-table-wrap table {
    font-size: var(--text-xs) !important;
  }
  .reports-table-wrap th,
  .reports-table-wrap td {
    padding: 6px 8px !important;
  }
}

/* ─── Notifications panel on small screens ─── */
@media (max-width: 480px) {
  .notif-panel {
    right: 4px !important;
    left: 4px !important;
    width: auto !important;
    max-height: calc(100vh - 60px) !important;
  }
}

/* ─── Touch targets: minimum 44px ─── */
@media (pointer: coarse) {
  .touch-target {
    min-height: 44px;
    min-width: 44px;
  }
}

/* ─── Entity Dialog on very small screens ─── */
@media (max-width: 400px) {
  .dt-dialog-card {
    max-width: calc(100vw - 8px) !important;
    max-height: calc(100vh - 8px) !important;
    border-radius: var(--radius-md) !important;
  }
}

/* ─── Sidebar hamburger adjustments on very small screens ─── */
@media (max-width: 360px) {
  .sidebar-hamburger {
    top: 6px !important;
    left: 6px !important;
    padding: 6px !important;
  }
}

/* ─── Prevent text size adjustment on mobile ─── */
html {
  -webkit-text-size-adjust: 100%;
}
  `}</style>;
}

export default function App() {
  return (
    <ErrorBoundary>
    <ThemeProvider>
      <QueryProvider>
        <AuthProvider>
          <ToastProvider>
                <CookieConsentBanner />
                <MobileResponsiveStyles />
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

              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="*" element={<SuspenseWrapper><NotFoundPage /></SuspenseWrapper>} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </QueryProvider>
  </ThemeProvider>
  </ErrorBoundary>
  );
}
