import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dir = join(tmpdir(), `tucajero-dashcharts-${Date.now()}`);
process.env.DATABASE_URL = join(dir, 'test.db');
process.env.TUCAJERO_BACKUP_DIR = join(dir, 'backups');

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

/** Mediodía local de hace `n` días: lejos de los bordes del día en cualquier zona horaria. */
const noonDaysAgo = (n: number): string => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - n, 12, 0, 0).toISOString();
};
const capitalized = (date: Date, options: Intl.DateTimeFormatOptions): string => {
  const text = date.toLocaleDateString('es-CO', options);
  return text.charAt(0).toUpperCase() + text.slice(1);
};

serviceDescribe('gráficos del inicio (semana y 30 días)', () => {
  const sales = new SalesService();
  let sqlite: Database.Database;

  const sell = async (session: number, price: number, daysAgo: number, cancel = false): Promise<void> => {
    const sale = await sales.createSale(session, 1, [{ productId: 1, quantity: 1, unitPrice: price, discount: 0 }], [{ method: 'efectivo', amount: price }], 1);
    if (cancel) await sales.cancelSale(sale.id, 1, 1);
    sqlite.prepare('update "Sale" set createdAt = ? where id = ?').run(noonDaysAgo(daysAgo), sale.id);
  };

  beforeAll(async () => {
    mkdirSync(dir, { recursive: true });
    const setup = new Database(process.env.DATABASE_URL as string);
    setup.pragma('foreign_keys = ON');
    migrate(drizzle(setup), { migrationsFolder: resolve('database/migrations') });
    setup.exec(`
      INSERT INTO "Account" (name, nit, email, createdAt, updatedAt) VALUES ('A', '1', 'a@a.com', '${NOW}', '${NOW}');
      INSERT INTO "Account" (name, nit, email, createdAt, updatedAt) VALUES ('B', '2', 'b@b.com', '${NOW}', '${NOW}');
      INSERT INTO "User" (accountId, username, password, fullName, role, active, createdAt, updatedAt) VALUES (1, 'admin', 'h', 'Admin', 'ADMIN', 1, '${NOW}', '${NOW}');
      INSERT INTO "Category" (name, color, accountId, createdAt, updatedAt) VALUES ('Cat', '#fff', 1, '${NOW}', '${NOW}');
      INSERT INTO "Product" (accountId, code, name, categoryId, price, cost, stock, taxRate, isActive, createdAt, updatedAt) VALUES (1, 'P1', 'Producto', 1, 1000, 600, 1000000, 0, 1, '${NOW}', '${NOW}');
    `);
    setup.close();
    sqlite = new Database(process.env.DATABASE_URL as string);

    const session = (await new CashSessionService().openCashSession(1, 1, 0)).id;
    await sell(session, 1000, 0);
    await sell(session, 2000, 0);
    await sell(session, 4000, 1);
    await sell(session, 8000, 10);
    await sell(session, 16000, 29);
    await sell(session, 32000, 30); // fuera de la ventana de 30 días
    await sell(session, 64000, 2, true); // anulada: no cuenta
  });

  afterAll(() => {
    sqlite.close();
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it('la semana tiene 7 días, de más viejo a hoy, con ventas e ingresos por día', async () => {
    const { weeklyChart } = await sales.getDashboardSummary(1);
    expect(weeklyChart).toHaveLength(7);
    const today = new Date();
    const expectedNames = Array.from({ length: 7 }, (_, i) => capitalized(new Date(today.getFullYear(), today.getMonth(), today.getDate() - (6 - i)), { weekday: 'short' }));
    expect(weeklyChart.map((d) => d.name)).toEqual(expectedNames);
    expect(weeklyChart[6]).toMatchObject({ ventas: 2, ingresos: 3000 }); // hoy
    expect(weeklyChart[5]).toMatchObject({ ventas: 1, ingresos: 4000 }); // ayer
    expect(weeklyChart[4]).toMatchObject({ ventas: 0, ingresos: 0 }); // la venta anulada de hace 2 días no cuenta
  });

  it('los 30 días incluyen los extremos y dejan fuera lo anterior', async () => {
    const { monthlyChart } = await sales.getDashboardSummary(1);
    expect(monthlyChart).toHaveLength(30);
    const today = new Date();
    expect(monthlyChart[29].name).toBe(today.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }));
    expect(monthlyChart[29]).toMatchObject({ ventas: 2, ingresos: 3000 });
    expect(monthlyChart[28]).toMatchObject({ ventas: 1, ingresos: 4000 });
    expect(monthlyChart[19]).toMatchObject({ ventas: 1, ingresos: 8000 }); // hace 10 días
    expect(monthlyChart[0]).toMatchObject({ ventas: 1, ingresos: 16000 }); // hace 29 días
    const totalInChart = monthlyChart.reduce((sum, d) => sum + d.ventas, 0);
    expect(totalInChart).toBe(5); // la de hace 30 días y la anulada no están
  });

  it('otra cuenta no ve estas ventas', async () => {
    const { weeklyChart, monthlyChart } = await sales.getDashboardSummary(2);
    expect(weeklyChart.every((d) => d.ventas === 0)).toBe(true);
    expect(monthlyChart.every((d) => d.ventas === 0)).toBe(true);
  });

  it('con miles de ventas recientes responde en tiempo razonable (no formatea fechas por venta)', async () => {
    const columns = (sqlite.prepare('pragma table_info("Sale")').all() as Array<{ name: string }>).map((c) => c.name).filter((n) => n !== 'id');
    const select = columns
      .map((c) => (c === 'saleNumber' ? `'BULK-' || n.i` : c === 'createdAt' ? `strftime('%Y-%m-%dT12:00:00.000Z', 'now', '-' || (n.i % 25) || ' days')` : `t."${c}"`))
      .join(', ');
    sqlite.exec(`
      WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 9000)
      INSERT INTO "Sale" (${columns.map((c) => `"${c}"`).join(', ')})
      SELECT ${select} FROM n, (SELECT * FROM "Sale" WHERE status = 'COMPLETED' LIMIT 1) t;
    `);
    const started = performance.now();
    const summary = await sales.getDashboardSummary(1);
    const elapsed = performance.now() - started;
    expect(summary.monthlyChart.reduce((sum, d) => sum + d.ventas, 0)).toBeGreaterThan(9000);
    expect(elapsed).toBeLessThan(250);
  });
});
