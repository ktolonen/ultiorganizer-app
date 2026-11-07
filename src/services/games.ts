import {
  fetchEntryContext,
  serverUnavailable,
  type Credentials,
  type DiscoveredGame,
  type FetchLike,
} from '../api/http';
import { fromEntryContext } from '../game/reducer';
import type { GameSession } from '../game/runtime';
import { newOutbox } from '../sync/outbox';
import type { Repo } from '../store/repo';
import type { EntryContext } from '../game/types';
import { defaultTeamColors } from '../ui/tokens';

export type OpenGameError = 'network' | 'forbidden' | 'not_found' | 'bad_body' | 'unexpected';

export type OpenedGame = {
  session: GameSession;
  colors: { home: string; away: string };
  /** The game was already on this phone and was resumed as is. */
  resumed: boolean;
  /** Opened without a connection from server data saved at this time. */
  cachedAt?: number;
};

export const gameTitle = (game: {
  field: string | null;
  home: { name: string | null };
  away: { name: string | null };
}) =>
  [game.field, `${game.home.name ?? '?'} – ${game.away.name ?? '?'}`].filter(Boolean).join(' · ');

/**
 * Opens a game for keeping score. A game already on the phone is resumed untouched,
 * because during play the phone is the source of truth; otherwise the entry context
 * is fetched and a fresh session starts from it. When the server cannot answer (no
 * connection, a 5xx or rate limit, a captive portal), an entry context saved earlier
 * (`prefetchContexts`) starts the session instead: entries queue as during any outage
 * and sync when it returns. A refusal (revoked link, removed game) never falls back:
 * it must not be papered over with old data.
 */
export async function openGame(deps: {
  repo: Repo;
  creds: Credentials;
  serverId: number;
  gameId: number;
  saveLinkToken: (serverId: number, gameId: number, token: string) => Promise<void>;
  fetch?: FetchLike;
  now: number;
}): Promise<{ ok: true; game: OpenedGame } | { ok: false; error: OpenGameError }> {
  const { repo, serverId, gameId } = deps;
  const local = await repo.loadGame(serverId, gameId);
  if (local) {
    if (deps.creds.linkToken) await deps.saveLinkToken(serverId, gameId, deps.creds.linkToken);
    return {
      ok: true,
      game: {
        session: {
          serverId,
          gameId,
          title: local.title,
          context: local.context,
          state: local.state,
          outbox: local.outbox,
        },
        colors: local.colors ?? defaultTeamColors(gameId),
        resumed: true,
      },
    };
  }
  const res = await fetchEntryContext(deps.creds, gameId, { fetch: deps.fetch });
  let cachedAt: number | undefined;
  let context: EntryContext;
  if (res.ok) {
    context = res.data;
  } else {
    const cached = serverUnavailable(res) ? await repo.cachedContext(serverId, gameId) : null;
    if (cached) {
      context = cached.context;
      cachedAt = cached.fetchedAt;
    } else if (res.kind === 'network') return { ok: false, error: 'network' };
    else if (res.kind === 'bad_body') return { ok: false, error: 'bad_body' };
    else if (res.status === 404) return { ok: false, error: 'not_found' };
    else {
      return {
        ok: false,
        error: res.status === 401 || res.status === 403 ? 'forbidden' : 'unexpected',
      };
    }
  }
  const title = gameTitle({
    field: context.game.field,
    home: { name: context.home.name },
    away: { name: context.away.name },
  });
  const colors = defaultTeamColors(gameId);
  const session: GameSession = {
    serverId,
    gameId,
    title,
    context,
    state: fromEntryContext(context),
    outbox: newOutbox(gameId, context.token, context.result),
  };
  if (deps.creds.linkToken) await deps.saveLinkToken(serverId, gameId, deps.creds.linkToken);
  await repo.saveGame({ ...session, colors, now: deps.now });
  await repo.dropCachedContext(serverId, gameId);
  return { ok: true, game: { session, colors, resumed: false, cachedAt } };
}

/** A saved entry context younger than this is not fetched again. */
export const PREFETCH_FRESH_MS = 10 * 60 * 1000;

/**
 * Saves the entry context of each listed game not yet on the phone, one request at a
 * time, so the games can be opened later without a connection. Final games and games
 * saved in the last few minutes are skipped: the API allows 120 requests a minute per
 * app token and address, which phones behind one venue network share with their live
 * writes. Stops at the first network failure, rate limit or refusal of the link; a
 * single missing game is skipped. Returns how many were saved.
 */
export async function prefetchContexts(deps: {
  repo: Repo;
  creds: Credentials;
  serverId: number;
  games: readonly { game_id: number; result: { state: string } }[];
  fetch?: FetchLike;
  now: () => number;
  shouldStop?: () => boolean;
}): Promise<number> {
  let saved = 0;
  for (const g of deps.games) {
    if (deps.shouldStop?.()) break;
    const gameId = g.game_id;
    if (g.result.state === 'final') continue;
    if (await deps.repo.hasGame(deps.serverId, gameId)) continue;
    const recent = await deps.repo.cachedContext(deps.serverId, gameId);
    if (recent && deps.now() - recent.fetchedAt < PREFETCH_FRESH_MS) continue;
    // A saved context with an ETag is asked If-None-Match: an unchanged one answers 304
    // without a body. It still counts against the rate limit, so it saves transfer only.
    const res = await fetchEntryContext(deps.creds, gameId, {
      fetch: deps.fetch,
      headers: recent?.etag ? { 'If-None-Match': recent.etag } : undefined,
    });
    if (res.ok) {
      await deps.repo.cacheContext(deps.serverId, res.data, deps.now(), res.etag);
      saved++;
    } else if (res.kind === 'http' && res.status === 304) {
      await deps.repo.touchCachedContext(deps.serverId, gameId, deps.now());
    } else if (res.kind === 'network' || (res.kind === 'http' && res.status !== 404)) {
      break;
    }
  }
  return saved;
}

/** Games grouped by field, each group sorted by time. */
export function groupByField(games: readonly DiscoveredGame[]): [string, DiscoveredGame[]][] {
  const groups = new Map<string, DiscoveredGame[]>();
  for (const g of [...games].sort(
    (a, b) => (a.time ?? '').localeCompare(b.time ?? '') || a.game_id - b.game_id,
  )) {
    const key = g.field ?? '';
    groups.set(key, [...(groups.get(key) ?? []), g]);
  }
  return [...groups.entries()];
}
