import type { GameEvent } from '../game/reducer';
import { enqueue, newOutbox, type OutboxState, type Response, syncStatus } from './outbox';
import { drain } from './sender';

const teams = { home: 1, away: 2 };
const timeout = (time: number): GameEvent => ({ type: 'timeout', side: 'home', time });
const ok: Response = { kind: 'ok', token: 't', result: null };

function setup(count: number) {
  let s = newOutbox(9, 't0', null);
  for (let i = 1; i <= count; i++) s = enqueue(s, timeout(i), teams, `k${i}`, 0);
  return s;
}

/** A mutable outbox cell, like the hook's ref. */
function cell(initial: OutboxState) {
  const saved: OutboxState[] = [];
  const box = {
    state: initial,
    saved,
    get: () => box.state,
    set: (s: OutboxState) => {
      box.state = s;
      saved.push(s);
    },
  };
  return box;
}

describe('drain', () => {
  it('sends everything in order and persists around each request', async () => {
    const c = cell(setup(3));
    const sent: string[] = [];
    const out = await drain({
      ...c,
      transport: async (req) => (sent.push(req.key), ok),
      now: () => 0,
    });
    expect(sent).toEqual(['k1', 'k2', 'k3']);
    expect(syncStatus(c.state)).toEqual({ kind: 'synced' });
    expect(out.retryAt).toBeNull();
    // Each key was persisted as `sending` before its request left.
    expect(c.saved.some((s) => s.rows[0].status === 'sending')).toBe(true);
  });

  it('applies answers to the newest outbox when the user queued more during a request', async () => {
    const c = cell(setup(1));
    const out = await drain({
      ...c,
      now: () => 0,
      transport: async (req) => {
        // The user taps while k1 is in flight.
        if (req.key === 'k1') c.state = enqueue(c.state, timeout(2), teams, 'k2', 0);
        return ok;
      },
    });
    expect(c.state.rows.map((r) => [r.key, r.status])).toEqual([
      ['k1', 'sent'],
      ['k2', 'sent'],
    ]);
    expect(out.retryAt).toBeNull();
  });

  it('stops at a network error and says when to retry, keeping the same key', async () => {
    const c = cell(setup(2));
    const sent: string[] = [];
    const first = await drain({
      ...c,
      transport: async (req) => (sent.push(req.key), { kind: 'network' } as Response),
      now: () => 1000,
    });
    expect(sent).toEqual(['k1']);
    expect(first.retryAt).toBe(2000);
    await drain({ ...c, transport: async (req) => (sent.push(req.key), ok), now: () => 2000 });
    expect(sent).toEqual(['k1', 'k1', 'k2']);
    expect(syncStatus(c.state)).toEqual({ kind: 'synced' });
  });

  it('does not skip a backoff when called early', async () => {
    const c = cell(setup(1));
    await drain({ ...c, transport: async () => ({ kind: 'network' }), now: () => 0 });
    const transport = jest.fn();
    await drain({ ...c, transport, now: () => 500 });
    expect(transport).not.toHaveBeenCalled();
  });

  it('stops at a conflict and reports no retry time', async () => {
    const c = cell(setup(2));
    const out = await drain({
      ...c,
      transport: async () => ({ kind: 'http', status: 409, code: 'goal_changed' }),
      now: () => 0,
    });
    expect(c.state.paused?.reason).toBe('conflict');
    expect(out.retryAt).toBeNull();
  });

  it('resends a request that was in flight when the app died', async () => {
    const base = setup(1);
    const c = cell({
      ...base,
      rows: base.rows.map((r) => ({ ...r, status: 'sending' as const, attempts: 1 })),
    });
    const sent: string[] = [];
    await drain({ ...c, transport: async (r) => (sent.push(r.key), ok), now: () => 0 });
    expect(sent).toEqual(['k1']);
  });

  it('can be stopped between requests', async () => {
    const c = cell(setup(3));
    let calls = 0;
    await drain({
      ...c,
      transport: async () => (calls++, ok),
      now: () => 0,
      shouldStop: () => calls >= 1,
    });
    expect(calls).toBe(1);
    expect(c.state.rows.map((r) => r.status)).toEqual(['sent', 'pending', 'pending']);
  });

  it('does not write or schedule a retry when nothing is due', async () => {
    // A finalize with no score the server has confirmed is pending but cannot be sent.
    const c = cell(enqueue(newOutbox(9, 't0', null), { type: 'finalize' }, teams, 'f1', 0));
    const out = await drain({ ...c, transport: jest.fn(), now: () => 5000 });
    expect(out.retryAt).toBeNull();
    expect(c.saved).toEqual([]);
  });

  it('does not write on an idle kick with nothing queued', async () => {
    const c = cell(newOutbox(9, 't0', null));
    const out = await drain({ ...c, transport: jest.fn(), now: () => 0 });
    expect(out.retryAt).toBeNull();
    expect(c.saved).toEqual([]);
  });
});
