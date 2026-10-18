import { fetchGames, type Credentials, type Discovery } from '../api/http';
import { getAppToken, getLinkToken, saveLinkToken } from '../store/secure';
import { getRepo } from '../store/sqlite';
import { openGame, type OpenGameError } from './games';

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
  | { ok: true; data: Discovery }
  | { ok: false; kind: 'no_server' | 'network' | 'bad_body' | 'http'; code?: string };

export async function loadGameList(link: Link): Promise<GameListResult> {
  const creds = await credentialsFor(link.serverId, link.linkToken);
  if (!creds) return { ok: false, kind: 'no_server' };
  const res = await fetchGames(creds);
  if (res.ok) return { ok: true, data: res.data };
  return res.kind === 'http'
    ? { ok: false, kind: 'http', code: res.code }
    : { ok: false, kind: res.kind };
}

export async function openFromLink(
  link: Link,
  gameId: number,
): Promise<{ ok: true } | { ok: false; error: OpenGameError | 'no_server' }> {
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
  return res.ok ? { ok: true } : res;
}
