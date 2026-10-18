import { DatabaseSync } from 'node:sqlite';
import { type Db, migrate } from '../store/migrations';
import { createRepo } from '../store/repo';
import en from '../i18n/locales/en.app.json';
import { pairErrorKey, pairServer, type PairError } from './pairing';

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
  const saved: [number, string][] = [];
  return {
    repo: createRepo(db),
    saved,
    saveToken: async (id: number, t: string) => void saved.push([id, t]),
  };
}

const reply = (status: number) => jest.fn().mockResolvedValue(new Response('{}', { status }));

describe('pairServer', () => {
  it('stores the server and token once the server accepts the token', async () => {
    const { repo, saved, saveToken } = await setup();
    const fetch = reply(200);
    const r = await pairServer(
      { root: 'https://Example.org/uo/', token: ' tok ' },
      { repo, saveToken, fetch },
    );
    expect(r).toMatchObject({
      ok: true,
      server: { root: 'https://example.org/uo', label: 'example.org' },
    });
    expect(saved).toEqual([[1, 'tok']]);
    expect(fetch.mock.calls[0][0]).toBe('https://example.org/uo/api/v1/version');
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
  });
  it('stores nothing when the token is rejected', async () => {
    const { repo, saved, saveToken } = await setup();
    expect(
      await pairServer(
        { root: 'https://a.org', token: 'bad' },
        { repo, saveToken, fetch: reply(401) },
      ),
    ).toEqual({ ok: false, error: 'rejected' });
    expect(await repo.listServers()).toEqual([]);
    expect(saved).toEqual([]);
  });
  it('reports network and unexpected failures', async () => {
    const { repo, saveToken } = await setup();
    const down = jest.fn().mockRejectedValue(new TypeError('offline'));
    expect(
      await pairServer({ root: 'https://a.org', token: 't' }, { repo, saveToken, fetch: down }),
    ).toEqual({ ok: false, error: 'network' });
    expect(
      await pairServer(
        { root: 'https://a.org', token: 't' },
        { repo, saveToken, fetch: reply(500) },
      ),
    ).toEqual({ ok: false, error: 'unexpected' });
  });
  it('refuses http and an empty token without calling the server', async () => {
    const { repo, saveToken } = await setup();
    const fetch = reply(200);
    expect(
      await pairServer({ root: 'http://a.org', token: 't' }, { repo, saveToken, fetch }),
    ).toEqual({ ok: false, error: 'insecure_root' });
    expect(
      await pairServer({ root: 'https://a.org', token: '  ' }, { repo, saveToken, fetch }),
    ).toEqual({ ok: false, error: 'missing_token' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('pairing the same root again keeps one server and replaces the token', async () => {
    const { repo, saved, saveToken } = await setup();
    const f = reply(200);
    await pairServer({ root: 'https://a.org', token: 'one' }, { repo, saveToken, fetch: f });
    await pairServer({ root: 'https://a.org', token: 'two' }, { repo, saveToken, fetch: f });
    expect(await repo.listServers()).toHaveLength(1);
    expect(saved).toEqual([
      [1, 'one'],
      [1, 'two'],
    ]);
  });
});

describe('pairErrorKey', () => {
  it('has an English message for every error', () => {
    const all: PairError[] = [
      'not_a_url',
      'wrong_kind',
      'insecure_root',
      'bad_root',
      'bad_link_token',
      'missing_token',
      'network',
      'rejected',
      'unexpected',
    ];
    for (const e of all) expect(Object.keys(en)).toContain(pairErrorKey(e));
  });
  it('blames the token, not the scorekeeping link, when the server rejects it', () => {
    expect(pairErrorKey('rejected')).toBe('pair.error.rejected');
  });
});
