import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, mkdirSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

const dir = join(tmpdir(), `tucajero-sales-${Date.now()}`);
const dbPath = join(dir, 'test.db');

process.env.DATABASE_URL = dbPath;

const { SalesService } = await import('../app/main/services/sales.service');
const { InventoryService } = await import('../app/main/services/inventory.service');
const { closeDatabase, ensureTaxRateFraction } = await import('../app/main/db');

const salesService = new SalesService();
const inventoryService = new InventoryService();

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

function createDatabase(): void {
  mkdirSync(dir, { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma('foreign_keys = ON');
  const migration = readFileSync(resolve('database/migrations/0000_melodic_barracuda.sql'), 'utf8')
    .split('\n')
    .filter((line) => !line.includes('--> statement-breakpoint'))
    .join('\n');
  sqlite.exec(migration);
  sqlite.exec(`
    INSERT INTO "Account" (name, nit, email, createdAt, updatedAt)
      VALUES ('Cuenta Test', '900000001', 'test@test.com', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    INSERT INTO "User" (username, password, fullName, role, active, accountId, createdAt, updatedAt)
      VALUES ('admin', 'hash', 'Admin', 'ADMIN', 1, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    INSERT INTO "Category" (name, color, accountId, createdAt, updatedAt)
      VALUES ('Bebidas', '#ff0000', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    INSERT INTO "Customer" (accountId, name, phone, createdAt, updatedAt)
      VALUES (1, 'Cliente Test', '3000000000', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    INSERT INTO "CashSession" (accountId, userId, initialCash, expectedCash, openedAt, status)
      VALUES (1, 1, 0, 0, '2026-01-01T00:00:00.000Z', 'OPEN');
    INSERT INTO "CashSession" (accountId, userId, initialCash, expectedCash, openedAt, status)
      VALUES (1, 1, 0, 0, '2026-01-01T00:00:00.000Z', 'OPEN');
    INSERT INTO "CashSession" (accountId, userId, initialCash, expectedCash, openedAt, status)
      VALUES (1, 1, 0, 0, '2026-01-01T00:00:00.000Z', 'OPEN');
    INSERT INTO "Config" (accountId, key, value, updatedAt)
      VALUES (1, 'ivaEnabled', 'true', '2026-01-01T00:00:00.000Z');
  `);
  sqlite.close();
}

serviceDescribe('SalesService.createSale', () => {
  beforeAll(() => {
    createDatabase();
  });

  afterAll(() => {
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it('calcula el IVA usando taxRate como fracción almacenada', async () => {
    const product = await inventoryService.createProduct(
      { code: 'P001', name: 'Coca', categoryId: 1, price: 1000, cost: 500, stock: 10, taxRate: 0.19, userId: 1 },
      1,
    );

    const sale = await salesService.createSale(
      1,
      1,
      [{ productId: product.id, quantity: 2, unitPrice: 1000, discount: 0 }],
      [{ method: 'efectivo', amount: 2380 }],
      1,
    );

    expect(sale.subtotal).toBe(2000);
    expect(sale.tax).toBeCloseTo(380);
    expect(sale.total).toBe(2380);
  });

  it('venta a crédito con abono parcial crea deuda por el saldo restante', async () => {
    const product = await inventoryService.createProduct(
      { code: 'P002', name: 'Papas', categoryId: 1, price: 1000, cost: 500, stock: 10, taxRate: 0, userId: 1 },
      1,
    );

    const sale = await salesService.createSale(
      3,
      1,
      [{ productId: product.id, quantity: 2, unitPrice: 1000, discount: 0 }],
      [{ method: 'efectivo', amount: 1000 }],
      1,
      0,
      0,
      1,
      true,
    );

    expect(sale.total).toBe(2000);
    expect(sale.change).toBe(0);
    const paid = (sale.payments ?? []).reduce((sum, p) => sum + p.amount, 0);
    expect(paid).toBe(2000);

    const sqlite = new Database(dbPath, { readonly: true });
    try {
      const debt = sqlite
        .prepare('SELECT "amount", "balance", "status" FROM "Debt" WHERE "saleId" = ?')
        .get(sale.id) as { amount: number; balance: number; status: string };
      expect(debt.amount).toBe(1000);
      expect(debt.balance).toBe(1000);
      expect(debt.status).toBe('PENDING');

      const session = sqlite
        .prepare('SELECT "expectedCash" FROM "CashSession" WHERE "id" = 3')
        .get() as { expectedCash: number };
      expect(session.expectedCash).toBe(1000);
    } finally {
      sqlite.close();
    }
  });

  it('venta 100% a crédito (sin abonos) crea deuda por el total', async () => {
    const product = await inventoryService.createProduct(
      { code: 'P003', name: 'Gaseosa', categoryId: 1, price: 1500, cost: 1000, stock: 10, taxRate: 0, userId: 1 },
      1,
    );

    const sale = await salesService.createSale(
      2,
      1,
      [{ productId: product.id, quantity: 1, unitPrice: 1500, discount: 0 }],
      [],
      1,
      0,
      0,
      1,
      true,
    );

    expect(sale.total).toBe(1500);

    const sqlite = new Database(dbPath, { readonly: true });
    try {
      const debt = sqlite
        .prepare('SELECT "amount", "balance" FROM "Debt" WHERE "saleId" = ?')
        .get(sale.id) as { amount: number; balance: number };
      expect(debt.amount).toBe(1500);
      expect(debt.balance).toBe(1500);

      const session = sqlite
        .prepare('SELECT "expectedCash" FROM "CashSession" WHERE "id" = 2')
        .get() as { expectedCash: number };
      expect(session.expectedCash).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('rechaza la venta con stock insuficiente sin decrementar', async () => {
    const product = await inventoryService.createProduct(
      { code: 'P004', name: 'Stock bajo', categoryId: 1, price: 1000, cost: 500, stock: 1, taxRate: 0, userId: 1 },
      1,
    );

    await expect(
      salesService.createSale(
        1,
        1,
        [{ productId: product.id, quantity: 5, unitPrice: 1000, discount: 0 }],
        [{ method: 'efectivo', amount: 5000 }],
        1,
      ),
    ).rejects.toThrow('Stock insuficiente');

    const after = await inventoryService.getProductById(product.id, 1);
    expect(after.stock).toBe(1);
  });

  it('permite vender y listar un producto sin categoría (leftJoin)', async () => {
    const sqlite = new Database(dbPath);
    const result = sqlite
      .prepare(
        `INSERT INTO "Product" (accountId, code, name, price, cost, stock, minStock, criticalStock, taxRate, unitType, conversionFactor, isActive, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(1, 'P005', 'Huérfano', 1000, 500, 5, 1, 1, 0, 'UNIT', 1, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    sqlite.close();
    const productId = Number(result.lastInsertRowid);

    const sale = await salesService.createSale(
      1,
      1,
      [{ productId, quantity: 1, unitPrice: 1000, discount: 0 }],
      [{ method: 'efectivo', amount: 1000 }],
      1,
    );
    expect(sale.total).toBe(1000);

    const list = await inventoryService.getAllProducts({}, 1);
    expect(list.products.some((p) => p.code === 'P005')).toBe(true);

    const detail = await inventoryService.getProductById(productId, 1);
    expect(detail.category.name).toBe('');
  });
});

serviceDescribe('ensureTaxRateFraction (migración legacy)', () => {
  it('convierte taxRate de porcentaje (19) a fracción (0.19)', () => {
    mkdirSync(dir, { recursive: true });
    const migrationPath = join(dir, 'migration.db');
    const sqlite = new Database(migrationPath);
    try {
      sqlite.exec('CREATE TABLE "Product" ("taxRate" real NOT NULL DEFAULT 0);');
      sqlite.prepare('INSERT INTO "Product" ("taxRate") VALUES (19)').run();
      sqlite.prepare('INSERT INTO "Product" ("taxRate") VALUES (0.19)').run();

      ensureTaxRateFraction(sqlite);

      const rows = sqlite.prepare('SELECT "taxRate" FROM "Product" ORDER BY rowid').all() as Array<{ taxRate: number }>;
      expect(rows[0].taxRate).toBeCloseTo(0.19);
      expect(rows[1].taxRate).toBeCloseTo(0.19);
    } finally {
      sqlite.close();
    }
  });
});
