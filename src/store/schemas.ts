import { z } from 'zod';
import type { GameState } from '../game/reducer';
import { sideSchema } from '../game/types';
import type { OutboxState } from '../sync/outbox';
import type { TimekeeperSession } from '../timekeeper/engine';

/**
 * Guards for JSON read back from SQLite. They check structure, not every rule: the
 * rules ran when the data was written. The event payload inside an outbox row is
 * only checked for its `type`, since it came from our own reducer.
 */

const result = z.object({
  home: z.number().int(),
  away: z.number().int(),
  state: z.enum(['ongoing', 'final']),
});

const row = z.object({
  key: z.string().min(1).max(64),
  op: z.enum([
    'goal',
    'delete_goal',
    'timeout',
    'spirit_stoppage',
    'score_tap',
    'roster',
    'metadata',
    'finalize',
    'cap',
    'remove_cap',
    'upload',
  ]),
  event: z
    .custom<NonNullable<OutboxState['rows'][number]['event']>>(
      (v) =>
        typeof v === 'object' && v !== null && typeof (v as { type?: unknown }).type === 'string',
    )
    .nullable(),
  method: z.enum(['POST', 'PUT', 'PATCH', 'DELETE']),
  path: z.string(),
  body: z.unknown(),
  ifMatch: z.string().optional(),
  status: z.enum(['pending', 'sending', 'sent', 'failed']),
  attempts: z.number().int(),
  createdAt: z.number(),
  serverNum: z.number().int().optional(),
  skipped: z.boolean().optional(),
  error: z
    .object({
      status: z.number(),
      code: z.string(),
      path: z.string().optional(),
      message: z.string(),
    })
    .optional(),
});

export const outboxSchema: z.ZodType<OutboxState> = z.object({
  gameId: z.number().int(),
  rows: z.array(row),
  paused: z
    .object({
      reason: z.enum(['conflict', 'auth', 'failed']),
      rowKey: z.string().nullable(),
      code: z.string(),
    })
    .nullable(),
  token: z.string().nullable(),
  confirmedResult: result.nullable(),
  nextAttemptAt: z.number(),
  offline: z.boolean(),
  offlineOnly: z.boolean(),
  capsAbsent: z.boolean().optional(),
}) as unknown as z.ZodType<OutboxState>;

const timer = z.object({
  scenario: z.object({
    id: z.string(),
    total: z.number(),
    signals: z.array(
      z.object({
        at: z.number(),
        text: z.string(),
        kind: z.enum(['warn', 'go']),
        final: z.boolean().optional(),
        startsClock: z.boolean().optional(),
      }),
    ),
    repeat: z
      .object({
        from: z.number(),
        every: z.number(),
        text: z.string(),
        kind: z.enum(['warn', 'go']),
      })
      .optional(),
  }),
  startMs: z.number(),
  accumMs: z.number(),
  pausedAtMs: z.number().nullable(),
});

const caps = z.object({ half_time_cap: z.number(), time_cap: z.number() });

export const sessionSchema: z.ZodType<TimekeeperSession> = z.object({
  timer: timer.nullable(),
  clock: z.object({ running: z.boolean(), startMs: z.number(), accumMs: z.number() }),
  marks: z.array(
    z.object({ key: z.string(), label: z.string(), number: z.number(), seconds: z.number() }),
  ),
  halftimeStarted: z.boolean(),
  capConfig: caps.nullable(),
  loggedCaps: z.object({ half: z.literal(true).optional(), time: z.literal(true).optional() }),
  dismissedCap: z.enum(['half', 'time']).nullable(),
  startWarning: z.boolean(),
}) as unknown as z.ZodType<TimekeeperSession>;

export const overridesSchema = z.record(
  z.string(),
  z.object({
    signals: z.record(z.string(), z.number()).optional(),
    caps: z
      .object({ half_time_cap: z.number().optional(), time_cap: z.number().optional() })
      .optional(),
  }),
);
export type OverridesByTemplate = z.infer<typeof overridesSchema>;

export const probesSchema = z.record(z.string(), z.enum(['present', 'absent']));

export const teamColorsSchema = z.object({ home: z.string(), away: z.string() });

export const gameStateSchema = z.custom<GameState>(
  (v) =>
    typeof v === 'object' &&
    v !== null &&
    typeof (v as GameState).gameId === 'number' &&
    Array.isArray((v as GameState).goals),
);

export { sideSchema };

/** Parses JSON text with a schema; returns null for missing, malformed or non-matching data. */
export function parseJson<T>(text: string | null | undefined, schema: z.ZodType<T>): T | null {
  if (!text) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
