import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

const dir = join(tmpdir(), `tucajero-money-sales-${Date.now()}`);
const dbPath = join(dir, 'test.db');
process.env.DATABASE_URL = dbPath;

const { SalesService } = await import('../app/main/services/sales.service');
const { closeDatabase } = await import('../app/main/db');

let nativeDbAvailable = true;
try {
  new Database(':memory:').close();
} catch {
  nativeDbAvailable = false;
}
const serviceDescribe = nativeDbAvailable ? describe : describe.skip;

const NOW = '2026-01-01T00:00:00.000Z';
const salesService = new SalesService();

serviceDescribe('ventas con migraciones completas (dinero entero)', () => {
  beforeAll(() => {
    mkdirSync(dir, { recursive: true });
    const sqlite = new Database(dbPath);
    sqlite.pragma('foreign_keys = ON');
    migrate(drizzle(sqlite), { migrationsFolder: resolve('database/migrations') });
    sqlite.exec(`
      INSERT INTO "Account" (name, nit, email, createdAt, updatedAt) VALUES ('T', '1', 't@t.com', '${NOW}', '${NOW}');
      INSERT INTO "User" (username, password, fullName, role, active, accountId, createdAt, updatedAt)
        VALUES ('a', 'h', 'A', 'ADMIN', 1, 1, '${NOW}', '${NOW}');
      INSERT INTO "Category" (name, color, accountId, createdAt, updatedAt) VALUES ('C', '#fff', 1, '${NOW}', '${NOW}');
      INSERT INTO "Product" (accountId, code, name, categoryId, price, cost, stock, taxRate, createdAt, updatedAt)
        VALUES (1, 'P1', 'Prod', 1, 3333, 2000, 100, 0.19, '${NOW}', '${NOW}');
      INSERT INTO "CashSession" (accountId, userId, initialCash, expectedCash, openedAt, status)
        VALUES (1, 1, 0, 0, '${NOW}', 'OPEN');
      INSERT INTO "Config" (accountId, key, value, updatedAt) VALUES (1, 'ivaEnabled', 'true', '${NOW}');
    `);
    sqlite.close();
  });

  afterAll(() => {
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it('una venta con cantidades y descuento porcentual fraccionarios guarda solo enteros', async () => {
    const sale = await salesService.createSale(
      1,
      1,
      [{ productId: 1, quantity: 2.5, unitPrice: 3333.33, discount: 0 }],
      [{ method: 'efectivo', amount: 20000 }],
      1,
      7.5,
      0,
      undefined,
      false,
      undefined,
      'percentage',
    );

    for (const value of [sale.subtotal, sale.tax, sale.discount, sale.total, sale.change]) {
      expect(Number.isInteger(value)).toBe(true);
    }
    // 2.5 * 3333.33 = 8333.325 -> 8333; IVA 19% = 1583; descuento 7.5% de 8333 = 625
    expect(sale.subtotal).toBe(8333);
    expect(sale.tax).toBe(1583);
    expect(sale.discount).toBe(625);
    expect(sale.total).toBe(8333 + 1583 - 625);
    expect(sale.change).toBe(20000 - sale.total);
  });
});
