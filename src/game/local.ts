import { newOutbox } from '../sync/outbox';
import { fromEntryContext } from './reducer';
import type { GameSession } from './runtime';
import { entryContextSchema, type EntryContext } from './types';

/**
 * Local games are kept on this phone only, under a reserved server row (`LOCAL_SERVER_ID`,
 * created by a migration). They are a backup for a game the server does not know, for
 * example after an ad hoc schedule change mid-tournament: never linked to a server game,
 * never uploaded. With no server there are no players, so a local game keeps the result
 * with +1 and −1, timeouts, spirit stoppages, caps and the clock.
 */
export const LOCAL_SERVER_ID = 0;
export const isLocalGame = (serverId: number) => serverId === LOCAL_SERVER_ID;

export const MAX_TEAM_NAME = 50;
export const DEFAULT_LOCAL_TIMEOUTS = 2;

const pad = (n: number) => String(n).padStart(2, '0');

/** Device wall-clock time in the server's `YYYY-MM-DD HH:MM:SS` form. */
export function localTimestamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

export type LocalGameInput = {
  home: string;
  away: string;
  field: string;
  timeoutsPerTeam: number;
};

/**
 * The entry context of a local game, shaped like the server's so the rest of the app
 * treats it as any other game. It must pass `entryContextSchema`: a stored context that
 * does not is read back as absent and the game would vanish.
 */
export function localEntryContext(
  gameId: number,
  input: LocalGameInput,
  nowMs: number,
): EntryContext {
  const name = (s: string) => s.trim().slice(0, MAX_TEAM_NAME).trim() || null;
  const side = (n: string) => ({ team_id: null, name: name(n), eligible_players: [], roster: [] });
  return entryContextSchema.parse({
    game: {
      game_id: gameId,
      time: localTimestamp(nowMs),
      field: name(input.field),
      location: null,
      pool: { pool_id: null, name: null },
      division: null,
      event: { event_id: 'local', name: null, timezone: null },
    },
    home: side(input.home),
    away: side(input.away),
    result: null,
    goals: [],
    timeouts: { home: [], away: [] },
    spirit_stoppages: { home: [], away: [] },
    metadata: { starting_offence: null, halftime: null, official: null },
    rules: {
      hide_time_on_scoresheet: false,
      timeouts_per_team: Math.max(0, Math.min(9, Math.round(input.timeoutsPerTeam))),
      spirit_stoppages_enabled: true,
      require_accreditation: false,
      max_game_score: 255,
      max_goals_per_side: 255,
      max_jersey_number: 255,
    },
    retained: {
      forfeit: 'none',
      cap_events: [],
      defenses: { home: 0, away: 0, referenced_player_ids: [] },
    },
    token: '',
  });
}

/** A fresh local session: the outbox is offline-only, so nothing is ever queued. */
export function newLocalSession(
  gameId: number,
  title: string,
  input: LocalGameInput,
  nowMs: number,
): GameSession {
  const context = localEntryContext(gameId, input, nowMs);
  return {
    serverId: LOCAL_SERVER_ID,
    gameId,
    title,
    context,
    state: fromEntryContext(context),
    outbox: newOutbox(gameId, null, null, true),
  };
}
