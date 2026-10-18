import { newOutbox, markSending, onResponse, nextToSend, type OutboxState } from '../sync/outbox';
import { entryContextFixture } from './fixtures';
import { applyEvent, undoLastGoal, uploadAll, type GameSession } from './runtime';
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
function send(o: OutboxState, goalNum?: number): OutboxState {
  const req = nextToSend(o, 0)!;
  return onResponse(
    markSending(o, req.key),
    req.key,
    { kind: 'ok', token: 't' + req.key, result: { home: 1, away: 0, state: 'ongoing' }, goalNum },
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
