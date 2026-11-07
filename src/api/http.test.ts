import { entryContextFixture } from '../game/fixtures';
import {
  fetchEntryContext,
  fetchGames,
  retryAfterSeconds,
  sendRequest,
  toOutboxResponse,
} from './http';
import { probeFromStatus } from './client';

const creds = { root: 'https://example.org/uo', appToken: 'app-token', linkToken: 'a'.repeat(32) };
const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' }, ...init });

describe('sendRequest', () => {
  it('sends the credentials, key and body in the right headers', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      json(
        {
          status: 'ok',
          data: {
            game_id: 123,
            token: 't1',
            result: { home: 1, away: 0, state: 'ongoing' },
            goal: { num: 4 },
          },
        },
        { status: 201 },
      ),
    );
    const res = await sendRequest(
      creds,
      { key: 'k1', method: 'POST', path: '/games/123/goals', body: { side: 'home' } },
      { fetch: fetchMock },
    );
    expect(res).toEqual({
      kind: 'ok',
      token: 't1',
      result: { home: 1, away: 0, state: 'ongoing' },
      num: 4,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.org/uo/api/v1/games/123/goals');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"side":"home"}');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer app-token',
      'X-Scorekeeping-Token': 'a'.repeat(32),
      'Idempotency-Key': 'k1',
      'Content-Type': 'application/json',
    });
    expect(init.headers).not.toHaveProperty('If-Match');
  });

  it('puts the link token in a header only, never the URL or body', async () => {
    const fetchMock = jest.fn().mockResolvedValue(json({ data: { token: 't', result: null } }));
    await sendRequest(
      creds,
      { key: 'k', method: 'POST', path: '/games/1/timeouts', body: { side: 'home', time: 1 } },
      { fetch: fetchMock },
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).not.toContain('a'.repeat(32));
    expect(init.body).not.toContain('a'.repeat(32));
  });

  it('quotes If-Match on an upload and sends no body for DELETE', async () => {
    const fetchMock = jest.fn().mockResolvedValue(json({ data: { token: 't', result: null } }));
    await sendRequest(
      creds,
      { key: 'k', method: 'PUT', path: '/games/1/game-data', body: { version: 1 }, ifMatch: 'abc' },
      { fetch: fetchMock },
    );
    expect(fetchMock.mock.calls[0][1].headers['If-Match']).toBe('"abc"');
    await sendRequest(
      creds,
      { key: 'k2', method: 'DELETE', path: '/games/1/goals/3', body: null },
      { fetch: fetchMock },
    );
    const init = fetchMock.mock.calls[1][1];
    expect(init.body).toBeUndefined();
    expect(init.headers).not.toHaveProperty('Content-Type');
  });

  it('treats a thrown fetch as a network error', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    expect(
      await sendRequest(
        creds,
        { key: 'k', method: 'POST', path: '/x', body: {} },
        { fetch: fetchMock },
      ),
    ).toEqual({ kind: 'network' });
  });

  it('aborts a request that hangs', async () => {
    const fetchMock = jest.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) =>
          init.signal!.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    );
    const res = await sendRequest(
      creds,
      { key: 'k', method: 'POST', path: '/x', body: {} },
      { fetch: fetchMock as never, timeoutMs: 10 },
    );
    expect(res).toEqual({ kind: 'network' });
  });
});

describe('toOutboxResponse', () => {
  it('reads an error code, message and first field path', async () => {
    const res = await toOutboxResponse(
      json(
        {
          status: 'error',
          error: {
            code: 'validation_failed',
            message: 'Bad.',
            details: [{ path: 'time', message: 'x' }],
          },
        },
        { status: 400 },
      ),
      0,
    );
    expect(res).toEqual({
      kind: 'http',
      status: 400,
      code: 'validation_failed',
      message: 'Bad.',
      path: 'time',
      retryAfterSec: undefined,
    });
  });
  it('survives a non-JSON error page', async () => {
    const res = await toOutboxResponse(
      new Response('<html>Bad gateway</html>', { status: 502 }),
      0,
    );
    expect(res).toMatchObject({ kind: 'http', status: 502, code: 'http_502' });
  });
  it('reads Retry-After on 503', async () => {
    const res = await toOutboxResponse(
      json({ error: { code: 'busy' } }, { status: 503, headers: { 'Retry-After': '5' } }),
      0,
    );
    expect(res).toMatchObject({ status: 503, retryAfterSec: 5 });
  });
  it('retries a 2xx that is not a write answer (captive portal) instead of marking it sent', async () => {
    expect(
      await toOutboxResponse(new Response('<html>Log in to the Wi-Fi</html>', { status: 200 }), 0),
    ).toEqual({ kind: 'network' });
    expect(await toOutboxResponse(new Response(null, { status: 204 }), 0)).toEqual({
      kind: 'network',
    });
    expect(await toOutboxResponse(json({ status: 'ok', data: { game_id: 1 } }), 0)).toEqual({
      kind: 'network',
    });
  });
});

describe('retryAfterSeconds', () => {
  it('prefers Retry-After, else the epoch reset, and clamps', () => {
    expect(retryAfterSeconds(new Headers({ 'Retry-After': '30' }), 0)).toBe(30);
    expect(retryAfterSeconds(new Headers({ 'Retry-After': '9999' }), 0)).toBe(120);
    expect(
      retryAfterSeconds(new Headers({ 'X-RateLimit-Reset': '1700000045' }), 1_700_000_000_000),
    ).toBe(45);
    expect(retryAfterSeconds(new Headers({ 'X-RateLimit-Reset': '12' }), 0)).toBe(12);
    expect(retryAfterSeconds(new Headers(), 0)).toBeUndefined();
  });
});

describe('reads', () => {
  it('parses an entry context', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(json({ status: 'ok', data: entryContextFixture() }));
    const r = await fetchEntryContext(creds, 123, { fetch: fetchMock });
    expect(r.ok && r.data.token).toBe('tok0');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://example.org/uo/api/v1/games/123/entry-context',
    );
  });
  it('reports a malformed entry context', async () => {
    const fetchMock = jest.fn().mockResolvedValue(json({ data: { nope: 1 } }));
    expect(await fetchEntryContext(creds, 1, { fetch: fetchMock })).toEqual({
      ok: false,
      kind: 'bad_body',
    });
  });
  it('reports an HTTP error code', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(json({ error: { code: 'game_not_covered' } }, { status: 403 }));
    expect(await fetchEntryContext(creds, 1, { fetch: fetchMock })).toEqual({
      ok: false,
      kind: 'http',
      status: 403,
      code: 'game_not_covered',
    });
  });
  it('parses the game list, including available_from', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(json({ data: { games: [], available_from: '2026-10-17' } }));
    expect(await fetchGames(creds, { fetch: fetchMock })).toEqual({
      ok: true,
      data: { games: [], available_from: '2026-10-17' },
    });
  });
});

describe('probeFromStatus', () => {
  it('caches only a definite absence', () => {
    expect(probeFromStatus(404)).toBe('absent');
    expect(probeFromStatus(200)).toBe('present');
    expect(probeFromStatus(500)).toBe('unknown');
    expect(probeFromStatus(401)).toBe('unknown');
    expect(probeFromStatus(null)).toBe('unknown');
  });
});

describe('write answers of the newer routes', () => {
  const creds = { root: 'https://example.org/uo', appToken: 'app-token' };
  const answer = (data: object) =>
    jest
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ status: 'ok', data: { game_id: 1, token: 't', result: null, ...data } }),
        ),
      );
  const send = (fetchMock: jest.Mock) =>
    sendRequest(creds, { key: 'k', method: 'POST', path: '/x', body: null }, { fetch: fetchMock });
  it('takes the number of a created timeout or spirit stoppage', async () => {
    expect(await send(answer({ timeout: { side: 'home', num: 3, time: 5 } }))).toMatchObject({
      num: 3,
    });
    expect(
      await send(answer({ spirit_stoppage: { side: 'away', num: 1, time: 5 } })),
    ).toMatchObject({
      num: 1,
    });
  });
  it('takes the clock and the note', async () => {
    expect(await send(answer({ clock: { state: 'paused', elapsed: 61 } }))).toMatchObject({
      clock: { state: 'paused', elapsed: 61 },
    });
    expect(await send(answer({ note: null }))).toMatchObject({ note: null });
  });
});
