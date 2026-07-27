import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import styles from './NotFoundPage.module.css';

export default function NotFoundPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  return (
    <div className={styles.container}>
      <div className={styles.errorCode}>
        404
      </div>
      <h2 className={styles.heading}>
        {t('errors.404.heading')}
      </h2>
      <p className={styles.message}>
        {t('errors.404.message')}
      </p>
      <button
        onClick={() => navigate('/dashboard')}
        className={styles.button}
      >
        <ArrowLeft size={16} /> {t('errors.404.backToDashboard')}
      </button>
    </div>
  );
}
