import { randomUUID } from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { fetchEntryContext, sendRequest, type Credentials } from '../api/http';
import { credentialsForGame } from '../services/session';
import { getRepo } from '../store/sqlite';
import {
  keepServerVersion,
  syncStatus,
  uploadMyVersion,
  retryFailed,
  resumeAfterAuth,
  shouldOfferUpload,
  type OutboxState,
  type SyncStatus,
} from '../sync/outbox';
import { drain } from '../sync/sender';
import { defaultTeamColors } from '../ui/tokens';
import { applyEvent, refreshEligible, undoLastGoal, uploadAll, type GameSession } from './runtime';
import { fromEntryContext, type GameError, type GameEvent } from './reducer';
import { toGameData } from './upload';
import type { EntryContext } from './types';

export type ActionError = GameError | { code: 'busy' | 'no_token'; message: string };

export type GameHandle = {
  loaded: boolean;
  session: GameSession | null;
  colors: { home: string; away: string };
  status: SyncStatus;
  /** The server's version, fetched after a conflict, for the "someone else changed this game" sheet. */
  conflict: { fresh: EntryContext } | null;
  offerUpload: boolean;
  /** Applies a user action; returns the refusal, or null when it was accepted. */
  apply: (event: GameEvent) => ActionError | null;
  undoGoal: () => ActionError | null;
  uploadWholeGame: () => ActionError | null;
  keepServer: () => void;
  /** Returns why the whole game cannot be uploaded (for example, the score disagrees with the goals). */
  uploadMine: () => ActionError | null;
  retry: (rowKey: string) => void;
  resumeAuth: () => void;
  syncNow: () => void;
  setColors: (c: { home: string; away: string }) => void;
};

/**
 * One game on the phone. The device is the source of truth during play: every
 * accepted action is saved to SQLite (state and outbox together) before any network
 * attempt, and a single sender loop converges the server to it.
 */
export function useGame(serverId: number, gameId: number): GameHandle {
  const [session, setSession] = useState<GameSession | null>(null);
  const [colors, setColorsState] = useState(() => defaultTeamColors(gameId));
  const [conflict, setConflict] = useState<{ fresh: EntryContext } | null>(null);
  const ref = useRef<GameSession | null>(null);
  const colorsRef = useRef(colors);
  const creds = useRef<Credentials | null>(null);
  const draining = useRef(false);
  const again = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const commit = useCallback(async (next: GameSession) => {
    ref.current = next;
    setSession(next);
    await (await getRepo()).saveGame({ ...next, colors: colorsRef.current, now: Date.now() });
  }, []);

  const kick = useCallback(async () => {
    if (!ref.current || !creds.current) return;
    if (draining.current) {
      // A row queued after the running drain's last look would wait for the next trigger.
      again.current = true;
      return;
    }
    draining.current = true;
    try {
      const c = creds.current;
      const { retryAt } = await drain({
        get: () => ref.current!.outbox,
        set: (outbox: OutboxState) => commit({ ...ref.current!, outbox }),
        transport: (req) => sendRequest(c, req),
        now: Date.now,
        shouldStop: () => !alive.current,
      });
      if (timer.current) clearTimeout(timer.current);
      if (retryAt !== null && alive.current) {
        timer.current = setTimeout(() => void kick(), Math.max(250, retryAt - Date.now()));
      }
    } finally {
      draining.current = false;
      if (again.current && alive.current) {
        again.current = false;
        void kick();
      }
    }
  }, [commit]);

  useEffect(() => {
    alive.current = true;
    void (async () => {
      const repo = await getRepo();
      const local = await repo.loadGame(serverId, gameId);
      creds.current = await credentialsForGame(serverId, gameId);
      if (!local || !alive.current) return;
      if (local.colors) {
        colorsRef.current = local.colors;
        setColorsState(local.colors);
      }
      const s: GameSession = {
        serverId,
        gameId,
        title: local.title,
        context: local.context,
        state: local.state,
        outbox: local.outbox,
      };
      ref.current = s;
      setSession(s);
      void kick();
      // Players added on the server after the game was opened: refresh the pickable list in
      // the background. Offline or refused reads keep the stored list.
      if (creds.current && !s.outbox.offlineOnly) {
        const r = await fetchEntryContext(creds.current, gameId);
        const cur = ref.current;
        if (r.ok && alive.current && cur) {
          const next = refreshEligible(cur, r.data);
          if (next !== cur) await commit(next);
        }
      }
    })();
    const sub = AppState.addEventListener('change', (st) => st === 'active' && void kick());
    return () => {
      alive.current = false;
      sub.remove();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [serverId, gameId, kick, commit]);

  // A conflict or a refused row pauses the queue: fetch the server's version so the sheet can
  // show both. A refused row cannot simply be dropped, because local state already contains it.
  const paused = session?.outbox.paused;
  const conflictCode =
    paused?.reason === 'conflict' || paused?.reason === 'failed'
      ? `${paused.reason}:${paused.code}`
      : null;
  useEffect(() => {
    if (!conflictCode || !creds.current) return;
    let live = true;
    void fetchEntryContext(creds.current, gameId).then((r) => {
      if (live && r.ok) setConflict({ fresh: r.data });
    });
    return () => {
      live = false;
    };
  }, [conflictCode, gameId]);

  const deps = () => ({ now: Date.now(), newKey: randomUUID });
  const run = (fn: (s: GameSession) => ReturnType<typeof applyEvent>): ActionError | null => {
    const cur = ref.current;
    if (!cur) return { code: 'validation_failed', message: 'Game not loaded.' };
    const r = fn(cur);
    if (!r.ok) return r.error;
    void commit(r.session).then(() => kick());
    return null;
  };

  return {
    loaded: session !== null,
    session,
    colors,
    status: session ? syncStatus(session.outbox) : { kind: 'synced' },
    conflict,
    offerUpload: session ? shouldOfferUpload(session.outbox) : false,
    apply: (event) => run((s) => applyEvent(s, event, deps())),
    undoGoal: () => run((s) => undoLastGoal(s, deps())),
    uploadWholeGame: () => run((s) => uploadAll(s, deps())),
    keepServer: () => {
      const cur = ref.current;
      if (!cur || !conflict) return;
      const { fresh } = conflict;
      void commit({
        ...cur,
        context: fresh,
        state: fromEntryContext(fresh),
        outbox: keepServerVersion(cur.outbox, { token: fresh.token, result: fresh.result }),
      }).then(() => {
        setConflict(null);
        void kick();
      });
    },
    uploadMine: () => {
      const cur = ref.current;
      if (!cur || !conflict) return { code: 'validation_failed', message: 'Nothing to upload.' };
      const doc = toGameData(cur.state);
      if (!doc.ok) return doc.error;
      const { fresh } = conflict;
      const outbox = uploadMyVersion(
        cur.outbox,
        { token: fresh.token, result: fresh.result },
        doc.doc,
        randomUUID(),
        Date.now(),
      );
      if (!outbox) return { code: 'busy', message: 'A request is in flight.' };
      void commit({ ...cur, outbox }).then(() => {
        setConflict(null);
        void kick();
      });
      return null;
    },
    retry: (key) => {
      const cur = ref.current;
      if (!cur) return;
      void commit({ ...cur, outbox: retryFailed(cur.outbox, key) }).then(() => kick());
    },
    resumeAuth: () => {
      const cur = ref.current;
      if (!cur) return;
      void credentialsForGame(serverId, gameId).then((c) => {
        creds.current = c;
        return commit({ ...cur, outbox: resumeAfterAuth(cur.outbox) }).then(() => kick());
      });
    },
    syncNow: () => void kick(),
    setColors: (c) => {
      colorsRef.current = c;
      setColorsState(c);
      if (ref.current) void commit(ref.current);
    },
  };
}
