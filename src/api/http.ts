import { z } from 'zod';
import { clockSchema, entryContextSchema, type EntryContext } from '../game/types';
import type { Response as OutboxResponse, SendRequest } from '../sync/outbox';

/**
 * Plain `fetch` transport for the scorekeeping routes. Outbox requests are built
 * from stored rows with dynamic paths, so they go through here rather than the
 * typed client; the typed `openapi-fetch` client in `./client` serves the reads.
 */

export type Credentials = {
  /** Installation root, e.g. `https://example.org/uo` (the API is at `<root>/api/v1`). */
  root: string;
  /** App token, sent as `Authorization: Bearer`. */
  appToken: string;
  /** Scorekeeping link token, sent as `X-Scorekeeping-Token` and nowhere else. */
  linkToken?: string;
};

export type FetchLike = typeof fetch;
export type Clock = () => number;

export const REQUEST_TIMEOUT_MS = 20_000;
const MAX_WAIT_SEC = 120;

export function headersFor(creds: Credentials, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${creds.appToken}`,
    ...extra,
  };
  if (creds.linkToken) headers['X-Scorekeeping-Token'] = creds.linkToken;
  return headers;
}

export const apiUrl = (creds: Credentials, path: string) => `${creds.root}/api/v1${path}`;

const errorBody = z.object({
  status: z.literal('error').optional(),
  error: z.object({
    code: z.string(),
    message: z.string().optional(),
    details: z.unknown().optional(),
  }),
});

const writeBody = z.object({
  data: z.object({
    token: z.string(),
    result: z
      .object({
        home: z.number().int(),
        away: z.number().int(),
        state: z.enum(['ongoing', 'final']),
      })
      .nullable(),
    goal: z.object({ num: z.number().int() }).optional(),
    timeout: z.object({ num: z.number().int() }).optional(),
    spirit_stoppage: z.object({ num: z.number().int() }).optional(),
    clock: clockSchema.optional(),
    note: z.string().nullable().optional(),
  }),
});

const detailRows = z.array(z.object({ path: z.string(), message: z.string() }));

/** Seconds to wait after a 429/503: `Retry-After`, else the rate-limit reset. */
export function retryAfterSeconds(headers: Headers, nowMs: number): number | undefined {
  const clamp = (n: number) => Math.min(MAX_WAIT_SEC, Math.max(1, Math.ceil(n)));
  const retry = Number(headers.get('Retry-After'));
  if (headers.get('Retry-After') !== null && Number.isFinite(retry)) return clamp(retry);
  const reset = Number(headers.get('X-RateLimit-Reset'));
  if (headers.get('X-RateLimit-Reset') !== null && Number.isFinite(reset)) {
    // The reset is an epoch second; tolerate a plain delay in seconds.
    return clamp(reset > 1e9 ? reset - nowMs / 1000 : reset);
  }
  return undefined;
}

/** Turns an HTTP answer into the outcome the outbox understands. */
export async function toOutboxResponse(res: Response, nowMs: number): Promise<OutboxResponse> {
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // A non-JSON answer (proxy error page) is handled by status below.
  }
  if (res.ok) {
    const parsed = writeBody.safeParse(json);
    if (!parsed.success) {
      // A 2xx that is not a write answer is not the server: a captive portal or proxy
      // answering 200 with a login page. Never mark the row sent; resend with the same
      // key, which the server's idempotency receipt makes safe.
      return { kind: 'network' };
    }
    const d = parsed.data.data;
    return {
      kind: 'ok',
      token: d.token,
      result: d.result,
      num: (d.goal ?? d.timeout ?? d.spirit_stoppage)?.num,
      clock: d.clock,
      note: d.note,
    };
  }
  const err = errorBody.safeParse(json);
  const rows = err.success ? detailRows.safeParse(err.data.error.details) : null;
  return {
    kind: 'http',
    status: res.status,
    code: err.success ? err.data.error.code : `http_${res.status}`,
    message: err.success ? err.data.error.message : undefined,
    path: rows?.success && rows.data.length ? rows.data[0].path : undefined,
    retryAfterSec: retryAfterSeconds(res.headers, nowMs),
  };
}

/** Sends one outbox request. A network error, timeout or abort is `{ kind: 'network' }`. */
export async function sendRequest(
  creds: Credentials,
  req: SendRequest,
  deps: { fetch?: FetchLike; now?: Clock; timeoutMs?: number } = {},
): Promise<OutboxResponse> {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    const extra: Record<string, string> = { 'Idempotency-Key': req.key };
    if (req.body !== null && req.body !== undefined) extra['Content-Type'] = 'application/json';
    if (req.ifMatch) extra['If-Match'] = `"${req.ifMatch}"`;
    const res = await doFetch(apiUrl(creds, req.path), {
      method: req.method,
      headers: headersFor(creds, extra),
      body: req.body === null || req.body === undefined ? undefined : JSON.stringify(req.body),
      signal: controller.signal,
    });
    return await toOutboxResponse(res, now());
  } catch {
    return { kind: 'network' };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export type ReadResult<T> =
  /** `etag`: the response's ETag as sent (quoted), for a later `If-None-Match`. */
  | { ok: true; data: T; etag?: string }
  | { ok: false; kind: 'network' }
  | { ok: false; kind: 'http'; status: number; code: string }
  | { ok: false; kind: 'bad_body' };

/**
 * The server could not answer properly, as opposed to refusing: no connection, a
 * timeout, a rate limit, a 5xx from the server or its proxy, or a body that is not
 * the server's (a captive portal). Saved data may stand in for these, never for a
 * refusal such as 401, 403 or 404.
 */
export function serverUnavailable(res: ReadResult<unknown>): boolean {
  if (res.ok) return false;
  if (res.kind === 'network' || res.kind === 'bad_body') return true;
  return res.status === 408 || res.status === 429 || res.status >= 500;
}

async function read<T>(
  creds: Credentials,
  path: string,
  pick: (json: unknown) => T | null,
  deps: { fetch?: FetchLike; timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<ReadResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    const res = await (deps.fetch ?? fetch)(apiUrl(creds, path), {
      headers: headersFor(creds, deps.headers),
      signal: controller.signal,
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* fall through */
    }
    // Only sent with If-None-Match: what is saved is still current.
    if (res.status === 304) return { ok: false, kind: 'http', status: 304, code: 'not_modified' };
    if (!res.ok) {
      const err = errorBody.safeParse(json);
      return {
        ok: false,
        kind: 'http',
        status: res.status,
        code: err.success ? err.data.error.code : `http_${res.status}`,
      };
    }
    const data = pick(json);
    const etag = res.headers?.get('ETag') ?? undefined;
    return data === null ? { ok: false, kind: 'bad_body' } : { ok: true, data, etag };
  } catch {
    return { ok: false, kind: 'network' };
  } finally {
    clearTimeout(timer);
  }
}

const dataOf = (json: unknown): unknown =>
  json && typeof json === 'object' && 'data' in json ? (json as { data: unknown }).data : null;

export function fetchEntryContext(
  creds: Credentials,
  gameId: number,
  deps?: Parameters<typeof read>[3],
): Promise<ReadResult<EntryContext>> {
  return read(
    creds,
    `/games/${gameId}/entry-context`,
    (json) => {
      const parsed = entryContextSchema.safeParse(dataOf(json));
      return parsed.success ? parsed.data : null;
    },
    deps,
  );
}

export const discoverySchema = z.object({
  event_id: z.string().nullable().optional(),
  games: z.array(
    z.object({
      game_id: z.number().int(),
      time: z.string().nullable(),
      field: z.string().nullable(),
      location: z.string().nullable(),
      pool: z.object({ pool_id: z.number().int().nullable(), name: z.string().nullable() }),
      home: z.object({ team_id: z.number().int().nullable(), name: z.string().nullable() }),
      away: z.object({ team_id: z.number().int().nullable(), name: z.string().nullable() }),
      result: z.object({
        state: z.enum(['not_started', 'ongoing', 'final']),
        home: z.number().int().nullable(),
        away: z.number().int().nullable(),
      }),
    }),
  ),
  available_from: z.string().nullable(),
});
export type Discovery = z.infer<typeof discoverySchema>;
export type DiscoveredGame = Discovery['games'][number];

export function fetchGames(
  creds: Credentials,
  deps?: Parameters<typeof read>[3],
): Promise<ReadResult<Discovery>> {
  return read(
    creds,
    '/scorekeeping/games',
    (json) => {
      const parsed = discoverySchema.safeParse(dataOf(json));
      return parsed.success ? parsed.data : null;
    },
    deps,
  );
}
