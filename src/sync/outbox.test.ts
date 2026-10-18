import type { GameEvent } from '../game/reducer';
import type { GameDataDocument } from '../game/upload';
import {
  BACKOFF_MAX_MS,
  type OutboxState,
  backoffMs,
  discardFailed,
  dropRow,
  enqueue,
  enqueueUpload,
  isFullySynced,
  keepServerVersion,
  markSending,
  newOutbox,
  nextToSend,
  onResponse,
  planUndo,
  recover,
  retryFailed,
  shouldOfferUpload,
  syncStatus,
  uploadMyVersion,
} from './outbox';

const teams = { home: 90300, away: 90301 };
const goalEv = (time: number): GameEvent => ({
  type: 'goal',
  side: 'home',
  scorerId: 1,
  assistId: 2,
  callahan: false,
  time,
});
const doc = { version: 1 } as unknown as GameDataDocument;
let n = 0;
const key = () => `key-${++n}`;

const fresh = () => newOutbox(123, 'tok0', null);
const add = (s: OutboxState, ev: GameEvent, now = 0) => enqueue(s, ev, teams, key(), now);
const ok = (token: string, extra: object = {}) =>
  ({
    kind: 'ok',
    token,
    result: { home: 1, away: 0, state: 'ongoing' as const },
    ...extra,
  }) as const;

/** Sends the next due request and applies the answer. */
function step(s: OutboxState, res: Parameters<typeof onResponse>[2], now = 0) {
  const req = nextToSend(s, now);
  if (!req) throw new Error('nothing to send');
  return { req, state: onResponse(markSending(s, req.key), req.key, res, now) };
}

beforeEach(() => {
  n = 0;
});

describe('enqueue and requests', () => {
  it('writes the row with its key before any send', () => {
    const s = add(fresh(), goalEv(10));
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0]).toMatchObject({
      key: 'key-1',
      op: 'goal',
      method: 'POST',
      path: '/games/123/goals',
      status: 'pending',
      attempts: 0,
      body: { side: 'home', scorer_id: 1, assist_id: 2, callahan: false, time: 10 },
    });
  });

  it('maps each event to its route', () => {
    const cases: [GameEvent, string, string][] = [
      [{ type: 'delete_last_goal', num: 4 }, 'DELETE', '/games/123/goals/4'],
      [{ type: 'timeout', side: 'away', time: 5 }, 'POST', '/games/123/timeouts'],
      [{ type: 'spirit_stoppage', side: 'away', time: 5 }, 'POST', '/games/123/spirit-stoppages'],
      [{ type: 'score_tap', side: 'home', delta: -1 }, 'POST', '/games/123/score-taps'],
      [{ type: 'roster', side: 'away', players: [] }, 'PUT', '/games/123/rosters/away'],
      [{ type: 'metadata', halftime: 1500 }, 'PATCH', '/games/123/metadata'],
      [{ type: 'finalize' }, 'POST', '/games/123/finalize'],
    ];
    for (const [ev, method, path] of cases) {
      expect(add(fresh(), ev).rows[0]).toMatchObject({ method, path });
    }
  });

  it('sends only the metadata fields that changed, snake_case', () => {
    const s = add(fresh(), { type: 'metadata', startingOffence: 'away', official: null });
    expect(s.rows[0].body).toEqual({ starting_offence: 'away', official: null });
  });

  it('adds the side team id to a roster write', () => {
    const s = add(fresh(), { type: 'roster', side: 'away', players: [] });
    expect(s.rows[0].body).toEqual({ team_id: 90301, players: [] });
  });

  it('queues nothing for local-only corrections', () => {
    const s = add(fresh(), { type: 'remove_timeout', side: 'home', index: 0 });
    expect(s.rows).toEqual([]);
  });
});

describe('sending', () => {
  it('sends strictly in order, one at a time', () => {
    let s = add(add(fresh(), goalEv(1)), goalEv(2));
    const first = nextToSend(s, 0)!;
    expect(first.key).toBe('key-1');
    s = markSending(s, first.key);
    expect(nextToSend(s, 0)).toBeNull(); // in flight
    s = onResponse(s, first.key, ok('tok1', { goalNum: 1 }), 0);
    expect(nextToSend(s, 0)!.key).toBe('key-2');
  });

  it('stores the token, result and goal number on success', () => {
    const s = step(add(fresh(), goalEv(1)), ok('tok1', { goalNum: 1 })).state;
    expect(s.rows[0]).toMatchObject({ status: 'sent', serverNum: 1 });
    expect(s.token).toBe('tok1');
    expect(s.confirmedResult).toEqual({ home: 1, away: 0, state: 'ongoing' });
    expect(syncStatus(s)).toEqual({ kind: 'synced' });
  });

  it('retries a network error with the same key and growing backoff', () => {
    let s = add(fresh(), goalEv(1));
    let now = 0;
    const delays: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = step(s, { kind: 'network' }, now);
      expect(r.req.key).toBe('key-1');
      s = r.state;
      delays.push(s.nextAttemptAt - now);
      expect(nextToSend(s, now)).toBeNull(); // still backing off
      now = s.nextAttemptAt;
    }
    expect(delays).toEqual([1000, 2000, 4000]);
    expect(syncStatus(s)).toEqual({ kind: 'offline', queued: 1 });
    expect(s.rows[0].attempts).toBe(3);
  });

  it('caps the backoff', () => {
    expect(backoffMs(1)).toBe(1000);
    expect(backoffMs(20)).toBe(BACKOFF_MAX_MS);
  });

  it('waits for Retry-After on 429 and 503', () => {
    for (const status of [429, 503]) {
      const s = step(
        add(fresh(), goalEv(1)),
        { kind: 'http', status, code: 'busy', retryAfterSec: 7 },
        1000,
      ).state;
      expect(s.nextAttemptAt).toBe(8000);
      expect(s.rows[0].status).toBe('pending');
      expect(s.offline).toBe(false);
    }
  });

  it('retries a 5xx like a network error, without pausing', () => {
    const s = step(add(fresh(), goalEv(1)), { kind: 'http', status: 500, code: 'internal' }).state;
    expect(s.paused).toBeNull();
    expect(s.rows[0].status).toBe('pending');
  });

  it('reuses the key after a crash while sending', () => {
    let s = add(fresh(), goalEv(1));
    s = markSending(s, 'key-1');
    expect(syncStatus(s)).toEqual({ kind: 'sending' });
    s = recover(JSON.parse(JSON.stringify(s)));
    expect(nextToSend(s, 0)).toMatchObject({ key: 'key-1', method: 'POST' });
  });
});

describe('conflicts', () => {
  const conflict = (code: string) => ({ kind: 'http', status: 409, code }) as const;
  const conflicted = () => {
    let s = add(add(fresh(), goalEv(1)), goalEv(2));
    s = step(s, conflict('goal_changed')).state;
    return s;
  };

  it.each(['goal_changed', 'score_changed', 'fixture_changed'])('%s pauses the queue', (code) => {
    const s = step(add(fresh(), goalEv(1)), conflict(code)).state;
    expect(s.paused).toEqual({ reason: 'conflict', rowKey: 'key-1', code });
    expect(nextToSend(s, 1e9)).toBeNull();
    expect(syncStatus(s)).toEqual({ kind: 'attention', reason: 'conflict' });
  });

  it('keep the server version drops unsent rows and resumes', () => {
    const s = keepServerVersion(conflicted(), {
      token: 'tok9',
      result: { home: 0, away: 2, state: 'ongoing' },
    });
    expect(s.rows).toEqual([]);
    expect(s).toMatchObject({ token: 'tok9', paused: null });
    expect(s.confirmedResult).toEqual({ home: 0, away: 2, state: 'ongoing' });
  });

  it('upload my version replaces unsent rows with one PUT using the fresh token and a new key', () => {
    const s = uploadMyVersion(conflicted(), { token: 'tok9', result: null }, doc, 'up-1', 5)!;
    expect(s.paused).toBeNull();
    expect(s.rows).toHaveLength(1);
    expect(nextToSend(s, 5)).toEqual({
      key: 'up-1',
      method: 'PUT',
      path: '/games/123/game-data',
      body: doc,
      ifMatch: 'tok9',
    });
  });

  it('a stale upload pauses for a refetch, and a second upload gets a new key', () => {
    let s = enqueueUpload(fresh(), doc, 'up-1', 0)!;
    s = step(s, conflict('stale_token')).state;
    expect(s.paused?.code).toBe('stale_token');
    s = uploadMyVersion(s, { token: 'tok2', result: null }, doc, 'up-2', 1)!;
    expect(nextToSend(s, 1)).toMatchObject({ key: 'up-2', ifMatch: 'tok2' });
  });

  it('refuses an upload while a request is in flight', () => {
    const s = markSending(add(fresh(), goalEv(1)), 'key-1');
    expect(enqueueUpload(s, doc, 'up', 0)).toBeNull();
  });

  it('refuses an upload without a token', () => {
    expect(enqueueUpload(newOutbox(123, null, null, true), doc, 'up', 0)).toBeNull();
  });
});

describe('other failures', () => {
  it('marks a refused row failed with the server path and pauses', () => {
    const s = step(add(fresh(), goalEv(1)), {
      kind: 'http',
      status: 400,
      code: 'validation_failed',
      message: 'Goal times must not go backwards.',
      path: 'time',
    }).state;
    expect(s.rows[0]).toMatchObject({
      status: 'failed',
      error: { status: 400, code: 'validation_failed', path: 'time' },
    });
    expect(syncStatus(s)).toEqual({ kind: 'attention', reason: 'failed' });
    expect(isFullySynced(s)).toBe(false);
  });

  it('discard drops the failed row and resumes with the rest', () => {
    let s = add(add(fresh(), goalEv(1)), goalEv(2));
    s = step(s, { kind: 'http', status: 409, code: 'timeout_limit' }).state;
    s = discardFailed(s, 'key-1');
    expect(s.paused).toBeNull();
    expect(nextToSend(s, 0)!.key).toBe('key-2');
  });

  it('retry keeps the key and body', () => {
    let s = step(add(fresh(), goalEv(1)), { kind: 'http', status: 409, code: 'game_final' }).state;
    s = retryFailed(s, 'key-1');
    expect(nextToSend(s, 0)).toMatchObject({ key: 'key-1' });
  });

  it('pauses on a bad link or app token until credentials are fixed', () => {
    for (const [status, code] of [
      [401, 'invalid_scorekeeping_token'],
      [403, 'invalid_scope'],
    ] as const) {
      const s = step(add(fresh(), goalEv(1)), { kind: 'http', status, code }).state;
      expect(s.paused).toMatchObject({ reason: 'auth' });
      expect(s.rows[0].status).toBe('pending');
    }
  });
});

describe('finalize', () => {
  const finalizeAfterGoal = () => {
    let s = add(fresh(), goalEv(1));
    s = add(s, { type: 'finalize' });
    return s;
  };

  it('is sent only after earlier rows, with the score the server confirmed', () => {
    let s = finalizeAfterGoal();
    s = step(s, ok('tok1', { goalNum: 1 })).state;
    expect(nextToSend(s, 0)).toMatchObject({
      method: 'POST',
      path: '/games/123/finalize',
      body: { home: 1, away: 0 },
    });
  });

  it('waits while no score is confirmed', () => {
    const s = add(fresh(), { type: 'finalize' });
    expect(nextToSend(s, 0)).toBeNull();
  });

  it('reports fully synced only when the outbox is empty', () => {
    let s = finalizeAfterGoal();
    expect(isFullySynced(s)).toBe(false);
    s = step(s, ok('tok1', { goalNum: 1 })).state;
    s = step(s, { kind: 'ok', token: 'tok2', result: { home: 1, away: 0, state: 'final' } }).state;
    expect(isFullySynced(s)).toBe(true);
  });
});

describe('undo', () => {
  const sent = (s: OutboxState, ev: GameEvent, goalNum?: number) => {
    const r = step(add(s, ev), ok('t' + n, goalNum ? { goalNum } : {}));
    return r.state;
  };

  it('drops an unsent row', () => {
    let s = add(fresh(), goalEv(1));
    expect(planUndo(s, 'key-1')).toEqual({ kind: 'drop' });
    s = dropRow(s, 'key-1');
    expect(s.rows).toEqual([]);
  });

  it('does not drop a sent row', () => {
    const s = sent(fresh(), goalEv(1), 1);
    expect(dropRow(s, 'key-1')).toBe(s);
  });

  it('waits for a request in flight', () => {
    const s = markSending(add(fresh(), goalEv(1)), 'key-1');
    expect(planUndo(s, 'key-1')).toEqual({ kind: 'wait' });
  });

  it('deletes a sent goal that is still the last goal, by its server number', () => {
    const s = sent(fresh(), goalEv(1), 7);
    expect(planUndo(s, 'key-1')).toEqual({ kind: 'delete_goal', num: 7 });
  });

  it('needs a full upload for an older goal', () => {
    let s = sent(fresh(), goalEv(1), 1);
    s = sent(s, goalEv(2), 2);
    expect(planUndo(s, 'key-1')).toEqual({ kind: 'full_upload' });
    expect(planUndo(s, 'key-2')).toEqual({ kind: 'delete_goal', num: 2 });
  });

  it('needs a full upload for a goal whose server number is unknown, and after a pending goal', () => {
    let s = sent(fresh(), goalEv(1));
    expect(planUndo(s, 'key-1')).toEqual({ kind: 'full_upload' });
    n = 0;
    s = sent(fresh(), goalEv(1), 1);
    s = add(s, goalEv(2));
    expect(planUndo(s, 'key-1')).toEqual({ kind: 'full_upload' });
  });

  it('needs a full upload for a sent timeout or spirit stoppage', () => {
    let s = sent(fresh(), { type: 'timeout', side: 'home', time: 5 });
    s = sent(s, { type: 'spirit_stoppage', side: 'home', time: 6 });
    expect(planUndo(s, 'key-1')).toEqual({ kind: 'full_upload' });
    expect(planUndo(s, 'key-2')).toEqual({ kind: 'full_upload' });
  });

  it('undoes taps, rosters and metadata with a new write', () => {
    let s = sent(fresh(), { type: 'score_tap', side: 'home', delta: 1 });
    s = sent(s, { type: 'metadata', halftime: 5 });
    expect(planUndo(s, 'key-1')).toEqual({ kind: 'inverse' });
    expect(planUndo(s, 'key-2')).toEqual({ kind: 'inverse' });
  });

  it('knows nothing of an unknown key', () => {
    expect(planUndo(fresh(), 'nope')).toEqual({ kind: 'unknown_row' });
  });
});

describe('fall-behind', () => {
  it('offers a full upload past 10 unsent rows or when kept offline', () => {
    let s = fresh();
    for (let i = 0; i < 10; i++) s = add(s, { type: 'timeout', side: 'home', time: i });
    expect(shouldOfferUpload(s)).toBe(false);
    s = add(s, { type: 'timeout', side: 'away', time: 99 });
    expect(shouldOfferUpload(s)).toBe(true);
    expect(shouldOfferUpload(newOutbox(1, 't', null, true))).toBe(true);
  });

  it('reports queued rows when online and waiting', () => {
    expect(syncStatus(add(fresh(), goalEv(1)))).toEqual({ kind: 'queued', queued: 1 });
  });
});
