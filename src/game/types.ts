import { z } from 'zod';

/**
 * `GET /games/{id}/entry-context`. The OpenAPI spec types this response as a bare
 * object, so the shape follows `ScorekeeperEntryContext()` in the server. Parsed
 * with zod because it is persisted on the phone and read back after relaunch.
 */

export const sideSchema = z.enum(['home', 'away']);
export type Side = z.infer<typeof sideSchema>;

const rosterEntry = z.object({
  player_id: z.number().int(),
  number: z.number().int().min(0).max(255).nullable(),
  captain: z.boolean(),
  spirit_captain: z.boolean(),
});
export type RosterEntry = z.infer<typeof rosterEntry>;

const eligiblePlayer = z.object({
  player_id: z.number().int(),
  name: z.string(),
  number: z.number().int().nullable(),
  /** Present only when the event requires accreditation. */
  accredited: z.boolean().optional(),
});
export type EligiblePlayer = z.infer<typeof eligiblePlayer>;

const teamSide = z.object({
  team_id: z.number().int().nullable(),
  name: z.string().nullable(),
  eligible_players: z.array(eligiblePlayer),
  roster: z.array(rosterEntry),
});

const resultSchema = z.object({
  home: z.number().int(),
  away: z.number().int(),
  state: z.enum(['ongoing', 'final']),
});
export type GameResult = z.infer<typeof resultSchema>;

const serverGoal = z.object({
  num: z.number().int(),
  side: sideSchema,
  scorer_id: z.number().int().nullable(),
  assist_id: z.number().int().nullable(),
  callahan: z.boolean(),
  time: z.number().int().nullable(),
  home_score: z.number().int(),
  away_score: z.number().int(),
});

const bySide = z.object({
  home: z.array(z.object({ time: z.number().int() })),
  away: z.array(z.object({ time: z.number().int() })),
});

export const clockSchema = z.object({
  state: z.enum(['not_started', 'running', 'paused', 'stopped']),
  /** Seconds, as of the response. */
  elapsed: z.number().int(),
});
export type ServerClock = z.infer<typeof clockSchema>;

export const rulesSchema = z.object({
  hide_time_on_scoresheet: z.boolean(),
  timeouts_per_team: z.number().int(),
  spirit_stoppages_enabled: z.boolean(),
  require_accreditation: z.boolean(),
  max_game_score: z.number().int(),
  max_goals_per_side: z.number().int(),
  max_jersey_number: z.number().int(),
});
export type Rules = z.infer<typeof rulesSchema>;

export const entryContextSchema = z.object({
  game: z.object({
    game_id: z.number().int(),
    time: z.string().nullable(),
    field: z.string().nullable(),
    location: z.string().nullable(),
    pool: z.object({ pool_id: z.number().int().nullable(), name: z.string().nullable() }),
    division: z.string().nullable(),
    event: z.object({
      event_id: z.string(),
      name: z.string().nullable(),
      timezone: z.string().nullable(),
    }),
  }),
  home: teamSide,
  away: teamSide,
  result: resultSchema.nullable(),
  goals: z.array(serverGoal),
  timeouts: bySide,
  spirit_stoppages: bySide,
  /**
   * The server's game clock: null while the event hides times. Absent from older
   * servers and from contexts saved before the clock route existed.
   */
  clock: clockSchema.nullable().optional(),
  /** The game note: only a user-scoped (personal) app token is shown it, otherwise null. */
  note: z.string().nullable().optional(),
  metadata: z.object({
    starting_offence: sideSchema.nullable(),
    halftime: z.number().int().nullable(),
    official: z.string().nullable(),
  }),
  rules: rulesSchema,
  retained: z.object({
    forfeit: z.enum(['none', 'home', 'away', 'both']),
    cap_events: z.array(
      z.object({ type: z.string(), time: z.number().int(), point_cap: z.number().int() }),
    ),
    defenses: z.object({
      home: z.number().int(),
      away: z.number().int(),
      referenced_player_ids: z.array(z.number().int()),
    }),
  }),
  token: z.string(),
});
export type EntryContext = z.infer<typeof entryContextSchema>;
