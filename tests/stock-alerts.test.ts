import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dir = join(tmpdir(), `tucajero-alerts-${Date.now()}`);
process.env.DATABASE_URL = join(dir, 'test.db');
process.env.TUCAJERO_BACKUP_DIR = join(dir, 'backups');

const { InventoryService } = await import('../app/main/services/inventory.service');
const { closeDatabase } = await import('../app/main/db');
const { toLocalIsoDate, addDays } = await import('../app/main/utils/date');

let nativeDbAvailable = true;
try {
  new Database(':memory:').close();
} catch {
  nativeDbAvailable = false;
}
const serviceDescribe = nativeDbAvailable ? describe : describe.skip;

const NOW = '2026-01-01T00:00:00.000Z';
const inDays = (n: number): string => toLocalIsoDate(addDays(new Date(), n));

serviceDescribe('alertas de stock y vencimiento', () => {
  const inventory = new InventoryService();
  let sqlite: Database.Database;

  beforeAll(() => {
    mkdirSync(dir, { recursive: true });
    const setup = new Database(process.env.DATABASE_URL as string);
    setup.pragma('foreign_keys = ON');
    migrate(drizzle(setup), { migrationsFolder: resolve('database/migrations') });
    setup.exec(`
      INSERT INTO "Account" (name, nit, email, createdAt, updatedAt) VALUES ('A', '1', 'a@a.com', '${NOW}', '${NOW}');
      INSERT INTO "Account" (name, nit, email, createdAt, updatedAt) VALUES ('B', '2', 'b@b.com', '${NOW}', '${NOW}');
      INSERT INTO "Category" (name, color, accountId, createdAt, updatedAt) VALUES ('Cat', '#fff', 1, '${NOW}', '${NOW}');
    `);
    const product = (code: string, stock: number, min: number, critical: number, opts: { account?: number; active?: number; expiry?: string | null } = {}): string => {
      const expiry = opts.expiry === undefined || opts.expiry === null ? 'NULL' : `'${opts.expiry}'`;
      return `INSERT INTO "Product" (accountId, code, name, categoryId, price, cost, stock, minStock, criticalStock, taxRate, isActive, expiryDate, createdAt, updatedAt) VALUES (${opts.account ?? 1}, '${code}', 'Producto ${code}', 1, 1000, 600, ${stock}, ${min}, ${critical}, 0, ${opts.active ?? 1}, ${expiry}, '${NOW}', '${NOW}');`;
    };
    setup.exec(`
      ${product('CRITICO', 2, 10, 3)}
      ${product('CERO', 0, 10, 3)}
      ${product('BAJO', 8, 10, 3)}
      ${product('JUSTO-MIN', 10, 10, 3)}
      ${product('JUSTO-CRIT', 3, 10, 3)}
      ${product('BIEN', 50, 10, 3)}
      ${product('INVERTIDO', 5, 4, 8)}
      ${product('INACTIVO', 0, 10, 3, { active: 0 })}
      ${product('OTRA-CUENTA', 0, 10, 3, { account: 2 })}
      ${product('VENCIDO', 50, 10, 3, { expiry: inDays(-1) })}
      ${product('VENCE-HOY', 50, 10, 3, { expiry: inDays(0) })}
      ${product('VENCE-30', 50, 10, 3, { expiry: inDays(30) })}
      ${product('VENCE-31', 50, 10, 3, { expiry: inDays(31) })}
      ${product('VENCE-CON-HORA', 50, 10, 3, { expiry: `${inDays(5)}T00:00:00.000Z` })}
      ${product('FECHA-RARA', 50, 10, 3, { expiry: '15/11/2026' })}
      ${product('VENCIDO-INACTIVO', 50, 10, 3, { expiry: inDays(-9), active: 0 })}
      ${product('VENCIDO-OTRA', 50, 10, 3, { expiry: inDays(-9), account: 2 })}
    `);
    setup.close();
    sqlite = new Database(process.env.DATABASE_URL as string);
  });

  afterAll(() => {
    sqlite.close();
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('stock', () => {
    it('separa críticos y bajos, con los límites incluidos', async () => {
      const { critical, warning } = await inventory.getStockAlerts(undefined, 1);
      expect(critical.map((p) => p.code).sort()).toEqual(['CERO', 'CRITICO', 'INVERTIDO', 'JUSTO-CRIT']);
      expect(warning.map((p) => p.code).sort()).toEqual(['BAJO', 'JUSTO-MIN']);
    });

    it('cuenta los productos que están bien sin enviarlos, y no cuenta inactivos ni de otra cuenta', async () => {
      const alerts = await inventory.getStockAlerts(undefined, 1);
      const sent = alerts.critical.length + alerts.warning.length;
      // 13 activos de la cuenta 1 (todos los de arriba menos INACTIVO, OTRA-CUENTA y los dos VENCIDO-*)
      expect(sent + alerts.okCount).toBe(13);
      expect(alerts.okCount).toBe(7);
      expect(Object.keys(alerts).sort()).toEqual(['critical', 'okCount', 'warning']);
    });

    it('una cuenta sin productos devuelve todo vacío', async () => {
      expect(await inventory.getStockAlerts(undefined, 999)).toEqual({ critical: [], warning: [], okCount: 0 });
    });

    it('cada producto de alerta lleva su categoría y datos completos', async () => {
      const [first] = (await inventory.getStockAlerts(undefined, 1)).critical;
      expect(first).toMatchObject({ category: { name: 'Cat' }, price: 1000, isActive: true });
    });
  });

  describe('vencimientos', () => {
    it('vencido es antes de hoy; vence hoy todavía cuenta como por vencer (igual que la venta)', async () => {
      const { expired, expiringSoon } = await inventory.getExpiryAlerts(undefined, 1);
      expect(expired.map((p) => p.code)).toEqual(['VENCIDO']);
      expect(expiringSoon.map((p) => p.code).sort()).toEqual(['VENCE-30', 'VENCE-CON-HORA', 'VENCE-HOY']);
    });

    it('lo que vence en más de 30 días solo se cuenta, y las fechas ilegibles se ignoran', async () => {
      const alerts = await inventory.getExpiryAlerts(undefined, 1);
      expect(alerts.okCount).toBe(1); // VENCE-31
      expect(Object.keys(alerts).sort()).toEqual(['expired', 'expiringSoon', 'okCount']);
    });

    it('no mezcla cuentas ni productos inactivos', async () => {
      const alerts = await inventory.getExpiryAlerts(undefined, 1);
      const codes = [...alerts.expired, ...alerts.expiringSoon].map((p) => p.code);
      expect(codes).not.toContain('VENCIDO-INACTIVO');
      expect(codes).not.toContain('VENCIDO-OTRA');
      expect((await inventory.getExpiryAlerts(undefined, 999)).okCount).toBe(0);
    });
  });

  it('con miles de productos en buen estado casi no envía nada y responde rápido', async () => {
    const insert = sqlite.prepare(
      `INSERT INTO "Product" (accountId, code, name, categoryId, price, cost, stock, minStock, criticalStock, taxRate, isActive, expiryDate, createdAt, updatedAt) VALUES (1, ?, ?, 1, 1000, 600, 100, 10, 3, 0, 1, ?, '${NOW}', '${NOW}')`,
    );
    const far = inDays(400);
    sqlite.transaction(() => {
      for (let i = 0; i < 8000; i++) insert.run(`BULK${i}`, `Masivo ${i}`, far);
    })();

    const started = performance.now();
    const stock = await inventory.getStockAlerts(undefined, 1);
    const expiry = await inventory.getExpiryAlerts(undefined, 1);
    const elapsed = performance.now() - started;

    expect(stock.critical.length + stock.warning.length).toBe(6);
    expect(stock.okCount).toBe(7 + 8000);
    expect(expiry.expired.length + expiry.expiringSoon.length).toBe(4);
    expect(expiry.okCount).toBe(1 + 8000);
    expect(JSON.stringify({ stock, expiry }).length).toBeLessThan(20_000);
    expect(elapsed).toBeLessThan(1500);
  });
});
