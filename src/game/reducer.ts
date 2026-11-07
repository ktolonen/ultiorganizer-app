import type { EligiblePlayer, EntryContext, GameResult, RosterEntry, Rules, Side } from './types';

/**
 * Pure game state over the event log. Every rule here mirrors what the server
 * enforces (docs/api.md, "Scorekeeping app endpoints"), so an event the reducer
 * accepts is one the server should accept, and an event it refuses never enters
 * the outbox.
 */

export type Goal = {
  num: number;
  side: Side;
  scorerId: number | null;
  assistId: number | null;
  callahan: boolean;
  /** Seconds into the game; null when the event hides goal times. */
  time: number | null;
  homeScore: number;
  awayScore: number;
};

export type Stoppage = { time: number };

export type CapType = 'half_cap' | 'time_cap';
export const CAP_TYPES: readonly CapType[] = ['half_cap', 'time_cap'];
/** A recorded halftime cap or time cap: when it was called and the new point cap. */
export type Cap = { time: number; pointCap: number };
export type Caps = Partial<Record<CapType, Cap>>;
export type BySide<T> = Record<Side, T>;

export type GameState = {
  gameId: number;
  teamIds: BySide<number | null>;
  eligible: BySide<EligiblePlayer[]>;
  rosters: BySide<RosterEntry[]>;
  goals: Goal[];
  timeouts: BySide<Stoppage[]>;
  spiritStoppages: BySide<Stoppage[]>;
  result: GameResult | null;
  startingOffence: Side | null;
  halftime: number | null;
  official: string | null;
  forfeit: boolean;
  rules: Rules;
  /** Player ids the defence sheet refers to; they must stay on a roster. */
  retainedPlayerIds: number[];
  /**
   * Halftime cap and time cap. Not part of the concurrency token or of a full upload,
   * which keeps the server's caps; they sync only through their own route.
   */
  caps: Caps;
  /**
   * The game note. Not part of the token or of a full upload; only a personal (user-scoped)
   * app token may read or write it, so for other tokens it stays null.
   */
  note: string | null;
};

export type GameEvent =
  | {
      type: 'goal';
      side: Side;
      scorerId: number | null;
      assistId: number | null;
      callahan: boolean;
      time: number | null;
    }
  | { type: 'delete_last_goal'; num: number }
  /** Corrects a recorded goal's scorer, assist and Callahan flag; side, time and score stay. */
  | {
      type: 'correct_goal';
      num: number;
      scorerId: number | null;
      assistId: number | null;
      callahan: boolean;
    }
  | { type: 'timeout'; side: Side; time: number }
  | { type: 'spirit_stoppage'; side: Side; time: number }
  /**
   * Removes a timeout or spirit stoppage. The team's last one syncs through its delete
   * route; an older one only by full upload.
   */
  | { type: 'remove_timeout'; side: Side; index: number }
  | { type: 'remove_spirit_stoppage'; side: Side; index: number }
  | { type: 'score_tap'; side: Side; delta: 1 | -1 }
  | { type: 'roster'; side: Side; players: RosterEntry[] }
  | {
      type: 'metadata';
      startingOffence?: Side | null;
      halftime?: number | null;
      official?: string | null;
    }
  | { type: 'finalize' }
  /** Records a cap, or corrects the recorded one. */
  | { type: 'cap'; cap: CapType; time: number; pointCap: number }
  | { type: 'remove_cap'; cap: CapType }
  /** Sets the game note; an empty text clears it. */
  | { type: 'note'; text: string };

export type GameErrorCode =
  | 'forfeit'
  | 'game_final'
  | 'goal_changed'
  | 'timeout_limit'
  | 'spirit_stoppage_limit'
  | 'spirit_stoppages_disabled'
  | 'score_out_of_range'
  | 'score_changed'
  | 'player_referenced'
  | 'times_hidden'
  | 'point_cap_too_low'
  | 'note_too_long'
  | 'validation_failed';

export type GameError = { code: GameErrorCode; path?: string; message: string };
export type Reduced = { ok: true; state: GameState } | { ok: false; error: GameError };

export const MAX_SPIRIT_STOPPAGES_PER_TEAM = 4;
export const MAX_GOAL_TIME = 32767;
export const MAX_STOPPAGE_TIME = 86400;
export const MAX_ROSTER = 100;
export const MAX_OFFICIAL_LENGTH = 50;
/** The server stores cap times in a smallint, like goal times. */
export const MAX_CAP_TIME = 32767;
export const MAX_POINT_CAP = 255;
/** The server's limit for the game note, in UTF-8 bytes. */
export const MAX_NOTE_BYTES = 4000;

/** UTF-8 length of a string, as the server counts it. */
export function utf8Bytes(text: string): number {
  let n = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}

/** Trim a typed scorekeeper name and cap it at what the server accepts. */
export const cleanOfficial = (name: string): string =>
  name.trim().slice(0, MAX_OFFICIAL_LENGTH).trim();

const other = (side: Side): Side => (side === 'home' ? 'away' : 'home');
const fail = (code: GameErrorCode, message: string, path?: string): Reduced => ({
  ok: false,
  error: { code, message, path },
});
const ok = (state: GameState): Reduced => ({ ok: true, state });
const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

/** The caps the entry context lists; unknown event types are ignored. */
export function capsFromContext(ctx: EntryContext): Caps {
  const caps: Caps = {};
  for (const e of ctx.retained.cap_events) {
    if ((CAP_TYPES as readonly string[]).includes(e.type)) {
      caps[e.type as CapType] = { time: e.time, pointCap: e.point_cap };
    }
  }
  return caps;
}

export function fromEntryContext(ctx: EntryContext): GameState {
  return {
    gameId: ctx.game.game_id,
    teamIds: { home: ctx.home.team_id, away: ctx.away.team_id },
    eligible: { home: ctx.home.eligible_players, away: ctx.away.eligible_players },
    rosters: { home: ctx.home.roster, away: ctx.away.roster },
    goals: ctx.goals.map((g) => ({
      num: g.num,
      side: g.side,
      scorerId: g.scorer_id,
      assistId: g.assist_id,
      callahan: g.callahan,
      time: g.time,
      homeScore: g.home_score,
      awayScore: g.away_score,
    })),
    timeouts: ctx.timeouts,
    spiritStoppages: ctx.spirit_stoppages,
    result: ctx.result,
    startingOffence: ctx.metadata.starting_offence,
    halftime: ctx.metadata.halftime,
    official: ctx.metadata.official,
    forfeit: ctx.retained.forfeit !== 'none',
    rules: ctx.rules,
    retainedPlayerIds: ctx.retained.defenses.referenced_player_ids,
    caps: capsFromContext(ctx),
    note: ctx.note ?? null,
  };
}

/**
 * The point cap to offer for a new cap: one above the higher score, the lowest the
 * server accepts, as the Scorekeeper cap page suggests. A recorded cap keeps its own.
 */
export function suggestedPointCap(state: GameState, cap: CapType): number {
  const recorded = state.caps[cap];
  if (recorded) return recorded.pointCap;
  const s = currentScore(state);
  return Math.min(MAX_POINT_CAP, Math.max(s.home, s.away) + 1);
}

/** The lowest point cap the server takes: above the score for a new cap, 1 for a correction. */
export function minPointCap(state: GameState, cap: CapType): number {
  if (state.caps[cap]) return 1;
  const s = currentScore(state);
  return Math.max(s.home, s.away) + 1;
}

/** Score the goal list adds up to. */
export function goalTotals(goals: readonly Goal[]): { home: number; away: number } {
  const last = goals[goals.length - 1];
  return last ? { home: last.homeScore, away: last.awayScore } : { home: 0, away: 0 };
}

/** The score to show: the stored result when there is one, else the goal total. */
export function currentScore(state: GameState): { home: number; away: number } {
  return state.result
    ? { home: state.result.home, away: state.result.away }
    : goalTotals(state.goals);
}

export function timeoutsLeft(state: GameState, side: Side): number {
  return Math.max(0, state.rules.timeouts_per_team - state.timeouts[side].length);
}

function onRoster(state: GameState, side: Side, playerId: number): boolean {
  return state.rosters[side].some((p) => p.player_id === playerId);
}

function reduceGoal(state: GameState, e: Extract<GameEvent, { type: 'goal' }>): Reduced {
  if (state.result?.state === 'final') return fail('game_final', 'The game is final.');
  const { rules } = state;
  const sideGoals = state.goals.filter((g) => g.side === e.side).length;
  if (sideGoals >= rules.max_goals_per_side) {
    return fail('validation_failed', 'Too many goals for one side.', 'side');
  }
  if (e.callahan && e.assistId !== null) {
    return fail('validation_failed', 'A Callahan goal has no assist.', 'assist_id');
  }
  if (e.scorerId !== null && e.scorerId === e.assistId) {
    return fail('validation_failed', 'Scorer and assist must differ.', 'assist_id');
  }
  if (e.scorerId !== null && !onRoster(state, e.side, e.scorerId)) {
    return fail('validation_failed', 'The scorer is not on the roster.', 'scorer_id');
  }
  if (e.assistId !== null && !onRoster(state, e.side, e.assistId)) {
    return fail('validation_failed', 'The assist is not on the roster.', 'assist_id');
  }
  const last = state.goals[state.goals.length - 1];
  if (rules.hide_time_on_scoresheet) {
    if (e.time !== null) {
      return fail('validation_failed', 'Goal times are hidden in this event.', 'time');
    }
  } else {
    if (!isInt(e.time) || e.time < 0 || e.time > MAX_GOAL_TIME) {
      return fail('validation_failed', 'A goal time from 0 to 32767 is required.', 'time');
    }
    if (last?.time != null && e.time < last.time) {
      return fail('validation_failed', 'Goal times must not go backwards.', 'time');
    }
  }
  const home = last?.homeScore ?? 0;
  const away = last?.awayScore ?? 0;
  const goal: Goal = {
    num: (last?.num ?? 0) + 1,
    side: e.side,
    scorerId: e.scorerId,
    assistId: e.callahan ? null : e.assistId,
    callahan: e.callahan,
    time: e.time,
    homeScore: home + (e.side === 'home' ? 1 : 0),
    awayScore: away + (e.side === 'away' ? 1 : 0),
  };
  // Like the server: raise the result to the new score unless a stored score is already higher.
  const prev = state.result;
  const result: GameResult = {
    home: Math.max(prev?.home ?? 0, goal.homeScore),
    away: Math.max(prev?.away ?? 0, goal.awayScore),
    state: 'ongoing',
  };
  return ok({ ...state, goals: [...state.goals, goal], result });
}

function reduceDeleteLast(
  state: GameState,
  e: Extract<GameEvent, { type: 'delete_last_goal' }>,
): Reduced {
  if (state.result?.state === 'final') return fail('game_final', 'The game is final.');
  const last = state.goals[state.goals.length - 1];
  if (!last || last.num !== e.num) {
    return fail('goal_changed', 'Only the last goal can be deleted.', 'num');
  }
  const goals = state.goals.slice(0, -1);
  // Lower the result only when it was tracking the goals.
  const tracking =
    state.result && state.result.home === last.homeScore && state.result.away === last.awayScore;
  const totals = goalTotals(goals);
  const result: GameResult | null = tracking ? { ...state.result!, ...totals } : state.result;
  return ok({ ...state, goals, result });
}

// Like the server's PATCH goals/{num}: allowed on a final game, since the result does not
// change, and only a player being changed needs to be on the game roster.
function reduceCorrectGoal(
  state: GameState,
  e: Extract<GameEvent, { type: 'correct_goal' }>,
): Reduced {
  const idx = state.goals.findIndex((g) => g.num === e.num);
  if (idx < 0) return fail('validation_failed', 'No such goal.', 'num');
  const goal = state.goals[idx];
  const assistId = e.callahan ? null : e.assistId;
  if (e.callahan && e.assistId !== null) {
    return fail('validation_failed', 'A Callahan goal has no assist.', 'assist_id');
  }
  if (e.scorerId !== null && e.scorerId === assistId) {
    return fail('validation_failed', 'Scorer and assist must differ.', 'assist_id');
  }
  if (
    e.scorerId !== goal.scorerId &&
    e.scorerId !== null &&
    !onRoster(state, goal.side, e.scorerId)
  ) {
    return fail('validation_failed', 'The scorer is not on the roster.', 'scorer_id');
  }
  if (assistId !== goal.assistId && assistId !== null && !onRoster(state, goal.side, assistId)) {
    return fail('validation_failed', 'The assist is not on the roster.', 'assist_id');
  }
  if (e.scorerId === goal.scorerId && assistId === goal.assistId && e.callahan === goal.callahan) {
    return ok(state);
  }
  const goals = [...state.goals];
  goals[idx] = { ...goal, scorerId: e.scorerId, assistId, callahan: e.callahan };
  return ok({ ...state, goals });
}

function reduceStoppage(
  state: GameState,
  e: Extract<GameEvent, { type: 'timeout' | 'spirit_stoppage' }>,
): Reduced {
  if (!isInt(e.time) || e.time < 0 || e.time > MAX_STOPPAGE_TIME) {
    return fail('validation_failed', 'A time from 0 to 86400 is required.', 'time');
  }
  if (e.type === 'timeout') {
    if (state.timeouts[e.side].length >= state.rules.timeouts_per_team) {
      return fail('timeout_limit', 'No timeouts left.', 'side');
    }
    return ok({
      ...state,
      timeouts: { ...state.timeouts, [e.side]: [...state.timeouts[e.side], { time: e.time }] },
    });
  }
  if (!state.rules.spirit_stoppages_enabled) {
    return fail('spirit_stoppages_disabled', 'Spirit stoppages are not used in this event.');
  }
  if (state.spiritStoppages[e.side].length >= MAX_SPIRIT_STOPPAGES_PER_TEAM) {
    return fail('spirit_stoppage_limit', 'No spirit stoppages left.', 'side');
  }
  return ok({
    ...state,
    spiritStoppages: {
      ...state.spiritStoppages,
      [e.side]: [...state.spiritStoppages[e.side], { time: e.time }],
    },
  });
}

function reduceScoreTap(state: GameState, e: Extract<GameEvent, { type: 'score_tap' }>): Reduced {
  if (state.result?.state === 'final') return fail('game_final', 'The game is final.');
  const base = state.result ?? { home: 0, away: 0, state: 'ongoing' as const };
  const next = { ...base, [e.side]: base[e.side] + e.delta };
  if (next[e.side] < 0 || next[e.side] > state.rules.max_game_score) {
    return fail('score_out_of_range', 'The score is out of range.');
  }
  // A game back at 0-0 before it started returns to "not started".
  const result = next.home === 0 && next.away === 0 && state.goals.length === 0 ? null : next;
  return ok({ ...state, result });
}

function reduceRoster(state: GameState, e: Extract<GameEvent, { type: 'roster' }>): Reduced {
  if (state.result?.state === 'final') return fail('game_final', 'The game is final.');
  if (e.players.length > MAX_ROSTER) {
    return fail('validation_failed', 'Too many players.', 'players');
  }
  const seen = new Set<number>();
  const eligible = new Map(state.eligible[e.side].map((p) => [p.player_id, p]));
  for (const [i, p] of e.players.entries()) {
    const path = `players[${i}]`;
    if (seen.has(p.player_id)) return fail('validation_failed', 'Duplicate player.', path);
    seen.add(p.player_id);
    const known = eligible.get(p.player_id);
    if (!known) return fail('validation_failed', 'Not a player of this team.', path);
    if (state.rules.require_accreditation && known.accredited === false) {
      return fail('validation_failed', 'The player is not accredited.', path);
    }
    if (
      p.number !== null &&
      (!isInt(p.number) || p.number < 0 || p.number > state.rules.max_jersey_number)
    ) {
      return fail('validation_failed', 'Jersey number out of range.', `${path}.number`);
    }
  }
  const referenced = state.goals
    .filter((g) => g.side === e.side)
    .flatMap((g) => [g.scorerId, g.assistId])
    .concat(state.retainedPlayerIds.filter((id) => onRoster(state, e.side, id)))
    .filter((id): id is number => id !== null && !seen.has(id));
  if (referenced.length) {
    return fail(
      'player_referenced',
      `A goal or the defence sheet refers to player ${referenced[0]}.`,
      'players',
    );
  }
  return ok({ ...state, rosters: { ...state.rosters, [e.side]: e.players } });
}

function reduceMetadata(state: GameState, e: Extract<GameEvent, { type: 'metadata' }>): Reduced {
  if ('halftime' in e && e.halftime != null) {
    if (!isInt(e.halftime) || e.halftime < 0 || e.halftime > MAX_STOPPAGE_TIME) {
      return fail('validation_failed', 'Halftime must be 0 to 86400.', 'halftime');
    }
  }
  if ('official' in e && e.official != null && e.official.length > MAX_OFFICIAL_LENGTH) {
    return fail('validation_failed', 'The name is too long.', 'official');
  }
  const next = { ...state };
  if ('startingOffence' in e) next.startingOffence = e.startingOffence ?? null;
  // Like the server, a halftime of 0 and an empty name count as unset.
  if ('halftime' in e) next.halftime = e.halftime ? e.halftime : null;
  if ('official' in e) next.official = e.official ? e.official : null;
  return ok(next);
}

function reduceFinalize(state: GameState): Reduced {
  if (!state.result) return fail('validation_failed', 'A game with no score cannot be finalized.');
  if (state.result.state === 'final') return fail('game_final', 'The game is final.');
  return ok({ ...state, result: { ...state.result, state: 'final' } });
}

// Like the server: a final game can still take a cap, and the score check uses the
// stored result, not the goal total.
function reduceCap(
  state: GameState,
  e: Extract<GameEvent, { type: 'cap' | 'remove_cap' }>,
): Reduced {
  if (state.rules.hide_time_on_scoresheet) {
    return fail('times_hidden', 'Caps are not recorded while the event hides times.');
  }
  if (!CAP_TYPES.includes(e.cap)) return fail('validation_failed', 'No such cap.', 'type');
  if (e.type === 'remove_cap') {
    if (!state.caps[e.cap]) return ok(state);
    const caps = { ...state.caps };
    delete caps[e.cap];
    return ok({ ...state, caps });
  }
  if (!isInt(e.time) || e.time < 0 || e.time > MAX_CAP_TIME) {
    return fail('validation_failed', 'A time from 0 to 32767 is required.', 'time');
  }
  if (!isInt(e.pointCap) || e.pointCap < 1 || e.pointCap > MAX_POINT_CAP) {
    return fail('validation_failed', 'The point cap must be 1 to 255.', 'point_cap');
  }
  if (e.pointCap < minPointCap(state, e.cap)) {
    return fail(
      'point_cap_too_low',
      'A new point cap must be greater than the score.',
      'point_cap',
    );
  }
  return ok({ ...state, caps: { ...state.caps, [e.cap]: { time: e.time, pointCap: e.pointCap } } });
}

export function reduce(state: GameState, event: GameEvent): Reduced {
  if (state.forfeit) return fail('forfeit', 'The game is a forfeit.');
  switch (event.type) {
    case 'goal':
      return reduceGoal(state, event);
    case 'delete_last_goal':
      return reduceDeleteLast(state, event);
    case 'correct_goal':
      return reduceCorrectGoal(state, event);
    case 'timeout':
    case 'spirit_stoppage':
      return reduceStoppage(state, event);
    case 'remove_timeout':
    case 'remove_spirit_stoppage': {
      const key = event.type === 'remove_timeout' ? 'timeouts' : 'spiritStoppages';
      const list = state[key][event.side];
      if (!isInt(event.index) || event.index < 0 || event.index >= list.length) {
        return fail('validation_failed', 'No such entry.', 'index');
      }
      return ok({
        ...state,
        [key]: { ...state[key], [event.side]: list.filter((_, i) => i !== event.index) },
      });
    }
    case 'score_tap':
      return reduceScoreTap(state, event);
    case 'roster':
      return reduceRoster(state, event);
    case 'metadata':
      return reduceMetadata(state, event);
    case 'finalize':
      return reduceFinalize(state);
    case 'cap':
    case 'remove_cap':
      return reduceCap(state, event);
    case 'note': {
      // Like the server: trimmed, an empty text clears it, allowed on a final game.
      const text = event.text.trim();
      if (utf8Bytes(text) > MAX_NOTE_BYTES) {
        return fail('note_too_long', 'The note is too long.', 'text');
      }
      return ok({ ...state, note: text === '' ? null : text });
    }
  }
}

/** Replays events over a base state, stopping at the first refused one. */
export function replay(
  base: GameState,
  events: readonly GameEvent[],
): { state: GameState; failedAt: number | null; error?: GameError } {
  let state = base;
  for (const [i, event] of events.entries()) {
    const r = reduce(state, event);
    if (!r.ok) return { state, failedAt: i, error: r.error };
    state = r.state;
  }
  return { state, failedAt: null };
}

export { other as otherSide };
