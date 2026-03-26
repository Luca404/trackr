import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import it from './locales/it.json';
import es from './locales/es.json';

const savedLang = localStorage.getItem('lang');
const bl = navigator.language?.toLowerCase();
const browserLang = bl?.startsWith('it') ? 'it' : bl?.startsWith('es') ? 'es' : 'en';
const savedLang_final = savedLang || browserLang;

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, it: { translation: it }, es: { translation: es } },
  lng: savedLang_final,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
