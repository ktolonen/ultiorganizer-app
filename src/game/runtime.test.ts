import { newOutbox, markSending, onResponse, nextToSend, type OutboxState } from '../sync/outbox';
import { entryContextFixture } from './fixtures';
import {
  applyEvent,
  refreshEligible,
  resolveNeedsUpload,
  undoLastGoal,
  uploadAll,
  type GameSession,
} from './runtime';
import { fromEntryContext, type GameEvent } from './reducer';

let k = 0;
const deps = () => ({ now: 1, newKey: () => `k${++k}` });

function session(offlineOnly = false): GameSession {
  const context = entryContextFixture();
  return {
    serverId: 1,
    gameId: 123,
    title: 't',
    context,
    state: fromEntryContext(context),
    outbox: newOutbox(123, context.token, null, offlineOnly),
  };
}
const goal = (time: number): GameEvent => ({
  type: 'goal',
  side: 'home',
  scorerId: 1,
  assistId: 2,
  callahan: false,
  time,
});

function must(r: ReturnType<typeof applyEvent>): GameSession {
  if (!r.ok) throw new Error(r.error.code);
  return r.session;
}

/** Marks a row sent as the server would, with a goal number. */
function send(o: OutboxState, num?: number): OutboxState {
  const req = nextToSend(o, 0)!;
  return onResponse(
    markSending(o, req.key),
    req.key,
    { kind: 'ok', token: 't' + req.key, result: { home: 1, away: 0, state: 'ongoing' }, num },
    0,
  );
}

beforeEach(() => {
  k = 0;
});

describe('applyEvent', () => {
  it('updates state and queues one row per accepted event', () => {
    const s = must(applyEvent(session(), goal(10), deps()));
    expect(s.state.goals).toHaveLength(1);
    expect(s.outbox.rows.map((r) => [r.key, r.op])).toEqual([['k1', 'goal']]);
  });
  it('queues nothing for a refused event', () => {
    const r = applyEvent(session(), goal(-5), deps());
    expect(r.ok).toBe(false);
  });
  it('records state only in an offline-only game', () => {
    const s = must(applyEvent(session(true), goal(10), deps()));
    expect(s.state.goals).toHaveLength(1);
    expect(s.outbox.rows).toEqual([]);
  });
  it('removing an older timeout corrects locally and queues a full upload', () => {
    let s = must(applyEvent(session(), { type: 'timeout', side: 'home', time: 5 }, deps()));
    s = must(applyEvent(s, { type: 'timeout', side: 'home', time: 9 }, deps()));
    s = { ...s, outbox: send(send(s.outbox)) };
    s = must(applyEvent(s, { type: 'remove_timeout', side: 'home', index: 0 }, deps()));
    expect(s.state.timeouts.home).toEqual([{ time: 9 }]);
    const up = s.outbox.rows.find((r) => r.op === 'upload')!;
    expect(up).toMatchObject({ method: 'PUT', path: '/games/123/game-data' });
    expect((up.body as { timeouts: { home: unknown[] } }).timeouts.home).toHaveLength(1);
  });
  it('refuses a correction while a request is in flight', () => {
    let s = must(applyEvent(session(), { type: 'timeout', side: 'home', time: 5 }, deps()));
    s = { ...s, outbox: markSending(s.outbox, 'k1') };
    expect(applyEvent(s, { type: 'remove_timeout', side: 'home', index: 0 }, deps())).toMatchObject(
      { ok: false, error: { code: 'busy' } },
    );
  });
});

describe('undoLastGoal', () => {
  it('drops an unsent goal without touching the server', () => {
    let s = must(applyEvent(session(), goal(10), deps()));
    s = must(undoLastGoal(s, deps()));
    expect(s.state.goals).toEqual([]);
    expect(s.outbox.rows).toEqual([]);
  });
  it('queues DELETE with the server number for a sent last goal', () => {
    let s = must(applyEvent(session(), goal(10), deps()));
    s = { ...s, outbox: send(s.outbox, 7) };
    s = must(undoLastGoal(s, deps()));
    expect(s.state.goals).toEqual([]);
    expect(s.outbox.rows.at(-1)).toMatchObject({
      op: 'delete_goal',
      method: 'DELETE',
      path: '/games/123/goals/7',
      status: 'pending',
    });
  });
  it('undoes consecutive goals newest first', () => {
    let s = must(applyEvent(session(), goal(10), deps()));
    s = { ...s, outbox: send(s.outbox, 1) };
    s = must(applyEvent(s, goal(20), deps()));
    s = { ...s, outbox: send(s.outbox, 2) };
    s = must(undoLastGoal(s, deps())); // goal 2, still last: DELETE
    expect(s.outbox.rows.at(-1)?.op).toBe('delete_goal');
    s = { ...s, outbox: send(s.outbox) };
    s = must(undoLastGoal(s, deps())); // goal 1 now last locally, server confirmed delete of 2: its row is not "later"
    expect(s.state.goals).toEqual([]);
  });
  it('has no goal to undo', () => {
    expect(undoLastGoal(session(), deps())).toMatchObject({ ok: false });
  });
  it('waits for a goal in flight', () => {
    let s = must(applyEvent(session(), goal(10), deps()));
    s = { ...s, outbox: markSending(s.outbox, 'k1') };
    expect(undoLastGoal(s, deps())).toMatchObject({ ok: false, error: { code: 'busy' } });
  });
});

describe('uploadAll', () => {
  it('replaces unsent rows with one upload using the latest token', () => {
    let s = must(applyEvent(session(), goal(10), deps()));
    s = must(applyEvent(s, goal(20), deps()));
    s = must(uploadAll(s, deps()));
    expect(s.outbox.rows.map((r) => r.op)).toEqual(['upload']);
    expect(s.outbox.rows[0].ifMatch).toBe('tok0');
  });
  it('works for an offline-only game (the only way it syncs)', () => {
    let s = must(applyEvent(session(true), goal(10), deps()));
    s = must(uploadAll(s, deps()));
    expect(s.outbox.rows).toHaveLength(1);
  });
});

describe('refreshEligible', () => {
  const withPlayers = (home: number[], away: number[]) => {
    const base = entryContextFixture();
    const p = (id: number) => ({ player_id: id, name: `Player ${id}`, number: id });
    return entryContextFixture({
      home: { ...base.home, eligible_players: home.map(p) },
      away: { ...base.away, eligible_players: away.map(p) },
    });
  };

  it('adds players the server lists now, leaving rosters, goals and outbox alone', () => {
    const s = must(applyEvent(session(), goal(10), deps()));
    const next = refreshEligible(s, withPlayers([1, 2, 3, 4, 5], [11, 12, 13, 14]));
    expect(next.state.eligible.home.map((p) => p.player_id)).toEqual([1, 2, 3, 4, 5]);
    expect(next.state.eligible.away.map((p) => p.player_id)).toEqual([11, 12, 13, 14]);
    expect(next.context.home.eligible_players).toEqual(next.state.eligible.home);
    expect(next.state.rosters).toEqual(s.state.rosters);
    expect(next.state.goals).toEqual(s.state.goals);
    expect(next.outbox).toBe(s.outbox);
  });

  it('keeps a player the server dropped while a local roster uses them', () => {
    const next = refreshEligible(session(), withPlayers([2, 3, 4], [11, 12, 13]));
    expect(next.state.eligible.home.map((p) => p.player_id)).toEqual([2, 3, 4, 1]);
    // The roster still validates against the merged list.
    const r = applyEvent(
      next,
      { type: 'roster', side: 'home', players: next.state.rosters.home },
      deps(),
    );
    expect(r.ok).toBe(true);
  });

  it('drops a player nobody uses and returns the same session when nothing changed', () => {
    const s = session();
    expect(refreshEligible(s, entryContextFixture())).toBe(s);
    const next = refreshEligible(s, withPlayers([1, 2, 3], [11, 12, 13]));
    expect(next.state.eligible.home.map((p) => p.player_id)).toEqual([1, 2, 3]);
  });

  it('skips a side whose team changed on the server, and another game entirely', () => {
    const s = session();
    const base = withPlayers([1, 2, 3, 4, 5], [11, 12, 13]);
    const otherTeam = { ...base, home: { ...base.home, team_id: 999 } };
    expect(refreshEligible(s, otherTeam)).toBe(s);
    const otherGame = { ...base, game: { ...base.game, game_id: 999 } };
    expect(refreshEligible(s, otherGame)).toBe(s);
  });
});

describe('caps', () => {
  const capEv: GameEvent = { type: 'cap', cap: 'half_cap', time: 1500, pointCap: 8 };
  it('queues a cap write', () => {
    const s = must(applyEvent(session(), capEv, deps()));
    expect(s.state.caps.half_cap).toEqual({ time: 1500, pointCap: 8 });
    expect(s.outbox.rows.map((r) => r.op)).toEqual(['cap']);
  });
  it('keeps caps on the phone once the server is known to lack the route', () => {
    const base = session();
    const s = must(
      applyEvent({ ...base, outbox: { ...base.outbox, capsAbsent: true } }, capEv, deps()),
    );
    expect(s.state.caps.half_cap).toBeDefined();
    expect(s.outbox.rows).toEqual([]);
  });
});

describe('corrections through the live routes', () => {
  const timeout = (time: number): GameEvent => ({ type: 'timeout', side: 'home', time });
  const removeLast = (index: number): GameEvent => ({
    type: 'remove_timeout',
    side: 'home',
    index,
  });

  it("deletes the team's last sent timeout by the server's number", () => {
    let s = must(applyEvent(session(), timeout(5), deps()));
    s = { ...s, outbox: send(s.outbox, 4) };
    s = must(applyEvent(s, removeLast(0), deps()));
    expect(s.state.timeouts.home).toEqual([]);
    expect(s.outbox.rows.at(-1)).toMatchObject({
      op: 'delete_timeout',
      method: 'DELETE',
      path: '/games/123/timeouts/home/4',
      body: null,
    });
  });
  it('numbers an entry from the entry context by its position', () => {
    const ctx = entryContextFixture({
      spirit_stoppages: { home: [], away: [{ time: 3 }, { time: 7 }] },
    });
    const base = { ...session(), context: ctx, state: fromEntryContext(ctx) };
    const s = must(
      applyEvent(base, { type: 'remove_spirit_stoppage', side: 'away', index: 1 }, deps()),
    );
    expect(s.outbox.rows.map((r) => r.path)).toEqual(['/games/123/spirit-stoppages/away/2']);
  });
  it('drops an unsent timeout row instead of sending anything', () => {
    let s = must(applyEvent(session(), timeout(5), deps()));
    s = must(applyEvent(s, removeLast(0), deps()));
    expect(s.outbox.rows).toEqual([]);
  });
  it('uploads when the server has no correction routes', () => {
    let s = must(applyEvent(session(), timeout(5), deps()));
    s = { ...s, outbox: { ...send(s.outbox, 1), correctionsAbsent: true } };
    s = must(applyEvent(s, removeLast(0), deps()));
    expect(s.outbox.rows.at(-1)?.op).toBe('upload');
  });
  it('patches a sent goal with the changed fields only, by its server number', () => {
    let s = must(applyEvent(session(), goal(10), deps()));
    expect(s.outbox.rows[0].localNum).toBe(1);
    s = { ...s, outbox: send(s.outbox, 7) };
    s = must(
      applyEvent(
        s,
        { type: 'correct_goal', num: 1, scorerId: 3, assistId: 2, callahan: false },
        deps(),
      ),
    );
    expect(s.outbox.rows.at(-1)).toMatchObject({
      op: 'correct_goal',
      method: 'PATCH',
      path: '/games/123/goals/7',
      body: { scorer_id: 3 },
    });
  });
  it('rewrites an unsent goal row instead of queuing a correction', () => {
    let s = must(applyEvent(session(), goal(10), deps()));
    s = must(
      applyEvent(
        s,
        { type: 'correct_goal', num: 1, scorerId: 3, assistId: null, callahan: true },
        deps(),
      ),
    );
    expect(s.outbox.rows).toHaveLength(1);
    expect(s.outbox.rows[0].body).toMatchObject({ scorer_id: 3, assist_id: null, callahan: true });
    expect(s.outbox.rows[0].event).toMatchObject({ scorerId: 3, callahan: true });
  });
  it('replaces the queue with a full upload when the server cannot make a correction', () => {
    let s = must(applyEvent(session(), timeout(5), deps()));
    s = { ...s, outbox: send(s.outbox, 1) };
    s = must(applyEvent(s, removeLast(0), deps()));
    const req = nextToSend(s.outbox, 0)!;
    const outbox = onResponse(
      markSending(s.outbox, req.key),
      req.key,
      { kind: 'http', status: 404, code: 'not_found' },
      0,
    );
    expect(outbox.paused?.reason).toBe('needs_upload');
    expect(outbox.correctionsAbsent).toBe(true);
    const next = resolveNeedsUpload({ ...s, outbox }, deps());
    expect(next.outbox.paused).toBeNull();
    expect(next.outbox.rows.map((r) => [r.op, r.status])).toEqual([
      ['timeout', 'sent'],
      ['upload', 'pending'],
    ]);
  });
});

describe('note', () => {
  it('queues a note, or keeps it on the phone once the server refused notes', () => {
    const s = must(applyEvent(session(), { type: 'note', text: 'x' }, deps()));
    expect(s.outbox.rows.map((r) => r.op)).toEqual(['note']);
    const refused = {
      ...session(),
      outbox: { ...session().outbox, noteRefused: 'user_token_required' as const },
    };
    const t = must(applyEvent(refused, { type: 'note', text: 'x' }, deps()));
    expect(t.state.note).toBe('x');
    expect(t.outbox.rows).toEqual([]);
  });
});
