import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dir = join(tmpdir(), `tucajero-atomicity-${Date.now()}`);
process.env.DATABASE_URL = join(dir, 'test.db');

const { CashSessionService } = await import('../app/main/services/cash-session.service');
const { SalesService } = await import('../app/main/services/sales.service');
const { CashExpenseService } = await import('../app/main/services/cash-expense.service');
const { CustomerService } = await import('../app/main/services/customer.service');
const { getDatabase, schema, closeDatabase } = await import('../app/main/db');
const { eq } = await import('drizzle-orm');

let nativeDbAvailable = true;
try {
  new Database(':memory:').close();
} catch {
  nativeDbAvailable = false;
}
const serviceDescribe = nativeDbAvailable ? describe : describe.skip;

const NOW = '2026-01-01T00:00:00.000Z';
const pad = (n: number): string => String(n).padStart(2, '0');
const localDate = (offsetDays: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

serviceDescribe('ventas, caja y fiado: sin duplicados ni cifras falsas', () => {
  const cashSessions = new CashSessionService();
  const sales = new SalesService();
  const expenses = new CashExpenseService();
  const customers = new CustomerService();

  const item = (productId: number, qty: number) => [{ productId, quantity: qty, unitPrice: 1000, discount: 0 }];
  const stockOf = (id: number): number => getDatabase().select().from(schema.products).where(eq(schema.products.id, id)).get()!.stock;
  const expectedOf = (id: number): number => getDatabase().select().from(schema.cashSessions).where(eq(schema.cashSessions.id, id)).get()!.expectedCash!;

  beforeAll(() => {
    mkdirSync(dir, { recursive: true });
    const sqlite = new Database(process.env.DATABASE_URL as string);
    sqlite.pragma('foreign_keys = ON');
    migrate(drizzle(sqlite), { migrationsFolder: resolve('database/migrations') });
    sqlite.exec(`
      INSERT INTO "Account" (name, nit, email, createdAt, updatedAt) VALUES ('A', '1', 'a@a.com', '${NOW}', '${NOW}');
      INSERT INTO "User" (accountId, username, password, fullName, role, active, createdAt, updatedAt) VALUES (1, 'admin', 'h', 'Admin', 'ADMIN', 1, '${NOW}', '${NOW}');
      INSERT INTO "User" (accountId, username, password, fullName, role, active, createdAt, updatedAt) VALUES (1, 'cajero', 'h', 'Cajero', 'CASHIER', 1, '${NOW}', '${NOW}');
      INSERT INTO "Category" (name, color, accountId, createdAt, updatedAt) VALUES ('Cat', '#fff', 1, '${NOW}', '${NOW}');
      INSERT INTO "Product" (accountId, code, name, categoryId, price, cost, stock, taxRate, isActive, createdAt, updatedAt) VALUES (1, 'P1', 'Producto 1', 1, 1000, 600, 1000, 0, 1, '${NOW}', '${NOW}');
      INSERT INTO "Product" (accountId, code, name, categoryId, price, cost, stock, taxRate, isActive, expiryDate, createdAt, updatedAt) VALUES (1, 'P2', 'Vence hoy', 1, 1000, 600, 50, 0, 1, '${localDate(0)}', '${NOW}', '${NOW}');
      INSERT INTO "Product" (accountId, code, name, categoryId, price, cost, stock, taxRate, isActive, expiryDate, createdAt, updatedAt) VALUES (1, 'P3', 'Vencio ayer', 1, 1000, 600, 50, 0, 1, '${localDate(-1)}', '${NOW}', '${NOW}');
      INSERT INTO "Customer" (accountId, name, phone, createdAt, updatedAt) VALUES (1, 'Cliente', '300', '${NOW}', '${NOW}');
    `);
    sqlite.close();
  });

  afterAll(() => {
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it('numera las ventas más allá de la 9.999 del año', async () => {
    const session = (await cashSessions.openCashSession(1, 1, 100000)).id;
    const first = await sales.createSale(session, 1, item(1, 1), [{ method: 'efectivo', amount: 1000 }], 1);
    const year = new Date().getFullYear();
    getDatabase().update(schema.sales).set({ saleNumber: `V-${year}-9999` }).where(eq(schema.sales.id, first.id)).run();

    const second = await sales.createSale(session, 1, item(1, 1), [{ method: 'efectivo', amount: 1000 }], 1);
    const third = await sales.createSale(session, 1, item(1, 1), [{ method: 'efectivo', amount: 1000 }], 1);
    const fourth = await sales.createSale(session, 1, item(1, 1), [{ method: 'efectivo', amount: 1000 }], 1);

    expect(second.saleNumber).toBe(`V-${year}-10000`);
    expect(third.saleNumber).toBe(`V-${year}-10001`);
    expect(fourth.saleNumber).toBe(`V-${year}-10002`);
    await cashSessions.closeCashSession(session, 0, 0, 1, 1);
  });

  describe('valores que no tienen sentido', () => {
    let session = 0;
    beforeAll(async () => {
      session = (await cashSessions.openCashSession(1, 2, 0)).id;
    });

    it('rechaza un descuento fijo mayor que el subtotal', async () => {
      await expect(
        sales.createSale(session, 2, item(1, 1), [{ method: 'efectivo', amount: 1000 }], 1, 5000, 0, undefined, false, undefined, 'fixed'),
      ).rejects.toThrow(/descuento/i);
    });

    it('rechaza un descuento por línea mayor que la línea', async () => {
      await expect(
        sales.createSale(session, 2, [{ productId: 1, quantity: 1, unitPrice: 1000, discount: 1500 }], [{ method: 'efectivo', amount: 1000 }], 1),
      ).rejects.toThrow(/descuento/i);
    });

    it('rechaza un porcentaje mayor que 100', async () => {
      await expect(
        sales.createSale(session, 2, item(1, 1), [{ method: 'efectivo', amount: 1000 }], 1, 150),
      ).rejects.toThrow(/descuento/i);
    });

    it('rechaza cantidad cero o negativa', async () => {
      await expect(sales.createSale(session, 2, item(1, 0), [{ method: 'efectivo', amount: 1000 }], 1)).rejects.toThrow(/cantidad/i);
      await expect(sales.createSale(session, 2, item(1, -1), [{ method: 'efectivo', amount: 1000 }], 1)).rejects.toThrow(/cantidad/i);
    });

    it('un descuento válido del 100 % deja la venta en cero y sigue permitido', async () => {
      const sale = await sales.createSale(session, 2, item(1, 1), [{ method: 'efectivo', amount: 0 }], 1, 100);
      expect(sale.total).toBe(0);
    });

    it('un producto que vence hoy se puede vender; uno vencido ayer, no', async () => {
      await expect(sales.createSale(session, 2, item(2, 1), [{ method: 'efectivo', amount: 1000 }], 1)).resolves.toMatchObject({ total: 1000 });
      await expect(sales.createSale(session, 2, item(3, 1), [{ method: 'efectivo', amount: 1000 }], 1)).rejects.toThrow(/vencido/i);
    });
  });

  describe('doble envío', () => {
    let session = 0;
    beforeAll(async () => {
      const stale = await cashSessions.getActiveCashSession(2);
      if (stale) await cashSessions.closeCashSession(stale.id, 0, 0, 1, 2);
      session = (await cashSessions.openCashSession(1, 2, 10000)).id;
    });

    it('anular la misma venta dos veces a la vez solo cuenta una', async () => {
      const sale = await sales.createSale(session, 2, item(1, 3), [{ method: 'efectivo', amount: 3000 }], 1);
      const stockBefore = stockOf(1);
      const expectedBefore = expectedOf(session);

      const results = await Promise.allSettled([sales.cancelSale(sale.id, 2, 1), sales.cancelSale(sale.id, 2, 1)]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(stockOf(1)).toBe(stockBefore + 3);
      expect(expectedOf(session)).toBe(expectedBefore - 3000);
    });

    it('abonar dos veces a la vez la misma deuda solo cuenta una', async () => {
      await sales.createSale(session, 2, item(1, 2), [], 1, 0, 0, 1, true);
      const debt = getDatabase().select().from(schema.debts).get()!;
      const expectedBefore = expectedOf(session);

      const results = await Promise.allSettled([
        customers.payDebt(debt.id, debt.balance, 2, session, 1, 'efectivo'),
        customers.payDebt(debt.id, debt.balance, 2, session, 1, 'efectivo'),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(expectedOf(session)).toBe(expectedBefore + debt.balance);
    });

    it('dos egresos a la vez restan ambos del efectivo esperado', async () => {
      const expectedBefore = expectedOf(session);
      await Promise.all([
        expenses.createExpense(session, 2, 100, 'Cambio dado', 1),
        expenses.createExpense(session, 2, 250, 'Pago de servicio', 1),
      ]);
      expect(expectedOf(session)).toBe(expectedBefore - 350);
    });

    it('un egreso mayor que el efectivo esperado se rechaza', async () => {
      await expect(expenses.createExpense(session, 2, expectedOf(session) + 1, 'Retiro personal', 1)).rejects.toThrow(/efectivo/i);
    });

    it('cerrar la misma caja dos veces a la vez solo cierra una', async () => {
      const results = await Promise.allSettled([
        cashSessions.closeCashSession(session, 1000, 0, 1, 2),
        cashSessions.closeCashSession(session, 1000, 0, 1, 2),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });

    it('no permite cerrar con efectivo contado negativo', async () => {
      const open = (await cashSessions.openCashSession(1, 2, 0)).id;
      await expect(cashSessions.closeCashSession(open, -5, 0, 1, 2)).rejects.toThrow(/negativ|mayor|cero/i);
      await cashSessions.closeCashSession(open, 0, 0, 1, 2);
    });
  });

  describe('anular una venta cuya caja ya cerró', () => {
    it('descuenta el efectivo devuelto de la caja abierta actual y lo deja como egreso', async () => {
      const first = (await cashSessions.openCashSession(1, 2, 0)).id;
      const sale = await sales.createSale(first, 2, item(1, 2), [{ method: 'efectivo', amount: 2000 }], 1);
      await cashSessions.closeCashSession(first, 2000, 0, 1, 2);

      const second = (await cashSessions.openCashSession(1, 2, 5000)).id;
      await sales.cancelSale(sale.id, 2, 1);

      expect(expectedOf(second)).toBe(5000 - 2000);
      const refunds = getDatabase().select().from(schema.cashExpenses).where(eq(schema.cashExpenses.cashSessionId, second)).all();
      expect(refunds).toHaveLength(1);
      expect(refunds[0].amount).toBe(2000);
      expect(refunds[0].reason).toContain(sale.saleNumber);
      await cashSessions.closeCashSession(second, 3000, 0, 1, 2);
    });

    it('sin una caja abierta donde registrar la devolución, no anula y lo explica', async () => {
      const first = (await cashSessions.openCashSession(1, 2, 0)).id;
      const sale = await sales.createSale(first, 2, item(1, 1), [{ method: 'efectivo', amount: 1000 }], 1);
      await cashSessions.closeCashSession(first, 1000, 0, 1, 2);

      await expect(sales.cancelSale(sale.id, 2, 1)).rejects.toThrow(/caja abierta/i);
      const still = getDatabase().select().from(schema.sales).where(eq(schema.sales.id, sale.id)).get()!;
      expect(still.status).toBe('COMPLETED');
    });

    it('una venta pagada sin efectivo se anula aunque su caja esté cerrada', async () => {
      const first = (await cashSessions.openCashSession(1, 2, 0)).id;
      const sale = await sales.createSale(first, 2, item(1, 1), [{ method: 'nequi', amount: 1000 }], 1);
      await cashSessions.closeCashSession(first, 0, 0, 1, 2);
      await expect(sales.cancelSale(sale.id, 2, 1)).resolves.toEqual({ success: true });
    });
  });
});
