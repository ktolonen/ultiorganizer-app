import { type GameError, type GameState, goalTotals } from './reducer';

/** Body of `PUT /games/{id}/game-data` (schema `GameData` in api/openapi.json). */
export type GameDataDocument = {
  version: 1;
  home_team_id: number;
  away_team_id: number;
  rosters: Record<'home' | 'away', GameState['rosters']['home']>;
  goals: {
    side: 'home' | 'away';
    scorer_id: number | null;
    assist_id: number | null;
    callahan: boolean;
    time: number | null;
  }[];
  timeouts: Record<'home' | 'away', { time: number }[]>;
  spirit_stoppages: Record<'home' | 'away', { time: number }[]>;
  result: { home: number; away: number; state: 'ongoing' | 'final' } | null;
  starting_offence: 'home' | 'away' | null;
  halftime: number | null;
  official: string | null;
};

/**
 * Builds the complete upload from local state, applying the server's cross-field
 * rules: a `null` result requires no goals, and a result with goals must equal the
 * goal total. Teams the fixture has not decided yet cannot be uploaded.
 */
export function toGameData(
  state: GameState,
): { ok: true; doc: GameDataDocument } | { ok: false; error: GameError } {
  const { home, away } = state.teamIds;
  if (home === null || away === null) {
    return {
      ok: false,
      error: { code: 'validation_failed', message: 'The fixture has no teams yet.' },
    };
  }
  const totals = goalTotals(state.goals);
  if (state.goals.length && state.result === null) {
    return {
      ok: false,
      error: {
        code: 'validation_failed',
        path: 'result',
        message: 'A result is required when there are goals.',
      },
    };
  }
  if (
    state.goals.length &&
    state.result &&
    (state.result.home !== totals.home || state.result.away !== totals.away)
  ) {
    return {
      ok: false,
      error: {
        code: 'validation_failed',
        path: 'result',
        message: 'The result must equal the goal total.',
      },
    };
  }
  return {
    ok: true,
    doc: {
      version: 1,
      home_team_id: home,
      away_team_id: away,
      rosters: state.rosters,
      goals: state.goals.map((g) => ({
        side: g.side,
        scorer_id: g.scorerId,
        assist_id: g.assistId,
        callahan: g.callahan,
        time: state.rules.hide_time_on_scoresheet ? null : g.time,
      })),
      timeouts: state.timeouts,
      spirit_stoppages: state.spiritStoppages,
      result: state.result,
      starting_offence: state.startingOffence,
      halftime: state.halftime,
      official: state.official,
    },
  };
}
