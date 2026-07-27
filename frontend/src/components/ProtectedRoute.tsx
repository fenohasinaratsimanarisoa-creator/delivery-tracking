import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/AuthContext';
import type { Role } from '../types';
import styles from './ProtectedRoute.module.css';

interface Props {
  children: React.ReactNode;
  roles?: Role[];
}

export default function ProtectedRoute({ children, roles }: Props) {
  const { t } = useTranslation();
  const { user, isAuthenticated, isInitializing } = useAuth();

  if (isInitializing) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.loadingText}>{t('components.protectedRoute.loading')}</div>
      </div>
    );
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  if (roles && user && !roles.includes(user.role)) {
    return <Navigate to="/403" replace />;
  }

  return <>{children}</>;
}
