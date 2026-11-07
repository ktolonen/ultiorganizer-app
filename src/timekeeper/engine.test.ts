import {
  adoptClock,
  clockChange,
  clockUntouched,
  addMark,
  applyFired,
  buildScenario,
  capStatus,
  clockElapsed,
  dismissCap,
  firedBetween,
  logCaps,
  newSession,
  pauseAction,
  pauseClock,
  pendingSignals,
  resumeAction,
  startAction,
  startClock,
  stopAction,
  timerElapsed,
  timerView,
} from './engine';
import { WFDF_TEMPLATE, resolveTemplate } from './templates';

const { signals, caps } = resolveTemplate(WFDF_TEMPLATE);
const T0 = 1_700_000_000_000;
const sec = (n: number) => n * 1000;

function timerFor(
  id: Parameters<typeof buildScenario>[0],
  active = null as Parameters<typeof buildScenario>[2],
) {
  const scenario = buildScenario(id, signals, active)!;
  return { scenario, startMs: T0, accumMs: 0, pausedAtMs: null };
}

describe('scenarios from the WFDF defaults', () => {
  it('Start of point: 45 / 60 / 75, red at the end', () => {
    const t = timerFor('betweenpoints');
    expect(timerView(t, T0)).toMatchObject({ remaining: 75, state: 'running', signalText: null });
    expect(timerView(t, T0 + sec(45))).toMatchObject({
      state: 'warn',
      signalText: 'Offence warning',
    });
    expect(timerView(t, T0 + sec(60))).toMatchObject({
      state: 'warn',
      signalText: 'Defence warning',
    });
    expect(timerView(t, T0 + sec(75))).toMatchObject({
      state: 'zero',
      remaining: 0,
      signalText: 'Play',
    });
    expect(timerView(t, T0 + sec(200)).remaining).toBe(0);
  });

  it('fires each signal exactly once across ticks', () => {
    const t = timerFor('betweenpoints');
    const texts: string[] = [];
    let prev = -1;
    for (let s = 0; s <= 100; s += 0.2) {
      const e = timerElapsed(t, T0 + s * 1000);
      texts.push(...firedBetween(t, prev, e).map((f) => f.text));
      prev = e;
    }
    expect(texts).toEqual(['Offence warning', 'Defence warning', 'Play']);
  });

  it('Start of game fires at 0 and its final signal starts the clock', () => {
    const t = timerFor('halfstart');
    const first = firedBetween(t, -1, 0);
    expect(first).toEqual([{ text: 'Approaching start', kind: 'warn', startsClock: false }]);
    const second = firedBetween(t, 0, 60);
    expect(second[0]).toMatchObject({ text: 'Start of play', kind: 'go', startsClock: true });
    const s = applyFired(newSession(), second, T0 + sec(60), caps);
    expect(s.clock.running).toBe(true);
  });

  it('returns null for an action without signals', () => {
    expect(buildScenario('halftime', { ...signals, halftime: [] })).toBeNull();
  });
});

describe('timeout', () => {
  it('after the pull runs 45/60/75/90', () => {
    const sc = buildScenario('timeout', signals)!;
    expect(sc.total).toBe(90);
    expect(sc.signals.map((s) => s.at)).toEqual([45, 60, 75, 90]);
  });

  it('before the pull: remaining point time plus the template timeout duration', () => {
    // Point total 75, 57 s elapsed -> 18 s left; Timeout over at 75 s.
    const sc = buildScenario('timeout', signals, { id: 'betweenpoints', elapsed: 57 })!;
    expect(sc.total).toBe(18 + 75);
    expect(sc.signals).toEqual([
      { at: 75, text: 'Timeout over', kind: 'warn' },
      { at: 75 + 3, text: 'Defence warning', kind: 'warn', final: false },
      { at: 75 + 18, text: 'Play', kind: 'go', final: true },
    ]);
  });

  it('before the pull skips point signals already given', () => {
    const sc = buildScenario('timeout', signals, { id: 'betweenpoints', elapsed: 60 })!;
    expect(sc.signals.map((s) => s.text)).toEqual(['Timeout over', 'Play']);
  });

  it('falls back to a regular timeout once Start of point reached zero', () => {
    const sc = buildScenario('timeout', signals, { id: 'betweenpoints', elapsed: 75 })!;
    expect(sc.total).toBe(90);
  });

  it('ignores an active timer that is not Start of point', () => {
    expect(buildScenario('timeout', signals, { id: 'halftime', elapsed: 5 })!.total).toBe(90);
  });

  it('startAction wires the active Start of point timer into the timeout', () => {
    let s = startAction(newSession(), 'betweenpoints', signals, 'Start of point', T0);
    s = startAction(s, 'timeout', signals, 'Timeout', T0 + sec(57));
    expect(s.timer!.scenario.total).toBe(93);
  });
});

describe('Call or discussion repeats its final signal', () => {
  const t = () => timerFor('dispute');
  it('repeats every gap between the last two signals', () => {
    const timer = t();
    expect(timer.scenario.repeat).toEqual({
      from: 60,
      every: 15,
      text: 'Play must restart',
      kind: 'go',
    });
    const fired = firedBetween(timer, 60, 100).map((f) => f.text);
    expect(fired).toEqual(['Play must restart', 'Play must restart']); // 75 and 90
  });
  it('counts down to the next repeat after the first restart point', () => {
    const timer = t();
    expect(timerView(timer, T0 + sec(60)).remaining).toBe(0);
    expect(timerView(timer, T0 + sec(70)).remaining).toBe(5);
    expect(timerView(timer, T0 + sec(75)).remaining).toBe(0);
  });
});

describe('pause and recovery', () => {
  it('excludes paused time', () => {
    let s = startAction(newSession(), 'betweenpoints', signals, 'Start of point', T0);
    s = pauseAction(s, T0 + sec(10));
    expect(timerElapsed(s.timer!, T0 + sec(500))).toBe(10);
    s = resumeAction(s, T0 + sec(30));
    expect(timerElapsed(s.timer!, T0 + sec(40))).toBe(20);
  });

  it('survives a JSON round trip and a long gap (killed app)', () => {
    let s = startAction(newSession(), 'halftime', signals, 'Halftime', T0);
    s = startClock(s, T0, caps);
    const restored = JSON.parse(JSON.stringify(s)) as typeof s;
    const later = T0 + sec(400);
    expect(timerView(restored.timer!, later)).toMatchObject({
      state: 'warn',
      signalText: 'Halftime ending',
      remaining: 20,
    });
    expect(clockElapsed(restored.clock, later)).toBe(400);
    // Recovered signals are not re-sounded when the caller passes the recovered elapsed.
    const e = timerElapsed(restored.timer!, later);
    expect(firedBetween(restored.timer!, e, e)).toEqual([]);
  });

  it('stopAction clears the timer', () => {
    const s = stopAction(startAction(newSession(), 'betweenpoints', signals, 'x', T0));
    expect(s.timer).toBeNull();
  });
});

describe('pendingSignals for notifications', () => {
  it('lists future signals at absolute times', () => {
    const t = timerFor('betweenpoints');
    expect(pendingSignals(t, T0 + sec(50)).map((p) => [p.atMs - T0, p.text])).toEqual([
      [sec(60), 'Defence warning'],
      [sec(75), 'Play'],
    ]);
  });
  it('accounts for earlier pauses and lists nothing while paused', () => {
    let s = startAction(newSession(), 'betweenpoints', signals, 'x', T0);
    s = pauseAction(s, T0 + sec(10));
    expect(pendingSignals(s.timer!, T0 + sec(20))).toEqual([]);
    s = resumeAction(s, T0 + sec(30));
    expect(pendingSignals(s.timer!, T0 + sec(30))[0].atMs).toBe(T0 + sec(30 + 35)); // 45 s signal, 10 s used
  });
  it('lists a bounded run of repeats', () => {
    const t = timerFor('dispute');
    const p = pendingSignals(t, T0 + sec(100), 3);
    expect(p.map((x) => x.atMs - T0)).toEqual([sec(105), sec(120), sec(135)]);
  });
});

describe('game clock, marks and caps', () => {
  it('starts, pauses with a mark, and resumes', () => {
    let s = startClock(newSession(), T0, caps);
    s = pauseClock(s, T0 + sec(90));
    expect(s.clock.running).toBe(false);
    expect(clockElapsed(s.clock, T0 + sec(999))).toBe(90);
    expect(s.marks).toEqual([{ key: 'pause', label: 'Pause', number: 1, seconds: 90 }]);
    s = startClock(s, T0 + sec(200), caps);
    expect(clockElapsed(s.clock, T0 + sec(210))).toBe(100);
  });

  it('numbers marks per key', () => {
    let s = startClock(newSession(), T0, caps);
    s = addMark(s, 'mark', 'Mark', T0 + sec(5));
    s = addMark(s, 'mark', 'Mark', T0 + sec(9));
    expect(s.marks.map((m) => [m.number, m.seconds])).toEqual([
      [1, 5],
      [2, 9],
    ]);
  });

  it('halftime cap shows at 55 min until Halftime starts, time cap at 100 min', () => {
    let s = startClock(newSession(), T0, caps);
    expect(capStatus(s, T0 + sec(55 * 60 - 1), caps).active).toBeNull();
    expect(capStatus(s, T0 + sec(55 * 60), caps).active).toBe('half');
    expect(capStatus(s, T0 + sec(100 * 60), caps)).toMatchObject({ active: 'time', time: true });
    s = dismissCap(s, 'half');
    expect(capStatus(s, T0 + sec(56 * 60), caps).active).toBeNull();
  });

  it('starting Halftime clears the halftime cap notice', () => {
    let s = startClock(newSession(), T0, caps);
    s = startAction(s, 'halftime', signals, 'Halftime', T0 + sec(55 * 60 + 5));
    expect(capStatus(s, T0 + sec(56 * 60), caps)).toMatchObject({ active: null, half: false });
  });

  it('caps pause with the clock', () => {
    let s = startClock(newSession(), T0, caps);
    s = pauseClock(s, T0 + sec(54 * 60));
    expect(capStatus(s, T0 + sec(54 * 60 + 9999), caps).active).toBeNull();
  });

  it('logs each cap once', () => {
    let s = startClock(newSession(), T0, caps);
    s = logCaps(s, T0 + sec(55 * 60), caps);
    const again = logCaps(s, T0 + sec(55 * 60 + 5), caps);
    expect(again).toBe(s);
    expect(s.marks.filter((m) => m.key === 'cap_half_time')).toHaveLength(1);
    s = logCaps(s, T0 + sec(100 * 60), caps);
    expect(s.marks.map((m) => m.key)).toEqual(['cap_half_time', 'cap_time']);
  });

  it('keeps the caps from when the clock started', () => {
    let s = startClock(newSession(), T0, { half_time_cap: 10, time_cap: 20 });
    expect(capStatus(s, T0 + sec(10 * 60), caps).active).toBe('half');
  });

  it('flags an action started while the clock is stopped, until it starts', () => {
    let s = startAction(newSession(), 'betweenpoints', signals, 'Start of point', T0);
    expect(s.startWarning).toBe(true);
    s = startClock(s, T0 + sec(3), caps);
    expect(s.startWarning).toBe(false);
    expect(startAction(newSession(), 'halfstart', signals, 'Start of game', T0).startWarning).toBe(
      false,
    );
  });

  it('logs the action name as a mark with the clock time', () => {
    let s = startClock(newSession(), T0, caps);
    s = startAction(s, 'timeout', signals, 'Timeout', T0 + sec(125));
    expect(s.marks[0]).toEqual({ key: 'timeout', label: 'Timeout', number: 1, seconds: 125 });
  });
});

describe('local template overrides', () => {
  it('applies signal and cap overrides and keeps rows sorted', () => {
    const ids = WFDF_TEMPLATE.signals.betweenpoints.map((r) => r.id);
    const r = resolveTemplate(WFDF_TEMPLATE, { signals: { [ids[0]]: 70 }, caps: { time_cap: 90 } });
    expect(r.signals.betweenpoints.map((x) => x.time)).toEqual([60, 70, 75]);
    expect(r.caps).toEqual({ half_time_cap: 55, time_cap: 90 });
  });
  it('clamps junk input to zero', () => {
    const id = WFDF_TEMPLATE.signals.discretrieval[0].id;
    const r = resolveTemplate(WFDF_TEMPLATE, { signals: { [id]: -5 } });
    expect(r.signals.discretrieval[0].time).toBe(0);
  });
});

describe('server clock', () => {
  it('names each change as the server does', () => {
    const idle = { running: false, startMs: 0, accumMs: 0 };
    const run = { running: true, startMs: 5, accumMs: 0 };
    const paused = { running: false, startMs: 0, accumMs: 3000 };
    expect(clockChange(idle, run)).toBe('start');
    expect(clockChange(run, paused)).toBe('pause');
    expect(clockChange(paused, { ...run, accumMs: 3000 })).toBe('resume');
    expect(clockChange(paused, idle)).toBe('reset');
    expect(clockChange(run, idle)).toBe('reset');
    expect(clockChange(paused, paused)).toBeNull();
  });
  it('takes over a running or paused clock', () => {
    const caps = { half_time_cap: 3000, time_cap: 6000 };
    const r = adoptClock(newSession(), { running: true, elapsedSec: 90 }, 100_000, caps);
    expect(clockElapsed(r.clock, 100_000)).toBe(90);
    expect(r.capConfig).toEqual(caps);
    const p = adoptClock(newSession(), { running: false, elapsedSec: 90 }, 100_000, caps);
    expect(p.clock).toEqual({ running: false, startMs: 0, accumMs: 90_000 });
    expect(clockUntouched(newSession())).toBe(true);
    expect(clockUntouched(p)).toBe(false);
  });
});
