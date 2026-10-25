import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { computeCartTotals, quickCashAmounts } from '../app/renderer/src/shared/utils/cart-totals';

const dir = join(tmpdir(), `tucajero-cart-totals-${Date.now()}`);
process.env.DATABASE_URL = join(dir, 'test.db');

const { CashSessionService } = await import('../app/main/services/cash-session.service');
const { SalesService } = await import('../app/main/services/sales.service');
const { getDatabase, closeDatabase } = await import('../app/main/db');
void getDatabase;

let nativeDbAvailable = true;
try {
  new Database(':memory:').close();
} catch {
  nativeDbAvailable = false;
}
const serviceDescribe = nativeDbAvailable ? describe : describe.skip;

const NOW = '2026-01-01T00:00:00.000Z';

describe('montos de billete para el cobro', () => {
  it('ofrece el valor exacto y los billetes que alcanzan, de menor a mayor', () => {
    expect(quickCashAmounts(8500)).toEqual([8500, 10000, 20000, 50000, 100000]);
    expect(quickCashAmounts(21000)).toEqual([21000, 25000, 30000, 40000, 50000]);
    expect(quickCashAmounts(10000)).toEqual([10000, 20000, 50000, 100000]);
    expect(quickCashAmounts(100000)).toEqual([100000]);
  });

  it('no ofrece nada si no hay nada que cobrar', () => {
    expect(quickCashAmounts(0)).toEqual([]);
    expect(quickCashAmounts(-5)).toEqual([]);
  });
});

serviceDescribe('el total que ve el cajero es el que guarda el servidor', () => {
  const sales = new SalesService();
  const cashSessions = new CashSessionService();
  let session = 0;

  // Generador determinista (mulberry32) para que la prueba sea reproducible.
  const rng = (() => {
    let a = 123456789;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();

  beforeAll(async () => {
    mkdirSync(dir, { recursive: true });
    const sqlite = new Database(process.env.DATABASE_URL as string);
    sqlite.pragma('foreign_keys = ON');
    migrate(drizzle(sqlite), { migrationsFolder: resolve('database/migrations') });
    sqlite.exec(`
      INSERT INTO "Account" (name, nit, email, createdAt, updatedAt) VALUES ('A', '1', 'a@a.com', '${NOW}', '${NOW}');
      INSERT INTO "User" (accountId, username, password, fullName, role, active, createdAt, updatedAt) VALUES (1, 'admin', 'h', 'Admin', 'ADMIN', 1, '${NOW}', '${NOW}');
      INSERT INTO "Category" (name, color, accountId, createdAt, updatedAt) VALUES ('Cat', '#fff', 1, '${NOW}', '${NOW}');
      INSERT INTO "Config" (accountId, key, value, updatedAt) VALUES (1, 'ivaEnabled', 'true', '${NOW}');
      INSERT INTO "Product" (accountId, code, name, categoryId, price, cost, stock, taxRate, isActive, createdAt, updatedAt) VALUES (1, 'IVA19', 'Con IVA', 1, 2850, 1000, 100000, 0.19, 1, '${NOW}', '${NOW}');
      INSERT INTO "Product" (accountId, code, name, categoryId, price, cost, stock, taxRate, isActive, createdAt, updatedAt) VALUES (1, 'IVA5', 'IVA 5', 1, 1990, 1000, 100000, 0.05, 1, '${NOW}', '${NOW}');
      INSERT INTO "Product" (accountId, code, name, categoryId, price, cost, stock, taxRate, isActive, createdAt, updatedAt) VALUES (1, 'EXE', 'Sin IVA', 1, 3333, 1000, 100000, 0, 1, '${NOW}', '${NOW}');
    `);
    sqlite.close();
    session = (await cashSessions.openCashSession(1, 1, 0)).id;
  });

  afterAll(() => {
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it('coincide en 60 carritos al azar con IVA, descuentos por línea, globales y domicilio', async () => {
    const catalog = [
      { id: 1, price: 2850, taxRate: 0.19 },
      { id: 2, price: 1990, taxRate: 0.05 },
      { id: 3, price: 3333, taxRate: 0 },
    ];
    for (let n = 0; n < 60; n++) {
      const lines = Array.from({ length: 1 + Math.floor(rng() * 4) }, () => {
        const p = catalog[Math.floor(rng() * catalog.length)];
        const quantity = rng() < 0.3 ? 0.5 + Math.floor(rng() * 6) * 0.5 : 1 + Math.floor(rng() * 7);
        const gross = Math.round(quantity * p.price);
        const discount = rng() < 0.3 ? Math.floor(rng() * gross * 0.5) : 0;
        return { productId: p.id, quantity, unitPrice: p.price, discount, taxRate: p.taxRate };
      });
      // Una misma línea de producto repetida no se agrupa: el servidor las suma por separado.
      const discountType = rng() < 0.5 ? 'percentage' : 'fixed';
      const discount = rng() < 0.5 ? 0 : discountType === 'percentage' ? Math.floor(rng() * 30) + 0.5 : Math.floor(rng() * 800);
      const deliveryFee = rng() < 0.3 ? Math.floor(rng() * 5) * 1000 : 0;

      const expected = computeCartTotals({ lines, ivaEnabled: true, deliveryFee, discount, discountType });
      const sale = await sales.createSale(
        session, 1,
        lines.map(({ productId, quantity, unitPrice, discount: lineDiscount }) => ({ productId, quantity, unitPrice, discount: lineDiscount })),
        [{ method: 'efectivo', amount: expected.total + 1000 }],
        1, discount, deliveryFee, undefined, false, undefined, discountType,
      );

      expect(sale.total, `carrito ${n}`).toBe(expected.total);
      expect(sale.tax, `IVA del carrito ${n}`).toBe(expected.tax);
      expect(sale.subtotal, `subtotal del carrito ${n}`).toBe(expected.subtotal);
    }
  });
});
