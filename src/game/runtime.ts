import { type OutboxState, dropRow, enqueue, enqueueUpload, planUndo } from '../sync/outbox';
import { type GameError, type GameEvent, type GameState, reduce } from './reducer';
import type { EntryContext } from './types';
import { toGameData } from './upload';

/** Everything the live screen needs for one game; persisted as a unit. */
export type GameSession = {
  serverId: number;
  gameId: number;
  title: string;
  context: EntryContext;
  state: GameState;
  outbox: OutboxState;
};

export type Deps = { now: number; newKey: () => string };

export type ApplyResult =
  | { ok: true; session: GameSession }
  | { ok: false; error: GameError | { code: 'busy' | 'no_token'; message: string } };

const busy = { code: 'busy' as const, message: 'A request is in flight; try again in a moment.' };

/** Queues a full upload built from `state`. Refused while a request is in flight. */
function queueUpload(session: GameSession, state: GameState, deps: Deps): ApplyResult {
  const doc = toGameData(state);
  if (!doc.ok) return { ok: false, error: doc.error };
  const outbox = enqueueUpload(session.outbox, doc.doc, deps.newKey(), deps.now);
  if (!outbox)
    return {
      ok: false,
      error:
        session.outbox.token === null
          ? { code: 'no_token', message: 'No concurrency token yet.' }
          : busy,
    };
  return { ok: true, session: { ...session, state, outbox } };
}

/**
 * Applies a user action: the reducer decides, and only an accepted event reaches the
 * outbox. Corrections the live API cannot express (removing an older timeout) queue a
 * full upload instead. A game kept offline-only records state and queues nothing.
 */
export function applyEvent(session: GameSession, event: GameEvent, deps: Deps): ApplyResult {
  const reduced = reduce(session.state, event);
  if (!reduced.ok) return { ok: false, error: reduced.error };
  const state = reduced.state;
  if (event.type === 'remove_timeout' || event.type === 'remove_spirit_stoppage') {
    return session.outbox.offlineOnly
      ? { ok: true, session: { ...session, state } }
      : queueUpload(session, state, deps);
  }
  if (session.outbox.offlineOnly) return { ok: true, session: { ...session, state } };
  const outbox = enqueue(session.outbox, event, state.teamIds, deps.newKey(), deps.now);
  return { ok: true, session: { ...session, state, outbox } };
}

/** Undoes the most recent goal by the rules in PLAN.md "Undo". */
export function undoLastGoal(session: GameSession, deps: Deps): ApplyResult {
  const last = session.state.goals[session.state.goals.length - 1];
  if (!last)
    return { ok: false, error: { code: 'validation_failed', message: 'No goal to undo.' } };
  const remove: GameEvent = { type: 'delete_last_goal', num: last.num };
  const row = [...session.outbox.rows].reverse().find((r) => r.op === 'goal');
  if (!row) {
    // No goal row: kept offline-only, or folded into an upload. Correct locally and
    // sync by full upload when there is a server to sync with.
    const r = reduce(session.state, remove);
    if (!r.ok) return { ok: false, error: r.error };
    return session.outbox.offlineOnly
      ? { ok: true, session: { ...session, state: r.state } }
      : queueUpload(session, r.state, deps);
  }
  const plan = planUndo(session.outbox, row.key);
  const reduced = reduce(session.state, remove);
  if (!reduced.ok) return { ok: false, error: reduced.error };
  switch (plan.kind) {
    case 'drop':
      return {
        ok: true,
        session: { ...session, state: reduced.state, outbox: dropRow(session.outbox, row.key) },
      };
    case 'delete_goal': {
      const outbox = enqueue(
        session.outbox,
        { type: 'delete_last_goal', num: plan.num },
        reduced.state.teamIds,
        deps.newKey(),
        deps.now,
      );
      return { ok: true, session: { ...session, state: reduced.state, outbox } };
    }
    case 'full_upload':
      return queueUpload(session, reduced.state, deps);
    case 'wait':
      return { ok: false, error: busy };
    default:
      return { ok: false, error: { code: 'validation_failed', message: 'Unknown goal row.' } };
  }
}

/** Queues a full upload of the current state (fall-behind, offline-only games, conflict resolution). */
export function uploadAll(session: GameSession, deps: Deps): ApplyResult {
  return queueUpload(session, session.state, deps);
}
