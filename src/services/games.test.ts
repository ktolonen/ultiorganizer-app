import { DatabaseSync } from 'node:sqlite';
import { entryContextFixture } from '../game/fixtures';
import { type Db, migrate } from '../store/migrations';
import { createRepo } from '../store/repo';
import { gameTitle, groupByField, openGame, PREFETCH_FRESH_MS, prefetchContexts } from './games';

async function setup() {
  const raw = new DatabaseSync(':memory:');
  const db: Db = {
    execAsync: async (s) => void raw.exec(s),
    getFirstAsync: async (s, ...p) => (raw.prepare(s).get(...(p as never[])) as never) ?? null,
    getAllAsync: async (s, ...p) => raw.prepare(s).all(...(p as never[])) as never,
    runAsync: async (s, ...p) => raw.prepare(s).run(...(p as never[])),
    withTransactionAsync: async (t) => {
      raw.exec('BEGIN');
      await t();
      raw.exec('COMMIT');
    },
  };
  await migrate(db);
  const repo = createRepo(db);
  const server = await repo.upsertServer('https://a.org', 'a.org', 0);
  const saved: string[] = [];
  return {
    repo,
    server,
    saved,
    saveLinkToken: async (_s: number, g: number, t: string) => void saved.push(`${g}:${t}`),
  };
}

const creds = { root: 'https://a.org', appToken: 'app', linkToken: 'l'.repeat(32) };
const ok = () =>
  jest.fn().mockResolvedValue(new Response(JSON.stringify({ data: entryContextFixture() })));

describe('openGame', () => {
  it('fetches the entry context, stores the game and the link token', async () => {
    const { repo, server, saved, saveLinkToken } = await setup();
    const fetch = ok();
    const r = await openGame({
      repo,
      creds,
      serverId: server.id,
      gameId: 123,
      saveLinkToken,
      fetch,
      now: 5,
    });
    expect(r).toMatchObject({
      ok: true,
      game: { resumed: false, session: { gameId: 123, title: 'Field 3 · Home – Away' } },
    });
    expect(saved).toEqual([`123:${'l'.repeat(32)}`]);
    expect((await repo.loadGame(server.id, 123))?.outbox.token).toBe('tok0');
  });
  it('resumes a game already on the phone without asking the server', async () => {
    const { repo, server, saveLinkToken } = await setup();
    await openGame({
      repo,
      creds,
      serverId: server.id,
      gameId: 123,
      saveLinkToken,
      fetch: ok(),
      now: 5,
    });
    const fetch = jest.fn();
    const r = await openGame({
      repo,
      creds,
      serverId: server.id,
      gameId: 123,
      saveLinkToken,
      fetch,
      now: 6,
    });
    expect(r).toMatchObject({ ok: true, game: { resumed: true } });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('maps failures', async () => {
    const { repo, server, saveLinkToken } = await setup();
    const run = (res: unknown) =>
      openGame({
        repo,
        creds,
        serverId: server.id,
        gameId: 9,
        saveLinkToken,
        fetch: res as never,
        now: 0,
      });
    expect(await run(jest.fn().mockRejectedValue(new Error('x')))).toEqual({
      ok: false,
      error: 'network',
    });
    expect(
      await run(
        jest
          .fn()
          .mockResolvedValue(
            new Response('{"error":{"code":"game_not_covered"}}', { status: 403 }),
          ),
      ),
    ).toEqual({ ok: false, error: 'forbidden' });
    expect(
      await run(
        jest
          .fn()
          .mockResolvedValue(new Response('{"error":{"code":"game_not_found"}}', { status: 404 })),
      ),
    ).toEqual({ ok: false, error: 'not_found' });
    expect(await run(jest.fn().mockResolvedValue(new Response('{"data":{}}')))).toEqual({
      ok: false,
      error: 'bad_body',
    });
    expect(await repo.listGames()).toEqual([]); // nothing stored on failure
  });
});

describe('list helpers', () => {
  const g = (id: number, field: string | null, time: string) =>
    ({
      game_id: id,
      field,
      time,
      location: null,
      pool: { pool_id: 1, name: 'A' },
      home: { team_id: 1, name: 'H' },
      away: { team_id: 2, name: 'V' },
      result: { state: 'not_started', home: null, away: null },
    }) as never;
  it('groups by field and sorts by time', () => {
    const groups = groupByField([
      g(3, '2', '2026-06-01 11:00:00'),
      g(1, '1', '2026-06-01 10:00:00'),
      g(2, '2', '2026-06-01 09:00:00'),
    ]);
    expect(groups.map(([f, gs]) => [f, gs.map((x) => x.game_id)])).toEqual([
      ['2', [2, 3]],
      ['1', [1]],
    ]);
  });
  it('titles a game by field and teams', () => {
    expect(gameTitle({ field: null, home: { name: null }, away: { name: 'V' } })).toBe('? – V');
  });
});

describe('saved server data', () => {
  const offline = () => jest.fn().mockRejectedValue(new Error('offline'));
  const status = (code: string, s: number) =>
    jest.fn().mockResolvedValue(new Response(`{"error":{"code":"${code}"}}`, { status: s }));
  const open = (d: Awaited<ReturnType<typeof setup>>, fetch: unknown, gameId = 123) =>
    openGame({
      repo: d.repo,
      creds,
      serverId: d.server.id,
      gameId,
      saveLinkToken: d.saveLinkToken,
      fetch: fetch as never,
      now: 50,
    });

  it('opens a game from the saved entry context when the server cannot be reached', async () => {
    const d = await setup();
    await d.repo.cacheContext(d.server.id, entryContextFixture(), 10);
    const r = await open(d, offline());
    expect(r).toMatchObject({ ok: true, game: { resumed: false, cachedAt: 10 } });
    // It is now an ordinary game on the phone with the saved token, and the cache row is gone.
    expect((await d.repo.loadGame(d.server.id, 123))?.outbox.token).toBe('tok0');
    expect(await d.repo.cachedContext(d.server.id, 123)).toBeNull();
    expect(d.saved).toEqual([`123:${'l'.repeat(32)}`]);
  });
  it('uses saved data when the server is unavailable rather than refusing', async () => {
    for (const res of [
      new Response('{"error":{"code":"maintenance"}}', { status: 503 }),
      new Response('<html>Bad gateway</html>', { status: 502 }),
      new Response('<html>Wi-Fi login</html>', { status: 200 }),
      new Response('{"error":{"code":"rate_limited"}}', { status: 429 }),
    ]) {
      const d = await setup();
      await d.repo.cacheContext(d.server.id, entryContextFixture(), 10);
      const r = await open(d, jest.fn().mockResolvedValue(res));
      expect(r).toMatchObject({ ok: true, game: { cachedAt: 10 } });
    }
  });
  it('does not fall back to saved data when the server refuses', async () => {
    const d = await setup();
    await d.repo.cacheContext(d.server.id, entryContextFixture(), 10);
    expect(await open(d, status('game_not_covered', 403))).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(await open(d, status('game_not_found', 404))).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(await d.repo.listGames()).toEqual([]);
  });
  it('prefers a fresh entry context and drops the saved one', async () => {
    const d = await setup();
    await d.repo.cacheContext(d.server.id, entryContextFixture({ token: 'old' }), 10);
    const r = await open(d, ok());
    expect(r).toMatchObject({ ok: true, game: { cachedAt: undefined } });
    expect((await d.repo.loadGame(d.server.id, 123))?.outbox.token).toBe('tok0');
    expect(await d.repo.cachedContext(d.server.id, 123)).toBeNull();
  });

  const ctxFor = (gameId: number) => ({
    data: entryContextFixture({ game: { ...entryContextFixture().game, game_id: gameId } }),
  });
  const prefetch = (
    d: Awaited<ReturnType<typeof setup>>,
    fetch: jest.Mock,
    ids: number[],
    now = 7,
    final: number[] = [],
  ) =>
    prefetchContexts({
      repo: d.repo,
      creds,
      serverId: d.server.id,
      games: ids.map((id) => ({
        game_id: id,
        result: { state: final.includes(id) ? 'final' : 'ongoing' },
      })),
      fetch: fetch as never,
      now: () => now,
    });

  it('saves the entry context of each listed game not yet on the phone', async () => {
    const d = await setup();
    await open(d, ok()); // game 123 is on the phone already
    const fetch = jest.fn((url: string) => {
      const id = Number(/games\/(\d+)/.exec(url)![1]);
      return Promise.resolve(new Response(JSON.stringify(ctxFor(id))));
    });
    expect(await prefetch(d, fetch, [123, 5, 6])).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((await d.repo.cachedContext(d.server.id, 5))?.fetchedAt).toBe(7);
    expect(await d.repo.cachedContext(d.server.id, 123)).toBeNull();
  });
  it('skips final games and games saved in the last few minutes', async () => {
    const d = await setup();
    const fetch = jest.fn((url: string) => {
      const id = Number(/games\/(\d+)/.exec(url)![1]);
      return Promise.resolve(new Response(JSON.stringify(ctxFor(id))));
    });
    expect(await prefetch(d, fetch, [1, 2], 1000, [2])).toBe(1);
    expect(await prefetch(d, fetch, [1], 1000 + PREFETCH_FRESH_MS - 1)).toBe(0);
    expect(await prefetch(d, fetch, [1], 1000 + PREFETCH_FRESH_MS)).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('asks If-None-Match for a saved context and keeps it on 304', async () => {
    const d = await setup();
    const first = jest.fn(() =>
      Promise.resolve(new Response(JSON.stringify(ctxFor(1)), { headers: { ETag: '"tok0-abc"' } })),
    );
    expect(await prefetch(d, first, [1], 1000)).toBe(1);
    expect((await d.repo.cachedContext(d.server.id, 1))?.etag).toBe('"tok0-abc"');
    const later = 1000 + PREFETCH_FRESH_MS;
    const same = jest.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(new Response(null, { status: 304 })),
    );
    expect(await prefetch(d, same, [1], later)).toBe(0);
    expect(same.mock.calls[0][1].headers).toMatchObject({ 'If-None-Match': '"tok0-abc"' });
    const kept = await d.repo.cachedContext(d.server.id, 1);
    expect(kept).toMatchObject({ fetchedAt: later, etag: '"tok0-abc"' });
    expect(kept?.context.game.game_id).toBe(1);
  });
  it('skips a missing game but stops at a network failure or a refused link', async () => {
    const d = await setup();
    const answers = [
      new Response('{"error":{"code":"game_not_found"}}', { status: 404 }),
      new Response(JSON.stringify(ctxFor(2))),
      new Response('{"error":{"code":"rate_limited"}}', { status: 429 }),
      new Response(JSON.stringify(ctxFor(4))),
    ];
    const fetch = jest.fn(() => Promise.resolve(answers.shift()!));
    expect(await prefetch(d, fetch, [1, 2, 3, 4])).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(3);
    const net = jest.fn().mockRejectedValue(new Error('offline'));
    expect(await prefetch(d, net, [7, 8])).toBe(0);
    expect(net).toHaveBeenCalledTimes(1);
  });
});
