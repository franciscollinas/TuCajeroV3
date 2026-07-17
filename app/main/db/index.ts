import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../database/schema/index';
import { getDatabasePath } from '../utils/paths';

let dbPath = getDatabasePath();
let sqliteInstance: Database.Database | null = null;
let db: ReturnType<typeof drizzle> | null = null;

export function getDatabase(): ReturnType<typeof drizzle> {
  if (!db) {
    sqliteInstance = new Database(dbPath);
    sqliteInstance.pragma('journal_mode = WAL');
    sqliteInstance.pragma('foreign_keys = ON');
    sqliteInstance.pragma('busy_timeout = 5000');
    sqliteInstance.pragma('synchronous = NORMAL');

    const integrityRow = sqliteInstance.pragma('integrity_check') as Array<{ integrity_check: string }> | { integrity_check: string };
    const integrityResult = Array.isArray(integrityRow) ? integrityRow[0]?.integrity_check : integrityRow?.integrity_check;
    if (integrityResult !== 'ok') {
      sqliteInstance.close();
      sqliteInstance = null;
      throw new Error(`La base de datos está corrupta: ${integrityResult ?? 'error desconocido'}`);
    }

    db = drizzle(sqliteInstance, { schema });
  }
  return db;
}

export function setDatabasePath(path: string): void {
  closeDatabase();
  dbPath = path;
}

export function closeDatabase(): void {
  if (sqliteInstance) {
    sqliteInstance.close();
    sqliteInstance = null;
    db = null;
  }
}

export function getDatabasePathForTesting(): string {
  return dbPath;
}

export { schema };
