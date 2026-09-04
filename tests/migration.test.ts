import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const dir = join(tmpdir(), `tucajero-migration-${Date.now()}`);
const v2Path = join(dir, 'tucajero-v2.db');
const v3Path = join(dir, 'tucajero-v3.db');

process.env.V2_DATABASE_PATH = v2Path;
process.env.DATABASE_URL = v3Path;

const { MigrationService } = await import('../app/main/services/migration.service');
const { closeDatabase } = await import('../app/main/db');

let nativeDbAvailable = true;
try {
  const probe = new Database(':memory:');
  probe.close();
} catch {
  nativeDbAvailable = false;
}

// better-sqlite3 está compilado para el ABI de Electron; si se ejecuta vitest con
// el Node del sistema y el binario no coincide (NODE_MODULE_VERSION), se salta.
const serviceDescribe = nativeDbAvailable ? describe : describe.skip;

function createV2Database(path: string): void {
  const sqlite = new Database(path);
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(`
    CREATE TABLE "User" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "username" TEXT NOT NULL UNIQUE, "password" TEXT NOT NULL, "fullName" TEXT NOT NULL, "role" TEXT NOT NULL DEFAULT 'CASHIER', "active" INTEGER NOT NULL DEFAULT 1, "mustChangePassword" INTEGER NOT NULL DEFAULT 0, "hourlyRate" REAL, "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0, "lockedUntil" TEXT, "createdAt" TEXT NOT NULL, "updatedAt" TEXT NOT NULL);
    CREATE TABLE "Session" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "userId" INTEGER NOT NULL, "token" TEXT NOT NULL UNIQUE, "expiresAt" TEXT NOT NULL, "createdAt" TEXT NOT NULL, "closedAt" TEXT);
    CREATE TABLE "Category" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT NOT NULL UNIQUE, "color" TEXT, "createdAt" TEXT NOT NULL, "updatedAt" TEXT NOT NULL);
    CREATE TABLE "Product" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "code" TEXT NOT NULL UNIQUE, "barcode" TEXT UNIQUE, "name" TEXT NOT NULL, "description" TEXT, "categoryId" INTEGER NOT NULL, "price" REAL NOT NULL, "cost" REAL NOT NULL, "stock" REAL NOT NULL DEFAULT 0, "minStock" INTEGER NOT NULL DEFAULT 5, "criticalStock" INTEGER NOT NULL DEFAULT 2, "taxRate" REAL NOT NULL DEFAULT 0.19, "suggestedPurchaseQty" INTEGER, "expiryDate" TEXT, "location" TEXT, "unitType" TEXT NOT NULL DEFAULT 'UNIT', "conversionFactor" REAL NOT NULL DEFAULT 1, "isActive" INTEGER NOT NULL DEFAULT 1, "createdAt" TEXT NOT NULL, "updatedAt" TEXT NOT NULL);
    CREATE TABLE "StockMovement" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "productId" INTEGER NOT NULL, "type" TEXT NOT NULL, "quantity" REAL NOT NULL, "previousStock" REAL NOT NULL, "newStock" REAL NOT NULL, "reason" TEXT, "userId" INTEGER NOT NULL, "createdAt" TEXT NOT NULL);
    CREATE TABLE "Sale" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "receiptNumber" TEXT NOT NULL UNIQUE, "userId" INTEGER NOT NULL, "cashSessionId" INTEGER, "subtotal" REAL NOT NULL, "taxAmount" REAL NOT NULL, "discount" REAL NOT NULL DEFAULT 0, "deliveryFee" REAL NOT NULL DEFAULT 0, "total" REAL NOT NULL, "change" REAL NOT NULL DEFAULT 0, "status" TEXT NOT NULL DEFAULT 'COMPLETED', "customerId" INTEGER, "createdAt" TEXT NOT NULL);
    CREATE TABLE "SaleItem" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "saleId" INTEGER NOT NULL, "productId" INTEGER NOT NULL, "quantity" REAL NOT NULL, "unitPrice" REAL NOT NULL, "taxRate" REAL NOT NULL, "subtotal" REAL NOT NULL, "discount" REAL NOT NULL DEFAULT 0, "total" REAL NOT NULL DEFAULT 0, "unitType" TEXT NOT NULL);
    CREATE TABLE "Payment" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "saleId" INTEGER, "debtId" INTEGER, "cashSessionId" INTEGER, "method" TEXT NOT NULL, "amount" REAL NOT NULL, "reference" TEXT, "createdAt" TEXT NOT NULL);
    CREATE TABLE "CashSession" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "userId" INTEGER NOT NULL, "initialCash" REAL NOT NULL, "finalCash" REAL, "expectedCash" REAL, "difference" REAL, "openedAt" TEXT NOT NULL, "closedAt" TEXT, "status" TEXT NOT NULL DEFAULT 'OPEN');
    CREATE TABLE "cash_expense" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "cashSessionId" INTEGER NOT NULL, "userId" INTEGER NOT NULL, "amount" REAL NOT NULL, "reason" TEXT NOT NULL, "createdAt" TEXT NOT NULL);
    CREATE TABLE "AuditLog" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "userId" INTEGER NOT NULL, "action" TEXT NOT NULL, "entity" TEXT NOT NULL, "entityId" INTEGER, "payload" TEXT, "createdAt" TEXT NOT NULL);
    CREATE TABLE "Config" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "key" TEXT NOT NULL UNIQUE, "value" TEXT NOT NULL, "updatedAt" TEXT NOT NULL);
    CREATE TABLE "Customer" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "document" TEXT UNIQUE, "name" TEXT NOT NULL, "email" TEXT, "phone" TEXT, "address" TEXT, "isActive" INTEGER NOT NULL DEFAULT 1, "createdAt" TEXT NOT NULL, "updatedAt" TEXT NOT NULL);
    CREATE TABLE "Debt" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "customerId" INTEGER NOT NULL, "saleId" INTEGER UNIQUE, "amount" REAL NOT NULL, "balance" REAL NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING', "createdAt" TEXT NOT NULL, "updatedAt" TEXT NOT NULL);
    CREATE TABLE "Supplier" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT NOT NULL, "contactPerson" TEXT, "phone" TEXT NOT NULL, "email" TEXT, "address" TEXT, "leadTimeDays" INTEGER NOT NULL DEFAULT 7, "isActive" INTEGER NOT NULL DEFAULT 1, "notes" TEXT, "createdAt" TEXT NOT NULL, "updatedAt" TEXT NOT NULL);
    CREATE TABLE "PurchaseOrder" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "orderNumber" TEXT NOT NULL UNIQUE, "supplierId" INTEGER NOT NULL, "status" TEXT NOT NULL DEFAULT 'DRAFT', "subtotal" REAL NOT NULL DEFAULT 0, "tax" REAL NOT NULL DEFAULT 0, "freight" REAL NOT NULL DEFAULT 0, "total" REAL NOT NULL DEFAULT 0, "expectedDate" TEXT, "receivedDate" TEXT, "observations" TEXT, "notes" TEXT, "userId" INTEGER NOT NULL, "createdAt" TEXT NOT NULL, "updatedAt" TEXT NOT NULL);
    CREATE TABLE "PurchaseOrderItem" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "orderId" INTEGER NOT NULL, "productId" INTEGER NOT NULL, "quantityOrdered" REAL NOT NULL, "quantityReceived" REAL NOT NULL DEFAULT 0, "unitCost" REAL NOT NULL, "total" REAL NOT NULL, "received" INTEGER NOT NULL DEFAULT 0, "observations" TEXT);
  `);

  sqlite.prepare('INSERT INTO "User" (username, password, fullName, role, createdAt, updatedAt) VALUES (?,?,?,?,?,?)')
    .run('admin', 'hash', 'Admin', 'ADMIN', '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z');
  sqlite.prepare('INSERT INTO "Category" (name, color, createdAt, updatedAt) VALUES (?,?,?,?)')
    .run('Bebidas', '#ff0000', '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z');
  sqlite.prepare('INSERT INTO "Category" (name, color, createdAt, updatedAt) VALUES (?,?,?,?)')
    .run('Snacks', '#00ff00', '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z');
  sqlite.prepare('INSERT INTO "Product" (code, barcode, name, categoryId, price, cost, stock, taxRate, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run('P001', '7700001', 'Coca Cola', 1, 3000, 2500, 50, 0.19, '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z');
  sqlite.prepare('INSERT INTO "Product" (code, barcode, name, categoryId, price, cost, stock, taxRate, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run('P002', '7700002', 'Papas', 2, 1500, 1000, 100, 0.19, '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z');
  sqlite.prepare('INSERT INTO "StockMovement" (productId, type, quantity, previousStock, newStock, userId, createdAt) VALUES (?,?,?,?,?,?,?)')
    .run(1, 'INIT', 50, 0, 50, 1, '2024-01-01T00:00:00.000Z');
  sqlite.prepare('INSERT INTO "Customer" (document, name, phone, createdAt, updatedAt) VALUES (?,?,?,?,?)')
    .run('CC123', 'Juan Perez', '300123', '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z');
  sqlite.prepare('INSERT INTO "CashSession" (userId, initialCash, openedAt, status) VALUES (?,?,?,?)')
    .run(1, 50000, '2024-01-01T08:00:00.000Z', 'CLOSED');
  sqlite.prepare('INSERT INTO "Sale" (receiptNumber, userId, cashSessionId, subtotal, taxAmount, total, createdAt) VALUES (?,?,?,?,?,?,?)')
    .run('V-0001', 1, 1, 3000, 570, 3570, '2024-01-01T10:00:00.000Z');
  sqlite.prepare('INSERT INTO "SaleItem" (saleId, productId, quantity, unitPrice, taxRate, subtotal, total, unitType) VALUES (?,?,?,?,?,?,?,?)')
    .run(1, 1, 1, 3000, 0.19, 3000, 3570, 'UNIT');
  sqlite.prepare('INSERT INTO "Payment" (saleId, method, amount, createdAt) VALUES (?,?,?,?)')
    .run(1, 'CASH', 3570, '2024-01-01T10:00:00.000Z');
  sqlite.prepare('INSERT INTO "cash_expense" (cashSessionId, userId, amount, reason, createdAt) VALUES (?,?,?,?,?)')
    .run(1, 1, 5000, 'Arriendo', '2024-01-01T12:00:00.000Z');
  sqlite.prepare('INSERT INTO "Config" (key, value, updatedAt) VALUES (?,?,?)')
    .run('businessName', 'Mi Negocio', '2024-01-01T00:00:00.000Z');
  sqlite.prepare('INSERT INTO "Config" (key, value, updatedAt) VALUES (?,?,?)')
    .run('first_run_at', '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z');
  sqlite.prepare('INSERT INTO "Debt" (customerId, saleId, amount, balance, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?)')
    .run(1, 1, 3570, 3570, 'PENDING', '2024-01-01T10:00:00.000Z', '2024-01-01T10:00:00.000Z');
  sqlite.prepare('INSERT INTO "AuditLog" (userId, action, entity, entityId, payload, createdAt) VALUES (?,?,?,?,?,?)')
    .run(1, 'sale.create', 'Sale', 1, '{}', '2024-01-01T10:00:00.000Z');
  sqlite.prepare('INSERT INTO "Supplier" (name, phone, createdAt, updatedAt) VALUES (?,?,?,?)')
    .run('Proveedor SAS', '301000', '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z');
  sqlite.prepare('INSERT INTO "PurchaseOrder" (orderNumber, supplierId, userId, createdAt, updatedAt) VALUES (?,?,?,?,?)')
    .run('OC-001', 1, 1, '2024-01-02T00:00:00.000Z', '2024-01-02T00:00:00.000Z');
  sqlite.prepare('INSERT INTO "PurchaseOrderItem" (orderId, productId, quantityOrdered, unitCost, total) VALUES (?,?,?,?,?)')
    .run(1, 2, 10, 1000, 10000);
  sqlite.close();
}

serviceDescribe('MigrationService (V2 → V3)', () => {
  const service = new MigrationService();

  beforeAll(() => {
    mkdirSync(dir, { recursive: true });
    createV2Database(v2Path);
  });

  afterAll(() => {
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it('detecta la base de datos V2 disponible', () => {
    const detection = service.detectV2();
    expect(detection.available).toBe(true);
    expect(detection.alreadyMigrated).toBe(false);
    expect(detection.path).toBe(v2Path);
  });

  it('migra sin perder datos', async () => {
    const report = await service.migrateV2();
    expect(report.migrated).toBe(true);
    expect(report.integrity).toBe('ok');
    expect(report.accountId).toBe(1);
    expect(report.rows['User']).toBe(1);
    expect(report.rows['Product']).toBe(2);
    expect(report.rows['Sale']).toBe(1);
    expect(report.rows['CashExpense']).toBe(1);
    expect(report.rows['Config']).toBe(2);

    const db = new Database(v3Path, { readonly: true });
    try {
      const saleColumns = db.pragma('table_info("Sale")') as Array<{ name: string }>;
      const columnNames = saleColumns.map((c) => c.name);
      expect(columnNames).toContain('saleNumber');
      expect(columnNames).toContain('tax');
      expect(columnNames).not.toContain('receiptNumber');
      expect(columnNames).not.toContain('taxAmount');

      const cashExpenseTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'CashExpense'").get();
      expect(cashExpenseTable).toBeTruthy();
      const oldExpenseTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'cash_expense'").get();
      expect(oldExpenseTable).toBeFalsy();

      const sale = db.prepare('SELECT "saleNumber", "tax", "total", "accountId" FROM "Sale" WHERE "saleNumber" = ?').get('V-0001') as {
        saleNumber: string; tax: number; total: number; accountId: number;
      };
      expect(sale.total).toBe(3570);
      expect(sale.tax).toBe(570);
      expect(sale.accountId).toBe(1);

      const product = db.prepare('SELECT "code", "stock", "accountId" FROM "Product" WHERE "code" = ?').get('P001') as {
        code: string; stock: number; accountId: number;
      };
      expect(product.stock).toBe(50);
      expect(product.accountId).toBe(1);

      const session = db.prepare('SELECT "initialCash", "accountId" FROM "CashSession" WHERE "id" = 1').get() as {
        initialCash: number; accountId: number;
      };
      expect(session.initialCash).toBe(50000);
      expect(session.accountId).toBe(1);

      const expense = db.prepare('SELECT "amount", "accountId" FROM "CashExpense" WHERE "id" = 1').get() as {
        amount: number; accountId: number;
      };
      expect(expense.amount).toBe(5000);
      expect(expense.accountId).toBe(1);

      const config = db.prepare('SELECT "value", "accountId" FROM "Config" WHERE "key" = ?').get('businessName') as {
        value: string; accountId: number;
      };
      expect(config.value).toBe('Mi Negocio');
      expect(config.accountId).toBe(1);

      const firstRun = db.prepare('SELECT "value" FROM "Config" WHERE "key" = ?').get('first_run_at') as { value: string };
      expect(firstRun.value).toBe('2024-01-01T00:00:00.000Z');

      const account = db.prepare('SELECT COUNT(*) AS count FROM "Account"').get() as { count: number };
      expect(account.count).toBe(1);
      const branch = db.prepare('SELECT COUNT(*) AS count FROM "Branch"').get() as { count: number };
      expect(branch.count).toBe(1);

      const user = db.prepare('SELECT "accountId" FROM "User" WHERE "username" = ?').get('admin') as { accountId: number };
      expect(user.accountId).toBe(1);

      const uniqueIndex = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name = 'idx_user_account_username'").get();
      expect(uniqueIndex).toBeTruthy();
    } finally {
      db.close();
    }
  });

  it('detecta que los datos ya fueron migrados', () => {
    const detection = service.detectV2();
    expect(detection.available).toBe(false);
    expect(detection.alreadyMigrated).toBe(true);
  });

  it('rechaza migrar una base de datos ya migrada', async () => {
    await expect(service.migrateV2()).rejects.toThrow('ya fue migrada');
  });
});
