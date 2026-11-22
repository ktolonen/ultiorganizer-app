import { classifyQr, normalizeRoot, parseScorekeepingQr, parseSetupQr } from './qr';

const T = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const dev = { allowDevHttp: true };

describe('normalizeRoot', () => {
  it('accepts https and strips trailing slash, query and fragment', () => {
    expect(normalizeRoot('https://Example.org/uo/?x=1#y')).toEqual({
      ok: true,
      root: 'https://example.org/uo',
    });
  });
  it('rejects http outside dev builds', () => {
    expect(normalizeRoot('http://example.org')).toEqual({ ok: false, error: 'insecure_root' });
    expect(normalizeRoot('http://localhost:8080')).toEqual({ ok: false, error: 'insecure_root' });
  });
  it.each([
    'http://localhost:8080',
    'http://10.0.2.2:8080',
    'http://192.168.1.20',
    'http://172.20.0.5',
    'http://127.0.0.1',
  ])('dev builds allow %s', (u) => expect(normalizeRoot(u, dev).ok).toBe(true));
  it.each(['http://example.org', 'http://172.32.0.1', 'http://8.8.8.8'])(
    'dev builds still refuse %s',
    (u) => expect(normalizeRoot(u, dev)).toEqual({ ok: false, error: 'insecure_root' }),
  );
  it('refuses credentials in the URL', () => {
    expect(normalizeRoot('https://user:pw@example.org')).toEqual({ ok: false, error: 'bad_root' });
  });
  it('refuses other schemes', () => {
    expect(normalizeRoot('ftp://example.org').ok).toBe(false);
  });
});

describe('parseSetupQr', () => {
  const qr = (root: string, token: string) =>
    `ultiorganizer-app://pair?root=${encodeURIComponent(root)}&token=${encodeURIComponent(token)}`;
  it('parses root and token', () => {
    expect(parseSetupQr(qr('https://example.org/uo/', 'tok_123'))).toEqual({
      ok: true,
      root: 'https://example.org/uo',
      token: 'tok_123',
    });
  });
  it('accepts a pasted setup link with surrounding whitespace', () => {
    expect(parseSetupQr(`  ${qr('https://example.org/uo', 'tok')}\n`)).toEqual({
      ok: true,
      root: 'https://example.org/uo',
      token: 'tok',
    });
  });
  it('refuses an insecure root', () => {
    expect(parseSetupQr(qr('http://example.org', 'x'))).toEqual({
      ok: false,
      error: 'insecure_root',
    });
  });
  it('requires a token', () => {
    expect(parseSetupQr('ultiorganizer-app://pair?root=https%3A%2F%2Fexample.org')).toEqual({
      ok: false,
      error: 'missing_token',
    });
  });
  it('reports a scorekeeping URL as the wrong kind', () => {
    expect(parseSetupQr(`https://example.org/scorekeeper/?t=${T}`)).toEqual({
      ok: false,
      error: 'wrong_kind',
    });
  });
  it('ignores a malformed escape instead of throwing', () => {
    expect(parseSetupQr('ultiorganizer-app://pair?root=%E0%A4%A&token=x').ok).toBe(false);
  });
});

describe('parseScorekeepingQr', () => {
  it('splits root and token', () => {
    expect(parseScorekeepingQr(`https://example.org/scorekeeper/?t=${T}`)).toEqual({
      ok: true,
      root: 'https://example.org',
      linkToken: T,
    });
  });
  it('keeps a subdirectory install root', () => {
    expect(parseScorekeepingQr(`https://example.org/uo/scorekeeper/?t=${T.toUpperCase()}`)).toEqual(
      {
        ok: true,
        root: 'https://example.org/uo',
        linkToken: T,
      },
    );
  });
  it.each(['', 'abc', T.slice(1), T + 'a', 'g'.repeat(32)])('rejects link token %p', (t) => {
    expect(parseScorekeepingQr(`https://example.org/scorekeeper/?t=${t}`)).toEqual({
      ok: false,
      error: 'bad_link_token',
    });
  });
  it('refuses http, but dev builds accept the emulator host', () => {
    expect(parseScorekeepingQr(`http://10.0.2.2:8080/scorekeeper/?t=${T}`)).toEqual({
      ok: false,
      error: 'insecure_root',
    });
    expect(parseScorekeepingQr(`http://10.0.2.2:8080/scorekeeper/?t=${T}`, dev).ok).toBe(true);
  });
  it('rejects the setup QR and random text', () => {
    expect(parseScorekeepingQr('ultiorganizer-app://pair?root=x&token=y')).toEqual({
      ok: false,
      error: 'wrong_kind',
    });
    expect(parseScorekeepingQr('hello')).toEqual({ ok: false, error: 'not_a_url' });
  });
});

describe('classifyQr', () => {
  it('tells the two codes apart', () => {
    expect(classifyQr('ultiorganizer-app://pair?root=https%3A%2F%2Fa.org&token=z').kind).toBe(
      'setup',
    );
    expect(classifyQr(`https://a.org/scorekeeper/?t=${T}`).kind).toBe('scorekeeping');
    expect(classifyQr('https://a.org/')).toEqual({ kind: 'unknown', error: 'wrong_kind' });
  });
  it('keeps a specific setup error', () => {
    expect(classifyQr('ultiorganizer-app://pair?root=http%3A%2F%2Fa.org&token=z')).toEqual({
      kind: 'unknown',
      error: 'insecure_root',
    });
  });
});
