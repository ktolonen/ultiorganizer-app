import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import de from './locales/de.json';
import enApp from './locales/en.app.json';
import enTerms from './locales/en.terms.json';
import es from './locales/es.json';
import fi from './locales/fi.json';

const i18n = createInstance();

export const LANGUAGES = ['en', 'fi', 'de', 'es'] as const;
export type Language = (typeof LANGUAGES)[number];

/**
 * English is complete. fi, de and es hold the shared terms seeded from the server
 * `.po` catalogs (`npm run i18n:seed`); every other string falls back to English
 * until the translations are reviewed.
 */
export const resources = {
  en: { translation: { ...enTerms, ...enApp } },
  fi: { translation: fi },
  de: { translation: de },
  es: { translation: es },
} as const;

export function pickLanguage(codes: readonly string[]): Language {
  for (const code of codes) {
    const base = code.toLowerCase().split(/[-_]/)[0];
    if ((LANGUAGES as readonly string[]).includes(base)) return base as Language;
  }
  return 'en';
}

export function initI18n(language?: Language) {
  const lng = language ?? pickLanguage(getLocales().map((l) => l.languageTag));
  if (!i18n.isInitialized) {
    void i18n.use(initReactI18next).init({
      resources,
      lng,
      fallbackLng: 'en',
      keySeparator: false,
      nsSeparator: false,
      interpolation: { escapeValue: false },
      returnNull: false,
    });
  } else if (language) {
    void i18n.changeLanguage(language);
  }
  return i18n;
}

/** Translated signal text; unknown texts (custom templates) are shown as the server sent them. */
export const signalText = (text: string): string =>
  i18n.exists(`signal.${text}`) ? i18n.t(`signal.${text}`) : text;

export default i18n;
