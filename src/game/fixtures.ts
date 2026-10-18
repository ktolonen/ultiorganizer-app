import type { EntryContext } from './types';

const player = (id: number, number: number) => ({
  player_id: id,
  name: `Player ${id}`,
  number,
});
const entry = (id: number, number: number, captain = false) => ({
  player_id: id,
  number,
  captain,
  spirit_captain: false,
});

/** Two teams of three, an ongoing-free game 0-0, times shown, 2 timeouts each. */
export function entryContextFixture(overrides: Partial<EntryContext> = {}): EntryContext {
  return {
    game: {
      game_id: 123,
      time: '2026-06-01 10:00:00',
      field: 'Field 3',
      location: 'Park',
      pool: { pool_id: 7, name: 'Pool A' },
      division: 'Open',
      event: { event_id: 'E1', name: 'Test Open', timezone: 'Europe/Helsinki' },
    },
    home: {
      team_id: 90300,
      name: 'Home',
      eligible_players: [player(1, 1), player(2, 2), player(3, 3), player(4, 4)],
      roster: [entry(1, 1, true), entry(2, 2), entry(3, 3)],
    },
    away: {
      team_id: 90301,
      name: 'Away',
      eligible_players: [player(11, 11), player(12, 12), player(13, 13)],
      roster: [entry(11, 11), entry(12, 12), entry(13, 13)],
    },
    result: null,
    goals: [],
    timeouts: { home: [], away: [] },
    spirit_stoppages: { home: [], away: [] },
    metadata: { starting_offence: null, halftime: null, official: null },
    rules: {
      hide_time_on_scoresheet: false,
      timeouts_per_team: 2,
      spirit_stoppages_enabled: true,
      require_accreditation: false,
      max_game_score: 1000,
      max_goals_per_side: 255,
      max_jersey_number: 255,
    },
    retained: {
      forfeit: 'none',
      cap_events: [],
      defenses: { home: 0, away: 0, referenced_player_ids: [] },
    },
    token: 'tok0',
    ...overrides,
  };
}
