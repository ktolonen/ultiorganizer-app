import type { Discovery } from '../api/http';
import type { Repo } from '../store/repo';

/**
 * A field link covers several games, so it is kept on Home to reopen its game list
 * without scanning again. A link that answers with one game is a game link: the game
 * itself goes to Recent games when opened, so the link is not kept.
 */
export function shouldRemember(data: Discovery): boolean {
  return data.games.length > 1 || (data.games.length === 0 && !!data.available_from);
}

/**
 * Card text for a link. A game link is named by its teams and field, a field link by
 * its fields; `day` is the first game's time (or the day it opens when the server
 * gives no time), so links for the same field on different days stay apart.
 */
export function linkSummary(data: Discovery): { label: string; day: string | null } {
  const up = data.upcoming;
  const one = data.games.length === 1 ? data.games[0] : null;
  const teams = one
    ? [one.home.name, one.away.name]
    : up && (up.home || up.away)
      ? [up.home, up.away]
      : null;
  const fields = data.games.length
    ? data.games.map((g) => g.field)
    : [up?.field || (teams ? null : up?.location)];
  const label = [
    teams ? teams.map((n) => n || '?').join(' – ') : '',
    [...new Set(fields.filter((f): f is string => !!f))].join(', '),
  ]
    .filter(Boolean)
    .join(' · ');
  const times = [...data.games.map((g) => g.time), up?.time]
    .filter((t): t is string => dayOf(t) !== null)
    .sort();
  return { label, day: times[0] ?? dayOf(data.available_from) };
}

/**
 * Saves a field link or a link scanned before its day, or refreshes the saved row when
 * this token is already kept for the server, even once it lists a single game, so a
 * link saved early takes its game's name. Tokens are compared in SecureStore, since
 * SQLite never holds them. Returns the row id, or null when nothing is kept.
 */
export async function rememberLink(deps: {
  repo: Repo;
  serverId: number;
  linkToken: string;
  data: Discovery;
  getToken: (linkId: number) => Promise<string | null>;
  saveToken: (linkId: number, token: string) => Promise<void>;
  now: number;
}): Promise<number | null> {
  const { repo, serverId, linkToken } = deps;
  const summary = { ...linkSummary(deps.data), now: deps.now };
  for (const l of await repo.listLinks(serverId)) {
    if ((await deps.getToken(l.id)) === linkToken) {
      await repo.updateLink(l.id, summary);
      return l.id;
    }
  }
  if (!shouldRemember(deps.data)) return null;
  const id = await repo.insertLink({ serverId, ...summary });
  await deps.saveToken(id, linkToken);
  return id;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/;

/** `YYYY-MM-DD` of a server time or date, or null. */
export function dayOf(time: string | null | undefined): string | null {
  const m = DATE.exec(time ?? '');
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * A server day as a short local date, e.g. `Sat 1 Nov`. Server times are event-local
 * wall-clock values without a zone, so they are formatted as given, never converted.
 */
export function formatDay(time: string | null | undefined, locale: string): string {
  const m = DATE.exec(time ?? '');
  if (!m) return '';
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  try {
    return date.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  } catch {
    return `${m[3]}.${m[2]}.`;
  }
}

/** `HH:MM` of a server time, or empty. */
export function formatClock(time: string | null | undefined): string {
  const m = DATE.exec(time ?? '');
  return m?.[4] ? `${m[4]}:${m[5]}` : '';
}

/** Day and start time, e.g. `Sat 1 Nov 10:30`. */
export const formatDayTime = (time: string | null | undefined, locale: string) =>
  [formatDay(time, locale), formatClock(time)].filter(Boolean).join(' ');
