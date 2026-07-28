import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '../hooks/AuthContext';
import styles from './AccessDeniedPage.module.css';

const ROLE_HOME: Record<string, string> = {
  admin: '/dashboard',
  dispatcher: '/dashboard',
  driver: '/my-deliveries',
  client: '/my-orders',
};

export default function AccessDeniedPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user } = useAuth();
  const home = (user && ROLE_HOME[user.role]) || '/dashboard';
  return (
    <div className={styles.container}>
      <div className={styles.emoji}>🚫</div>
      <h2 className={styles.heading}>
        {t('errors.403.heading')}
      </h2>
      <p className={styles.message}>
        {t('errors.403.message')}
      </p>
      <button
        onClick={() => navigate(home)}
        className={styles.button}
      >
        <ArrowLeft size={16} /> {t('errors.403.backToDashboard')}
      </button>
    </div>
  );
}
