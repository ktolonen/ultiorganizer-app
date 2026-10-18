export type QrError =
  'not_a_url' | 'wrong_kind' | 'insecure_root' | 'bad_root' | 'bad_link_token' | 'missing_token';

export type QrResult<T> = ({ ok: true } & T) | { ok: false; error: QrError };

export type QrOptions = {
  /** Dev builds also accept http to localhost, private networks and the Android emulator. */
  allowDevHttp?: boolean;
};

export type SetupQr = { root: string; token: string };
export type ScorekeepingQr = { root: string; linkToken: string };

const SETUP_PREFIX = 'ultiorganizer-app://pair?';
const LINK_TOKEN = /^[0-9a-f]{32}$/i;
const SCOREKEEPER_PATH = '/scorekeeper/';

function isDevHttpHost(host: string): boolean {
  if (host === 'localhost' || host === '10.0.2.2' || host.endsWith('.local')) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * Normalises an installation root: https only (dev builds may also use http on
 * local addresses), no credentials, query or fragment, no trailing slash.
 */
export function normalizeRoot(input: string, options: QrOptions = {}): QrResult<{ root: string }> {
  const m = /^(https?):\/\/([^/?#@]+)((?:\/[^?#]*)?)(?:[?#].*)?$/i.exec(input.trim());
  if (!m) return { ok: false, error: /@/.test(input) ? 'bad_root' : 'not_a_url' };
  const scheme = m[1].toLowerCase();
  const authority = m[2].toLowerCase();
  const host = authority.replace(/:\d+$/, '');
  if (!host) return { ok: false, error: 'bad_root' };
  if (scheme === 'http' && !(options.allowDevHttp && isDevHttpHost(host))) {
    return { ok: false, error: 'insecure_root' };
  }
  const path = m[3].replace(/\/+$/, '');
  return { ok: true, root: `${scheme}://${authority}${path}` };
}

function parseQuery(query: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of query.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const rawKey = eq < 0 ? part : part.slice(0, eq);
    const rawValue = eq < 0 ? '' : part.slice(eq + 1);
    try {
      const key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
      if (!(key in out)) out[key] = decodeURIComponent(rawValue.replace(/\+/g, ' '));
    } catch {
      // Malformed escape: skip the pair.
    }
  }
  return out;
}

/** `ultiorganizer-app://pair?root=<BASEURL>&token=<value>` from admin/apitokens.php. */
export function parseSetupQr(text: string, options: QrOptions = {}): QrResult<SetupQr> {
  const trimmed = text.trim();
  if (!trimmed.toLowerCase().startsWith(SETUP_PREFIX)) {
    return { ok: false, error: /^https?:\/\//i.test(trimmed) ? 'wrong_kind' : 'not_a_url' };
  }
  const query = parseQuery(trimmed.slice(SETUP_PREFIX.length).replace(/#.*$/, ''));
  const root = normalizeRoot(query.root ?? '', options);
  if (!root.ok) return root;
  const token = (query.token ?? '').trim();
  if (!token) return { ok: false, error: 'missing_token' };
  return { ok: true, root: root.root, token };
}

/** `<root>/scorekeeper/?t=<32 hex>`: the root is everything before `/scorekeeper/`. */
export function parseScorekeepingQr(
  text: string,
  options: QrOptions = {},
): QrResult<ScorekeepingQr> {
  const trimmed = text.trim();
  if (trimmed.toLowerCase().startsWith(SETUP_PREFIX)) return { ok: false, error: 'wrong_kind' };
  const at = trimmed.toLowerCase().lastIndexOf(SCOREKEEPER_PATH);
  if (at < 0)
    return { ok: false, error: /^https?:\/\//i.test(trimmed) ? 'wrong_kind' : 'not_a_url' };
  const root = normalizeRoot(trimmed.slice(0, at), options);
  if (!root.ok) return root;
  const query = parseQuery(
    trimmed
      .slice(at + SCOREKEEPER_PATH.length)
      .replace(/^[^?]*\?/, '')
      .replace(/#.*$/, ''),
  );
  const linkToken = query.t ?? '';
  if (!LINK_TOKEN.test(linkToken)) return { ok: false, error: 'bad_link_token' };
  return { ok: true, root: root.root, linkToken: linkToken.toLowerCase() };
}

/** Identifies what a scanned code is, for the shared scanner. */
export function classifyQr(
  text: string,
  options: QrOptions = {},
):
  | { kind: 'setup'; value: SetupQr }
  | { kind: 'scorekeeping'; value: ScorekeepingQr }
  | { kind: 'unknown'; error: QrError } {
  const setup = parseSetupQr(text, options);
  if (setup.ok) return { kind: 'setup', value: { root: setup.root, token: setup.token } };
  if (setup.error !== 'not_a_url' && setup.error !== 'wrong_kind')
    return { kind: 'unknown', error: setup.error };
  const sk = parseScorekeepingQr(text, options);
  if (sk.ok) return { kind: 'scorekeeping', value: { root: sk.root, linkToken: sk.linkToken } };
  return { kind: 'unknown', error: sk.error };
}
