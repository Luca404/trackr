import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import it from './locales/it.json';

const savedLang = localStorage.getItem('lang');
const browserLang = navigator.language?.toLowerCase().startsWith('it') ? 'it' : 'en';
const savedLang_final = savedLang || browserLang;

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, it: { translation: it } },
  lng: savedLang_final,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
