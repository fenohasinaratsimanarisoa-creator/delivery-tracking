import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AuthProvider, useAuth } from './hooks/AuthContext';
import QueryProvider from './components/QueryProvider';
import { ToastProvider } from './components/Toast';
import { ThemeProvider } from './styles/ThemeContext';
import Sidebar from './components/Sidebar';
import BottomNav from './components/BottomNav';
import ProtectedRoute from './components/ProtectedRoute';
import CookieConsentBanner from './components/CookieConsentBanner';
import MobileAppBanner from './components/MobileAppBanner';
import ErrorBoundary from './components/ErrorBoundary';
import { useDataUpdates } from './hooks/useDataUpdates';
import { useKeyboardHandling } from './hooks/useKeyboardHandling';
import styles from './App.module.css';

const LoginPage = lazy(() => import('./features/auth/LoginPage'));
const RegisterPage = lazy(() => import('./features/auth/RegisterPage'));
const ForgotPasswordPage = lazy(() => import('./features/auth/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./features/auth/ResetPasswordPage'));
const AcceptInvitePage = lazy(() => import('./features/auth/AcceptInvitePage'));
const AuthCallbackPage = lazy(() => import('./features/auth/AuthCallbackPage'));
const DashboardPage = lazy(() => import('./features/dashboard/DashboardPage'));
const LandingPage = lazy(() => import('./pages/LandingPage'));
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
const TrackingHealthPage = lazy(() => import('./pages/TrackingHealthPage'));
const NotificationsPage = lazy(() => import('./features/notifications/NotificationsPage'));
const DeliveryDetailPage = lazy(() => import('./pages/DeliveryDetailPage'));
const DeliveryProofsPage = lazy(() => import('./pages/DeliveryProofsPage'));
const PlansPage = lazy(() => import('./features/billing/PlansPage'));
const FacturationPage = lazy(() => import('./features/billing/FacturationPage'));
const SuccessPage = lazy(() => import('./features/billing/SuccessPage'));

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
  if (!isAuthenticated) return <SuspenseWrapper><LandingPage /></SuspenseWrapper>;
  const target = ROLE_HOME[user!.role] || '/dashboard';
  return <Navigate to={target} replace />;
}

// Layout PARTAGÉ : rendu UNE fois pour tout ce groupe de routes via <Outlet/>,
// au lieu d'un <AppLayout> imbriqué séparément dans chaque <Route element={...}>
// (ancien pattern ci-dessous, conservé uniquement pour les 2 routes chauffeur
// qui passent par DriverTrackingWrapper). Avec l'ancien pattern, changer de
// page démontait ET REMONTAIT ENTIÈREMENT AppLayout (donc la Sidebar) à
// chaque navigation, puisque React Router traite chaque `element` de route
// comme un arbre indépendant. Bug réel observé (2026-09-05) : en quittant la
// page Carte temps réel (RealTimeMap, mises à jour GPS continues), la
// navigation vers une autre page restait bloquée indéfiniment — l'URL
// changeait bien, mais l'écran restait figé sur l'ancienne page, sans la
// moindre erreur console, jusqu'à un F5. En gardant Sidebar/AppLayout montés
// en continu (le pattern <Outlet/> recommandé par React Router pour un layout
// partagé), seul le contenu de la route change réellement à chaque
// navigation — Sidebar n'est plus jamais démonté/remonté au moment critique.
function SharedAppLayout() {
  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}

function AppLayout({ children }: { children: React.ReactNode }) {
  useDataUpdates();
  const { user } = useAuth();
  // Contexte « field » : usagers terrain (driver / client) → thème sobre
  // haute lisibilité extérieur (buildFieldVars), indépendant de dark/light.
  // Les rôles admin/dispatcher gardent le « control room » tel quel.
  const isField = user?.role === 'driver' || user?.role === 'client';
  useEffect(() => {
    const html = document.documentElement;
    if (isField) {
      html.setAttribute('data-context', 'field');
    } else {
      html.removeAttribute('data-context');
    }
    return () => {
      html.removeAttribute('data-context');
    };
  }, [isField]);
  return (
    <div className={styles.appLayoutRoot}>
      <Sidebar />
      <BottomNav />
      <div className={styles.appLayoutContent}>
        <MobileAppBanner />
        <div className={styles.appLayoutMain}>
          {children}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  useKeyboardHandling();
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
              <Route path="/auth/invite/:token" element={<SuspenseWrapper><AcceptInvitePage /></SuspenseWrapper>} />
              <Route path="/auth/callback" element={<SuspenseWrapper><AuthCallbackPage /></SuspenseWrapper>} />
              <Route path="/cgu" element={<SuspenseWrapper><CguPage /></SuspenseWrapper>} />
              <Route path="/privacy" element={<SuspenseWrapper><PrivacyPolicyPage /></SuspenseWrapper>} />
              <Route path="/cookies" element={<SuspenseWrapper><CookiesPage /></SuspenseWrapper>} />
              <Route path="/tracking/:token" element={<SuspenseWrapper><PublicTrackingPage /></SuspenseWrapper>} />
              <Route path="/403" element={<SuspenseWrapper><AccessDeniedPage /></SuspenseWrapper>} />

              {/* Layout partagé (Sidebar/AppLayout montés UNE fois, cf. SharedAppLayout
                  ci-dessus) pour toutes les pages admin/dispatcher/client — chaque route
                  garde son propre <ProtectedRoute roles={...}> pour le contrôle d'accès,
                  seul le <Outlet/> matched change à la navigation. */}
              <Route element={<SharedAppLayout />}>
                {/* Admin + Dispatcher routes */}
                <Route path="/dashboard" element={
                  <ProtectedRoute roles={['admin', 'dispatcher']}>
                    <SuspenseWrapper><PageErrorBoundary><DashboardPage /></PageErrorBoundary></SuspenseWrapper>
                  </ProtectedRoute>
                } />
                <Route path="/deliveries" element={
                  <ProtectedRoute roles={['admin', 'dispatcher']}>
                    <SuspenseWrapper><DeliveriesPage /></SuspenseWrapper>
                  </ProtectedRoute>
                } />
                <Route path="/deliveries/:id" element={
                  <ProtectedRoute roles={['admin', 'dispatcher']}>
                    <SuspenseWrapper><DeliveryDetailPage /></SuspenseWrapper>
                  </ProtectedRoute>
                } />
                <Route path="/vehicles" element={
                  <ProtectedRoute roles={['admin', 'dispatcher']}>
                    <SuspenseWrapper><FleetPage /></SuspenseWrapper>
                  </ProtectedRoute>
                } />
                <Route path="/drivers" element={
                  <ProtectedRoute roles={['admin', 'dispatcher']}>
                    <SuspenseWrapper><DriversPage /></SuspenseWrapper>
                  </ProtectedRoute>
                } />
                <Route path="/map" element={
                  <ProtectedRoute roles={['admin', 'dispatcher']}>
                    <SuspenseWrapper><PageErrorBoundary><MapPage /></PageErrorBoundary></SuspenseWrapper>
                  </ProtectedRoute>
                } />
                <Route path="/tracking/replay" element={
                  <ProtectedRoute roles={['admin', 'dispatcher']}>
                    <SuspenseWrapper><TripReplayPage /></SuspenseWrapper>
                  </ProtectedRoute>
                } />
                <Route path="/tracking/report" element={
                  <ProtectedRoute roles={['admin', 'dispatcher']}>
                    <SuspenseWrapper><TripReportPage /></SuspenseWrapper>
                  </ProtectedRoute>
                } />

                {/* Admin-only routes */}
                <Route path="/fuel-consumption" element={
                  <ProtectedRoute roles={['admin']}>
                    <SuspenseWrapper><FuelPage /></SuspenseWrapper>
                  </ProtectedRoute>
                } />
                <Route path="/reports" element={
                  <ProtectedRoute roles={['admin']}>
                    <SuspenseWrapper><ReportsPage /></SuspenseWrapper>
                  </ProtectedRoute>
                } />
                <Route path="/alerts" element={
                  <ProtectedRoute roles={['admin', 'dispatcher', 'driver']}>
                    <SuspenseWrapper><AlertsPage /></SuspenseWrapper>
                  </ProtectedRoute>
                } />
                <Route path="/tracking-health" element={
                  <ProtectedRoute roles={['admin', 'dispatcher']}>
                    <SuspenseWrapper><TrackingHealthPage /></SuspenseWrapper>
                  </ProtectedRoute>
                } />
                <Route path="/delivery-proofs" element={
                  <ProtectedRoute roles={['admin', 'dispatcher']}>
                    <SuspenseWrapper><DeliveryProofsPage /></SuspenseWrapper>
                  </ProtectedRoute>
                } />
                {/* All roles */}
                <Route path="/notifications" element={
                  <ProtectedRoute roles={['admin', 'dispatcher', 'driver', 'client']}>
                    <SuspenseWrapper><NotificationsPage /></SuspenseWrapper>
                  </ProtectedRoute>
                } />
                <Route path="/users" element={
                  <ProtectedRoute roles={['admin']}>
                    <SuspenseWrapper><UsersPage /></SuspenseWrapper>
                  </ProtectedRoute>
                } />
                <Route path="/settings" element={
                  <ProtectedRoute roles={['admin']}>
                    <SuspenseWrapper><SettingsPage /></SuspenseWrapper>
                  </ProtectedRoute>
                } />
                {/* Billing (abonnements Stripe / Mobile Money) */}
                <Route path="/billing" element={
                  <ProtectedRoute roles={['admin']}>
                    <SuspenseWrapper><PlansPage /></SuspenseWrapper>
                  </ProtectedRoute>
                } />
                <Route path="/billing/invoices" element={
                  <ProtectedRoute roles={['admin']}>
                    <SuspenseWrapper><FacturationPage /></SuspenseWrapper>
                  </ProtectedRoute>
                } />
                <Route path="/billing/success" element={
                  <ProtectedRoute roles={['admin']}>
                    <SuspenseWrapper><SuccessPage /></SuspenseWrapper>
                  </ProtectedRoute>
                } />

                {/* Client routes */}
                <Route path="/my-orders" element={
                  <ProtectedRoute roles={['client']}>
                    <SuspenseWrapper><MyOrdersPage /></SuspenseWrapper>
                  </ProtectedRoute>
                } />
                <Route path="/tracking" element={
                  <ProtectedRoute roles={['client']}>
                    <SuspenseWrapper><PageErrorBoundary><ClientTrackingPage /></PageErrorBoundary></SuspenseWrapper>
                  </ProtectedRoute>
                } />
              </Route>

              {/* Super Admin routes */}
              <Route path="/admin/login" element={<SuspenseWrapper><AdminLoginPage /></SuspenseWrapper>} />
              <Route path="/admin" element={<SuspenseWrapper><AdminDashboard /></SuspenseWrapper>} />

              {/* Driver routes — DriverTrackingWrapper reste imbriqué séparément par
                  route (pas dans le layout partagé) : ces 2 pages ont un besoin
                  spécifique (suivi GPS actif en tâche de fond) distinct du layout
                  admin/dispatcher/client ci-dessus, et n'étaient pas concernées par le
                  bug de navigation (jamais reproduites, priorité à ne pas y toucher). */}
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
