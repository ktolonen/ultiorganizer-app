import type { ActionId, Caps, SignalsByAction, TemplateSignal } from './templates';

/**
 * Port of script/timekeeper.js as pure functions over plain JSON state.
 *
 * Elapsed time is always derived from stored wall-clock anchors (`startMs`,
 * `accumMs`, `pausedAtMs`) and the `nowMs` the caller passes in, never from
 * counted ticks. State therefore survives a backgrounded or killed app: persist
 * the session on every start, pause and resume, then evaluate it with the new
 * `Date.now()` after a relaunch.
 */

export type SignalKind = 'warn' | 'go';

export type Signal = {
  /** Seconds after the press. */
  at: number;
  text: string;
  kind: SignalKind;
  final?: boolean;
  /** The Start of game final signal starts the game clock. */
  startsClock?: boolean;
};

export type Repeat = { from: number; every: number; text: string; kind: SignalKind };

export type Scenario = {
  id: ActionId;
  total: number;
  signals: Signal[];
  repeat?: Repeat;
};

export type ActionTimer = {
  scenario: Scenario;
  startMs: number;
  /** Total paused time in ms, not counting a pause in progress. */
  accumMs: number;
  pausedAtMs: number | null;
};

export type TimerState = 'running' | 'warn' | 'zero';

export type TimerView = {
  elapsed: number;
  /** Seconds to the end, or to the next repeat signal once a repeating scenario is past its end. */
  remaining: number;
  state: TimerState;
  /** Text of the latest signal given, or null before the first. */
  signalText: string | null;
};

const last = <T>(a: readonly T[]): T => a[a.length - 1];

/* ------------------------------------------------------------------ */
/* Scenarios                                                           */
/* ------------------------------------------------------------------ */

function toScenario(id: ActionId, rows: readonly TemplateSignal[]): Scenario | null {
  if (!rows.length) return null;
  const total = last(rows).time;
  const signals: Signal[] = rows.map((row, i) => {
    const final = i === rows.length - 1;
    return {
      at: row.time,
      text: row.text,
      kind: final ? 'go' : 'warn',
      final,
      startsClock: id === 'halfstart' && final,
    };
  });
  const scenario: Scenario = { id, total, signals };
  // Only "Call or discussion" repeats its final signal, every gap between the last two.
  if (id === 'dispute' && rows.length >= 2) {
    const every = total - rows[rows.length - 2].time;
    if (every > 0) scenario.repeat = { from: total, every, text: last(rows).text, kind: 'go' };
  }
  return scenario;
}

/**
 * Timeout pressed while Start of point is still counting: the timer runs for
 * remaining point time + the timeout's fixed duration. "Timeout over" fires after
 * the duration, then only the point signals not yet given continue, shifted.
 */
function timeoutBeforePull(signals: SignalsByAction, pointElapsed: number): Scenario | null {
  const pointRows = signals.betweenpoints;
  const pointTotal = pointRows.length ? last(pointRows).time : 0;
  const remaining = pointTotal - pointElapsed;
  if (remaining <= 0) return null;
  const end = signals.timeoutbeforepull.length
    ? last(signals.timeoutbeforepull)
    : { time: 75, text: 'Timeout over' };
  const duration = end.time;
  const built: Signal[] = [{ at: duration, text: end.text, kind: 'warn' }];
  pointRows.forEach((row, i) => {
    if (row.time <= pointElapsed) return;
    const final = i === pointRows.length - 1;
    built.push({
      at: duration + (row.time - pointElapsed),
      text: row.text,
      kind: final ? 'go' : 'warn',
      final,
    });
  });
  return { id: 'timeout', total: remaining + duration, signals: built };
}

export type ActiveAction = { id: ActionId; elapsed: number } | null;

/** Returns null when the template has no signals for the action. */
export function buildScenario(
  id: ActionId,
  signals: SignalsByAction,
  active: ActiveAction = null,
): Scenario | null {
  if (id === 'timeout' && active?.id === 'betweenpoints') {
    const before = timeoutBeforePull(signals, active.elapsed);
    if (before) return before;
    // Start of point already reached zero: a regular after-pull timeout.
  }
  return toScenario(id, signals[id]);
}

/* ------------------------------------------------------------------ */
/* Action timer                                                        */
/* ------------------------------------------------------------------ */

export function startTimer(scenario: Scenario, nowMs: number): ActionTimer {
  return { scenario, startMs: nowMs, accumMs: 0, pausedAtMs: null };
}

export function pauseTimer(timer: ActionTimer, nowMs: number): ActionTimer {
  return timer.pausedAtMs === null ? { ...timer, pausedAtMs: nowMs } : timer;
}

export function resumeTimer(timer: ActionTimer, nowMs: number): ActionTimer {
  if (timer.pausedAtMs === null) return timer;
  return { ...timer, accumMs: timer.accumMs + (nowMs - timer.pausedAtMs), pausedAtMs: null };
}

export function timerElapsed(timer: ActionTimer, nowMs: number): number {
  const end = timer.pausedAtMs ?? nowMs;
  return Math.max(0, (end - timer.startMs - timer.accumMs) / 1000);
}

/** Last signal at or before `elapsed`, including repeat signals. */
function latestSignal(
  scenario: Scenario,
  elapsed: number,
): { text: string; kind: SignalKind } | null {
  let latest: { text: string; kind: SignalKind } | null = null;
  for (const sig of scenario.signals) {
    if (elapsed >= sig.at) latest = { text: sig.text, kind: sig.kind };
  }
  const r = scenario.repeat;
  if (r && elapsed >= r.from + r.every) latest = { text: r.text, kind: r.kind };
  return latest;
}

export function timerView(timer: ActionTimer, nowMs: number): TimerView {
  const { scenario } = timer;
  const elapsed = timerElapsed(timer, nowMs);
  const latest = latestSignal(scenario, elapsed);
  let remaining = scenario.total - elapsed;
  let zero = false;
  if (remaining <= 0) {
    zero = true;
    remaining = 0;
    const r = scenario.repeat;
    if (r) {
      const past = elapsed - r.from;
      if (past > 0) {
        const rest = past % r.every;
        remaining = rest === 0 ? 0 : r.every - rest;
      }
    }
  }
  return {
    elapsed,
    remaining,
    state: zero || latest?.kind === 'go' ? 'zero' : latest ? 'warn' : 'running',
    signalText: latest?.text ?? null,
  };
}

export type FiredSignal = { text: string; kind: SignalKind; startsClock: boolean };

/**
 * Signals that became due when elapsed went from `prevElapsed` (exclusive) to
 * `elapsed` (inclusive); pass -1 for the first call so a signal at 0 fires.
 * The caller keeps `prevElapsed` in memory only: after a relaunch, pass the
 * recovered elapsed so old signals are not sounded again.
 */
export function firedBetween(
  timer: ActionTimer,
  prevElapsed: number,
  elapsed: number,
): FiredSignal[] {
  const out: FiredSignal[] = [];
  const { scenario } = timer;
  for (const sig of scenario.signals) {
    if (sig.at > prevElapsed && sig.at <= elapsed) {
      out.push({ text: sig.text, kind: sig.kind, startsClock: !!sig.startsClock });
    }
  }
  const r = scenario.repeat;
  if (r) {
    const count = (t: number) => (t >= r.from + r.every ? Math.floor((t - r.from) / r.every) : 0);
    // The first repeat shares its moment with no other signal, so one entry per crossing.
    for (let n = count(prevElapsed) + 1; n <= count(elapsed); n++) {
      out.push({ text: r.text, kind: r.kind, startsClock: false });
    }
  }
  return out;
}

export type ScheduledSignal = { atMs: number; text: string; kind: SignalKind };

/**
 * Wall-clock times of the signals still ahead, for local notifications while the
 * app is backgrounded. Empty while paused (resuming reschedules). Repeats are
 * listed up to `maxRepeats` ahead.
 */
export function pendingSignals(
  timer: ActionTimer,
  nowMs: number,
  maxRepeats = 8,
): ScheduledSignal[] {
  if (timer.pausedAtMs !== null) return [];
  const elapsed = timerElapsed(timer, nowMs);
  const base = timer.startMs + timer.accumMs;
  const out: ScheduledSignal[] = [];
  for (const sig of timer.scenario.signals) {
    if (sig.at > elapsed) out.push({ atMs: base + sig.at * 1000, text: sig.text, kind: sig.kind });
  }
  const r = timer.scenario.repeat;
  if (r) {
    let n = elapsed >= r.from + r.every ? Math.floor((elapsed - r.from) / r.every) + 1 : 1;
    for (let i = 0; i < maxRepeats; i++, n++) {
      out.push({ atMs: base + (r.from + n * r.every) * 1000, text: r.text, kind: r.kind });
    }
  }
  return out.sort((a, b) => a.atMs - b.atMs);
}

/* ------------------------------------------------------------------ */
/* Game clock, marks and caps                                          */
/* ------------------------------------------------------------------ */

export type GameClock = { running: boolean; startMs: number; accumMs: number };

export type Mark = { key: string; label: string; number: number; seconds: number };

export type CapKind = 'half' | 'time';

export type TimekeeperSession = {
  timer: ActionTimer | null;
  clock: GameClock;
  marks: Mark[];
  halftimeStarted: boolean;
  /** Caps are fixed when the clock first starts, so later edits do not move them. */
  capConfig: Caps | null;
  loggedCaps: Partial<Record<CapKind, true>>;
  dismissedCap: CapKind | null;
  /** An action started while the clock was stopped: highlights a likely missed start. */
  startWarning: boolean;
};

export const newSession = (): TimekeeperSession => ({
  timer: null,
  clock: { running: false, startMs: 0, accumMs: 0 },
  marks: [],
  halftimeStarted: false,
  capConfig: null,
  loggedCaps: {},
  dismissedCap: null,
  startWarning: false,
});

export function clockElapsed(clock: GameClock, nowMs: number): number {
  return (clock.running ? nowMs - clock.startMs + clock.accumMs : clock.accumMs) / 1000;
}

export function addMark(
  session: TimekeeperSession,
  key: string,
  label: string,
  nowMs: number,
): TimekeeperSession {
  const number = session.marks.filter((m) => m.key === key).length + 1;
  const seconds = Math.floor(clockElapsed(session.clock, nowMs));
  return { ...session, marks: [...session.marks, { key, label, number, seconds }] };
}

export function startClock(
  session: TimekeeperSession,
  nowMs: number,
  caps: Caps,
): TimekeeperSession {
  if (session.clock.running) return session;
  return {
    ...session,
    capConfig: session.capConfig ?? caps,
    startWarning: false,
    clock: { ...session.clock, running: true, startMs: nowMs },
  };
}

export function pauseClock(session: TimekeeperSession, nowMs: number): TimekeeperSession {
  if (!session.clock.running) return session;
  const accumMs = session.clock.accumMs + (nowMs - session.clock.startMs);
  return addMark(
    { ...session, clock: { running: false, startMs: 0, accumMs } },
    'pause',
    'Pause',
    nowMs,
  );
}

export function resetClock(session: TimekeeperSession): TimekeeperSession {
  return {
    ...session,
    clock: { running: false, startMs: 0, accumMs: 0 },
    marks: [],
    capConfig: null,
    loggedCaps: {},
    dismissedCap: null,
    halftimeStarted: false,
    startWarning: false,
  };
}

export type CapStatus = {
  /** The cap notice to show, or null. Time cap wins over halftime cap. */
  active: CapKind | null;
  half: boolean;
  time: boolean;
};

export function capStatus(session: TimekeeperSession, nowMs: number, fallback: Caps): CapStatus {
  const caps = session.capConfig ?? fallback;
  const elapsed = clockElapsed(session.clock, nowMs);
  const timeCap = caps.time_cap * 60;
  const halfCap = caps.half_time_cap * 60;
  const time = timeCap > 0 && elapsed >= timeCap;
  const half = !session.halftimeStarted && halfCap > 0 && elapsed >= halfCap;
  let active: CapKind | null = null;
  if (time && session.dismissedCap !== 'time') active = 'time';
  else if (!time && half && session.dismissedCap !== 'half') active = 'half';
  return { active, half, time };
}

/** Logs each cap once in the mark list. Call on every tick; returns the same object if nothing changed. */
export function logCaps(
  session: TimekeeperSession,
  nowMs: number,
  fallback: Caps,
): TimekeeperSession {
  const status = capStatus(session, nowMs, fallback);
  let next = session;
  if (status.half && !session.loggedCaps.half) {
    next = addMark(
      { ...next, loggedCaps: { ...next.loggedCaps, half: true } },
      'cap_half_time',
      'Halftime cap',
      nowMs,
    );
  }
  if (status.time && !session.loggedCaps.time) {
    next = addMark(
      { ...next, loggedCaps: { ...next.loggedCaps, time: true } },
      'cap_time',
      'Time cap',
      nowMs,
    );
  }
  return next;
}

export function dismissCap(session: TimekeeperSession, kind: CapKind): TimekeeperSession {
  return { ...session, dismissedCap: kind };
}

/* ------------------------------------------------------------------ */
/* Session-level actions                                               */
/* ------------------------------------------------------------------ */

/** Starts an action timer, replacing any running one, and logs the action as a mark. */
export function startAction(
  session: TimekeeperSession,
  id: ActionId,
  signals: SignalsByAction,
  label: string,
  nowMs: number,
): TimekeeperSession {
  const active: ActiveAction = session.timer
    ? { id: session.timer.scenario.id, elapsed: timerElapsed(session.timer, nowMs) }
    : null;
  const scenario = buildScenario(id, signals, active);
  if (!scenario) return session;
  let next: TimekeeperSession = { ...session, timer: startTimer(scenario, nowMs) };
  if (id === 'halftime') {
    next.halftimeStarted = true;
    if (capStatus(session, nowMs, { half_time_cap: 0, time_cap: 0 }).active === 'half') {
      next.dismissedCap = 'half';
    }
  }
  if (id !== 'halfstart' && !session.clock.running) next.startWarning = true;
  next = addMark(next, id, label, nowMs);
  return next;
}

export const pauseAction = (s: TimekeeperSession, nowMs: number): TimekeeperSession =>
  s.timer ? { ...s, timer: pauseTimer(s.timer, nowMs) } : s;

export const resumeAction = (s: TimekeeperSession, nowMs: number): TimekeeperSession =>
  s.timer ? { ...s, timer: resumeTimer(s.timer, nowMs) } : s;

export const stopAction = (s: TimekeeperSession): TimekeeperSession => ({ ...s, timer: null });

/** Applies signals fired by the action timer that act on the session (Start of game starts the clock). */
export function applyFired(
  session: TimekeeperSession,
  fired: readonly FiredSignal[],
  nowMs: number,
  caps: Caps,
): TimekeeperSession {
  return fired.some((f) => f.startsClock) ? startClock(session, nowMs, caps) : session;
}
