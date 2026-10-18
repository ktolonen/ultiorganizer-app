import { DatabaseSync } from 'node:sqlite';
import { entryContextFixture } from '../game/fixtures';
import { type Db, migrate } from '../store/migrations';
import { createRepo } from '../store/repo';
import { gameTitle, groupByField, openGame } from './games';

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
