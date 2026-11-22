import type { GameState } from './reducer';
import type { Side } from './types';

/** The player's name, or `#id` for a player the context does not list. */
export const nameOf = (state: GameState, side: Side, id: number | null): string => {
  if (id === null) return '?';
  return state.eligible[side].find((p) => p.player_id === id)?.name ?? `#${id}`;
};

/** The jersey number on the game roster, or `–`. */
export const numberOf = (state: GameState, side: Side, id: number): string => {
  const onRoster = state.rosters[side].find((p) => p.player_id === id);
  return onRoster?.number != null ? String(onRoster.number) : '–';
};

/**
 * A player on the goal list: jersey number and name, or just the number for a player
 * with no name (a local game's numbers). `?` for an unknown player.
 */
export const playerLabel = (state: GameState, side: Side, id: number | null): string => {
  if (id === null) return '?';
  const name = nameOf(state, side, id);
  return name ? `${numberOf(state, side, id)} ${name}` : numberOf(state, side, id);
};

/** An assist on the goal list: by name, or by number for a player with no name. */
export const assistLabel = (state: GameState, side: Side, id: number | null): string =>
  nameOf(state, side, id) || playerLabel(state, side, id);
