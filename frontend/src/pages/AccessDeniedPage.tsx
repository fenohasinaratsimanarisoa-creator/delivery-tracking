import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import styles from './AccessDeniedPage.module.css';

export default function AccessDeniedPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
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
        onClick={() => navigate('/dashboard')}
        className={styles.button}
      >
        <ArrowLeft size={16} /> {t('errors.403.backToDashboard')}
      </button>
    </div>
  );
}
