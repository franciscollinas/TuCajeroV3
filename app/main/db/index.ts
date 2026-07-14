import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../database/schema/index';
import { getDatabasePath } from '../utils/paths';

const DB_PATH = getDatabasePath();

let sqliteInstance: Database.Database | null = null;
let db: ReturnType<typeof drizzle> | null = null;

export function getDatabase(): ReturnType<typeof drizzle> {
  if (!db) {
    sqliteInstance = new Database(DB_PATH);
    sqliteInstance.pragma('journal_mode = WAL');
    sqliteInstance.pragma('foreign_keys = ON');
    sqliteInstance.pragma('busy_timeout = 5000');
    sqliteInstance.pragma('synchronous = NORMAL');
    db = drizzle(sqliteInstance, { schema });
  }
  return db;
}

export function closeDatabase(): void {
  if (sqliteInstance) {
    sqliteInstance.close();
    sqliteInstance = null;
    db = null;
  }
}

export { schema };
