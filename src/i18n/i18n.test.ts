import deApp from './locales/de.app.json';
import deTerms from './locales/de.terms.json';
import en from './locales/en.app.json';
import enTerms from './locales/en.terms.json';
import esApp from './locales/es.app.json';
import esTerms from './locales/es.terms.json';
import fiApp from './locales/fi.app.json';
import fiTerms from './locales/fi.terms.json';
import i18n, { initI18n, parseLanguagePref, pickLanguage, setLanguage, signalText } from './index';

const apps: Record<string, Record<string, string>> = { fi: fiApp, de: deApp, es: esApp };
const terms: Record<string, Record<string, string>> = { fi: fiTerms, de: deTerms, es: esTerms };
const placeholders = (s: string) => (s.match(/{{\w+}}/g) ?? []).sort();

describe('pickLanguage', () => {
  it('maps device locales to the supported languages', () => {
    expect(pickLanguage(['fi-FI'])).toBe('fi');
    expect(pickLanguage(['sv-SE', 'de_AT'])).toBe('de');
    expect(pickLanguage(['es-419'])).toBe('es');
    expect(pickLanguage(['ja-JP'])).toBe('en');
    expect(pickLanguage([])).toBe('en');
  });
});

describe('parseLanguagePref', () => {
  it('keeps a supported language and reads anything else as the device language', () => {
    expect(parseLanguagePref('fi')).toBe('fi');
    expect(parseLanguagePref('es')).toBe('es');
    expect(parseLanguagePref('system')).toBe('system');
    expect(parseLanguagePref('sv')).toBe('system');
    expect(parseLanguagePref(null)).toBe('system');
  });
});

describe('catalogs', () => {
  it('seeds the same term keys in every language that the server .po has', () => {
    for (const cat of Object.values(terms)) {
      expect(Object.keys(cat).length).toBeGreaterThan(20);
      for (const key of Object.keys(cat)) expect(Object.keys(enTerms)).toContain(key);
    }
    expect(fiTerms['term.goal']).toBe('Maali');
    expect(fiTerms['term.timeout']).toBe('Aikalisä');
  });
  it('never mixes an app string into the seeded term namespace', () => {
    for (const cat of [en, ...Object.values(apps)]) {
      for (const key of Object.keys(cat)) expect(Object.keys(enTerms)).not.toContain(key);
    }
  });
  it.each(Object.keys(apps))('translates every app string into %s', (lng) => {
    expect(Object.keys(apps[lng]).sort()).toEqual(Object.keys(en).sort());
  });
  it.each(Object.keys(apps))('keeps the language-neutral abbreviations in %s', (lng) => {
    // docs/terminology.md in the server: narrow-table abbreviations are never translated.
    expect(apps[lng]['game.timeouts']).toBe('TO');
  });
  it.each(Object.keys(apps))('keeps the placeholders of every %s string', (lng) => {
    for (const [key, text] of Object.entries(en)) {
      expect([key, placeholders(apps[lng][key])]).toEqual([key, placeholders(text)]);
    }
  });
});

describe('translation', () => {
  it('uses the seeded word and the app strings of the language', () => {
    initI18n('fi');
    expect(i18n.t('term.goal')).toBe('Maali');
    expect(i18n.t('home.scan')).toBe('Skannaa pisteenkirjauksen QR');
    expect(i18n.t('settings.forget.unsent', { count: 1 })).toMatch(/^1 merkintä /);
    expect(i18n.t('settings.forget.unsent', { count: 3 })).toMatch(/^3 merkintää /);
  });
  it('uses the server alias for a term it has not translated', () => {
    initI18n('fi');
    expect(i18n.t('term.teamCaptain')).toBe('Kapteeni');
  });
  it('falls back to English for a term the server has not translated', () => {
    initI18n('fi');
    expect(i18n.t('signal.Offence warning')).toBe('Offence warning');
  });
  it('switches language from the Settings choice', () => {
    setLanguage('de');
    expect(i18n.language).toBe('de');
    expect(i18n.t('settings.title')).toBe('Einstellungen');
    setLanguage('en');
    expect(i18n.t('settings.title')).toBe('Settings');
  });
  it('shows custom signal texts as sent and known ones translated when possible', () => {
    initI18n('en');
    expect(signalText('Offence warning')).toBe('Offence warning');
    expect(signalText('Our own signal')).toBe('Our own signal');
  });
});
