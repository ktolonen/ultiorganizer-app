import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { STANDALONE_SCOPE } from '../store/repo';
import { getRepo } from '../store/sqlite';
import type { OverridesByTemplate } from '../store/schemas';
import {
  applyFired,
  capStatus,
  clockElapsed,
  dismissCap,
  firedBetween,
  logCaps,
  newSession,
  pauseAction,
  pauseClock,
  pendingSignals,
  resetClock,
  resumeAction,
  startAction,
  startClock,
  stopAction,
  timerElapsed,
  timerView,
  addMark,
  type CapStatus,
  type TimerView,
  type TimekeeperSession,
} from './engine';
import {
  alertSignal,
  cancelScheduledSignals,
  configureNotifications,
  ensureNotificationPermission,
  scheduleSignals,
  warmUpSounds,
} from './signals';
import {
  BUNDLED_TEMPLATES,
  resolveTemplate,
  type ActionId,
  type TemplateOverrides,
  type TemplateSet,
  type TimekeeperTemplate,
} from './templates';
import i18n, { signalText } from '../i18n';

export type TimekeeperApi = {
  ready: boolean;
  template: TimekeeperTemplate;
  templates: TemplateSet;
  nowMs: number;
  session: TimekeeperSession;
  view: TimerView | null;
  clockSeconds: number;
  caps: CapStatus;
  /** The next signal still ahead, for the "next:" line. */
  next: { text: string; inSeconds: number } | null;
  soundOn: boolean;
  setSoundOn: (on: boolean) => void;
  start: (id: ActionId) => void;
  pauseResume: () => void;
  stop: () => void;
  startClock: () => void;
  pauseClock: () => void;
  resetClock: () => void;
  mark: () => void;
  dismissCap: (kind: 'half' | 'time') => void;
  selectTemplate: (id: number) => void;
  setOverrides: (o: TemplateOverrides) => void;
  overrides: TemplateOverrides;
};

/**
 * Runs the Timekeeper engine on a phone: persists the anchors on every start,
 * pause and resume; fires beep and haptics at each signal; schedules the pending
 * signals as notifications while backgrounded; and keeps the screen awake while a
 * timer or the clock runs.
 */
export function useTimekeeper(
  templates: TemplateSet = BUNDLED_TEMPLATES,
  scope: string = STANDALONE_SCOPE,
): TimekeeperApi {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<TimekeeperSession>(newSession());
  const [templateId, setTemplateId] = useState<number>(templates.defaultTemplateId);
  const [overridesAll, setOverridesAll] = useState<OverridesByTemplate>({});
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [soundOn, setSoundOn] = useState(true);
  const sessionRef = useRef(session);
  const lastElapsed = useRef(-1);

  const template = useMemo(
    () =>
      templates.templates.find((t) => t.id === templateId) ??
      templates.templates.find((t) => t.id === templates.defaultTemplateId) ??
      templates.templates[0],
    [templates, templateId],
  );
  const overrides = useMemo<TemplateOverrides>(
    () => overridesAll[String(template.id)] ?? {},
    [overridesAll, template.id],
  );
  const resolved = useMemo(() => resolveTemplate(template, overrides), [template, overrides]);

  const persist = useCallback(
    async (s: TimekeeperSession, tid = templateId, o = overridesAll) => {
      sessionRef.current = s;
      setSession(s);
      await (await getRepo()).saveTimekeeper(scope, s, tid, o);
    },
    [scope, templateId, overridesAll],
  );

  // Load the stored session once. Anchors are wall-clock, so a relaunch after a long
  // gap continues from the real elapsed time; signals that passed meanwhile are not re-sounded.
  useEffect(() => {
    configureNotifications();
    warmUpSounds();
    let live = true;
    void (async () => {
      const stored = await (await getRepo()).loadTimekeeper(scope);
      if (!live) return;
      sessionRef.current = stored.session;
      setSession(stored.session);
      if (stored.templateId !== null) setTemplateId(stored.templateId);
      setOverridesAll(stored.overrides);
      if (stored.session.timer) {
        lastElapsed.current = timerElapsed(stored.session.timer, Date.now());
      }
      setReady(true);
    })();
    return () => {
      live = false;
    };
  }, [scope]);

  const running = !!session.timer || session.clock.running;

  // Tick: derive everything from anchors; ticks only drive re-rendering and signals.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const now = Date.now();
      setNowMs(now);
      let s = sessionRef.current;
      if (s.timer && s.timer.pausedAtMs === null) {
        const elapsed = timerElapsed(s.timer, now);
        const fired = firedBetween(s.timer, lastElapsed.current, elapsed);
        lastElapsed.current = elapsed;
        for (const f of fired) void alertSignal(f.kind, soundOn);
        if (fired.length) s = applyFired(s, fired, now, resolved.caps);
      }
      if (s.clock.running) s = logCaps(s, now, resolved.caps);
      if (s !== sessionRef.current) void persist(s);
    }, 200);
    return () => clearInterval(id);
  }, [running, soundOn, resolved.caps, persist]);

  useEffect(() => {
    if (running) void activateKeepAwakeAsync('timekeeper');
    else void deactivateKeepAwake('timekeeper');
    return () => void deactivateKeepAwake('timekeeper');
  }, [running]);

  // JS timers stop on iOS in the background: hand pending signals to the OS as notifications.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      const s = sessionRef.current;
      if (state === 'active') {
        void cancelScheduledSignals();
        if (s.timer) lastElapsed.current = timerElapsed(s.timer, Date.now());
        setNowMs(Date.now());
      } else if (s.timer) {
        const pending = pendingSignals(s.timer, Date.now());
        if (pending.length) {
          void ensureNotificationPermission().then((ok) => {
            if (ok) {
              void scheduleSignals(
                i18n.t(`timekeeper.action.${s.timer?.scenario.id ?? ''}`),
                pending,
                signalText,
              );
            }
          });
        }
      }
    });
    return () => sub.remove();
  }, []);

  const act = useCallback(
    (fn: (s: TimekeeperSession, now: number) => TimekeeperSession) => {
      const now = Date.now();
      const next = fn(sessionRef.current, now);
      setNowMs(now);
      void persist(next);
    },
    [persist],
  );

  const view = session.timer ? timerView(session.timer, nowMs) : null;
  const next = useMemo(() => {
    if (!session.timer) return null;
    const elapsed = timerElapsed(session.timer, nowMs);
    const ahead = session.timer.scenario.signals.find((s) => s.at > elapsed);
    return ahead ? { text: ahead.text, inSeconds: ahead.at - elapsed } : null;
  }, [session.timer, nowMs]);

  return {
    ready,
    template,
    templates,
    nowMs,
    session,
    view,
    clockSeconds: clockElapsed(session.clock, nowMs),
    caps: capStatus(session, nowMs, resolved.caps),
    next,
    soundOn,
    setSoundOn,
    overrides,
    start: (id) =>
      act((s, now) => {
        lastElapsed.current = -1;
        void ensureNotificationPermission();
        return startAction(s, id, resolved.signals, i18n.t(`timekeeper.action.${id}`), now);
      }),
    pauseResume: () =>
      act((s, now) =>
        s.timer?.pausedAtMs === null || s.timer?.pausedAtMs === undefined
          ? pauseAction(s, now)
          : resumeAction(s, now),
      ),
    stop: () => act((s) => stopAction(s)),
    startClock: () => act((s, now) => startClock(s, now, resolved.caps)),
    pauseClock: () => act((s, now) => pauseClock(s, now)),
    resetClock: () => act((s) => resetClock(s)),
    mark: () => act((s, now) => addMark(s, 'mark', i18n.t('timekeeper.mark'), now)),
    dismissCap: (kind) => act((s) => dismissCap(s, kind)),
    selectTemplate: (id) => {
      setTemplateId(id);
      void persist(sessionRef.current, id);
    },
    setOverrides: (o) => {
      const all = { ...overridesAll, [String(template.id)]: o };
      setOverridesAll(all);
      void persist(sessionRef.current, templateId, all);
    },
  };
}
