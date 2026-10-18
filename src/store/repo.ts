import { z } from 'zod';
import type { GameState } from '../game/reducer';
import { type EntryContext, entryContextSchema } from '../game/types';
import type { OutboxState } from '../sync/outbox';
import { newSession, type TimekeeperSession } from '../timekeeper/engine';
import type { TemplateSet } from '../timekeeper/templates';
import type { Db } from './migrations';
import {
  type OverridesByTemplate,
  gameStateSchema,
  outboxSchema,
  overridesSchema,
  parseJson,
  probesSchema,
  sessionSchema,
  teamColorsSchema,
} from './schemas';

export const STANDALONE_SCOPE = 'standalone';
export const gameScope = (serverId: number, gameId: number) => `game:${serverId}:${gameId}`;

/** Local game data is deleted this long after a game is finalized and synced. */
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export type ServerRow = {
  id: number;
  root: string;
  label: string;
  createdAt: number;
};

type ServerSql = { id: number; root: string; label: string; created_at: number };
const toServer = (r: ServerSql): ServerRow => ({
  id: r.id,
  root: r.root,
  label: r.label,
  createdAt: r.created_at,
});

export function createRepo(db: Db) {
  return {
    /* Servers ------------------------------------------------------- */

    async listServers(): Promise<ServerRow[]> {
      const rows = await db.getAllAsync<ServerSql>('SELECT * FROM servers ORDER BY created_at');
      return rows.map(toServer);
    },

    async serverByRoot(root: string): Promise<ServerRow | null> {
      const r = await db.getFirstAsync<ServerSql>('SELECT * FROM servers WHERE root = ?', root);
      return r ? toServer(r) : null;
    },

    /** Adds a server, or returns the one already paired with this root. */
    async upsertServer(root: string, label: string, now: number): Promise<ServerRow> {
      await db.runAsync(
        'INSERT INTO servers (root, label, created_at) VALUES (?, ?, ?) ON CONFLICT(root) DO UPDATE SET label = excluded.label',
        root,
        label,
        now,
      );
      return (await this.serverByRoot(root))!;
    },

    async removeServer(id: number): Promise<void> {
      await db.runAsync('DELETE FROM servers WHERE id = ?', id);
    },

    async getProbes(serverId: number): Promise<Record<string, 'present' | 'absent'>> {
      const r = await db.getFirstAsync<{ probes_json: string }>(
        'SELECT probes_json FROM servers WHERE id = ?',
        serverId,
      );
      return parseJson(r?.probes_json, probesSchema) ?? {};
    },

    /** Remembers that a route exists or not on this server, so it is asked once. */
    async setProbe(serverId: number, route: string, value: 'present' | 'absent'): Promise<void> {
      const probes = { ...(await this.getProbes(serverId)), [route]: value };
      await db.runAsync(
        'UPDATE servers SET probes_json = ? WHERE id = ?',
        JSON.stringify(probes),
        serverId,
      );
    },

    async getCachedTemplates(serverId: number): Promise<TemplateSet | null> {
      const r = await db.getFirstAsync<{ templates_json: string | null }>(
        'SELECT templates_json FROM servers WHERE id = ?',
        serverId,
      );
      return parseJson(r?.templates_json, templateSetSchema);
    },

    async setCachedTemplates(serverId: number, set: TemplateSet): Promise<void> {
      await db.runAsync(
        'UPDATE servers SET templates_json = ? WHERE id = ?',
        JSON.stringify(set),
        serverId,
      );
    },

    /* Games --------------------------------------------------------- */

    async saveGame(g: {
      serverId: number;
      gameId: number;
      title: string;
      context: EntryContext;
      state: GameState;
      outbox: OutboxState;
      colors?: { home: string; away: string } | null;
      now: number;
    }): Promise<void> {
      const finalized = g.state.result?.state === 'final';
      const synced =
        finalized && !g.outbox.rows.some((r) => r.status !== 'sent') && !g.outbox.paused;
      const prev = await db.getFirstAsync<{
        finalized_at: number | null;
        synced_at: number | null;
      }>(
        'SELECT finalized_at, synced_at FROM games WHERE server_id = ? AND game_id = ?',
        g.serverId,
        g.gameId,
      );
      await db.runAsync(
        `INSERT INTO games (server_id, game_id, title, context_json, state_json, outbox_json, colors_json, finalized_at, synced_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(server_id, game_id) DO UPDATE SET
           title = excluded.title, context_json = excluded.context_json, state_json = excluded.state_json,
           outbox_json = excluded.outbox_json, colors_json = COALESCE(excluded.colors_json, colors_json),
           finalized_at = excluded.finalized_at, synced_at = excluded.synced_at, updated_at = excluded.updated_at`,
        g.serverId,
        g.gameId,
        g.title,
        JSON.stringify(g.context),
        JSON.stringify(g.state),
        JSON.stringify(g.outbox),
        g.colors ? JSON.stringify(g.colors) : null,
        finalized ? (prev?.finalized_at ?? g.now) : null,
        synced ? (prev?.synced_at ?? g.now) : null,
        g.now,
      );
    },

    async loadGame(serverId: number, gameId: number) {
      const r = await db.getFirstAsync<GameSql>(
        'SELECT * FROM games WHERE server_id = ? AND game_id = ?',
        serverId,
        gameId,
      );
      if (!r) return null;
      const context = parseJson(r.context_json, entryContextSchema);
      const state = parseJson(r.state_json, gameStateSchema);
      const outbox = parseJson(r.outbox_json, outboxSchema);
      // Unreadable data is treated as absent: the game is fetched again.
      if (!context || !state || !outbox) return null;
      return {
        title: r.title,
        context,
        state,
        outbox,
        colors: parseJson(r.colors_json, teamColorsSchema),
        finalizedAt: r.finalized_at,
        syncedAt: r.synced_at,
        updatedAt: r.updated_at,
      };
    },

    async listGames(serverId?: number) {
      const rows = await db.getAllAsync<
        Pick<
          GameSql,
          | 'server_id'
          | 'game_id'
          | 'title'
          | 'finalized_at'
          | 'synced_at'
          | 'updated_at'
          | 'outbox_json'
        >
      >(
        `SELECT server_id, game_id, title, finalized_at, synced_at, updated_at, outbox_json FROM games
         ${serverId === undefined ? '' : 'WHERE server_id = ?'} ORDER BY updated_at DESC`,
        ...(serverId === undefined ? [] : [serverId]),
      );
      return rows.map((r) => {
        const outbox = parseJson(r.outbox_json, outboxSchema);
        return {
          serverId: r.server_id,
          gameId: r.game_id,
          title: r.title,
          finalizedAt: r.finalized_at,
          syncedAt: r.synced_at,
          updatedAt: r.updated_at,
          unsent: outbox ? outbox.rows.filter((x) => x.status !== 'sent').length : 0,
        };
      });
    },

    async deleteGame(serverId: number, gameId: number): Promise<void> {
      await db.runAsync('DELETE FROM games WHERE server_id = ? AND game_id = ?', serverId, gameId);
      await db.runAsync(
        'DELETE FROM timekeeper_sessions WHERE scope = ?',
        gameScope(serverId, gameId),
      );
    },

    /**
     * Deletes games finalized and synced more than 30 days ago, with their timekeeper
     * sessions. Returns the purged games so the caller can delete their link tokens.
     */
    async purgeOldGames(now: number): Promise<{ serverId: number; gameId: number }[]> {
      const cutoff = now - RETENTION_MS;
      const old = await db.getAllAsync<{ server_id: number; game_id: number }>(
        'SELECT server_id, game_id FROM games WHERE finalized_at IS NOT NULL AND synced_at IS NOT NULL AND synced_at < ?',
        cutoff,
      );
      for (const g of old) await this.deleteGame(g.server_id, g.game_id);
      return old.map((g) => ({ serverId: g.server_id, gameId: g.game_id }));
    },

    /* Timekeeper ---------------------------------------------------- */

    /**
     * The timekeeper session of one scope: `STANDALONE_SCOPE` for Timekeeper-only mode,
     * or `gameScope(serverId, gameId)` so each game has its own clock and marks. The
     * template choice and local edits are per device, shared by all scopes.
     */
    async loadTimekeeper(scope: string): Promise<{
      session: TimekeeperSession;
      templateId: number | null;
      overrides: OverridesByTemplate;
    }> {
      const s = await db.getFirstAsync<{ session_json: string }>(
        'SELECT session_json FROM timekeeper_sessions WHERE scope = ?',
        scope,
      );
      const p = await db.getFirstAsync<{ template_id: number | null; overrides_json: string }>(
        'SELECT template_id, overrides_json FROM timekeeper_prefs WHERE id = 1',
      );
      return {
        session: parseJson(s?.session_json, sessionSchema) ?? newSession(),
        templateId: p?.template_id ?? null,
        overrides: parseJson(p?.overrides_json, overridesSchema) ?? {},
      };
    },

    /** Written on every start, pause and resume, so a killed app recovers its anchors. */
    async saveTimekeeper(
      scope: string,
      session: TimekeeperSession,
      templateId: number | null,
      overrides: OverridesByTemplate,
    ): Promise<void> {
      await db.runAsync(
        `INSERT INTO timekeeper_sessions (scope, session_json) VALUES (?, ?)
         ON CONFLICT(scope) DO UPDATE SET session_json = excluded.session_json`,
        scope,
        JSON.stringify(session),
      );
      await db.runAsync(
        `INSERT INTO timekeeper_prefs (id, template_id, overrides_json) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET template_id = excluded.template_id, overrides_json = excluded.overrides_json`,
        templateId,
        JSON.stringify(overrides),
      );
    },

    /* Settings ------------------------------------------------------ */

    async getSetting(key: string): Promise<string | null> {
      const r = await db.getFirstAsync<{ value: string }>(
        'SELECT value FROM settings WHERE key = ?',
        key,
      );
      return r?.value ?? null;
    },

    async setSetting(key: string, value: string): Promise<void> {
      await db.runAsync(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        key,
        value,
      );
    },
  };
}

export type Repo = ReturnType<typeof createRepo>;

type GameSql = {
  server_id: number;
  game_id: number;
  title: string;
  context_json: string;
  state_json: string;
  outbox_json: string;
  colors_json: string | null;
  finalized_at: number | null;
  synced_at: number | null;
  updated_at: number;
};

const templateSetSchema: z.ZodType<TemplateSet> = z.object({
  defaultTemplateId: z.number().int(),
  templates: z.array(
    z.object({
      id: z.number().int(),
      name: z.string(),
      caps: z.object({ half_time_cap: z.number(), time_cap: z.number() }),
      signals: z.record(
        z.string(),
        z.array(z.object({ id: z.number().int(), time: z.number(), text: z.string() })),
      ),
    }),
  ),
}) as unknown as z.ZodType<TemplateSet>;
