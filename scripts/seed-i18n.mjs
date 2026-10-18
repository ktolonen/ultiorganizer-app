// Seeds the shared terms of the app catalogs from the ultiorganizer .po files, so
// the app and the website use the same words (docs/terminology.md).
// Usage: node scripts/seed-i18n.mjs [path-to-ultiorganizer]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] ?? join(import.meta.dirname, '../../ultiorganizer');
const catalogs = { fi: 'fi_FI.utf8', de: 'de_DE.utf8', es: 'es_ES.utf8' };

// key in the app catalog -> msgid in the server catalog
const TERMS = {
  'term.goal': 'Goal',
  'term.assist': 'Assist',
  'term.callahan': 'Callahan',
  'term.timeout': 'Timeout',
  'term.spiritStoppage': 'Spirit stoppage',
  'term.halftime': 'Halftime',
  'term.halftimeCap': 'Halftime cap',
  'term.timeCap': 'Time cap',
  'term.startingOffence': 'Starting offence',
  'term.teamCaptain': 'Team captain',
  'term.spiritCaptain': 'Spirit captain',
  'term.scorekeeper': 'Scorekeeper',
  'term.roster': 'Roster',
  'term.result': 'Result',
  'term.unknown': 'unknown',
  'timekeeper.action.betweenpoints': 'Start of point',
  'timekeeper.action.timeout': 'Timeout',
  'timekeeper.action.halftime': 'Halftime',
  'timekeeper.action.halfstart': 'Start of game',
  'timekeeper.action.dispute': 'Call or discussion',
  'timekeeper.action.discretrieval': 'Disc retrieval',
  'timekeeper.pause': 'Pause',
  'timekeeper.resume': 'Resume',
  'timekeeper.mark': 'Mark',
  // Signal texts, keyed by their English text as the templates store them.
  'signal.Offence warning': 'Offence warning',
  'signal.Defence warning': 'Defence warning',
  'signal.Play': 'Play',
  'signal.Timeout over': 'Timeout over',
  'signal.Halftime ending': 'Halftime ending',
  'signal.Halftime over': 'Halftime over',
  'signal.Approaching start': 'Approaching start',
  'signal.Start of play': 'Start of play',
  'signal.Resolve call or discussion': 'Resolve call or discussion',
  'signal.Play must restart': 'Play must restart',
};

function parsePo(text) {
  const entries = new Map();
  let id = null;
  let str = null;
  let target = null;
  const unquote = (s) => JSON.parse(s.trim());
  const flush = () => {
    if (id !== null && str) entries.set(id, str);
    id = str = target = null;
  };
  for (const line of text.split('\n')) {
    if (line.startsWith('msgid ')) {
      flush();
      id = unquote(line.slice(6));
      target = 'id';
    } else if (line.startsWith('msgstr ')) {
      str = unquote(line.slice(7));
      target = 'str';
    } else if (line.startsWith('"')) {
      if (target === 'id') id += unquote(line);
      else if (target === 'str') str += unquote(line);
    } else if (line.trim() === '') {
      flush();
    }
  }
  flush();
  return entries;
}

for (const [lng, dir] of Object.entries(catalogs)) {
  const po = parsePo(readFileSync(join(root, 'locale', dir, 'LC_MESSAGES/messages.po'), 'utf8'));
  const out = {};
  const missing = [];
  for (const [key, msgid] of Object.entries(TERMS)) {
    const msgstr = po.get(msgid);
    if (msgstr) out[key] = msgstr;
    else missing.push(msgid);
  }
  writeFileSync(
    join(import.meta.dirname, `../src/i18n/locales/${lng}.json`),
    JSON.stringify(out, null, 2) + '\n',
  );
  console.log(`${lng}: ${Object.keys(out).length} seeded, ${missing.length} missing`, missing);
}

// English is the msgid itself.
const en = Object.fromEntries(
  Object.entries(TERMS).map(([k, v]) => [k, v === 'unknown' ? 'Unknown' : v]),
);
writeFileSync(
  join(import.meta.dirname, '../src/i18n/locales/en.terms.json'),
  JSON.stringify(en, null, 2) + '\n',
);
