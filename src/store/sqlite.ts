import * as SQLite from 'expo-sqlite';
import { type Db, migrate } from './migrations';
import { createRepo, type Repo } from './repo';

let opened: Promise<Repo> | null = null;

/** Opens the app database once, runs migrations, and returns the repository. */
export function getRepo(): Promise<Repo> {
  opened ??= (async () => {
    const db = await SQLite.openDatabaseAsync('ultiorganizer-field.db');
    await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    await migrate(db as unknown as Db);
    return createRepo(db as unknown as Db);
  })();
  return opened;
}
