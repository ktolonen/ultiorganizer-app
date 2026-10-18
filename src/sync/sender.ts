import {
  type OutboxState,
  type Response,
  type SendRequest,
  markSending,
  nextToSend,
  onResponse,
  recover,
} from './outbox';

export type Transport = (req: SendRequest) => Promise<Response>;

/**
 * Drains one game's outbox: send the next due request, apply the answer, repeat.
 * Strictly one request in flight, so run at most one `drain` per game at a time.
 *
 * The outbox is read and written through `get`/`set` instead of being passed in:
 * the user keeps tapping while a request is in flight, and each answer must be
 * applied to the newest outbox, not to the copy the loop started with. `set` runs
 * after the row is marked sending and after each answer, so persisting there means
 * a crash in between resends with the same key.
 *
 * Stops when nothing is due (paused, backing off, or empty) and returns the time
 * to try again, if any.
 */
export async function drain(deps: {
  get: () => OutboxState;
  set: (state: OutboxState) => Promise<void> | void;
  transport: Transport;
  now: () => number;
  /** Stops a long drain, e.g. when the screen closes. */
  shouldStop?: () => boolean;
}): Promise<{ retryAt: number | null }> {
  // Only write when a crash left a request "in flight"; an idle kick must not touch SQLite.
  const start = deps.get();
  const recovered = recover(start);
  if (recovered !== start) await deps.set(recovered);
  while (!deps.shouldStop?.()) {
    const req = nextToSend(deps.get(), deps.now());
    if (!req) break;
    await deps.set(markSending(deps.get(), req.key));
    const res = await deps.transport(req);
    await deps.set(onResponse(deps.get(), req.key, res, deps.now()));
  }
  const state = deps.get();
  const waiting = !state.paused && state.rows.some((r) => r.status === 'pending');
  // Only a backoff in the future is worth a timer. A pending row that is not due for
  // another reason (a finalize with no confirmed score) would otherwise spin.
  return { retryAt: waiting && state.nextAttemptAt > deps.now() ? state.nextAttemptAt : null };
}
