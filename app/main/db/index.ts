import { mkdirSync } from 'fs';
import { dirname } from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../../../database/schema/index';
import { getDatabasePath, getMigrationsFolder } from '../utils/paths';

let dbPath = getDatabasePath();
let sqliteInstance: Database.Database | null = null;
let db: ReturnType<typeof drizzle> | null = null;

export function getDatabase(): ReturnType<typeof drizzle> {
  if (!db) {
    mkdirSync(dirname(dbPath), { recursive: true });
    sqliteInstance = new Database(dbPath);
    sqliteInstance.pragma('journal_mode = WAL');
    sqliteInstance.pragma('foreign_keys = ON');
    sqliteInstance.pragma('busy_timeout = 5000');
    sqliteInstance.pragma('synchronous = NORMAL');

    db = drizzle(sqliteInstance, { schema });
    if (schemaIsEmpty(sqliteInstance)) {
      migrate(db, { migrationsFolder: getMigrationsFolder() });
    }

    ensureOptionalColumns(sqliteInstance);
    ensureTaxRateFraction(sqliteInstance);
    ensureDailyAuditTable(sqliteInstance);

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

function schemaIsEmpty(sqlite: Database.Database): boolean {
  const tables = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('User', 'CashSession')")
    .all() as Array<{ name: string }>;
  return tables.length === 0;
}

function ensureOptionalColumns(sqlite: Database.Database): void {
  const columns = sqlite.pragma('table_info("CashSession")') as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'lastActivityAt')) {
    sqlite.exec('ALTER TABLE "CashSession" ADD COLUMN "lastActivityAt" text');
  }
}

// Los productos legado guardaron taxRate como porcentaje (ej: 19). Normaliza a
// fracción (0.19) para que el cálculo de IVA en ventas/cotizaciones sea correcto.
export function ensureTaxRateFraction(sqlite: Database.Database): void {
  const tables = sqlite.pragma('table_list') as Array<{ name: string }>;
  if (tables.some((t) => t.name === 'Product')) {
    sqlite.exec('UPDATE "Product" SET "taxRate" = "taxRate" / 100 WHERE "taxRate" > 1;');
  }
}

// Crea (si no existe) la tabla del log diario de auditoría. Los instalados previos
// no ejecutan migraciones de drizzle (solo bases nuevas), por eso se garantiza aquí.
export function ensureDailyAuditTable(sqlite: Database.Database): void {
  sqlite.exec(`
CREATE TABLE IF NOT EXISTS "DailyAuditLog" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "accountId" integer NOT NULL REFERENCES "Account"(id) ON DELETE cascade,
  "date" text NOT NULL,
  "summary" text NOT NULL,
  "createdAt" text NOT NULL,
  "updatedAt" text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_daily_audit_account_date" ON "DailyAuditLog" ("accountId", "date");
CREATE INDEX IF NOT EXISTS "idx_daily_audit_date" ON "DailyAuditLog" ("date");
`);
}

export { schema };
