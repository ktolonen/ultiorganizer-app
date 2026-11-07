import {
  type OutboxRow,
  type OutboxState,
  correctGoalRequest,
  deleteStoppageRequest,
  dropRow,
  enqueue,
  enqueueRequest,
  enqueueUpload,
  planUndo,
} from '../sync/outbox';
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
  if (session.outbox.offlineOnly) return { ok: true, session: { ...session, state } };
  if (event.type === 'remove_timeout' || event.type === 'remove_spirit_stoppage') {
    return removeStoppage(session, event, state, deps);
  }
  if (event.type === 'correct_goal') return correctGoal(session, event, state, deps);
  // A server without the caps route keeps caps on the phone only.
  if ((event.type === 'cap' || event.type === 'remove_cap') && session.outbox.capsAbsent) {
    return { ok: true, session: { ...session, state } };
  }
  let outbox = enqueue(session.outbox, event, state.teamIds, deps.newKey(), deps.now);
  if (event.type === 'goal' && outbox !== session.outbox) {
    // Remember which goal the row made, so a later correction can find its server number.
    const localNum = state.goals[state.goals.length - 1].num;
    outbox = {
      ...outbox,
      rows: outbox.rows.map((r, i, all) => (i === all.length - 1 ? { ...r, localNum } : r)),
    };
  }
  return { ok: true, session: { ...session, state, outbox } };
}

const hasUnsentUpload = (o: OutboxState): boolean =>
  o.rows.some((r) => r.op === 'upload' && r.status !== 'sent');

/**
 * The row that made an entry, searching back from the end while `match` says which rows
 * made it. Null when an upload (or a row `voids` names) came later, since then the row no
 * longer tells which entry is which on the server.
 */
function rowFor(
  o: OutboxState,
  match: (r: OutboxRow) => boolean,
  voids: (r: OutboxRow) => boolean = () => false,
): OutboxRow | null {
  for (let i = o.rows.length - 1; i >= 0; i--) {
    const r = o.rows[i];
    if (r.op === 'upload' || voids(r)) return null;
    if (match(r)) return r;
  }
  return null;
}

/**
 * Removing a timeout or spirit stoppage. The team's last one: an unsent row is dropped,
 * a sent one is deleted through its route by the server's number. An older one, or one
 * on a server without the route, syncs by full upload.
 */
function removeStoppage(
  session: GameSession,
  event: Extract<GameEvent, { type: 'remove_timeout' | 'remove_spirit_stoppage' }>,
  state: GameState,
  deps: Deps,
): ApplyResult {
  const kind = event.type === 'remove_timeout' ? 'timeout' : 'spirit_stoppage';
  const key = kind === 'timeout' ? 'timeouts' : 'spiritStoppages';
  const { outbox } = session;
  const isLast = event.index === session.state[key][event.side].length - 1;
  if (!isLast || outbox.correctionsAbsent || hasUnsentUpload(outbox)) {
    return queueUpload(session, state, deps);
  }
  const sameSide = (r: OutboxRow) => !!r.event && 'side' in r.event && r.event.side === event.side;
  const row = rowFor(
    outbox,
    (r) => r.op === kind && sameSide(r),
    (r) => r.op === `delete_${kind}` && sameSide(r),
  );
  if (row?.status === 'sending') return { ok: false, error: busy };
  if (row?.status === 'pending') {
    return { ok: true, session: { ...session, state, outbox: dropRow(outbox, row.key) } };
  }
  if (row?.status === 'failed') return queueUpload(session, state, deps);
  // An entry from the entry context has no row: the server numbers a team's entries 1, 2, ...
  const num = row?.serverNum ?? event.index + 1;
  const req = deleteStoppageRequest(session.gameId, kind, event.side, num);
  return {
    ok: true,
    session: {
      ...session,
      state,
      outbox: enqueueRequest(outbox, req, event, deps.newKey(), deps.now),
    },
  };
}

/**
 * Correcting a goal's players. An unsent goal row just takes the new players; a sent goal
 * is patched by its server number with the fields that changed.
 */
function correctGoal(
  session: GameSession,
  event: Extract<GameEvent, { type: 'correct_goal' }>,
  state: GameState,
  deps: Deps,
): ApplyResult {
  if (state === session.state) return { ok: true, session };
  const { outbox } = session;
  if (outbox.correctionsAbsent || hasUnsentUpload(outbox)) return queueUpload(session, state, deps);
  const before = session.state.goals.find((g) => g.num === event.num)!;
  const after = state.goals.find((g) => g.num === event.num)!;
  const row = rowFor(outbox, (r) => r.op === 'goal' && r.localNum === event.num);
  if (row?.status === 'sending') return { ok: false, error: busy };
  if (row?.status === 'failed') return queueUpload(session, state, deps);
  if (row?.status === 'pending' && row.event?.type === 'goal') {
    const goal = {
      ...row.event,
      scorerId: after.scorerId,
      assistId: after.assistId,
      callahan: after.callahan,
    };
    const body = {
      ...(row.body as object),
      scorer_id: goal.scorerId,
      assist_id: goal.assistId,
      callahan: goal.callahan,
    };
    const rows = outbox.rows.map((r) => (r.key === row.key ? { ...r, event: goal, body } : r));
    return { ok: true, session: { ...session, state, outbox: { ...outbox, rows } } };
  }
  const num = row?.serverNum ?? event.num;
  const req = correctGoalRequest(session.gameId, num, after);
  // Send only what changed: the server checks the roster for the players it is sent.
  const full = req.body as Record<string, unknown>;
  const body: Record<string, unknown> = {};
  if (after.scorerId !== before.scorerId) body.scorer_id = full.scorer_id;
  if (after.assistId !== before.assistId) body.assist_id = full.assist_id;
  if (after.callahan !== before.callahan) body.callahan = full.callahan;
  return {
    ok: true,
    session: {
      ...session,
      state,
      outbox: enqueueRequest(outbox, { ...req, body }, event, deps.newKey(), deps.now),
    },
  };
}

/**
 * The server could not make a correction through its live route (`needs_upload`): replace
 * the queue with a full upload of local state, which carries it. If local state cannot be
 * uploaded either, the row is marked refused, so the user sees why.
 */
export function resolveNeedsUpload(session: GameSession, deps: Deps): GameSession {
  const { paused } = session.outbox;
  if (paused?.reason !== 'needs_upload') return session;
  const r = queueUpload(session, session.state, deps);
  if (r.ok) return r.session;
  const error = { status: 0, code: r.error.code, message: r.error.message };
  return {
    ...session,
    outbox: {
      ...session.outbox,
      rows: session.outbox.rows.map((row) =>
        row.key === paused.rowKey ? { ...row, status: 'failed', error } : row,
      ),
      paused: { ...paused, reason: 'failed', code: r.error.code },
    },
  };
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

/**
 * Takes the server's current list of players a team can field, so players added on the
 * server after the game was opened become pickable. Only the eligible lists change: local
 * rosters, goals and the outbox stay as they are. A side is skipped when its team differs
 * from the local one (the server's game changed under us; a conflict handles that).
 * A player the server no longer lists stays eligible while a local roster or goal uses
 * them, so the next roster edit still validates. Returns the same session when nothing changed.
 */
export function refreshEligible(session: GameSession, fresh: EntryContext): GameSession {
  if (fresh.game.game_id !== session.gameId) return session;
  const { state, context } = session;
  let changed = false;
  const eligible = { ...state.eligible };
  const ctx = { ...context };
  for (const side of ['home', 'away'] as const) {
    if (fresh[side].team_id === null || fresh[side].team_id !== state.teamIds[side]) continue;
    const inUse = new Set<number>([
      ...state.rosters[side].map((p) => p.player_id),
      ...state.goals
        .filter((g) => g.side === side)
        .flatMap((g) => [g.scorerId, g.assistId])
        .filter((id): id is number => id !== null),
    ]);
    const freshIds = new Set(fresh[side].eligible_players.map((p) => p.player_id));
    const next = [
      ...fresh[side].eligible_players,
      ...state.eligible[side].filter((p) => inUse.has(p.player_id) && !freshIds.has(p.player_id)),
    ];
    if (JSON.stringify(next) === JSON.stringify(state.eligible[side])) continue;
    changed = true;
    eligible[side] = next;
    ctx[side] = { ...ctx[side], eligible_players: next };
  }
  return changed ? { ...session, context: ctx, state: { ...state, eligible } } : session;
}
