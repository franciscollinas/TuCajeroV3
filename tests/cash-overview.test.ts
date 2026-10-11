import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EXPENSE_CONCEPTS, buildExpenseReason, parseExpenseReason } from '../app/renderer/src/shared/types/cash.types';

const dir = join(tmpdir(), `tucajero-cash-overview-${Date.now()}`);
process.env.DATABASE_URL = join(dir, 'test.db');

const { appRouter } = await import('../app/main/router/index');
const { CashSessionService } = await import('../app/main/services/cash-session.service');
const { SalesService } = await import('../app/main/services/sales.service');
const { CashExpenseService } = await import('../app/main/services/cash-expense.service');
const { CustomerService } = await import('../app/main/services/customer.service');
const { getDatabase, schema, closeDatabase } = await import('../app/main/db');

let nativeDbAvailable = true;
try {
  new Database(':memory:').close();
} catch {
  nativeDbAvailable = false;
}
const serviceDescribe = nativeDbAvailable ? describe : describe.skip;

const NOW = '2026-01-01T00:00:00.000Z';

describe('conceptos de egreso', () => {
  it('arma el motivo con el concepto y el detalle opcional', () => {
    expect(buildExpenseReason('Cambio dado')).toBe('Cambio dado');
    expect(buildExpenseReason('Pago de servicio', '  luz del local ')).toBe('Pago de servicio — luz del local');
    expect(buildExpenseReason('Retiro personal', '')).toBe('Retiro personal');
  });

  it('«Otro» exige describir el egreso', () => {
    expect(() => buildExpenseReason('Otro')).toThrow(/Describe el egreso/);
    expect(() => buildExpenseReason('Otro', '   ')).toThrow(/Describe el egreso/);
    expect(buildExpenseReason('Otro', 'Flete')).toBe('Otro — Flete');
  });

  it('recorta el detalle a 200 caracteres', () => {
    expect(buildExpenseReason('Gasto operativo', 'x'.repeat(500))).toHaveLength('Gasto operativo — '.length + 200);
  });

  it('separa un motivo guardado y trata el texto libre antiguo como «Otro»', () => {
    expect(parseExpenseReason('Pago de servicio — luz')).toEqual({ concept: 'Pago de servicio', note: 'luz' });
    expect(parseExpenseReason('Cambio dado')).toEqual({ concept: 'Cambio dado', note: '' });
    expect(parseExpenseReason('Flete de mercancía')).toEqual({ concept: 'Otro', note: 'Flete de mercancía' });
    for (const concept of EXPENSE_CONCEPTS) {
      expect(parseExpenseReason(buildExpenseReason(concept, 'detalle')).concept).toBe(concept);
    }
  });
});

serviceDescribe('resumen por sesión de caja', () => {
  const cashSessions = new CashSessionService();
  const sales = new SalesService();
  const expenses = new CashExpenseService();
  const customers = new CustomerService();

  let sessionA = 0; // usuario 1
  let sessionB = 0; // usuario 2 (otro cajero, mismo día)

  const adminCaller = () => appRouter.createCaller({
    user: { id: 1, username: 'admin', role: 'ADMIN', fullName: 'Admin', mustChangePassword: false, branchId: null, branchName: null, accountId: 1 },
  });
  const cashierCaller = () => appRouter.createCaller({
    user: { id: 2, username: 'cajero', role: 'CASHIER', fullName: 'Cajero', mustChangePassword: false, branchId: null, branchName: null, accountId: 1 },
  });

  beforeAll(async () => {
    mkdirSync(dir, { recursive: true });
    const sqlite = new Database(process.env.DATABASE_URL as string);
    sqlite.pragma('foreign_keys = ON');
    migrate(drizzle(sqlite), { migrationsFolder: resolve('database/migrations') });
    sqlite.exec(`
      INSERT INTO "Account" (name, nit, email, createdAt, updatedAt) VALUES ('A', '1', 'a@a.com', '${NOW}', '${NOW}');
      INSERT INTO "User" (accountId, username, password, fullName, role, active, createdAt, updatedAt) VALUES (1, 'admin', 'h', 'Admin', 'ADMIN', 1, '${NOW}', '${NOW}');
      INSERT INTO "User" (accountId, username, password, fullName, role, active, createdAt, updatedAt) VALUES (1, 'cajero', 'h', 'Cajero', 'CASHIER', 1, '${NOW}', '${NOW}');
      INSERT INTO "User" (accountId, username, password, fullName, role, active, createdAt, updatedAt) VALUES (1, 'otro', 'h', 'Otro', 'CASHIER', 1, '${NOW}', '${NOW}');
      INSERT INTO "Category" (name, color, accountId, createdAt, updatedAt) VALUES ('Cat', '#fff', 1, '${NOW}', '${NOW}');
      INSERT INTO "Product" (accountId, code, name, categoryId, price, cost, stock, taxRate, isActive, createdAt, updatedAt) VALUES (1, 'P1', 'Producto', 1, 1000, 600, 500, 0, 1, '${NOW}', '${NOW}');
      INSERT INTO "Customer" (accountId, name, phone, createdAt, updatedAt) VALUES (1, 'Cliente', '300', '${NOW}', '${NOW}');
    `);
    sqlite.close();

    sessionA = (await cashSessions.openCashSession(1, 1, 100000)).id;
    sessionB = (await cashSessions.openCashSession(1, 2, 50000)).id;

    const item = (qty: number) => [{ productId: 1, quantity: qty, unitPrice: 1000, discount: 0 }];
    // Sesión A
    await sales.createSale(sessionA, 1, item(2), [{ method: 'efectivo', amount: 5000 }], 1); // cambio 3000 → efectivo neto 2000
    await sales.createSale(sessionA, 1, item(3), [{ method: 'nequi', amount: 3000 }], 1);
    await sales.createSale(sessionA, 1, item(2), [{ method: 'efectivo', amount: 500 }], 1, 0, 0, 1, true); // fiado de 1500
    const cancelled = await sales.createSale(sessionA, 1, item(1), [{ method: 'efectivo', amount: 1000 }], 1);
    await sales.cancelSale(cancelled.id, 1, 1);
    await expenses.createExpense(sessionA, 1, 700, 'Pago de servicio — luz', 1);
    // Sesión B (otro cajero, mismo día)
    await sales.createSale(sessionB, 2, item(4), [{ method: 'efectivo', amount: 4000 }], 1);
    // Abono de 500 en efectivo a la deuda del fiado, ingresado en la sesión A
    const debt = getDatabase().select().from(schema.debts).get()!;
    await customers.payDebt(debt.id, 500, 1, null, 1, 'efectivo');
  });

  afterAll(() => {
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it('cuenta solo lo de la sesión: ventas, cobros por método y egresos', async () => {
    const overview = await adminCaller().cash.getSessionOverview({ sessionId: sessionA });
    // 2.000 + 3.000 + 2.000; la cancelada no cuenta
    expect(overview.salesCount).toBe(3);
    expect(overview.salesTotal).toBe(7000);
    expect(overview.payments).toEqual({ efectivo: 3000, nequi: 3000, credito: 1500 }); // efectivo = 2.000 neto + 500 + abono 500
    expect(overview.cashCollected).toBe(3000);
    expect(overview.creditSales).toBe(1500);
    expect(overview.expensesCount).toBe(1);
    expect(overview.expensesTotal).toBe(700);
  });

  it('la otra caja del mismo día no se mezcla', async () => {
    const overview = await cashSessions.getSessionOverview(sessionB, 1);
    expect(overview.salesCount).toBe(1);
    expect(overview.salesTotal).toBe(4000);
    expect(overview.payments).toEqual({ efectivo: 4000, credito: 0 });
    expect(overview.expectedCash).toBe(54000);
  });

  it('el efectivo esperado guardado coincide con inicial + efectivo neto − egresos', async () => {
    const overview = await cashSessions.getSessionOverview(sessionA, 1);
    expect(overview.expectedCash).toBe(100000 + 3000 - 700);
    expect(overview.computedExpectedCash).toBe(overview.expectedCash);
  });

  it('un cajero no ve la sesión de otro; otra cuenta tampoco', async () => {
    await expect(cashierCaller().cash.getSessionOverview({ sessionId: sessionA })).rejects.toThrow(/no encontrada/);
    await expect(cashierCaller().cash.getSessionOverview({ sessionId: sessionB })).resolves.toMatchObject({ salesTotal: 4000 });
    await expect(cashSessions.getSessionOverview(sessionA, 2)).rejects.toThrow(/no encontrada/);
  });

  describe('egresos por concepto', () => {
    it('guarda concepto y detalle', async () => {
      const expense = await adminCaller().cash.createExpense({ sessionId: sessionA, userId: 1, amount: 300, concept: 'Cambio dado', note: 'billete de 50' });
      expect(expense.reason).toBe('Cambio dado — billete de 50');
    });

    it('«Otro» sin detalle se rechaza con un mensaje claro', async () => {
      await expect(adminCaller().cash.createExpense({ sessionId: sessionA, userId: 1, amount: 100, concept: 'Otro' })).rejects.toThrow(/Describe el egreso/);
    });

    it('rechaza un concepto que no está en la lista', async () => {
      await expect(
        adminCaller().cash.createExpense({ sessionId: sessionA, userId: 1, amount: 100, concept: 'Inventado' as never }),
      ).rejects.toThrow();
    });

    it('sin concepto ni motivo se rechaza; el motivo libre antiguo sigue funcionando', async () => {
      await expect(adminCaller().cash.createExpense({ sessionId: sessionA, userId: 1, amount: 100 })).rejects.toThrow(/concepto/i);
      const legacy = await adminCaller().cash.createExpense({ sessionId: sessionA, userId: 1, amount: 100, reason: 'Papelería' });
      expect(legacy.reason).toBe('Papelería');
    });

    it('los egresos registrados siguen restando del esperado', async () => {
      const overview = await cashSessions.getSessionOverview(sessionA, 1);
      expect(overview.expensesTotal).toBe(700 + 300 + 100);
      expect(overview.computedExpectedCash).toBe(overview.expectedCash);
    });
  });

  describe('cierre', () => {
    it('el servidor ignora el esperado que manda el cliente y guarda el motivo en la auditoría', async () => {
      const result = await cashierCaller().cash.close({ sessionId: sessionB, finalCash: 53000, expectedCash: 1, reason: 'faltó un billete' });
      expect(result).toEqual({ finalCash: 53000, expectedCash: 54000, difference: -1000 });
      const log = getDatabase().select().from(schema.auditLogs).all().find((l) => l.action === 'cash-session:closed' && l.entityId === sessionB);
      expect(JSON.parse(log!.payload as string)).toMatchObject({ difference: -1000, reason: 'faltó un billete' });
    });

    it('el esperado del cliente es opcional', async () => {
      const third = (await cashSessions.openCashSession(1, 3, 20000)).id;
      const caller = appRouter.createCaller({
        user: { id: 3, username: 'otro', role: 'CASHIER', fullName: 'Otro', mustChangePassword: false, branchId: null, branchName: null, accountId: 1 },
      });
      await expect(caller.cash.close({ sessionId: third, finalCash: 20000 })).resolves.toMatchObject({ difference: 0 });
    });
  });

  describe('historial de cierres', () => {
    it('marca como automático el cierre por inactividad (sin conteo) y no el manual', async () => {
      await cashSessions.autoCloseInactiveSessions(0); // cierra sola la caja A, que seguía abierta
      const closures = await cashSessions.listCashClosures(1);
      const byId = new Map(closures.map((c) => [c.id, c]));
      expect(byId.get(sessionA)).toMatchObject({ autoClosed: true, finalCash: null, difference: null });
      expect(byId.get(sessionB)).toMatchObject({ autoClosed: false, finalCash: 53000, difference: -1000 });
    });
  });
});
