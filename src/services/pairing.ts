import { apiUrl, headersFor, type FetchLike } from '../api/http';
import { normalizeRoot, type QrError, type QrOptions } from '../pairing/qr';
import type { Repo, ServerRow } from '../store/repo';

export type PairError = QrError | 'network' | 'rejected' | 'unexpected';

export type PairResult = { ok: true; server: ServerRow } | { ok: false; error: PairError };

/**
 * Pairs an installation: checks the token against `GET /version`, then stores the
 * server row and the token. Nothing is stored unless the server accepted the token.
 */
export async function pairServer(
  input: { root: string; token: string },
  deps: {
    repo: Repo;
    saveToken: (serverId: number, token: string) => Promise<void>;
    fetch?: FetchLike;
    now?: () => number;
    qr?: QrOptions;
  },
): Promise<PairResult> {
  const root = normalizeRoot(input.root, deps.qr);
  if (!root.ok) return root;
  const token = input.token.trim();
  if (!token) return { ok: false, error: 'missing_token' };

  const creds = { root: root.root, appToken: token };
  let res: Response;
  try {
    res = await (deps.fetch ?? fetch)(apiUrl(creds, '/version'), { headers: headersFor(creds) });
  } catch {
    return { ok: false, error: 'network' };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, error: 'rejected' };
  if (!res.ok) return { ok: false, error: 'unexpected' };

  const label = new URL(root.root).host;
  const server = await deps.repo.upsertServer(root.root, label, (deps.now ?? Date.now)());
  await deps.saveToken(server.id, token);
  return { ok: true, server };
}

/** Translation key for a pairing or QR error. */
export function pairErrorKey(e: PairError): string {
  switch (e) {
    case 'network':
      return 'games.error.network';
    case 'rejected':
      return 'pair.error.rejected';
    case 'unexpected':
      return 'error.unknown';
    default:
      return `scan.error.${e}`;
  }
}
