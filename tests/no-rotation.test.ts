import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dir = join(tmpdir(), `tucajero-norotation-${Date.now()}`);
process.env.DATABASE_URL = join(dir, 'test.db');
process.env.TUCAJERO_BACKUP_DIR = join(dir, 'backups');

const { InventoryService } = await import('../app/main/services/inventory.service');
const { CashSessionService } = await import('../app/main/services/cash-session.service');
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
const DAY = 24 * 3600 * 1000;
const daysAgo = (n: number): string => new Date(Date.now() - n * DAY).toISOString();

serviceDescribe('productos sin rotación', () => {
  const inventory = new InventoryService();
  const sales = new SalesService();
  let sqlite: Database.Database;

  const idOf = (code: string): number => (sqlite.prepare('select id from "Product" where code = ?').get(code) as { id: number }).id;
  const sell = async (session: number, code: string, accountId = 1): Promise<number> => {
    const sale = await sales.createSale(session, 1, [{ productId: idOf(code), quantity: 1, unitPrice: 1000, discount: 0 }], [{ method: 'efectivo', amount: 1000 }], accountId);
    return sale.id;
  };
  const dateSale = (saleId: number, when: string): void => {
    sqlite.prepare('update "Sale" set createdAt = ? where id = ?').run(when, saleId);
  };

  beforeAll(async () => {
    mkdirSync(dir, { recursive: true });
    const setup = new Database(process.env.DATABASE_URL as string);
    setup.pragma('foreign_keys = ON');
    migrate(drizzle(setup), { migrationsFolder: resolve('database/migrations') });
    const product = (code: string, stock: number, active = 1, created = NOW): string =>
      `INSERT INTO "Product" (accountId, code, name, categoryId, price, cost, stock, taxRate, isActive, createdAt, updatedAt) VALUES (1, '${code}', 'Producto ${code}', 1, 1000, 600, ${stock}, 0, ${active}, '${created}', '${created}');`;
    setup.exec(`
      INSERT INTO "Account" (name, nit, email, createdAt, updatedAt) VALUES ('A', '1', 'a@a.com', '${NOW}', '${NOW}');
      INSERT INTO "User" (accountId, username, password, fullName, role, active, createdAt, updatedAt) VALUES (1, 'admin', 'h', 'Admin', 'ADMIN', 1, '${NOW}', '${NOW}');
      INSERT INTO "Category" (name, color, accountId, createdAt, updatedAt) VALUES ('Cat', '#fff', 1, '${NOW}', '${NOW}');
      ${product('RECIENTE', 100)}
      ${product('VIEJO', 100)}
      ${product('NUNCA', 100, 1, daysAgo(200))}
      ${product('SINSTOCK', 0, 1, daysAgo(200))}
      ${product('INACTIVO', 100, 0, daysAgo(200))}
      ${product('SOLOANULADA', 100, 1, daysAgo(200))}
      ${product('VARIAS', 100)}
    `);
    setup.close();
    sqlite = new Database(process.env.DATABASE_URL as string);

    const session = (await new CashSessionService().openCashSession(1, 1, 0)).id;
    dateSale(await sell(session, 'RECIENTE'), daysAgo(10));
    dateSale(await sell(session, 'VIEJO'), daysAgo(120));
    const cancelled = await sell(session, 'SOLOANULADA');
    await sales.cancelSale(cancelled, 1, 1);
    dateSale(cancelled, daysAgo(5));
    // VARIAS: una venta vieja y otra reciente → cuenta como reciente
    dateSale(await sell(session, 'VARIAS'), daysAgo(150));
    dateSale(await sell(session, 'VARIAS'), daysAgo(3));
  });

  afterAll(() => {
    sqlite.close();
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it('lista los productos con stock que no se venden hace más de N días', async () => {
    const result = await inventory.getNoRotationProducts(90, 1);
    expect(result.map((p) => p.code).sort()).toEqual(['NUNCA', 'SOLOANULADA', 'VIEJO']);
  });

  it('no incluye productos con venta reciente, sin stock ni inactivos', async () => {
    const codes = (await inventory.getNoRotationProducts(90, 1)).map((p) => p.code);
    for (const excluded of ['RECIENTE', 'VARIAS', 'SINSTOCK', 'INACTIVO']) expect(codes).not.toContain(excluded);
  });

  it('la fecha de última venta es la más reciente de las ventas completadas (una anulada no cuenta)', async () => {
    const byCode = Object.fromEntries((await inventory.getNoRotationProducts(90, 1)).map((p) => [p.code, p]));
    expect(byCode.VIEJO.lastSaleDate?.slice(0, 10)).toBe(daysAgo(120).slice(0, 10));
    expect(byCode.VIEJO.daysWithoutSale).toBe(120);
    expect(byCode.NUNCA.lastSaleDate).toBeNull();
    expect(byCode.NUNCA.daysWithoutSale).toBe(200); // desde que se creó el producto
    expect(byCode.SOLOANULADA.lastSaleDate).toBeNull();
  });

  it('con un plazo más corto aparecen también los que se vendieron un poco antes', async () => {
    const codes = (await inventory.getNoRotationProducts(7, 1)).map((p) => p.code);
    expect(codes).toContain('RECIENTE');
    expect(codes).not.toContain('VARIAS');
  });

  it('no mezcla cuentas', async () => {
    expect(await inventory.getNoRotationProducts(90, 999)).toEqual([]);
  });

  it('con miles de productos responde en tiempo razonable (no una consulta por producto)', async () => {
    const insert = sqlite.prepare(
      `INSERT INTO "Product" (accountId, code, name, categoryId, price, cost, stock, taxRate, isActive, createdAt, updatedAt) VALUES (1, ?, ?, 1, 1000, 600, 5, 0, 1, '${NOW}', '${NOW}')`,
    );
    sqlite.transaction(() => {
      for (let i = 0; i < 6000; i++) insert.run(`BULK${i}`, `Masivo ${i}`);
    })();
    const started = performance.now();
    const result = await inventory.getNoRotationProducts(90, 1);
    const elapsed = performance.now() - started;
    expect(result.length).toBeGreaterThanOrEqual(6000);
    expect(elapsed).toBeLessThan(1500);
  });
});
