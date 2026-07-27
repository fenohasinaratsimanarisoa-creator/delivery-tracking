import { useTranslation } from 'react-i18next';
import styles from './ComingSoon.module.css';

interface Props {
  pageName?: string;
}

export default function ComingSoon({ pageName }: Props) {
  const { t } = useTranslation();
  return (
    <div className={styles.container}>
      <div className={styles.icon}>🚧</div>
      <h2 className={styles.title}>
        {pageName ?? t('components.comingSoon.fallbackTitle')} {t('components.comingSoon.title')}
      </h2>
      <p className={styles.description}>
        {t('components.comingSoon.description')}
      </p>
    </div>
  );
}
