import { DatabaseSync } from 'node:sqlite';
import { entryContextFixture } from '../game/fixtures';
import { fromEntryContext } from '../game/reducer';
import { newOutbox } from '../sync/outbox';
import { newSession, startClock } from '../timekeeper/engine';
import { BUNDLED_TEMPLATES } from '../timekeeper/templates';
import { type Db, MIGRATIONS, migrate } from './migrations';
import {
  CACHE_RETENTION_MS,
  LINK_RETENTION_MS,
  RETENTION_MS,
  STANDALONE_SCOPE,
  createRepo,
  gameScope,
  parseAutoPoint,
} from './repo';

/** Adapts node:sqlite (real SQL, in memory) to the app's Db interface. */
function memoryDb(): Db {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  return {
    execAsync: async (sql) => void raw.exec(sql),
    getFirstAsync: async (sql, ...p) => (raw.prepare(sql).get(...(p as never[])) as never) ?? null,
    getAllAsync: async (sql, ...p) => raw.prepare(sql).all(...(p as never[])) as never,
    runAsync: async (sql, ...p) => raw.prepare(sql).run(...(p as never[])),
    withTransactionAsync: async (task) => {
      raw.exec('BEGIN');
      try {
        await task();
        raw.exec('COMMIT');
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

async function fresh() {
  const db = memoryDb();
  await migrate(db);
  return { db, repo: createRepo(db) };
}

const NOW = 1_800_000_000_000;

function gameInput(serverId: number, gameId = 123, over: object = {}) {
  const context = entryContextFixture();
  return {
    serverId,
    gameId,
    title: 'Field 3 · Home – Away',
    context,
    state: fromEntryContext(context),
    outbox: newOutbox(gameId, context.token, null),
    now: NOW,
    ...over,
  };
}

describe('migrations', () => {
  it('creates the schema once and records the version', async () => {
    const db = memoryDb();
    expect(await migrate(db)).toBe(MIGRATIONS.length);
    await migrate(db); // second run is a no-op
    const v = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(v?.user_version).toBe(MIGRATIONS.length);
  });
  it('refuses a database from a newer app', async () => {
    const db = memoryDb();
    await db.execAsync('PRAGMA user_version = 99');
    await expect(migrate(db)).rejects.toThrow(/newer/);
  });
  it('rolls a failed step back', async () => {
    const db = memoryDb();
    await expect(migrate(db, ['CREATE TABLE a (x)', 'CREATE TABLE a (x)'])).rejects.toThrow();
    const v = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(v?.user_version).toBe(1);
  });
});

describe('servers', () => {
  it('upserts by root and keeps the id', async () => {
    const { repo } = await fresh();
    const a = await repo.upsertServer('https://a.org', 'A', NOW);
    const b = await repo.upsertServer('https://a.org', 'A renamed', NOW + 5);
    expect(b.id).toBe(a.id);
    expect(b.label).toBe('A renamed');
    expect(await repo.listServers()).toHaveLength(1);
  });
  it('remembers route probes and template caches', async () => {
    const { repo } = await fresh();
    const s = await repo.upsertServer('https://a.org', 'A', NOW);
    expect(await repo.getProbes(s.id)).toEqual({});
    await repo.setProbe(s.id, 'timekeeper/templates', 'absent');
    await repo.setProbe(s.id, 'caps', 'present');
    expect(await repo.getProbes(s.id)).toEqual({
      'timekeeper/templates': 'absent',
      caps: 'present',
    });
    expect(await repo.getCachedTemplates(s.id)).toBeNull();
    await repo.setCachedTemplates(s.id, BUNDLED_TEMPLATES);
    expect(await repo.getCachedTemplates(s.id)).toEqual(BUNDLED_TEMPLATES);
  });
  it('deleting a server deletes its games', async () => {
    const { repo } = await fresh();
    const s = await repo.upsertServer('https://a.org', 'A', NOW);
    await repo.saveGame(gameInput(s.id));
    await repo.removeServer(s.id);
    expect(await repo.listGames()).toEqual([]);
  });
});

describe('games', () => {
  it('round-trips a game with its outbox and colours', async () => {
    const { repo } = await fresh();
    const s = await repo.upsertServer('https://a.org', 'A', NOW);
    await repo.saveGame({ ...gameInput(s.id), colors: { home: '#d21f3c', away: '#0f8a4b' } });
    const g = await repo.loadGame(s.id, 123);
    expect(g?.context.token).toBe('tok0');
    expect(g?.state.gameId).toBe(123);
    expect(g?.outbox.gameId).toBe(123);
    expect(g?.colors).toEqual({ home: '#d21f3c', away: '#0f8a4b' });
  });
  it('keeps the colours when a later save omits them', async () => {
    const { repo } = await fresh();
    const s = await repo.upsertServer('https://a.org', 'A', NOW);
    await repo.saveGame({ ...gameInput(s.id), colors: { home: '#111111', away: '#222222' } });
    await repo.saveGame(gameInput(s.id));
    expect((await repo.loadGame(s.id, 123))?.colors).toEqual({ home: '#111111', away: '#222222' });
  });
  it('treats unreadable data as absent instead of throwing', async () => {
    const { db, repo } = await fresh();
    const s = await repo.upsertServer('https://a.org', 'A', NOW);
    await repo.saveGame(gameInput(s.id));
    await db.runAsync("UPDATE games SET outbox_json = '{not json'");
    expect(await repo.loadGame(s.id, 123)).toBeNull();
  });
  it('lists games with their unsent count', async () => {
    const { repo } = await fresh();
    const s = await repo.upsertServer('https://a.org', 'A', NOW);
    const input = gameInput(s.id);
    const outbox = {
      ...input.outbox,
      rows: [
        {
          key: 'k',
          op: 'goal' as const,
          event: null,
          method: 'POST' as const,
          path: '/x',
          body: {},
          status: 'pending' as const,
          attempts: 0,
          createdAt: 0,
        },
      ],
    };
    await repo.saveGame({ ...input, outbox });
    expect((await repo.listGames(s.id))[0]).toMatchObject({ gameId: 123, unsent: 1 });
  });
  it('purges only games finalized and synced more than 30 days ago', async () => {
    const { repo } = await fresh();
    const s = await repo.upsertServer('https://a.org', 'A', NOW);
    const finalCtx = entryContextFixture({ result: { home: 1, away: 0, state: 'final' } });
    const finalInput = (id: number, now: number) => ({
      ...gameInput(s.id, id),
      context: finalCtx,
      state: fromEntryContext(finalCtx),
      now,
    });
    await repo.saveGame(finalInput(1, NOW - RETENTION_MS - 1000)); // old, synced
    await repo.saveGame(finalInput(2, NOW - 1000)); // recent
    await repo.saveGame(gameInput(s.id, 3, { now: NOW - RETENTION_MS * 2 })); // old but never finalized
    expect(await repo.purgeOldGames(NOW)).toEqual([{ serverId: s.id, gameId: 1 }]);
    expect((await repo.listGames()).map((g) => g.gameId).sort()).toEqual([2, 3]);
  });
  it('does not purge a finalized game that still has unsent rows', async () => {
    const { repo } = await fresh();
    const s = await repo.upsertServer('https://a.org', 'A', NOW);
    const ctx = entryContextFixture({ result: { home: 1, away: 0, state: 'final' } });
    const base = gameInput(s.id, 1, {
      context: ctx,
      state: fromEntryContext(ctx),
      now: NOW - RETENTION_MS * 2,
    });
    const outbox = {
      ...base.outbox,
      rows: [
        {
          key: 'k',
          op: 'finalize' as const,
          event: null,
          method: 'POST' as const,
          path: '/x',
          body: null,
          status: 'pending' as const,
          attempts: 0,
          createdAt: 0,
        },
      ],
    };
    await repo.saveGame({ ...base, outbox });
    expect(await repo.purgeOldGames(NOW)).toEqual([]);
  });
});

describe('timekeeper and settings', () => {
  const STARTED = startClock(newSession(), NOW, { half_time_cap: 55, time_cap: 100 });

  it('starts empty, then persists the session anchors', async () => {
    const { repo } = await fresh();
    expect((await repo.loadTimekeeper(STANDALONE_SCOPE)).session).toEqual(newSession());
    await repo.saveTimekeeper(STANDALONE_SCOPE, STARTED, 4, { '4': { caps: { time_cap: 90 } } });
    const loaded = await repo.loadTimekeeper(STANDALONE_SCOPE);
    expect(loaded.session).toEqual(STARTED);
    expect(loaded.templateId).toBe(4);
    expect(loaded.overrides).toEqual({ '4': { caps: { time_cap: 90 } } });
  });
  it('keeps one clock per game and for standalone mode', async () => {
    const { repo } = await fresh();
    await repo.saveTimekeeper(gameScope(1, 10), STARTED, null, {});
    expect((await repo.loadTimekeeper(gameScope(1, 11))).session).toEqual(newSession());
    expect((await repo.loadTimekeeper(STANDALONE_SCOPE)).session).toEqual(newSession());
    expect((await repo.loadTimekeeper(gameScope(1, 10))).session).toEqual(STARTED);
  });
  it('shares the template choice and local edits across scopes', async () => {
    const { repo } = await fresh();
    await repo.saveTimekeeper(gameScope(1, 10), STARTED, 7, { '7': { caps: { time_cap: 80 } } });
    const other = await repo.loadTimekeeper(STANDALONE_SCOPE);
    expect(other.templateId).toBe(7);
    expect(other.overrides).toEqual({ '7': { caps: { time_cap: 80 } } });
  });
  it('deleting or purging a game deletes its clock', async () => {
    const { repo } = await fresh();
    const s = await repo.upsertServer('https://a.org', 'A', NOW);
    await repo.saveGame(gameInput(s.id, 5));
    await repo.saveTimekeeper(gameScope(s.id, 5), STARTED, null, {});
    await repo.deleteGame(s.id, 5);
    expect((await repo.loadTimekeeper(gameScope(s.id, 5))).session).toEqual(newSession());

    const ctx = entryContextFixture({ result: { home: 1, away: 0, state: 'final' } });
    await repo.saveGame({
      ...gameInput(s.id, 6),
      context: ctx,
      state: fromEntryContext(ctx),
      now: NOW - RETENTION_MS - 5,
    });
    await repo.saveTimekeeper(gameScope(s.id, 6), STARTED, null, {});
    await repo.purgeOldGames(NOW);
    expect((await repo.loadTimekeeper(gameScope(s.id, 6))).session).toEqual(newSession());
  });
  it('falls back to a new session when the stored one is corrupt', async () => {
    const { db, repo } = await fresh();
    await repo.saveTimekeeper(STANDALONE_SCOPE, newSession(), null, {});
    await db.runAsync('UPDATE timekeeper_sessions SET session_json = \'{"timer": 5}\'');
    expect((await repo.loadTimekeeper(STANDALONE_SCOPE)).session).toEqual(newSession());
  });
  it('stores settings', async () => {
    const { repo } = await fresh();
    expect(await repo.getSetting('theme')).toBeNull();
    await repo.setSetting('theme', 'dark');
    await repo.setSetting('theme', 'light');
    expect(await repo.getSetting('theme')).toBe('light');
  });
});

describe('auto point setting', () => {
  it('is on unless explicitly turned off', () => {
    expect(parseAutoPoint(null)).toBe(true);
    expect(parseAutoPoint('on')).toBe(true);
    expect(parseAutoPoint('off')).toBe(false);
  });
});

describe('saved links', () => {
  it('lists newest first, updates in place and cascades with the server', async () => {
    const { repo } = await fresh();
    const s = await repo.upsertServer('https://a.org', 'A', NOW);
    const a = await repo.insertLink({ serverId: s.id, label: 'Field 1', day: null, now: NOW });
    const b = await repo.insertLink({ serverId: s.id, label: 'Field 2', day: null, now: NOW + 1 });
    expect((await repo.listLinks()).map((l) => l.id)).toEqual([b, a]);
    await repo.updateLink(a, { label: 'Field 1, Field 4', day: '2026-11-01', now: NOW + 2 });
    expect((await repo.listLinks(s.id))[0]).toEqual({
      id: a,
      serverId: s.id,
      label: 'Field 1, Field 4',
      day: '2026-11-01',
      usedAt: NOW + 2,
    });
    await repo.removeServer(s.id);
    expect(await repo.listLinks()).toEqual([]);
  });
  it('purges links not opened for a week', async () => {
    const { repo } = await fresh();
    const s = await repo.upsertServer('https://a.org', 'A', NOW);
    const old = await repo.insertLink({
      serverId: s.id,
      label: '',
      day: null,
      now: NOW - LINK_RETENTION_MS - 1,
    });
    const recent = await repo.insertLink({ serverId: s.id, label: '', day: null, now: NOW - 1 });
    // Scanned long ago, but its game day is still ahead.
    const ahead = await repo.insertLink({
      serverId: s.id,
      label: '',
      day: new Date(NOW + 3 * 86_400_000).toISOString().slice(0, 10),
      now: NOW - LINK_RETENTION_MS * 3,
    });
    expect(await repo.purgeOldLinks(NOW)).toEqual([old]);
    expect((await repo.listLinks()).map((l) => l.id).sort()).toEqual([recent, ahead].sort());
  });
});

describe('game times', () => {
  it('lists the scheduled time from the stored entry context', async () => {
    const { repo } = await fresh();
    const s = await repo.upsertServer('https://a.org', 'A', NOW);
    await repo.saveGame(gameInput(s.id));
    expect((await repo.listGames())[0].time).toBe('2026-06-01 10:00:00');
  });
});

describe('caps in stored games', () => {
  it('reads caps from the stored entry context for a game saved before caps were kept', async () => {
    const { repo } = await fresh();
    const s = await repo.upsertServer('https://a.org', 'A', NOW);
    const input = gameInput(s.id);
    input.context.retained.cap_events = [{ type: 'half_cap', time: 1500, point_cap: 8 }];
    const { caps: _dropped, ...old } = input.state;
    await repo.saveGame({ ...input, state: old as typeof input.state });
    expect((await repo.loadGame(s.id, 123))?.state.caps).toEqual({
      half_cap: { time: 1500, pointCap: 8 },
    });
  });
});

describe('cached server data', () => {
  const list = {
    event_id: 'E1',
    games: [],
    available_from: '2026-06-01',
  };
  it('round-trips a game list by link hash and an entry context by game', async () => {
    const { repo } = await fresh();
    const s = await repo.upsertServer('https://a.org', 'A', NOW);
    await repo.cacheList(s.id, 'hash1', list, NOW);
    await repo.cacheList(s.id, 'hash1', { ...list, available_from: null }, NOW + 1);
    expect(await repo.cachedList(s.id, 'hash1')).toEqual({
      data: { ...list, available_from: null },
      fetchedAt: NOW + 1,
    });
    expect(await repo.cachedList(s.id, 'other')).toBeNull();
    await repo.cacheContext(s.id, entryContextFixture(), NOW);
    expect((await repo.cachedContext(s.id, 123))?.context.token).toBe('tok0');
    await repo.dropCachedContext(s.id, 123);
    expect(await repo.cachedContext(s.id, 123)).toBeNull();
  });
  it('purges data older than the retention and goes with its server', async () => {
    const { repo } = await fresh();
    const s = await repo.upsertServer('https://a.org', 'A', NOW);
    await repo.cacheList(s.id, 'old', list, NOW - CACHE_RETENTION_MS - 1);
    await repo.cacheList(s.id, 'new', list, NOW);
    await repo.cacheContext(s.id, entryContextFixture(), NOW - CACHE_RETENTION_MS - 1);
    await repo.purgeCache(NOW);
    expect(await repo.cachedList(s.id, 'old')).toBeNull();
    expect(await repo.cachedList(s.id, 'new')).not.toBeNull();
    expect(await repo.cachedContext(s.id, 123)).toBeNull();
    await repo.removeServer(s.id);
    expect(await repo.cachedList(s.id, 'new')).toBeNull();
  });
});
