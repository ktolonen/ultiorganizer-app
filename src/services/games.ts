import {
  fetchEntryContext,
  type Credentials,
  type DiscoveredGame,
  type FetchLike,
} from '../api/http';
import { fromEntryContext } from '../game/reducer';
import type { GameSession } from '../game/runtime';
import { newOutbox } from '../sync/outbox';
import type { Repo } from '../store/repo';
import { defaultTeamColors } from '../ui/tokens';

export type OpenGameError = 'network' | 'forbidden' | 'not_found' | 'bad_body' | 'unexpected';

export type OpenedGame = {
  session: GameSession;
  colors: { home: string; away: string };
  /** The game was already on this phone and was resumed as is. */
  resumed: boolean;
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
 * is fetched and a fresh session starts from it.
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
  if (!res.ok) {
    if (res.kind === 'network') return { ok: false, error: 'network' };
    if (res.kind === 'bad_body') return { ok: false, error: 'bad_body' };
    if (res.status === 404) return { ok: false, error: 'not_found' };
    return {
      ok: false,
      error: res.status === 401 || res.status === 403 ? 'forbidden' : 'unexpected',
    };
  }
  const context = res.data;
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
  return { ok: true, game: { session, colors, resumed: false } };
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
