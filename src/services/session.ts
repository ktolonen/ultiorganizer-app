import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { fetchGames, type Credentials, type Discovery } from '../api/http';
import { getAppToken, getLinkToken, saveLinkToken } from '../store/secure';
import { getRepo } from '../store/sqlite';
import { openGame, prefetchContexts, type OpenGameError } from './games';

export type Link = { serverId: number; linkToken: string };

/** Credentials for a paired server, or null when it or its token is gone. */
export async function credentialsFor(
  serverId: number,
  linkToken?: string,
): Promise<Credentials | null> {
  const repo = await getRepo();
  const server = (await repo.listServers()).find((s) => s.id === serverId);
  const appToken = await getAppToken(serverId);
  if (!server || !appToken) return null;
  return { root: server.root, appToken, linkToken };
}

/** Credentials for a game already on the phone, using the link token kept in SecureStore. */
export async function credentialsForGame(serverId: number, gameId: number) {
  return credentialsFor(serverId, (await getLinkToken(serverId, gameId)) ?? undefined);
}

export type GameListResult =
  /** `cachedAt` is set when the list is the one saved earlier, shown without a connection. */
  | { ok: true; data: Discovery; cachedAt?: number }
  | { ok: false; kind: 'no_server' | 'network' | 'bad_body' | 'http'; code?: string };

/** Key of a link's saved list: SQLite never holds link tokens, so a hash stands in. */
const linkHash = (link: Link) =>
  digestStringAsync(CryptoDigestAlgorithm.SHA256, `${link.serverId}:${link.linkToken}`);

/**
 * Loads a link's game list. Online, the list and the entry context of each game are
 * saved in the background, so the games can be opened and kept later without a
 * connection. Offline, the saved list is returned instead.
 */
export async function loadGameList(link: Link): Promise<GameListResult> {
  const creds = await credentialsFor(link.serverId, link.linkToken);
  if (!creds) return { ok: false, kind: 'no_server' };
  const repo = await getRepo();
  const res = await fetchGames(creds);
  if (res.ok) {
    const data = res.data;
    void (async () => {
      await repo.cacheList(link.serverId, await linkHash(link), data, Date.now());
      await prefetchContexts({
        repo,
        creds,
        serverId: link.serverId,
        gameIds: data.games.map((g) => g.game_id),
        now: Date.now,
      });
    })().catch(() => undefined);
    return { ok: true, data };
  }
  if (res.kind === 'network') {
    const cached = await repo.cachedList(link.serverId, await linkHash(link));
    if (cached) return { ok: true, data: cached.data, cachedAt: cached.fetchedAt };
  }
  return res.kind === 'http'
    ? { ok: false, kind: 'http', code: res.code }
    : { ok: false, kind: res.kind };
}

export async function openFromLink(
  link: Link,
  gameId: number,
): Promise<{ ok: true; cachedAt?: number } | { ok: false; error: OpenGameError | 'no_server' }> {
  const creds = await credentialsFor(link.serverId, link.linkToken);
  if (!creds) return { ok: false, error: 'no_server' };
  const res = await openGame({
    repo: await getRepo(),
    creds,
    serverId: link.serverId,
    gameId,
    saveLinkToken,
    now: Date.now(),
  });
  return res.ok ? { ok: true, cachedAt: res.game.cachedAt } : res;
}
