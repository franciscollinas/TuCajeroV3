import { copyFileSync, existsSync, mkdirSync, unlinkSync, statSync } from 'fs';
import { join } from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { closeDatabase, getDatabase } from '../db';
import { getDatabasePath, getBackupsDir, getMigrationsFolder } from '../utils/paths';
import { nowISO, toFileDate } from '../utils/date';
import { logger } from '../utils/logger';

export interface MigrationSummary {
  sales: number;
  products: number;
  customers: number;
  cashSessions: number;
  firstSale: string | null;
  lastSale: string | null;
}

export interface MigrationDetection {
  available: boolean;
  path: string | null;
  size: string | null;
  alreadyMigrated: boolean;
  summary?: MigrationSummary | null;
}

export interface MigrationVerification {
  /** Filas por tabla: en la base de V2 y en la nueva. Tienen que ser iguales. */
  tables: Record<string, { origen: number; destino: number }>;
  /** Totales (ventas, pagos, existencias, deudas...) en V2 y en la nueva. Tienen que ser iguales. */
  sums: Record<string, { origen: number; destino: number }>;
  /** Fechas que quedaron como número en vez de texto (debe ser 0). */
  datesNotConverted: number;
}

/** Un valor que no podía ser dinero real (por ejemplo, un conteo de caja mal tecleado) y se dejó sin valor. */
export interface MigrationCorrection {
  table: string;
  id: number;
  column: string;
  /** Valor tal como estaba en V2. También queda guardado en la auditoría. */
  original: string;
}

export interface MigrationReport {
  migrated: boolean;
  sourcePath: string;
  backupPath: string;
  accountId: number;
  rows: Record<string, number>;
  integrity: string;
  verification?: MigrationVerification;
  corrections?: MigrationCorrection[];
}

/** Monto máximo que V3 acepta al escribir dinero; lo que pase de ahí en V2 es un error de digitación. */
const MAX_MONEY = 999_999_999;

const DEFAULT_ACCOUNT_NAME = 'Cuenta Principal';
const DEFAULT_ACCOUNT_NIT = '000000000000';
const DEFAULT_ACCOUNT_EMAIL = 'local@tucajero.local';
const DEFAULT_ACCOUNT_PHONE = '';
const DEFAULT_BRANCH_NAME = 'Sucursal Principal';
const DEFAULT_BRANCH_CODE = 'MAIN';

/** Usuarios que crea V3 sola en una instalación nueva: una base que solo los tiene está «virgen». */
const BOOTSTRAP_USERNAMES = ['admin', 'cajero1'];

/** Tablas de V3 que no se comparan (las crea o las llena la propia migración). */
const NOT_COMPARED = new Set(['_prisma_migrations']);

/** Totales que deben ser idénticos antes y después de migrar. */
const SUM_CHECKS: Array<[string, string]> = [
  ['Sale', 'total'],
  ['SaleItem', 'total'],
  ['Payment', 'amount'],
  ['Product', 'stock'],
  ['StockMovement', 'quantity'],
  ['Debt', 'balance'],
  ['PurchaseOrder', 'total'],
  ['CashSession', 'expectedCash'],
  ['CashSession', 'initialCash'],
];

type TargetState = 'missing' | 'virgin' | 'has-data';

function formatSize(bytes: number): string {
  return bytes >= 1048576
    ? `${(bytes / 1048576).toFixed(1)} MB`
    : `${(bytes / 1024).toFixed(1)} KB`;
}

function tableExists(sqlite: Database.Database, name: string): boolean {
  const row = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
  return !!row;
}

function hasColumn(sqlite: Database.Database, table: string, column: string): boolean {
  const columns = sqlite.pragma(`table_info("${table}")`) as Array<{ name: string }>;
  return columns.some((c) => c.name === column);
}

function countRows(sqlite: Database.Database, table: string): number {
  return (sqlite.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as { count: number }).count;
}

/** Fecha de V2 (número en milisegundos, o texto) como AAAA-MM-DD. */
function toDay(value: unknown): string | null {
  if (typeof value === 'number') return new Date(value).toISOString().slice(0, 10);
  if (typeof value === 'string' && value.length >= 10) return value.slice(0, 10);
  return null;
}

/**
 * Estado de la base de V3 de destino: «virgen» si es la que V3 crea sola al instalarse (sin ventas,
 * productos ni clientes, y solo con los usuarios de fábrica); «con datos» si ya se usó.
 */
function targetState(path: string): TargetState {
  if (!existsSync(path)) return 'missing';
  let sqlite: Database.Database;
  try {
    sqlite = new Database(path, { readonly: true });
  } catch {
    return 'missing';
  }
  try {
    if (!tableExists(sqlite, 'User')) return 'missing';
    const users = sqlite.prepare('SELECT username FROM "User"').all() as Array<{ username: string }>;
    const populated = ['Sale', 'Product', 'Customer', 'CashSession', 'StockMovement'].some(
      (table) => tableExists(sqlite, table) && countRows(sqlite, table) > 0,
    );
    const onlyFactoryUsers = users.every((user) => BOOTSTRAP_USERNAMES.includes(user.username));
    return !populated && onlyFactoryUsers ? 'virgin' : 'has-data';
  } finally {
    sqlite.close();
  }
}

export class MigrationService {
  private candidatePaths(): string[] {
    const candidates: string[] = [];
    const envPath = process.env.V2_DATABASE_PATH;
    if (envPath) candidates.push(envPath);
    if (process.platform === 'win32' && process.env.APPDATA) {
      candidates.push(join(process.env.APPDATA, 'tucajero', 'tucajero.db'));
      candidates.push(join(process.env.APPDATA, 'TuCajero', 'tucajero.db'));
    }
    return candidates;
  }

  /** Qué hay en la base de V2 (para mostrárselo al usuario antes de importar). */
  private describeV2(path: string): MigrationSummary | null {
    try {
      const sqlite = new Database(path, { readonly: true });
      try {
        const count = (table: string): number => (tableExists(sqlite, table) ? countRows(sqlite, table) : 0);
        const range = tableExists(sqlite, 'Sale')
          ? (sqlite.prepare('SELECT MIN("createdAt") AS first, MAX("createdAt") AS last FROM "Sale"').get() as { first: unknown; last: unknown })
          : { first: null, last: null };
        return {
          sales: count('Sale'),
          products: count('Product'),
          customers: count('Customer'),
          cashSessions: count('CashSession'),
          firstSale: toDay(range.first),
          lastSale: toDay(range.last),
        };
      } finally {
        sqlite.close();
      }
    } catch {
      return null;
    }
  }

  detectV2(): MigrationDetection {
    let v2Path: string | null = null;

    for (const path of this.candidatePaths()) {
      if (!existsSync(path)) continue;
      try {
        const sqlite = new Database(path, { readonly: true });
        try {
          const hasAccount = tableExists(sqlite, 'Account');
          const hasSale = tableExists(sqlite, 'Sale');
          if (hasSale && !hasAccount) v2Path = path;
        } finally {
          sqlite.close();
        }
      } catch {
        continue;
      }
    }

    if (targetState(getDatabasePath()) === 'has-data') {
      return {
        available: false,
        path: v2Path,
        size: v2Path ? formatSize(statSync(v2Path).size) : null,
        alreadyMigrated: true,
        summary: v2Path ? this.describeV2(v2Path) : null,
      };
    }

    if (v2Path) {
      return {
        available: true,
        path: v2Path,
        size: formatSize(statSync(v2Path).size),
        alreadyMigrated: false,
        summary: this.describeV2(v2Path),
      };
    }

    return { available: false, path: null, size: null, alreadyMigrated: false, summary: null };
  }

  async migrateV2(): Promise<MigrationReport> {
    const detected = this.detectV2();
    if (!detected.path) {
      throw new Error('No se encontró la base de datos de TuCajero V2.');
    }
    if (detected.alreadyMigrated) {
      throw new Error('La base de datos encontrada ya fue migrada a la versión actual.');
    }
    return this.migrateFrom(detected.path);
  }

  /**
   * Importa la base de V2 a V3. La de V2 solo se lee: nunca se modifica. Si algo sale mal (o si después de
   * migrar las cifras no coinciden con las originales), la base de V3 queda exactamente como estaba.
   */
  async migrateFrom(sourcePath: string): Promise<MigrationReport> {
    const targetPath = getDatabasePath();
    const state = targetState(targetPath);
    if (state === 'has-data') {
      throw new Error('La base de datos actual ya contiene datos. No se puede migrar sin perder información.');
    }

    closeDatabase();

    const stamp = toFileDate(new Date());
    const backupPath = join(getBackupsDir(), `v2_migrate_${stamp}.db`);
    const virginBackup = state === 'virgin' ? join(getBackupsDir(), `v3_vacia_${stamp}.db`) : null;

    try {
      mkdirSync(getBackupsDir(), { recursive: true });
      // Copia de seguridad intacta de los datos del cliente, por si hiciera falta volver a empezar.
      await this.copyDatabase(sourcePath, backupPath);
      if (virginBackup) await this.copyDatabase(targetPath, virginBackup);

      this.removeDatabaseFiles(targetPath);
      await this.copyDatabase(sourcePath, targetPath);

      const report = this.transform(targetPath);
      report.verification = this.verify(sourcePath, targetPath, report.corrections ?? []);
      report.sourcePath = sourcePath;
      report.backupPath = backupPath;
      return report;
    } catch (err) {
      logger.error({ err }, 'La migración de V2 falló: se deja la base de V3 como estaba');
      closeDatabase();
      this.removeDatabaseFiles(targetPath);
      if (virginBackup && existsSync(virginBackup)) copyFileSync(virginBackup, targetPath);
      throw err;
    } finally {
      try {
        getDatabase();
      } catch (err) {
        logger.error({ err }, 'No se pudo reabrir la base de datos tras la migración');
      }
    }
  }

  private removeDatabaseFiles(path: string): void {
    for (const suffix of ['', '-wal', '-shm']) {
      const file = path + suffix;
      if (existsSync(file)) unlinkSync(file);
    }
  }

  private async copyDatabase(source: string, dest: string): Promise<void> {
    const src = new Database(source, { readonly: true });
    try {
      await src.backup(dest);
    } finally {
      src.close();
    }
  }

  private transform(targetPath: string): MigrationReport {
    const sqlite = new Database(targetPath);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('busy_timeout = 5000');

    const now = nowISO();

    try {
      sqlite.exec('BEGIN');

      this.createNewTables(sqlite);
      this.renameColumns(sqlite);
      this.createMissingTables(sqlite);
      this.addColumns(sqlite);
      this.addMissingColumns(sqlite);
      this.convertDates(sqlite);
      const corrections = this.fixImpossibleAmounts(sqlite, now);

      const accountId = this.seedDefaultData(sqlite, now);
      this.backfillAccountId(sqlite, accountId);
      this.createIndexes(sqlite);

      const rows = this.countRows(sqlite);

      const integrityRow = sqlite.pragma('integrity_check') as
        | Array<{ integrity_check: string }>
        | { integrity_check: string };
      const integrity = Array.isArray(integrityRow) ? integrityRow[0]?.integrity_check : integrityRow?.integrity_check;

      sqlite.exec('COMMIT');

      return {
        migrated: true,
        sourcePath: '',
        backupPath: '',
        accountId,
        rows,
        integrity: integrity ?? 'unknown',
        corrections,
      };
    } catch (err) {
      try {
        sqlite.exec('ROLLBACK');
      } catch {
        // ignore
      }
      throw err;
    } finally {
      sqlite.close();
    }
  }

  /**
   * Compara la base de V2 (solo lectura) con la nueva: mismas filas en cada tabla, mismos totales
   * y ninguna fecha sin convertir. Si algo no coincide, lanza un error y la migración se deshace.
   */
  private verify(sourcePath: string, targetPath: string, corrections: MigrationCorrection[]): MigrationVerification {
    const source = new Database(sourcePath, { readonly: true });
    const target = new Database(targetPath, { readonly: true });
    try {
      const problems: string[] = [];
      const tables: MigrationVerification['tables'] = {};
      const sourceTables = (source.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>).map((t) => t.name);

      for (const name of sourceTables) {
        if (NOT_COMPARED.has(name)) continue;
        const targetName = name === 'cash_expense' ? 'CashExpense' : name;
        // Cada valor corregido deja una fila nueva en la auditoría.
        const origen = countRows(source, name) + (targetName === 'AuditLog' ? corrections.length : 0);
        const destino = tableExists(target, targetName) ? countRows(target, targetName) : -1;
        tables[targetName] = { origen, destino };
        if (origen !== destino) problems.push(`${targetName}: ${origen} filas esperadas y ${destino} en la nueva`);
      }

      const corrected = new Set(corrections.map((c) => `${c.table}.${c.column}`));
      const sums: MigrationVerification['sums'] = {};
      for (const [table, column] of SUM_CHECKS) {
        if (!tableExists(source, table) || !hasColumn(source, table, column) || corrected.has(`${table}.${column}`)) continue;
        const total = (db: Database.Database): number =>
          (db.prepare(`SELECT COALESCE(ROUND(SUM("${column}"), 3), 0) AS total FROM "${table}"`).get() as { total: number }).total;
        const origen = total(source);
        const destino = total(target);
        sums[`${table}.${column}`] = { origen, destino };
        if (origen !== destino) problems.push(`${table}.${column}: suma ${origen} en V2 y ${destino} en la nueva`);
      }

      let datesNotConverted = 0;
      for (const { name } of target.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>) {
        for (const column of this.dateColumns(target, name)) {
          datesNotConverted += (target.prepare(`SELECT COUNT(*) AS c FROM "${name}" WHERE typeof("${column}") IN ('integer', 'real')`).get() as { c: number }).c;
        }
      }
      if (datesNotConverted > 0) problems.push(`${datesNotConverted} fechas quedaron sin convertir`);

      if (problems.length > 0) {
        throw new Error(`La verificación de la migración no coincidió, no se importó nada: ${problems.join('; ')}.`);
      }
      return { tables, sums, datesNotConverted };
    } finally {
      source.close();
      target.close();
    }
  }

  private dateColumns(sqlite: Database.Database, table: string): string[] {
    const columns = sqlite.pragma(`table_info("${table}")`) as Array<{ name: string; type: string }>;
    return columns.filter((c) => c.type.toUpperCase() === 'DATETIME').map((c) => c.name);
  }

  private createNewTables(sqlite: Database.Database): void {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS "Account" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "name" TEXT NOT NULL,
        "nit" TEXT NOT NULL UNIQUE,
        "email" TEXT NOT NULL,
        "phone" TEXT,
        "address" TEXT,
        "subscriptionStatus" TEXT NOT NULL DEFAULT 'TRIAL',
        "subscriptionPlan" TEXT NOT NULL DEFAULT 'BASIC',
        "trialEndsAt" TEXT,
        "stripeCustomerId" TEXT,
        "dianResolution" TEXT,
        "dianPrefix" TEXT DEFAULT 'FV',
        "isActive" INTEGER NOT NULL DEFAULT 1,
        "createdAt" TEXT NOT NULL,
        "updatedAt" TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS "Subscription" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "accountId" INTEGER NOT NULL REFERENCES "Account"("id") ON DELETE CASCADE,
        "stripeSubscriptionId" TEXT,
        "plan" TEXT NOT NULL,
        "status" TEXT NOT NULL,
        "startsAt" TEXT NOT NULL,
        "endsAt" TEXT,
        "createdAt" TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS "Branch" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "accountId" INTEGER NOT NULL REFERENCES "Account"("id") ON DELETE CASCADE,
        "name" TEXT NOT NULL,
        "code" TEXT NOT NULL,
        "address" TEXT,
        "phone" TEXT,
        "isActive" INTEGER NOT NULL DEFAULT 1,
        "createdAt" TEXT NOT NULL,
        "updatedAt" TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS "BranchStock" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "branchId" INTEGER NOT NULL REFERENCES "Branch"("id") ON DELETE CASCADE,
        "productId" INTEGER NOT NULL REFERENCES "Product"("id") ON DELETE CASCADE,
        "stock" REAL NOT NULL DEFAULT 0,
        "minStock" INTEGER NOT NULL DEFAULT 5,
        "criticalStock" INTEGER NOT NULL DEFAULT 2,
        "location" TEXT,
        "expiryDate" TEXT
      );
      CREATE TABLE IF NOT EXISTS "Invoice" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "saleId" INTEGER NOT NULL REFERENCES "Sale"("id"),
        "accountId" INTEGER NOT NULL REFERENCES "Account"("id"),
        "cufe" TEXT NOT NULL UNIQUE,
        "dianStatus" TEXT NOT NULL DEFAULT 'PENDING',
        "dianResponse" TEXT,
        "pdfUrl" TEXT,
        "xmlUrl" TEXT,
        "sentAt" TEXT,
        "validatedAt" TEXT
      );
    `);
  }

  private renameColumns(sqlite: Database.Database): void {
    this.renameColumnIfNeeded(sqlite, 'Sale', 'receiptNumber', 'saleNumber');
    this.renameColumnIfNeeded(sqlite, 'Sale', 'taxAmount', 'tax');
    if (tableExists(sqlite, 'cash_expense') && !tableExists(sqlite, 'CashExpense')) {
      sqlite.exec('ALTER TABLE "cash_expense" RENAME TO "CashExpense"');
    }
  }

  private renameColumnIfNeeded(sqlite: Database.Database, table: string, from: string, to: string): void {
    if (hasColumn(sqlite, table, from) && !hasColumn(sqlite, table, to)) {
      sqlite.exec(`ALTER TABLE "${table}" RENAME COLUMN "${from}" TO "${to}"`);
    }
  }

  /**
   * Estructura que V3 espera. Se arma una base vacía de V3 en memoria y se copia lo que le falta a la
   * base migrada: así, cualquier versión de V2 (con o sin egresos de caja, por ejemplo) queda completa.
   */
  private withFreshSchema<T>(fn: (fresh: Database.Database) => T): T {
    const fresh = new Database(':memory:');
    try {
      migrate(drizzle(fresh), { migrationsFolder: getMigrationsFolder() });
      return fn(fresh);
    } finally {
      fresh.close();
    }
  }

  /** Crea las tablas de V3 que la base de V2 no tiene (por ejemplo CashExpense o DailyAuditLog) y sus índices. */
  private createMissingTables(sqlite: Database.Database): void {
    this.withFreshSchema((fresh) => {
      const objects = fresh
        .prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%drizzle%'")
        .all() as Array<{ type: string; name: string; tbl_name: string; sql: string }>;
      const missing = new Set(objects.filter((o) => o.type === 'table' && !tableExists(sqlite, o.name)).map((o) => o.name));
      for (const object of objects) {
        if (object.type === 'table' && missing.has(object.name)) sqlite.exec(object.sql);
      }
      for (const object of objects) {
        if (object.type === 'index' && missing.has(object.tbl_name)) {
          sqlite.exec(object.sql.replace(/^CREATE (UNIQUE )?INDEX/i, 'CREATE $1INDEX IF NOT EXISTS'));
        }
      }
    });
  }

  private addColumns(sqlite: Database.Database): void {
    const definitions: Array<[string, string[]]> = [
      ['User', ['"accountId" INTEGER REFERENCES "Account"("id") ON DELETE CASCADE', '"branchId" INTEGER REFERENCES "Branch"("id") ON DELETE SET NULL']],
      ['Category', ['"accountId" INTEGER REFERENCES "Account"("id") ON DELETE CASCADE']],
      ['Product', ['"accountId" INTEGER REFERENCES "Account"("id") ON DELETE CASCADE']],
      ['StockMovement', ['"accountId" INTEGER REFERENCES "Account"("id") ON DELETE CASCADE', '"branchId" INTEGER REFERENCES "Branch"("id") ON DELETE SET NULL']],
      ['Customer', ['"accountId" INTEGER REFERENCES "Account"("id") ON DELETE CASCADE']],
      ['CashSession', ['"accountId" INTEGER REFERENCES "Account"("id") ON DELETE CASCADE', '"branchId" INTEGER REFERENCES "Branch"("id") ON DELETE SET NULL', '"lastActivityAt" TEXT']],
      ['CashExpense', ['"accountId" INTEGER REFERENCES "Account"("id") ON DELETE CASCADE']],
      ['Supplier', ['"accountId" INTEGER REFERENCES "Account"("id") ON DELETE CASCADE']],
      ['PurchaseOrder', ['"accountId" INTEGER REFERENCES "Account"("id") ON DELETE CASCADE', '"branchId" INTEGER REFERENCES "Branch"("id") ON DELETE SET NULL']],
      ['Sale', ['"accountId" INTEGER REFERENCES "Account"("id") ON DELETE CASCADE', '"branchId" INTEGER REFERENCES "Branch"("id") ON DELETE SET NULL', '"cufe" TEXT', '"dianStatus" TEXT DEFAULT \'PENDING\'']],
      ['Debt', ['"accountId" INTEGER REFERENCES "Account"("id") ON DELETE CASCADE', '"branchId" INTEGER REFERENCES "Branch"("id") ON DELETE SET NULL']],
      ['AuditLog', ['"accountId" INTEGER REFERENCES "Account"("id") ON DELETE CASCADE']],
      ['Config', ['"accountId" INTEGER REFERENCES "Account"("id") ON DELETE CASCADE']],
    ];

    for (const [table, columns] of definitions) {
      if (!tableExists(sqlite, table)) continue;
      for (const definition of columns) {
        const columnName = definition.split(' ')[0].replace(/"/g, '');
        if (!hasColumn(sqlite, table, columnName)) {
          sqlite.exec(`ALTER TABLE "${table}" ADD COLUMN ${definition}`);
        }
      }
    }
  }

  /** Cualquier otra columna que V3 espere y la base de V2 no tenga (versiones de V2 más antiguas). */
  private addMissingColumns(sqlite: Database.Database): void {
    type Column = { name: string; type: string; notnull: number; dflt_value: string | null; pk: number };
    this.withFreshSchema((fresh) => {
      const freshTables = (fresh.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%drizzle%'").all() as Array<{ name: string }>).map((t) => t.name);
      for (const table of freshTables) {
        if (!tableExists(sqlite, table)) continue;
        for (const column of fresh.pragma(`table_info("${table}")`) as Column[]) {
          if (column.pk || hasColumn(sqlite, table, column.name)) continue;
          const numeric = /INT|REAL|NUM|BOOL|DEC/i.test(column.type);
          let definition = `"${column.name}" ${column.type || 'TEXT'}`;
          if (column.dflt_value !== null) definition += ` NOT NULL DEFAULT ${column.dflt_value}`;
          else if (column.notnull) definition += numeric ? ' NOT NULL DEFAULT 0' : " NOT NULL DEFAULT ''";
          sqlite.exec(`ALTER TABLE "${table}" ADD COLUMN ${definition}`);
        }
      }
    });
  }

  /**
   * V2 (Prisma) guarda las fechas como números (milisegundos); V3 las guarda y las compara como texto
   * (AAAA-MM-DDTHH:MM:SS.mmmZ). Sin esto, los informes, el Inicio y los cierres no verían lo anterior.
   */
  private convertDates(sqlite: Database.Database): void {
    const tables = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>).map((t) => t.name);
    for (const table of tables) {
      for (const column of this.dateColumns(sqlite, table)) {
        sqlite.exec(
          `UPDATE "${table}" SET "${column}" = strftime('%Y-%m-%dT%H:%M:%fZ', "${column}" / 1000.0, 'unixepoch') WHERE typeof("${column}") IN ('integer', 'real');`,
        );
      }
    }
  }

  /**
   * Un conteo de caja mal tecleado en V2 (por ejemplo 1,331 × 10⁵⁵ en vez de 133.100) rompería las sumas de
   * V3. Esos valores no se inventan ni se borran en silencio: el cierre queda «sin conteo» (se puede conciliar
   * contando el efectivo) y el valor original se guarda en la auditoría.
   */
  private fixImpossibleAmounts(sqlite: Database.Database, now: string): MigrationCorrection[] {
    if (!tableExists(sqlite, 'CashSession') || !tableExists(sqlite, 'AuditLog')) return [];
    const columns = ['finalCash', 'expectedCash', 'difference'] as const;
    const rows = sqlite
      .prepare(
        'SELECT "id", "userId", "finalCash", "expectedCash", "difference" FROM "CashSession" ' +
          'WHERE ABS(COALESCE("finalCash", 0)) > ? OR ABS(COALESCE("expectedCash", 0)) > ? OR ABS(COALESCE("difference", 0)) > ?',
      )
      .all(MAX_MONEY, MAX_MONEY, MAX_MONEY) as Array<Record<string, number> & { id: number; userId: number }>;

    const corrections: MigrationCorrection[] = [];
    const audit = sqlite.prepare(
      'INSERT INTO "AuditLog" ("userId", "action", "entity", "entityId", "payload", "createdAt") VALUES (?, ?, ?, ?, ?, ?)',
    );
    for (const row of rows) {
      for (const column of columns) {
        const value = row[column];
        if (value === null || value === undefined || Math.abs(value) <= MAX_MONEY) continue;
        sqlite.prepare(`UPDATE "CashSession" SET "${column}" = NULL WHERE "id" = ?`).run(row.id);
        const correction = { table: 'CashSession', id: row.id, column, original: String(value) };
        corrections.push(correction);
        audit.run(
          row.userId,
          'migration:value-cleared',
          'CashSession',
          row.id,
          JSON.stringify({ column, original: correction.original, reason: 'Monto imposible (probable error al digitar) en la migración desde V2' }),
          now,
        );
      }
    }
    return corrections;
  }

  private seedDefaultData(sqlite: Database.Database, now: string): number {
    const existingAccount = sqlite.prepare('SELECT id FROM "Account" LIMIT 1').get() as { id: number } | undefined;
    let accountId: number;
    if (existingAccount) {
      accountId = existingAccount.id;
    } else {
      // Si V2 tenía los datos del negocio en Config, la cuenta nace con ellos.
      const config = (key: string): string | undefined => {
        if (!tableExists(sqlite, 'Config')) return undefined;
        const row = sqlite.prepare('SELECT "value" FROM "Config" WHERE "key" = ?').get(key) as { value: string } | undefined;
        return row?.value?.trim() || undefined;
      };
      const result = sqlite
        .prepare(
          'INSERT INTO "Account" ("name", "nit", "email", "phone", "address", "subscriptionStatus", "subscriptionPlan", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(
          config('businessName') ?? DEFAULT_ACCOUNT_NAME,
          config('nit') ?? DEFAULT_ACCOUNT_NIT,
          config('email') ?? DEFAULT_ACCOUNT_EMAIL,
          config('phone') ?? DEFAULT_ACCOUNT_PHONE,
          config('address') ?? null,
          'TRIAL',
          'BASIC',
          now,
          now,
        );
      accountId = Number(result.lastInsertRowid);
    }

    const existingBranch = sqlite
      .prepare('SELECT id FROM "Branch" WHERE "code" = ? LIMIT 1')
      .get(DEFAULT_BRANCH_CODE) as { id: number } | undefined;
    if (!existingBranch) {
      sqlite
        .prepare('INSERT INTO "Branch" ("accountId", "name", "code", "isActive", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?)')
        .run(accountId, DEFAULT_BRANCH_NAME, DEFAULT_BRANCH_CODE, 1, now, now);
    }

    return accountId;
  }

  private backfillAccountId(sqlite: Database.Database, accountId: number): void {
    const direct = ['User', 'Product', 'Category', 'Customer', 'Sale', 'Debt', 'Supplier', 'PurchaseOrder', 'StockMovement'];
    for (const table of direct) {
      if (!tableExists(sqlite, table)) continue;
      sqlite.prepare(`UPDATE "${table}" SET "accountId" = ? WHERE "accountId" IS NULL`).run(accountId);
    }

    const userAccount = sqlite.prepare('SELECT "accountId" FROM "User" WHERE "id" = ?');

    if (tableExists(sqlite, 'CashSession')) {
      const sessions = sqlite
        .prepare('SELECT "id", "userId" FROM "CashSession" WHERE "accountId" IS NULL')
        .all() as Array<{ id: number; userId: number }>;
      const updateSession = sqlite.prepare('UPDATE "CashSession" SET "accountId" = ? WHERE "id" = ?');
      for (const session of sessions) {
        const user = userAccount.get(session.userId) as { accountId: number | null } | undefined;
        updateSession.run(user?.accountId ?? accountId, session.id);
      }
    }

    if (tableExists(sqlite, 'CashExpense') && tableExists(sqlite, 'CashSession')) {
      const expenses = sqlite
        .prepare('SELECT "id", "cashSessionId" FROM "CashExpense" WHERE "accountId" IS NULL')
        .all() as Array<{ id: number; cashSessionId: number }>;
      const sessionAccount = sqlite.prepare('SELECT "accountId" FROM "CashSession" WHERE "id" = ?');
      const updateExpense = sqlite.prepare('UPDATE "CashExpense" SET "accountId" = ? WHERE "id" = ?');
      for (const expense of expenses) {
        const session = sessionAccount.get(expense.cashSessionId) as { accountId: number | null } | undefined;
        updateExpense.run(session?.accountId ?? accountId, expense.id);
      }
    }

    if (tableExists(sqlite, 'AuditLog')) {
      const auditLogs = sqlite
        .prepare('SELECT "id", "userId" FROM "AuditLog" WHERE "accountId" IS NULL')
        .all() as Array<{ id: number; userId: number }>;
      const updateAudit = sqlite.prepare('UPDATE "AuditLog" SET "accountId" = ? WHERE "id" = ?');
      for (const log of auditLogs) {
        const user = userAccount.get(log.userId) as { accountId: number | null } | undefined;
        updateAudit.run(user?.accountId ?? accountId, log.id);
      }
    }

    if (tableExists(sqlite, 'Config')) {
      const globalConfigs = sqlite
        .prepare('SELECT "id", "key", "value" FROM "Config" WHERE "accountId" IS NULL')
        .all() as Array<{ id: number; key: string; value: string }>;
      const existingConfig = sqlite.prepare('SELECT "id" FROM "Config" WHERE "accountId" = ? AND "key" = ?');
      const updateConfig = sqlite.prepare('UPDATE "Config" SET "accountId" = ? WHERE "id" = ?');
      const deleteConfig = sqlite.prepare('DELETE FROM "Config" WHERE "id" = ?');
      for (const row of globalConfigs) {
        if (existingConfig.get(accountId, row.key)) {
          deleteConfig.run(row.id);
        } else {
          updateConfig.run(accountId, row.id);
        }
      }
    }
  }

  private createIndexes(sqlite: Database.Database): void {
    const indexes: Array<{ name: string; table: string; columns: string }> = [
      { name: 'idx_user_account_username', table: 'User', columns: '"accountId", "username"' },
      { name: 'idx_category_account_name', table: 'Category', columns: '"accountId", "name"' },
      { name: 'idx_product_account_code', table: 'Product', columns: '"accountId", "code"' },
      { name: 'idx_product_account_barcode', table: 'Product', columns: '"accountId", "barcode"' },
      { name: 'idx_customer_account_document', table: 'Customer', columns: '"accountId", "document"' },
      { name: 'idx_config_account_key', table: 'Config', columns: '"accountId", "key"' },
    ];
    for (const index of indexes) {
      if (!tableExists(sqlite, index.table)) continue;
      sqlite.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "${index.name}" ON "${index.table}" (${index.columns})`);
    }
  }

  private countRows(sqlite: Database.Database): Record<string, number> {
    const tables = [
      'User', 'Session', 'Category', 'Product', 'StockMovement', 'Customer',
      'CashSession', 'CashExpense', 'Supplier', 'PurchaseOrder', 'PurchaseOrderItem',
      'Sale', 'SaleItem', 'Debt', 'Payment', 'AuditLog', 'Config',
      'Account', 'Branch', 'Subscription', 'Invoice', 'BranchStock',
    ];
    const rows: Record<string, number> = {};
    for (const table of tables) {
      if (tableExists(sqlite, table)) {
        rows[table] = countRows(sqlite, table);
      }
    }
    return rows;
  }
}
