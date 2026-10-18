import createClient from 'openapi-fetch';
import type { paths } from './schema';
import { type Credentials, headersFor } from './http';

/**
 * Typed client generated from `api/openapi.json` (`npm run api:types`). Use it for
 * routes whose responses the spec types; the scorekeeping reads and the outbox go
 * through `./http`, because the spec leaves those responses as bare objects.
 */
export function createApiClient(creds: Credentials, fetchImpl?: typeof fetch) {
  return createClient<paths>({
    baseUrl: creds.root,
    headers: headersFor(creds),
    fetch: fetchImpl,
  });
}

/** Cached probe of an optional route (S0–S2 additions): is it there on this server? */
export type ProbeResult = 'present' | 'absent' | 'unknown';

/** Only a 404 or 405 means the route does not exist; any other failure is retried later. */
export function probeFromStatus(status: number | null): ProbeResult {
  if (status === null) return 'unknown';
  if (status === 404 || status === 405) return 'absent';
  return status >= 200 && status < 300 ? 'present' : 'unknown';
}
