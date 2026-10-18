import { DatabaseSync } from 'node:sqlite';
import { refreshTemplates } from '../services/templates';
import { type Db, migrate } from '../store/migrations';
import { createRepo } from '../store/repo';
import { WFDF_TEMPLATE } from '../timekeeper/templates';
import { fetchTemplates, parseTemplates } from './templates';

const creds = { root: 'https://a.org', appToken: 't' };
const body = (templates: unknown) => ({ data: { defaultTemplateId: 1, templates } });
const wire = {
  id: 1,
  name: 'WFDF',
  caps: { half_time_cap: 55, time_cap: 100 },
  signals: { betweenpoints: [{ id: 10, time: 45, text: 'Offence warning' }], future_action: [] },
};

describe('parseTemplates', () => {
  it('reads templates keyed by id (the PHP shape) and as a list', () => {
    for (const templates of [{ '1': wire }, [wire]]) {
      const set = parseTemplates(body(templates))!;
      expect(set.defaultTemplateId).toBe(1);
      expect(set.templates[0].signals.betweenpoints).toEqual([
        { id: 10, time: 45, text: 'Offence warning' },
      ]);
      expect(set.templates[0].signals.timeout).toEqual([]); // missing groups become empty
      expect(Object.keys(set.templates[0].signals)).not.toContain('future_action');
    }
  });
  it('rejects malformed or empty answers', () => {
    expect(parseTemplates({ data: {} })).toBeNull();
    expect(parseTemplates(body({}))).toBeNull();
    expect(parseTemplates(null)).toBeNull();
  });
  it('round-trips the bundled WFDF template', () => {
    const set = parseTemplates(body({ '0': WFDF_TEMPLATE }))!;
    expect(set.templates[0]).toEqual(WFDF_TEMPLATE);
  });
});

describe('fetchTemplates', () => {
  it('sends Accept-Language and the app token', async () => {
    const f = jest.fn().mockResolvedValue(new Response(JSON.stringify(body({ '1': wire }))));
    const r = await fetchTemplates(creds, { fetch: f, language: 'fi' });
    expect(r.kind).toBe('ok');
    expect(f.mock.calls[0][0]).toBe('https://a.org/api/v1/timekeeper/templates');
    expect(f.mock.calls[0][1].headers).toMatchObject({
      Authorization: 'Bearer t',
      'Accept-Language': 'fi',
    });
  });
  it('treats 404 as absent and other failures as unavailable', async () => {
    const answer = (res: unknown) => fetchTemplates(creds, { fetch: res as never });
    expect(await answer(jest.fn().mockResolvedValue(new Response('{}', { status: 404 })))).toEqual({
      kind: 'absent',
    });
    expect(await answer(jest.fn().mockResolvedValue(new Response('{}', { status: 500 })))).toEqual({
      kind: 'unavailable',
    });
    expect(await answer(jest.fn().mockResolvedValue(new Response('{}', { status: 401 })))).toEqual({
      kind: 'unavailable',
    });
    expect(await answer(jest.fn().mockRejectedValue(new Error('x')))).toEqual({
      kind: 'unavailable',
    });
    expect(await answer(jest.fn().mockResolvedValue(new Response('nope')))).toEqual({
      kind: 'unavailable',
    });
  });
});

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
  const server = await repo.upsertServer('https://a.org', 'a', 0);
  return { repo, serverId: server.id };
}

describe('refreshTemplates', () => {
  it('asks a server without the route only once', async () => {
    const { repo, serverId } = await setup();
    const f = jest.fn().mockResolvedValue(new Response('{}', { status: 404 }));
    expect(await refreshTemplates({ repo, serverId, creds, fetch: f })).toBeNull();
    expect(await refreshTemplates({ repo, serverId, creds, fetch: f })).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('caches a good answer and serves it when the next fetch fails', async () => {
    const { repo, serverId } = await setup();
    const good = jest.fn().mockResolvedValue(new Response(JSON.stringify(body({ '1': wire }))));
    const first = await refreshTemplates({ repo, serverId, creds, fetch: good });
    expect(first?.templates).toHaveLength(1);
    const down = jest.fn().mockRejectedValue(new Error('offline'));
    expect(await refreshTemplates({ repo, serverId, creds, fetch: down })).toEqual(first);
  });
  it('does not remember a transient failure as absent', async () => {
    const { repo, serverId } = await setup();
    const down = jest.fn().mockRejectedValue(new Error('offline'));
    expect(await refreshTemplates({ repo, serverId, creds, fetch: down })).toBeNull();
    const good = jest.fn().mockResolvedValue(new Response(JSON.stringify(body({ '1': wire }))));
    expect(await refreshTemplates({ repo, serverId, creds, fetch: good })).not.toBeNull();
  });
});
