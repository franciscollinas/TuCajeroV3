import { existsSync, mkdirSync, unlinkSync, statSync } from 'fs';
import { join } from 'path';
import Database from 'better-sqlite3';
import { closeDatabase, getDatabase } from '../db';
import { getDatabasePath, getBackupsDir } from '../utils/paths';
import { nowISO, toFileDate } from '../utils/date';

export interface MigrationDetection {
  available: boolean;
  path: string | null;
  size: string | null;
  alreadyMigrated: boolean;
}

export interface MigrationReport {
  migrated: boolean;
  sourcePath: string;
  backupPath: string;
  accountId: number;
  rows: Record<string, number>;
  integrity: string;
}

const DEFAULT_ACCOUNT_NAME = 'Cuenta Principal';
const DEFAULT_ACCOUNT_NIT = '000000000000';
const DEFAULT_ACCOUNT_EMAIL = 'local@tucajero.local';
const DEFAULT_ACCOUNT_PHONE = '';
const DEFAULT_BRANCH_NAME = 'Sucursal Principal';
const DEFAULT_BRANCH_CODE = 'MAIN';

const BACKUP_DIR = getBackupsDir();

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

    const targetPath = getDatabasePath();
    let targetHasData = false;
    if (existsSync(targetPath)) {
      try {
        const sqlite = new Database(targetPath, { readonly: true });
        try {
          if (tableExists(sqlite, 'User')) {
            const row = sqlite.prepare('SELECT COUNT(*) AS count FROM "User"').get() as { count: number };
            targetHasData = row.count > 0;
          }
        } finally {
          sqlite.close();
        }
      } catch {
        // ignore
      }
    }

    if (targetHasData) {
      return {
        available: false,
        path: v2Path,
        size: v2Path ? formatSize(statSync(v2Path).size) : null,
        alreadyMigrated: true,
      };
    }

    if (v2Path) {
      return {
        available: true,
        path: v2Path,
        size: formatSize(statSync(v2Path).size),
        alreadyMigrated: false,
      };
    }

    return { available: false, path: null, size: null, alreadyMigrated: false };
  }

  async migrateV2(): Promise<MigrationReport> {
    const detected = this.detectV2();
    if (!detected.path) {
      throw new Error('No se encontró la base de datos de TuCajero V2.');
    }
    if (detected.alreadyMigrated) {
      throw new Error('La base de datos encontrada ya fue migrada a la versión actual.');
    }

    const sourcePath = detected.path;
    const targetPath = getDatabasePath();

    this.assertTargetEmpty(targetPath);

    closeDatabase();

    const backupFileName = `v2_migrate_${toFileDate(new Date())}.db`;
    const backupPath = join(BACKUP_DIR, backupFileName);

    try {
      mkdirSync(BACKUP_DIR, { recursive: true });
      await this.copyDatabase(sourcePath, backupPath);

      for (const suffix of ['-wal', '-shm']) {
        const sidecar = targetPath + suffix;
        if (existsSync(sidecar)) unlinkSync(sidecar);
      }
      await this.copyDatabase(sourcePath, targetPath);

      const report = this.transform(targetPath);
      report.sourcePath = sourcePath;
      report.backupPath = backupPath;
      return report;
    } finally {
      getDatabase();
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

  private assertTargetEmpty(targetPath: string): void {
    if (!existsSync(targetPath)) return;
    const sqlite = new Database(targetPath, { readonly: true });
    try {
      if (tableExists(sqlite, 'User')) {
        const row = sqlite.prepare('SELECT COUNT(*) AS count FROM "User"').get() as { count: number };
        if (row.count > 0) {
          throw new Error('La base de datos actual ya contiene datos. No se puede migrar sin perder información.');
        }
      }
    } finally {
      sqlite.close();
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
      this.addColumns(sqlite);

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

  private seedDefaultData(sqlite: Database.Database, now: string): number {
    const existingAccount = sqlite.prepare('SELECT id FROM "Account" LIMIT 1').get() as { id: number } | undefined;
    let accountId: number;
    if (existingAccount) {
      accountId = existingAccount.id;
    } else {
      const result = sqlite
        .prepare(
          'INSERT INTO "Account" ("name", "nit", "email", "phone", "subscriptionStatus", "subscriptionPlan", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(DEFAULT_ACCOUNT_NAME, DEFAULT_ACCOUNT_NIT, DEFAULT_ACCOUNT_EMAIL, DEFAULT_ACCOUNT_PHONE, 'TRIAL', 'BASIC', now, now);
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

    const sessions = sqlite
      .prepare('SELECT "id", "userId" FROM "CashSession" WHERE "accountId" IS NULL')
      .all() as Array<{ id: number; userId: number }>;
    const userAccount = sqlite.prepare('SELECT "accountId" FROM "User" WHERE "id" = ?');
    const updateSession = sqlite.prepare('UPDATE "CashSession" SET "accountId" = ? WHERE "id" = ?');
    for (const session of sessions) {
      const user = userAccount.get(session.userId) as { accountId: number | null } | undefined;
      updateSession.run(user?.accountId ?? accountId, session.id);
    }

    const expenses = sqlite
      .prepare('SELECT "id", "cashSessionId" FROM "CashExpense" WHERE "accountId" IS NULL')
      .all() as Array<{ id: number; cashSessionId: number }>;
    const sessionAccount = sqlite.prepare('SELECT "accountId" FROM "CashSession" WHERE "id" = ?');
    const updateExpense = sqlite.prepare('UPDATE "CashExpense" SET "accountId" = ? WHERE "id" = ?');
    for (const expense of expenses) {
      const session = sessionAccount.get(expense.cashSessionId) as { accountId: number | null } | undefined;
      updateExpense.run(session?.accountId ?? accountId, expense.id);
    }

    const auditLogs = sqlite
      .prepare('SELECT "id", "userId" FROM "AuditLog" WHERE "accountId" IS NULL')
      .all() as Array<{ id: number; userId: number }>;
    const updateAudit = sqlite.prepare('UPDATE "AuditLog" SET "accountId" = ? WHERE "id" = ?');
    for (const log of auditLogs) {
      const user = userAccount.get(log.userId) as { accountId: number | null } | undefined;
      updateAudit.run(user?.accountId ?? accountId, log.id);
    }

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
        const row = sqlite.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as { count: number };
        rows[table] = row.count;
      }
    }
    return rows;
  }
}
