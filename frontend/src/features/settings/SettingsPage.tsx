import { useTranslation } from 'react-i18next';
import { setLanguage, getLanguage } from '../../services/i18n/i18n';
import { useState } from 'react';
import AppearanceSection from './sections/AppearanceSection';

export default function SettingsPage() {
  const { t } = useTranslation();
  const [lang, setLang] = useState(getLanguage());
  const handleLanguageChange = (l: 'fr' | 'en') => { setLanguage(l); setLang(l); };
  return (
    <div style={{
      padding: 'var(--space-2xl)',
      maxWidth: 720,
      margin: '0 auto',
    }}>
      <h1 style={{
        fontFamily: 'var(--font-display)',
        fontSize: 'var(--text-2xl)',
        fontWeight: 700,
        color: 'var(--color-text)',
        marginBottom: 'var(--space-xl)',
      }}>
        {t('settings.title')}
      </h1>
      <section style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-xl)',
        padding: 'var(--space-xl)',
      }}>
        <AppearanceSection />
      </section>
      <section style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-xl)',
        padding: 'var(--space-xl)',
        marginBottom: 'var(--space-xl)',
      }}>
        <h2 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--text-lg)',
          fontWeight: 600,
          color: 'var(--color-text)',
          marginBottom: 'var(--space-lg)',
        }}>
          {t('settings.language')}
        </h2>
        <div style={{ display: 'flex', gap: 'var(--space-md)' }}>
          <button onClick={() => handleLanguageChange('fr')} style={{
            flex: 1, padding: 'var(--space-md)',
            border: '2px solid ' + (lang === 'fr' ? 'var(--color-accent)' : 'var(--color-border-subtle)'),
            borderRadius: 'var(--radius-lg)',
            background: lang === 'fr' ? 'var(--color-accent-bg)' : 'var(--color-surface)',
            color: 'var(--color-text)',
            cursor: 'pointer',
            fontSize: 'var(--text-sm)',
            fontFamily: 'var(--font-body)',
            fontWeight: lang === 'fr' ? 600 : 400,
          }}>
            {t('settings.languageFr')}
          </button>
          <button onClick={() => handleLanguageChange('en')} style={{
            flex: 1, padding: 'var(--space-md)',
            border: '2px solid ' + (lang === 'en' ? 'var(--color-accent)' : 'var(--color-border-subtle)'),
            borderRadius: 'var(--radius-lg)',
            background: lang === 'en' ? 'var(--color-accent-bg)' : 'var(--color-surface)',
            color: 'var(--color-text)',
            cursor: 'pointer',
            fontSize: 'var(--text-sm)',
            fontFamily: 'var(--font-body)',
            fontWeight: lang === 'en' ? 600 : 400,
          }}>
            {t('settings.languageEn')}
          </button>
        </div>
      </section>
    </div>
  );
}
