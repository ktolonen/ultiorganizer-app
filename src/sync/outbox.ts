import type { GameEvent } from '../game/reducer';
import type { GameDataDocument } from '../game/upload';
import type { GameResult, Side } from '../game/types';

/**
 * Per-game outbox. Pure state transitions over JSON, so the store can persist the
 * state after every call. A row and its Idempotency-Key exist before any network
 * attempt, and a resend after a crash reuses the same key.
 *
 * The sender loop is: `nextToSend` -> `markSending` -> do the request ->
 * `onResponse`. Only one request per game is ever in flight, strictly in order.
 */

export type Method = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type RowOp =
  | 'goal'
  | 'delete_goal'
  | 'timeout'
  | 'spirit_stoppage'
  | 'score_tap'
  | 'roster'
  | 'metadata'
  | 'finalize'
  | 'upload';

export type RowStatus = 'pending' | 'sending' | 'sent' | 'failed';

export type OutboxRow = {
  /** The Idempotency-Key (UUID v4). */
  key: string;
  op: RowOp;
  /** The reducer event this row came from; null for a full upload. */
  event: GameEvent | null;
  method: Method;
  /** Path under `/api/v1`. */
  path: string;
  /** Null for DELETE and for finalize, whose body is built when sent. */
  body: unknown;
  /** Set on an upload row. */
  ifMatch?: string;
  status: RowStatus;
  attempts: number;
  createdAt: number;
  /** Set when sent. */
  serverNum?: number;
  error?: { status: number; code: string; path?: string; message: string };
};

export type PauseReason = 'conflict' | 'auth' | 'failed';

export type OutboxState = {
  gameId: number;
  rows: OutboxRow[];
  paused: { reason: PauseReason; rowKey: string | null; code: string } | null;
  /** The newest concurrency token the server returned. */
  token: string | null;
  /** The result the server last confirmed; the finalize body comes from it. */
  confirmedResult: GameResult | null;
  nextAttemptAt: number;
  /** The last attempt failed without an answer. */
  offline: boolean;
  /** The game was kept without a server, so only a full upload can sync it. */
  offlineOnly: boolean;
};

export function newOutbox(
  gameId: number,
  token: string | null,
  confirmedResult: GameResult | null,
  offlineOnly = false,
): OutboxState {
  return {
    gameId,
    rows: [],
    paused: null,
    token,
    confirmedResult,
    nextAttemptAt: 0,
    offline: false,
    offlineOnly,
  };
}

export const FALL_BEHIND_ROWS = 10;
export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 30_000;

export const backoffMs = (attempts: number): number =>
  Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));

/* ------------------------------------------------------------------ */
/* Requests                                                            */
/* ------------------------------------------------------------------ */

type RequestContext = { gameId: number; teamIds: Record<Side, number | null> };

type Req = Pick<OutboxRow, 'op' | 'method' | 'path' | 'body'>;

/** Maps a reducer event to its live API request. Returns null for events with no live route. */
export function requestFor(event: GameEvent, ctx: RequestContext): Req | null {
  const base = `/games/${ctx.gameId}`;
  switch (event.type) {
    case 'goal':
      return {
        op: 'goal',
        method: 'POST',
        path: `${base}/goals`,
        body: {
          side: event.side,
          scorer_id: event.scorerId,
          assist_id: event.assistId,
          callahan: event.callahan,
          time: event.time,
        },
      };
    case 'delete_last_goal':
      return {
        op: 'delete_goal',
        method: 'DELETE',
        path: `${base}/goals/${event.num}`,
        body: null,
      };
    case 'timeout':
      return {
        op: 'timeout',
        method: 'POST',
        path: `${base}/timeouts`,
        body: { side: event.side, time: event.time },
      };
    case 'spirit_stoppage':
      return {
        op: 'spirit_stoppage',
        method: 'POST',
        path: `${base}/spirit-stoppages`,
        body: { side: event.side, time: event.time },
      };
    case 'score_tap':
      return {
        op: 'score_tap',
        method: 'POST',
        path: `${base}/score-taps`,
        body: { side: event.side, delta: event.delta },
      };
    case 'roster': {
      const teamId = ctx.teamIds[event.side];
      if (teamId === null) return null;
      return {
        op: 'roster',
        method: 'PUT',
        path: `${base}/rosters/${event.side}`,
        body: { team_id: teamId, players: event.players },
      };
    }
    case 'metadata': {
      const body: Record<string, unknown> = {};
      if ('startingOffence' in event) body.starting_offence = event.startingOffence ?? null;
      if ('halftime' in event) body.halftime = event.halftime ?? null;
      if ('official' in event) body.official = event.official ?? null;
      return { op: 'metadata', method: 'PATCH', path: `${base}/metadata`, body };
    }
    case 'finalize':
      return { op: 'finalize', method: 'POST', path: `${base}/finalize`, body: null };
    case 'remove_timeout':
    case 'remove_spirit_stoppage':
      return null; // no live delete: corrected locally and synced by full upload
  }
}

/* ------------------------------------------------------------------ */
/* Enqueue                                                             */
/* ------------------------------------------------------------------ */

const newRow = (req: Req, event: GameEvent | null, key: string, now: number): OutboxRow => ({
  key,
  event,
  ...req,
  status: 'pending',
  attempts: 0,
  createdAt: now,
});

/**
 * Appends a row for the event. Returns the state unchanged when the event has no
 * live route (the caller then queues a full upload with `enqueueUpload`).
 */
export function enqueue(
  state: OutboxState,
  event: GameEvent,
  teamIds: RequestContext['teamIds'],
  key: string,
  now: number,
): OutboxState {
  const req = requestFor(event, { gameId: state.gameId, teamIds });
  if (!req) return state;
  return { ...state, rows: [...state.rows, newRow(req, event, key, now)] };
}

/** True when a request is in flight; a full upload must wait for it. */
export const hasInFlight = (state: OutboxState): boolean =>
  state.rows.some((r) => r.status === 'sending');

/**
 * Replaces every unsent row with one full upload (`PUT game-data`, `If-Match` =
 * the newest token). The document already contains the unsent events. Refused
 * while a request is in flight, since that request may or may not have landed.
 */
export function enqueueUpload(
  state: OutboxState,
  doc: GameDataDocument,
  key: string,
  now: number,
): OutboxState | null {
  if (hasInFlight(state) || state.token === null) return null;
  const kept = state.rows.filter((r) => r.status === 'sent');
  const req: Req = {
    op: 'upload',
    method: 'PUT',
    path: `/games/${state.gameId}/game-data`,
    body: doc,
  };
  const row: OutboxRow = { ...newRow(req, null, key, now), ifMatch: state.token };
  return { ...state, rows: [...kept, row], paused: null, nextAttemptAt: 0 };
}

/* ------------------------------------------------------------------ */
/* Sending                                                             */
/* ------------------------------------------------------------------ */

export type SendRequest = {
  key: string;
  method: Method;
  path: string;
  body: unknown;
  ifMatch?: string;
};

/**
 * The next request to send, or null when nothing is due: paused, a request is in
 * flight, the backoff has not elapsed, or nothing is pending. Finalize is sent only
 * when every earlier row is sent, which strict ordering guarantees, and only with a
 * score the server has confirmed.
 */
export function nextToSend(state: OutboxState, now: number): SendRequest | null {
  if (state.paused || hasInFlight(state) || now < state.nextAttemptAt) return null;
  const row = state.rows.find((r) => r.status === 'pending');
  if (!row) return null;
  let body = row.body;
  if (row.op === 'finalize') {
    const r = state.confirmedResult;
    if (!r) return null;
    body = { home: r.home, away: r.away };
  }
  return { key: row.key, method: row.method, path: row.path, body, ifMatch: row.ifMatch };
}

const update = (
  state: OutboxState,
  key: string,
  fn: (row: OutboxRow) => OutboxRow,
): OutboxState => ({ ...state, rows: state.rows.map((r) => (r.key === key ? fn(r) : r)) });

export function markSending(state: OutboxState, key: string): OutboxState {
  return update(state, key, (r) => ({ ...r, status: 'sending', attempts: r.attempts + 1 }));
}

export type Response =
  | {
      kind: 'ok';
      /** The new token (ETag). */
      token: string | null;
      /** `result` from the body: null before the game starts. */
      result: GameResult | null;
      /** `goal.num` of a created goal. */
      goalNum?: number;
    }
  | { kind: 'network' }
  | {
      kind: 'http';
      status: number;
      code: string;
      message?: string;
      path?: string;
      retryAfterSec?: number;
    };

const CONFLICT_CODES = new Set(['goal_changed', 'score_changed', 'fixture_changed', 'stale_token']);
const AUTH_CODES = new Set([
  'invalid_scorekeeping_token',
  'invalid_token',
  'unauthorized',
  'invalid_scope',
  'event_scope_mismatch',
  'game_not_covered',
  'event_readonly',
]);

/** Applies the outcome of the request for `key`. */
export function onResponse(
  state: OutboxState,
  key: string,
  res: Response,
  now: number,
): OutboxState {
  const row = state.rows.find((r) => r.key === key);
  if (!row) return state;
  const retry = (delayMs: number, offline: boolean): OutboxState => ({
    ...update(state, key, (r) => ({ ...r, status: 'pending' })),
    nextAttemptAt: now + delayMs,
    offline,
  });

  if (res.kind === 'ok') {
    const s = update(state, key, (r) => ({
      ...r,
      status: 'sent',
      serverNum: res.goalNum ?? r.serverNum,
    }));
    return {
      ...s,
      token: res.token ?? s.token,
      confirmedResult: res.result,
      nextAttemptAt: 0,
      offline: false,
    };
  }
  if (res.kind === 'network') return retry(backoffMs(row.attempts), true);

  const { status, code } = res;
  if (status === 429 || status === 503) {
    const wait =
      res.retryAfterSec !== undefined ? res.retryAfterSec * 1000 : backoffMs(row.attempts);
    return retry(wait, false);
  }
  if (status >= 500) return retry(backoffMs(row.attempts), false);
  if (status === 409 && CONFLICT_CODES.has(code)) {
    return {
      ...update(state, key, (r) => ({ ...r, status: 'pending' })),
      paused: { reason: 'conflict', rowKey: key, code },
      offline: false,
    };
  }
  if (status === 401 || (status === 403 && AUTH_CODES.has(code)) || AUTH_CODES.has(code)) {
    return {
      ...update(state, key, (r) => ({ ...r, status: 'pending' })),
      paused: { reason: 'auth', rowKey: key, code },
      offline: false,
    };
  }
  // Any other 4xx: the server refused this row. Show it inline and stop, because
  // later rows were made on top of it.
  return {
    ...update(state, key, (r) => ({
      ...r,
      status: 'failed',
      error: { status, code, path: res.path, message: res.message ?? code },
    })),
    paused: { reason: 'failed', rowKey: key, code },
    offline: false,
  };
}

/** After a crash or relaunch a request may have been in flight: resend it with the same key. */
export function recover(state: OutboxState): OutboxState {
  if (!state.rows.some((r) => r.status === 'sending')) return state;
  return {
    ...state,
    rows: state.rows.map((r) => (r.status === 'sending' ? { ...r, status: 'pending' } : r)),
    nextAttemptAt: 0,
  };
}

/** Clears an auth pause after the user fixed the credentials. */
export function resumeAfterAuth(state: OutboxState): OutboxState {
  return state.paused?.reason === 'auth' ? { ...state, paused: null, nextAttemptAt: 0 } : state;
}

/* ------------------------------------------------------------------ */
/* Conflicts and failures                                              */
/* ------------------------------------------------------------------ */

/**
 * "Keep the server version": drops every unsent row, takes the fresh token and
 * result from a refetched entry context, and resumes. The caller rebuilds local
 * state from that entry context.
 */
export function keepServerVersion(
  state: OutboxState,
  fresh: { token: string; result: GameResult | null },
): OutboxState {
  return {
    ...state,
    rows: state.rows.filter((r) => r.status === 'sent'),
    token: fresh.token,
    confirmedResult: fresh.result,
    paused: null,
    nextAttemptAt: 0,
    offline: false,
  };
}

/**
 * "Upload my version": takes the fresh token and queues a new full upload (new
 * key). The caller passes the document built from local state.
 */
export function uploadMyVersion(
  state: OutboxState,
  fresh: { token: string; result: GameResult | null },
  doc: GameDataDocument,
  key: string,
  now: number,
): OutboxState | null {
  const refreshed: OutboxState = { ...state, token: fresh.token, confirmedResult: fresh.result };
  return enqueueUpload(refreshed, doc, key, now);
}

/** Drops a failed row and resumes. The caller rebuilds local state without its event. */
export function discardFailed(state: OutboxState, key: string): OutboxState {
  const row = state.rows.find((r) => r.key === key);
  if (!row || row.status !== 'failed') return state;
  return {
    ...state,
    rows: state.rows.filter((r) => r.key !== key),
    paused: state.paused?.rowKey === key ? null : state.paused,
    nextAttemptAt: 0,
  };
}

/** Retries a failed row once the user changed something (new attempt, same key and body). */
export function retryFailed(state: OutboxState, key: string): OutboxState {
  return {
    ...update(state, key, (r) => ({ ...r, status: 'pending', error: undefined })),
    paused: state.paused?.rowKey === key ? null : state.paused,
    nextAttemptAt: 0,
  };
}

/* ------------------------------------------------------------------ */
/* Undo                                                                */
/* ------------------------------------------------------------------ */

export type UndoPlan =
  /** Not sent yet: drop the row. */
  | { kind: 'drop' }
  /** A sent goal that is still the last goal: queue `DELETE goals/{num}`. */
  | { kind: 'delete_goal'; num: number }
  /** A sent timeout, spirit stoppage or older goal: correct locally and sync by full upload. */
  | { kind: 'full_upload' }
  /** A score tap is undone by a -1 tap, a roster or metadata change by a new write. */
  | { kind: 'inverse' }
  /** The row is in flight: wait for the answer. */
  | { kind: 'wait' }
  | { kind: 'unknown_row' };

export function planUndo(state: OutboxState, key: string): UndoPlan {
  const idx = state.rows.findIndex((r) => r.key === key);
  if (idx < 0) return { kind: 'unknown_row' };
  const row = state.rows[idx];
  if (row.status === 'sending') return { kind: 'wait' };
  if (row.status === 'pending' || row.status === 'failed') return { kind: 'drop' };
  switch (row.op) {
    case 'goal': {
      const later = state.rows.slice(idx + 1);
      const stillLast =
        row.serverNum !== undefined &&
        !later.some((r) => r.op === 'goal' || r.op === 'upload' || r.op === 'delete_goal');
      return stillLast ? { kind: 'delete_goal', num: row.serverNum! } : { kind: 'full_upload' };
    }
    case 'score_tap':
    case 'roster':
    case 'metadata':
      return { kind: 'inverse' };
    case 'delete_goal':
    case 'finalize':
    case 'timeout':
    case 'spirit_stoppage':
    case 'upload':
      return { kind: 'full_upload' };
  }
}

/** Drops an unsent row. The caller replays the remaining events to confirm they still apply. */
export function dropRow(state: OutboxState, key: string): OutboxState {
  const row = state.rows.find((r) => r.key === key);
  if (!row || (row.status !== 'pending' && row.status !== 'failed')) return state;
  return { ...state, rows: state.rows.filter((r) => r.key !== key) };
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

export type SyncStatus =
  | { kind: 'synced' }
  | { kind: 'sending' }
  | { kind: 'offline'; queued: number }
  | { kind: 'attention'; reason: PauseReason }
  | { kind: 'queued'; queued: number };

export const unsentRows = (state: OutboxState): OutboxRow[] =>
  state.rows.filter(
    (r) => r.status === 'pending' || r.status === 'sending' || r.status === 'failed',
  );

export function syncStatus(state: OutboxState): SyncStatus {
  if (state.paused) return { kind: 'attention', reason: state.paused.reason };
  const unsent = unsentRows(state);
  if (state.offline && unsent.length) return { kind: 'offline', queued: unsent.length };
  if (hasInFlight(state)) return { kind: 'sending' };
  if (unsent.length) return { kind: 'queued', queued: unsent.length };
  return { kind: 'synced' };
}

/** More than about 10 unsent rows, or a game kept without a server: offer a full upload. */
export function shouldOfferUpload(state: OutboxState): boolean {
  return state.offlineOnly || unsentRows(state).length > FALL_BEHIND_ROWS;
}

/** The end-of-game screen blocks until this is true, or offers to save and retry. */
export const isFullySynced = (state: OutboxState): boolean =>
  !state.paused && unsentRows(state).length === 0;
