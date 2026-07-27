import { useTranslation } from 'react-i18next';
import { setLanguage, getLanguage } from '../../services/i18n/i18n';
import { useState } from 'react';
import AppearanceSection from './sections/AppearanceSection';
import styles from './SettingsPage.module.css';

export default function SettingsPage() {
  const { t } = useTranslation();
  const [lang, setLang] = useState(getLanguage());
  const handleLanguageChange = (l: 'fr' | 'en') => { setLanguage(l); setLang(l); };
  return (
    <div className={styles.container}>
      <h1 className={styles.pageTitle}>
        {t('settings.title')}
      </h1>
      <section className={styles.section}>
        <AppearanceSection />
      </section>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          {t('settings.language')}
        </h2>
        <div className={styles.langBtnRow}>
          <button onClick={() => handleLanguageChange('fr')} className={`${styles.langBtn} ${lang === 'fr' ? styles.langBtnActive : ''}`}>
            {t('settings.languageFr')}
          </button>
          <button onClick={() => handleLanguageChange('en')} className={`${styles.langBtn} ${lang === 'en' ? styles.langBtnActive : ''}`}>
            {t('settings.languageEn')}
          </button>
        </div>
      </section>
    </div>
  );
}
