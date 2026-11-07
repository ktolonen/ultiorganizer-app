/**
 * SQLite schema, versioned with `PRAGMA user_version`. Documents (entry context,
 * outbox, timekeeper session) are stored as JSON text and validated with zod when
 * read, so a corrupted or older row is dropped instead of crashing the app.
 * Append new steps; never edit a shipped one.
 */
export const MIGRATIONS: readonly string[] = [
  `CREATE TABLE servers (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     root TEXT NOT NULL UNIQUE,
     label TEXT NOT NULL,
     version_json TEXT,
     probes_json TEXT NOT NULL DEFAULT '{}',
     templates_json TEXT,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE games (
     server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
     game_id INTEGER NOT NULL,
     title TEXT NOT NULL,
     context_json TEXT NOT NULL,
     state_json TEXT NOT NULL,
     outbox_json TEXT NOT NULL,
     colors_json TEXT,
     finalized_at INTEGER,
     synced_at INTEGER,
     updated_at INTEGER NOT NULL,
     PRIMARY KEY (server_id, game_id)
   );
   CREATE TABLE timekeeper_sessions (
     scope TEXT PRIMARY KEY,
     session_json TEXT NOT NULL
   );
   CREATE TABLE timekeeper_prefs (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     template_id INTEGER,
     overrides_json TEXT NOT NULL DEFAULT '{}'
   );
   CREATE TABLE settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );`,
  // Scorekeeping links kept for reopening their game list without a scan. The link
  // token itself is in SecureStore under the row id.
  `CREATE TABLE links (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
     label TEXT NOT NULL,
     day TEXT,
     used_at INTEGER NOT NULL
   );`,
  // Server data saved while online, so games can be opened and kept without a connection
  // and synced later. A list is keyed by a hash of its link token, never the token itself.
  `CREATE TABLE cached_lists (
     server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
     link_hash TEXT NOT NULL,
     discovery_json TEXT NOT NULL,
     fetched_at INTEGER NOT NULL,
     PRIMARY KEY (server_id, link_hash)
   );
   CREATE TABLE cached_contexts (
     server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
     game_id INTEGER NOT NULL,
     context_json TEXT NOT NULL,
     fetched_at INTEGER NOT NULL,
     PRIMARY KEY (server_id, game_id)
   );`,
  // The reserved row local games belong to (LOCAL_SERVER_ID in src/game/local.ts). Its root
  // is not a URL, so no pairing or scan can match it; server lists leave it out.
  `INSERT INTO servers (id, root, label, created_at) VALUES (0, 'local:', 'This phone', 0);`,
];

/** The minimal database surface the store needs; `expo-sqlite` and test fakes both fit. */
export interface Db {
  execAsync(sql: string): Promise<void>;
  getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  runAsync(sql: string, ...params: unknown[]): Promise<unknown>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

export async function migrate(db: Db, steps: readonly string[] = MIGRATIONS): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  if (current > steps.length) {
    throw new Error(`Database is newer (v${current}) than this app (v${steps.length}).`);
  }
  for (let v = current; v < steps.length; v++) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(steps[v]);
      await db.execAsync(`PRAGMA user_version = ${v + 1}`);
    });
  }
  return steps.length;
}
