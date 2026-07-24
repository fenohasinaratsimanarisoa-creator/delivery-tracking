import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import fr from './locales/fr.json';
import en from './locales/en.json';

const saved = typeof window !== 'undefined' ? localStorage.getItem('app_language') : null;

i18n.use(initReactI18next).init({
  resources: { fr: { translation: fr }, en: { translation: en } },
  lng: saved || 'fr',
  fallbackLng: 'fr',
  interpolation: { escapeValue: false },
  returnObjects: true,
});

export function setLanguage(lang: 'fr' | 'en') {
  i18n.changeLanguage(lang);
  localStorage.setItem('app_language', lang);
  document.documentElement.lang = lang;
}

export function getLanguage(): 'fr' | 'en' {
  return (i18n.language as 'fr' | 'en') || 'fr';
}

export default i18n;
