import en from './locales/en.app.json';
import de from './locales/de.json';
import fi from './locales/fi.json';
import es from './locales/es.json';
import enTerms from './locales/en.terms.json';
import i18n, { initI18n, pickLanguage, signalText } from './index';

describe('pickLanguage', () => {
  it('maps device locales to the supported languages', () => {
    expect(pickLanguage(['fi-FI'])).toBe('fi');
    expect(pickLanguage(['sv-SE', 'de_AT'])).toBe('de');
    expect(pickLanguage(['es-419'])).toBe('es');
    expect(pickLanguage(['ja-JP'])).toBe('en');
    expect(pickLanguage([])).toBe('en');
  });
});

describe('catalogs', () => {
  it('seeds the same term keys in every language that the server .po has', () => {
    for (const cat of [fi, de, es]) {
      expect(Object.keys(cat).length).toBeGreaterThan(20);
      for (const key of Object.keys(cat)) expect(Object.keys(enTerms)).toContain(key);
    }
    expect(fi['term.goal']).toBe('Maali');
    expect(fi['term.timeout']).toBe('Aikalisä');
  });
  it('never mixes an app string into the seeded term namespace', () => {
    for (const key of Object.keys(en)) expect(Object.keys(enTerms)).not.toContain(key);
  });
});

describe('translation', () => {
  it('uses the seeded word, and falls back to English for the rest', () => {
    initI18n('fi');
    expect(i18n.t('term.goal')).toBe('Maali');
    expect(i18n.t('home.scan')).toBe('Scan scorekeeping QR');
    expect(i18n.t('home.unsent', { count: 3 })).toBe('3 unsent');
  });
  it('shows custom signal texts as sent and known ones translated when possible', () => {
    initI18n('en');
    expect(signalText('Offence warning')).toBe('Offence warning');
    expect(signalText('Our own signal')).toBe('Our own signal');
  });
});
