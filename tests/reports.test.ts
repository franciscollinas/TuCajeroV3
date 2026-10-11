// Zona horaria de Colombia: una venta a las 8:30 p. m. cae en el día UTC siguiente.
process.env.TZ = 'America/Bogota';

import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const dir = join(tmpdir(), `tucajero-reports-${Date.now()}`);
const dbPath = join(dir, 'test.db');
process.env.DATABASE_URL = dbPath;

const { ReportsService } = await import('../app/main/services/reports.service');
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
const at = (month: number, day: number, hour = 10, minute = 0) => new Date(2026, month - 1, day, hour, minute).toISOString();
const range = (fromDay: number, toDay: number, month = 10) => ({
  start: new Date(2026, month - 1, fromDay),
  end: new Date(2026, month - 1, toDay),
});

interface Line { product: 1 | 2; qty: number }
interface Pay { method: string; amount: number }
interface SaleSpec {
  n: string; when: string; lines: Line[]; pays: Pay[];
  tax?: number; change?: number; status?: string; accountId?: number; branchId?: number | null;
}

const PRICE: Record<number, number> = { 1: 1000, 2: 2500 };
const TAX_RATE = 0.19;

// Ventas del conjunto de prueba (cuenta 1, salvo que se indique).
const SALES: SaleSpec[] = [
  { n: 'S0', when: at(10, 3, 9), lines: [{ product: 1, qty: 1 }], pays: [{ method: 'efectivo', amount: 1000 }] }, // periodo anterior
  { n: 'S1', when: at(10, 5, 10), lines: [{ product: 1, qty: 2 }, { product: 2, qty: 1 }], pays: [{ method: 'efectivo', amount: 5000 }], change: 500 },
  { n: 'S2', when: at(10, 5, 20, 30), lines: [{ product: 1, qty: 1 }], pays: [{ method: 'nequi', amount: 1000 }] }, // 8:30 p. m. local = 01:30Z del día 6
  { n: 'S3', when: at(10, 6, 9), lines: [{ product: 2, qty: 2 }], pays: [{ method: 'efectivo', amount: 3000 }, { method: 'transferencia', amount: 2000 }] },
  { n: 'S4', when: at(10, 7, 11), lines: [{ product: 2, qty: 4 }], pays: [{ method: 'efectivo', amount: 10000 }], status: 'CANCELLED' },
  { n: 'S5', when: at(10, 8, 12), lines: [{ product: 1, qty: 5 }], pays: [{ method: 'efectivo', amount: 5000 }], accountId: 2 },
  { n: 'S6', when: at(10, 8, 10), lines: [{ product: 1, qty: 1 }], pays: [{ method: 'efectivo', amount: 2000 }], tax: 190, change: 810 },
  { n: 'S7', when: at(10, 7, 15), lines: [{ product: 1, qty: 3 }], pays: [{ method: 'tarjeta', amount: 3000 }], branchId: 1 },
  // Mes anterior (septiembre), fuera de la ventana de 30 días del Dashboard al 8-oct.
  { n: 'S8', when: at(9, 2, 11), lines: [{ product: 2, qty: 2 }], pays: [{ method: 'efectivo', amount: 5000 }] },
  { n: 'S9', when: at(9, 8, 11), lines: [{ product: 1, qty: 4 }], pays: [{ method: 'nequi', amount: 4000 }] },
];

serviceDescribe('ReportsService', () => {
  const reports = new ReportsService();

  beforeAll(() => {
    mkdirSync(dir, { recursive: true });
    const sqlite = new Database(dbPath);
    sqlite.pragma('foreign_keys = ON');
    migrate(drizzle(sqlite), { migrationsFolder: resolve('database/migrations') });
    sqlite.exec(`
      INSERT INTO "Account" (name, nit, email, createdAt, updatedAt) VALUES ('A', '1', 'a@a.com', '${NOW}', '${NOW}');
      INSERT INTO "Account" (name, nit, email, createdAt, updatedAt) VALUES ('B', '2', 'b@b.com', '${NOW}', '${NOW}');
      INSERT INTO "User" (accountId, username, password, fullName, role, active, createdAt, updatedAt)
        VALUES (1, 'admin', 'hash', 'Admin', 'ADMIN', 1, '${NOW}', '${NOW}');
      INSERT INTO "Branch" (accountId, name, code, isActive, createdAt, updatedAt) VALUES (1, 'Sede', 'S1', 1, '${NOW}', '${NOW}');
      INSERT INTO "Category" (name, color, accountId, createdAt, updatedAt) VALUES ('Cat', '#fff', 1, '${NOW}', '${NOW}');
      INSERT INTO "Product" (accountId, code, name, categoryId, price, cost, stock, taxRate, isActive, createdAt, updatedAt)
        VALUES (1, 'P1', 'Producto Uno', 1, 1000, 600, 10, 0, 1, '${NOW}', '${NOW}');
      INSERT INTO "Product" (accountId, code, name, categoryId, price, cost, stock, taxRate, isActive, createdAt, updatedAt)
        VALUES (1, 'P2', 'Producto Dos', 1, 2500, 1500, 4, 0, 1, '${NOW}', '${NOW}');
      INSERT INTO "Product" (accountId, code, name, categoryId, price, cost, stock, taxRate, isActive, createdAt, updatedAt)
        VALUES (1, 'P3', 'Inactivo', 1, 100, 100, 100, 0, 0, '${NOW}', '${NOW}');
    `);

    const insSale = sqlite.prepare(
      `INSERT INTO "Sale" (accountId,saleNumber,userId,branchId,subtotal,tax,discount,deliveryFee,total,change,status,dianStatus,createdAt)
       VALUES (?,?,1,?,?,?,0,0,?,?,?,'PENDING',?)`,
    );
    const insItem = sqlite.prepare(
      `INSERT INTO "SaleItem" (saleId,productId,quantity,unitPrice,taxRate,subtotal,discount,total,unitType) VALUES (?,?,?,?,?,?,0,?,'UNIT')`,
    );
    const insPay = sqlite.prepare(`INSERT INTO "Payment" (saleId,method,amount,createdAt) VALUES (?,?,?,?)`);
    for (const s of SALES) {
      const subtotal = s.lines.reduce((acc, l) => acc + PRICE[l.product] * l.qty, 0);
      const tax = s.tax ?? 0;
      const id = Number(
        insSale.run(s.accountId ?? 1, s.n, s.branchId ?? null, subtotal, tax, subtotal + tax, s.change ?? 0, s.status ?? 'COMPLETED', s.when).lastInsertRowid,
      );
      for (const l of s.lines) {
        const line = PRICE[l.product] * l.qty;
        insItem.run(id, l.product, l.qty, PRICE[l.product], tax ? TAX_RATE : 0, line, line);
      }
      for (const p of s.pays) insPay.run(id, p.method, p.amount, s.when);
    }
    sqlite.close();
  });

  afterAll(() => {
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it('totales del periodo: ingresos sin multiplicar por ítems, IVA fuera de la ganancia', async () => {
    const totals = await reports.getPeriodTotals(range(5, 8), 1);
    // S1 4500 + S2 1000 + S3 5000 + S6 1190 + S7 3000; no cuentan la cancelada (S4) ni la de otra cuenta (S5).
    expect(totals.sales).toBe(5);
    expect(totals.revenue).toBe(14690);
    expect(totals.cost).toBe(8700);
    expect(totals.profit).toBe(14690 - 190 - 8700); // ingresos − IVA − costo
    expect(totals.marginPct).toBe(39.5);
    expect(totals.avgTicket).toBe(2938);
  });

  it('un periodo sin ventas devuelve ceros, no NaN', async () => {
    expect(await reports.getPeriodTotals(range(20, 25), 1)).toEqual({
      sales: 0, revenue: 0, cost: 0, profit: 0, marginPct: 0, avgTicket: 0,
    });
  });

  it('filtra por sucursal', async () => {
    const branch = await reports.getPeriodTotals(range(5, 8), 1, 1);
    expect(branch.sales).toBe(1);
    expect(branch.revenue).toBe(3000);
  });

  it('el periodo anterior tiene la misma duración y termina el día previo', async () => {
    const previous = reports.previousRange(range(5, 8));
    expect(previous.start).toEqual(new Date(2026, 9, 1));
    expect(previous.end).toEqual(new Date(2026, 9, 4));
    const totals = await reports.getPeriodTotals(previous, 1);
    expect(totals.sales).toBe(1);
    expect(totals.revenue).toBe(1000);
  });

  it('ventas por día: fecha local (8:30 p. m. no pasa al día siguiente), orden ascendente y días vacíos en cero', async () => {
    const byDay = await reports.getSalesByDay(range(5, 9), 1);
    expect(byDay).toEqual([
      { date: '2026-10-05', sales: 2, revenue: 5500 },
      { date: '2026-10-06', sales: 1, revenue: 5000 },
      { date: '2026-10-07', sales: 1, revenue: 3000 },
      { date: '2026-10-08', sales: 1, revenue: 1190 },
      { date: '2026-10-09', sales: 0, revenue: 0 },
    ]);
  });

  it('mezcla de pagos: el efectivo se descuenta del cambio y se ordena de mayor a menor', async () => {
    const mix = await reports.getPaymentMix(range(5, 8), 1);
    // Efectivo entregado 10.000 − cambio 1.310 (S1 500 + S6 810) = 8.690 = ventas pagadas en efectivo.
    expect(mix).toEqual([
      { method: 'efectivo', label: 'Efectivo', total: 8690 },
      { method: 'tarjeta', label: 'Tarjeta', total: 3000 },
      { method: 'transferencia', label: 'Transferencia', total: 2000 },
      { method: 'nequi', label: 'Nequi', total: 1000 },
    ]);
  });

  it('productos más vendidos por ingresos, con nombre', async () => {
    const top = await reports.getTopProducts(range(5, 8), 1, 10);
    expect(top).toEqual([
      { id: 2, name: 'Producto Dos', code: 'P2', quantity: 3, total: 7500 },
      { id: 1, name: 'Producto Uno', code: 'P1', quantity: 7, total: 7000 },
    ]);
    expect(await reports.getTopProducts(range(5, 8), 1, 1)).toHaveLength(1);
  });

  it('valor del inventario: solo productos activos de la cuenta', async () => {
    expect(await reports.getInventoryValue(1)).toBe(10 * 600 + 4 * 1500);
    expect(await reports.getInventoryValue(2)).toBe(0);
  });

  it('informe general: junta todo y calcula el periodo anterior', async () => {
    const general = await reports.getGeneralReport(range(5, 8), 1);
    expect(general.range).toEqual({ startDate: '2026-10-05', endDate: '2026-10-08' });
    expect(general.previousRange).toEqual({ startDate: '2026-10-01', endDate: '2026-10-04' });
    expect(general.current.revenue).toBe(14690);
    expect(general.previous.revenue).toBe(1000);
    expect(general.salesByDay).toHaveLength(4);
    expect(general.inventoryValue).toBe(12000);
    expect(general.monthComparison.month).toBe('2026-10');
    expect(general.monthComparison.previousMonth).toBe('2026-09');
  });

  describe('comparativo mensual', () => {
    const anchor = new Date(2026, 9, 8); // el mes se toma del último día del rango

    it('mes en curso: compara hasta el mismo día y deja vacíos los días que no llegan', async () => {
      const cmp = await reports.getMonthComparison(anchor, 1, undefined, new Date(2026, 9, 8, 12, 0));
      expect(cmp.month).toBe('2026-10');
      expect(cmp.previousMonth).toBe('2026-09');
      expect(cmp.days).toHaveLength(31); // octubre tiene 31 días; septiembre, 30
      expect(cmp.cutoffDay).toBe(8);
      const pick = (d: number) => cmp.days[d - 1];
      expect(pick(3)).toEqual({ day: 3, current: 1000, previous: 0 }); // S0
      expect(pick(5)).toEqual({ day: 5, current: 5500, previous: 0 }); // S1 + S2 (8:30 p. m. sigue en el día 5)
      expect(pick(2)).toEqual({ day: 2, current: 0, previous: 5000 }); // S8 de septiembre
      expect(pick(8)).toEqual({ day: 8, current: 1190, previous: 4000 }); // S6 y S9
      expect(pick(9).current).toBeNull(); // todavía no llega
      expect(pick(31)).toEqual({ day: 31, current: null, previous: null }); // septiembre no tiene día 31
      expect(cmp.currentToDate).toBe(15690);
      expect(cmp.previousSameDays).toBe(9000);
      expect(cmp.changePct).toBe(74.3);
    });

    it('mes ya cerrado: compara el mes completo', async () => {
      const cmp = await reports.getMonthComparison(anchor, 1, undefined, new Date(2026, 10, 20));
      expect(cmp.cutoffDay).toBe(31);
      expect(cmp.days[30].current).toBe(0); // 31-oct sin ventas, pero el día existe
      expect(cmp.currentToDate).toBe(15690);
      expect(cmp.previousSameDays).toBe(9000);
    });

    it('mes futuro: nada que comparar todavía', async () => {
      const cmp = await reports.getMonthComparison(anchor, 1, undefined, new Date(2026, 8, 20));
      expect(cmp.cutoffDay).toBe(0);
      expect(cmp.days.every((d) => d.current === null)).toBe(true);
      expect(cmp.changePct).toBeNull();
    });

    it('sin ventas el mes anterior no hay porcentaje (evita dividir entre cero)', async () => {
      const cmp = await reports.getMonthComparison(new Date(2026, 8, 15), 1, undefined, new Date(2026, 9, 8));
      expect(cmp.month).toBe('2026-09');
      expect(cmp.previousMonth).toBe('2026-08');
      expect(cmp.currentToDate).toBe(9000);
      expect(cmp.previousSameDays).toBe(0);
      expect(cmp.changePct).toBeNull();
    });

    it('enero se compara con diciembre del año anterior', async () => {
      const cmp = await reports.getMonthComparison(new Date(2026, 0, 10), 1, undefined, new Date(2026, 0, 10));
      expect(cmp.month).toBe('2026-01');
      expect(cmp.previousMonth).toBe('2025-12');
    });

    it('febrero (28 días) contra enero (31): no pierde los días extra del mes anterior', async () => {
      const cmp = await reports.getMonthComparison(new Date(2026, 1, 10), 1, undefined, new Date(2026, 2, 5));
      expect(cmp.days).toHaveLength(31);
      expect(cmp.days[28]).toEqual({ day: 29, current: null, previous: 0 });
    });

    it('filtra por sucursal y por cuenta', async () => {
      const branch = await reports.getMonthComparison(anchor, 1, 1, new Date(2026, 10, 20));
      expect(branch.currentToDate).toBe(3000);
      const other = await reports.getMonthComparison(anchor, 2, undefined, new Date(2026, 10, 20));
      expect(other.currentToDate).toBe(5000); // solo S5; nada de la cuenta 1
    });
  });

  it('rechaza rangos inválidos', async () => {
    await expect(reports.getPeriodTotals({ start: new Date(2026, 9, 8), end: new Date(2026, 9, 5) }, 1)).rejects.toThrow(/anterior/);
    await expect(reports.getPeriodTotals({ start: new Date(2020, 0, 1), end: new Date(2026, 9, 1) }, 1)).rejects.toThrow(/máximo/);
    await expect(reports.getPeriodTotals({ start: new Date('x'), end: new Date(2026, 9, 1) }, 1)).rejects.toThrow(/inválido/);
  });

  it('no trunca en 5.000 ventas', async () => {
    const sqlite = new Database(dbPath);
    const ins = sqlite.prepare(
      `INSERT INTO "Sale" (accountId,saleNumber,userId,subtotal,tax,discount,deliveryFee,total,change,status,dianStatus,createdAt)
       VALUES (1,?,1,1000,0,0,0,1000,0,'COMPLETED','PENDING',?)`,
    );
    sqlite.transaction(() => {
      for (let i = 0; i < 5200; i++) ins.run(`BULK-${i}`, at(11, 1 + (i % 28), 10, i % 60));
    })();
    sqlite.close();

    const totals = await reports.getPeriodTotals(range(1, 30, 11), 1);
    expect(totals.sales).toBe(5200);
    expect(totals.revenue).toBe(5_200_000);
    const byDay = await reports.getSalesByDay(range(1, 30, 11), 1);
    expect(byDay.reduce((acc, d) => acc + d.sales, 0)).toBe(5200);
  });

  it('el Dashboard muestra las mismas cifras que Reportes (y no multiplica por ítems)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 8, 12, 0));
    try {
      const dashboard = await new SalesService().getDashboardSummary(1);
      const month = await reports.getPeriodTotals(range(1, 8), 1);
      // S0 + S1 + S2 + S3 + S6 + S7 = 1000 + 14690
      expect(dashboard.monthToDate.totalIngresos).toBe(15690);
      expect(dashboard.monthToDate.totalVentas).toBe(6);
      expect(dashboard.monthToDate.totalIngresos).toBe(month.revenue);
      expect(dashboard.monthToDate.totalProfit).toBe(month.profit);
      // La mezcla de pagos del Dashboard también descuenta el cambio.
      const cash = dashboard.paymentMethods.find((p) => p.method === 'efectivo');
      expect(cash?.total).toBe(8690 + 1000);
    } finally {
      vi.useRealTimers();
    }
  });
});
