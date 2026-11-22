import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import deApp from './locales/de.app.json';
import deTerms from './locales/de.terms.json';
import enApp from './locales/en.app.json';
import enTerms from './locales/en.terms.json';
import esApp from './locales/es.app.json';
import esTerms from './locales/es.terms.json';
import fiApp from './locales/fi.app.json';
import fiTerms from './locales/fi.terms.json';

const i18n = createInstance();

export const LANGUAGES = ['en', 'fi', 'de', 'es'] as const;
export type Language = (typeof LANGUAGES)[number];

/** The language's own name, so a user who picked the wrong one can still find theirs. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English',
  fi: 'Suomi',
  de: 'Deutsch',
  es: 'Español',
};

/** The Settings choice: a fixed language, or whatever the device uses. */
export type LanguagePref = Language | 'system';
export const LANGUAGE_KEY = 'language';

export function parseLanguagePref(value: string | null | undefined): LanguagePref {
  return (LANGUAGES as readonly string[]).includes(value ?? '') ? (value as Language) : 'system';
}

/**
 * Each language is its `*.terms.json`, the shared terms seeded from the server `.po`
 * catalogs (`npm run i18n:seed` rewrites only those), plus its `*.app.json`, the app's own
 * strings. A term the server has not translated falls back to English.
 */
export const resources = {
  en: { translation: { ...enTerms, ...enApp } },
  fi: { translation: { ...fiTerms, ...fiApp } },
  de: { translation: { ...deTerms, ...deApp } },
  es: { translation: { ...esTerms, ...esApp } },
} as const;

export function pickLanguage(codes: readonly string[]): Language {
  for (const code of codes) {
    const base = code.toLowerCase().split(/[-_]/)[0];
    if ((LANGUAGES as readonly string[]).includes(base)) return base as Language;
  }
  return 'en';
}

const deviceLanguage = (): Language => pickLanguage(getLocales().map((l) => l.languageTag));

export function initI18n(language?: Language) {
  const lng = language ?? deviceLanguage();
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

/** Applies the Settings choice; 'system' follows the device language. */
export function setLanguage(pref: LanguagePref) {
  initI18n(pref === 'system' ? deviceLanguage() : pref);
}

/** Translated signal text; unknown texts (custom templates) are shown as the server sent them. */
export const signalText = (text: string): string =>
  i18n.exists(`signal.${text}`) ? i18n.t(`signal.${text}`) : text;

export default i18n;
