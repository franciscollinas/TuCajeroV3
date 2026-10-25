import { mkdirSync } from 'fs';
import { dirname } from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../../../database/schema/index';
import { getDatabasePath, getMigrationsFolder } from '../utils/paths';
import { ensureMoneyIntegers } from './money-integrity';
import { recoverFromBackups } from './database-files';
import { getBackupsDir } from '../utils/paths';
import { logger } from '../utils/logger';

let dbPath = getDatabasePath();
let sqliteInstance: Database.Database | null = null;
let db: ReturnType<typeof drizzle> | null = null;

/** Se ejecuta con la base ya abierta y ANTES de aplicar cambios de esquema (copia previa a una actualización). */
let beforeUpgradeHook: ((sqlite: Database.Database) => void) | null = null;
export function setBeforeUpgradeHook(hook: ((sqlite: Database.Database) => void) | null): void {
  beforeUpgradeHook = hook;
}

export interface RecoveryNotice {
  restoredFrom: string;
  quarantinedTo: string;
}
let pendingRecoveryNotice: RecoveryNotice | null = null;
/** Si en este arranque se recuperó la base desde una copia, devuelve el aviso (una sola vez). */
export function consumeRecoveryNotice(): RecoveryNotice | null {
  const notice = pendingRecoveryNotice;
  pendingRecoveryNotice = null;
  return notice;
}

/** Conexión abierta de SQLite (para copias de seguridad en caliente). */
export function getRawDatabase(): Database.Database {
  getDatabase();
  return sqliteInstance as Database.Database;
}

function isCorruptionError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === 'SQLITE_NOTADB' || code === 'SQLITE_CORRUPT' || code === 'SQLITE_CORRUPT_VTAB';
}

// Evita un ciclo infinito si, tras restaurar, la base sigue sin poder abrirse.
let recoveryDepth = 0;

export function getDatabase(): ReturnType<typeof drizzle> {
  if (!db) {
    try {
      openAndPrepare();
    } catch (err) {
      if (!isCorruptionError(err) || recoveryDepth >= 3) throw err;
      // El archivo ni siquiera se puede leer como base de datos: mismo camino de recuperación.
      try { sqliteInstance?.close(); } catch { /* ya estaba cerrada */ }
      sqliteInstance = null;
      db = null;
      logger.error({ err }, 'Base de datos ilegible: se intenta recuperar desde la última copia sana');
      pendingRecoveryNotice = recoverFromBackups(dbPath, getBackupsDir());
      recoveryDepth++;
      try {
        return getDatabase();
      } finally {
        recoveryDepth--;
      }
    }
  }
  return db as ReturnType<typeof drizzle>;
}

function openAndPrepare(): void {
  {
    mkdirSync(dirname(dbPath), { recursive: true });
    sqliteInstance = new Database(dbPath);
    sqliteInstance.pragma('journal_mode = WAL');
    sqliteInstance.pragma('foreign_keys = ON');
    sqliteInstance.pragma('busy_timeout = 5000');
    sqliteInstance.pragma('synchronous = NORMAL');

    db = drizzle(sqliteInstance, { schema });
    if (schemaIsEmpty(sqliteInstance)) {
      migrate(db, { migrationsFolder: getMigrationsFolder() });
    } else if (beforeUpgradeHook) {
      try {
        beforeUpgradeHook(sqliteInstance);
      } catch (err) {
        // Una copia previa que falla no debe impedir abrir la aplicación.
        logger.error({ err }, 'No se pudo hacer la copia previa a la actualización');
      }
    }

    ensureOptionalColumns(sqliteInstance);
    ensureTaxRateFraction(sqliteInstance);
    ensureDailyAuditTable(sqliteInstance);
    ensureIndexes(sqliteInstance);
    ensureMoneyIntegers(sqliteInstance, `${dbPath}.pre-money-int.bak`);

    // quick_check devuelve una fila con la columna `quick_check` (no `integrity_check`).
    const integrityRows = sqliteInstance.pragma('quick_check') as Array<Record<string, string>>;
    const integrityResult = Object.values(integrityRows[0] ?? {})[0];
    if (integrityResult !== 'ok') {
      sqliteInstance.close();
      sqliteInstance = null;
      db = null;
      logger.error({ integrityResult }, 'Base de datos dañada: se intenta recuperar desde la última copia sana');
      // Si hay una copia sana se restaura sola (y la dañada se guarda aparte); si no, lanza un error claro.
      pendingRecoveryNotice = recoverFromBackups(dbPath, getBackupsDir());
      openAndPrepare();
      return;
    }

    db = drizzle(sqliteInstance, { schema });
  }
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

// Índices que faltaban para los reportes, los abonos y la anulación de ventas. Las migraciones
// de drizzle solo corren con la base vacía, así que se aplican siempre (IF NOT EXISTS).
export function ensureIndexes(sqlite: Database.Database): void {
  const statements = [
    'CREATE INDEX IF NOT EXISTS idx_payment_debt ON "Payment" ("debtId")',
    'CREATE INDEX IF NOT EXISTS idx_payment_created ON "Payment" ("createdAt")',
    'CREATE INDEX IF NOT EXISTS idx_debt_sale ON "Debt" ("saleId")',
    'CREATE INDEX IF NOT EXISTS idx_sale_account_status_created ON "Sale" ("accountId", "status", "createdAt")',
  ];
  for (const statement of statements) sqlite.exec(statement);
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
