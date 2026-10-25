import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dir = join(tmpdir(), `tucajero-cash-reconcile-${Date.now()}`);
process.env.DATABASE_URL = join(dir, 'test.db');
process.env.TUCAJERO_BACKUP_DIR = join(dir, 'backups');

const { appRouter } = await import('../app/main/router/index');
const { CashSessionService } = await import('../app/main/services/cash-session.service');
const { SalesService } = await import('../app/main/services/sales.service');
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

serviceDescribe('conciliación de cierres automáticos', () => {
  const cashSessions = new CashSessionService();
  const sales = new SalesService();

  const caller = (id: number, role: 'ADMIN' | 'SUPERVISOR' | 'CASHIER', accountId = 1) => appRouter.createCaller({
    user: { id, username: `u${id}`, role, fullName: `U${id}`, mustChangePassword: false, branchId: null, branchName: null, accountId },
  });
  const row = (id: number) => getDatabase().select().from(schema.cashSessions).where(eq(schema.cashSessions.id, id)).get()!;
  const auditOf = (id: number, action: string) =>
    getDatabase().select().from(schema.auditLogs).all().filter((l) => l.action === action && l.entityId === id);

  let autoClosed = 0; // cerrada sola, con 10.000 de base + 5.000 de venta en efectivo = 15.000 esperados
  let manual = 0;
  let stillOpen = 0;

  beforeAll(async () => {
    mkdirSync(dir, { recursive: true });
    const sqlite = new Database(process.env.DATABASE_URL as string);
    sqlite.pragma('foreign_keys = ON');
    migrate(drizzle(sqlite), { migrationsFolder: resolve('database/migrations') });
    sqlite.exec(`
      INSERT INTO "Account" (name, nit, email, createdAt, updatedAt) VALUES ('A', '1', 'a@a.com', '${NOW}', '${NOW}');
      INSERT INTO "Account" (name, nit, email, createdAt, updatedAt) VALUES ('B', '2', 'b@b.com', '${NOW}', '${NOW}');
      INSERT INTO "User" (accountId, username, password, fullName, role, active, createdAt, updatedAt) VALUES (1, 'admin', 'h', 'Admin', 'ADMIN', 1, '${NOW}', '${NOW}');
      INSERT INTO "User" (accountId, username, password, fullName, role, active, createdAt, updatedAt) VALUES (1, 'cajero', 'h', 'Cajero', 'CASHIER', 1, '${NOW}', '${NOW}');
      INSERT INTO "User" (accountId, username, password, fullName, role, active, createdAt, updatedAt) VALUES (1, 'otro', 'h', 'Otro', 'CASHIER', 1, '${NOW}', '${NOW}');
      INSERT INTO "User" (accountId, username, password, fullName, role, active, createdAt, updatedAt) VALUES (2, 'admin-b', 'h', 'Admin B', 'ADMIN', 1, '${NOW}', '${NOW}');
      INSERT INTO "Category" (name, color, accountId, createdAt, updatedAt) VALUES ('Cat', '#fff', 1, '${NOW}', '${NOW}');
      INSERT INTO "Product" (accountId, code, name, categoryId, price, cost, stock, taxRate, isActive, createdAt, updatedAt) VALUES (1, 'P1', 'Producto', 1, 5000, 3000, 100, 0, 1, '${NOW}', '${NOW}');
    `);
    sqlite.close();

    autoClosed = (await cashSessions.openCashSession(1, 2, 10000)).id;
    await sales.createSale(autoClosed, 2, [{ productId: 1, quantity: 1, unitPrice: 5000, discount: 0 }], [{ method: 'efectivo', amount: 5000 }], 1);
    await cashSessions.autoCloseInactiveSessions(0);

    manual = (await cashSessions.openCashSession(1, 2, 20000)).id;
    await cashSessions.closeCashSession(manual, 20000, 0, 1, 2);
    stillOpen = (await cashSessions.openCashSession(1, 3, 1000)).id;
  });

  afterAll(() => {
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it('el cierre automático queda pendiente de conciliar, y el manual y la caja abierta no', async () => {
    const byId = new Map((await cashSessions.listCashClosures(1)).map((c) => [c.id, c]));
    expect(byId.get(autoClosed)).toMatchObject({ autoClosed: true, pendingReconciliation: true, finalCash: null });
    expect(byId.get(manual)).toMatchObject({ autoClosed: false, pendingReconciliation: false });
    expect(byId.has(stillOpen)).toBe(false);
  });

  it('un cajero no puede conciliar', async () => {
    await expect(caller(2, 'CASHIER').cash.reconcile({ sessionId: autoClosed, countedCash: 15000 })).rejects.toThrow();
    expect(row(autoClosed).finalCash).toBeNull();
  });

  it('no se concilia la caja de otra cuenta, ni una abierta, ni una cerrada con conteo', async () => {
    await expect(caller(4, 'ADMIN', 2).cash.reconcile({ sessionId: autoClosed, countedCash: 1 })).rejects.toThrow(/No existe un cierre/);
    await expect(caller(1, 'ADMIN').cash.reconcile({ sessionId: stillOpen, countedCash: 1 })).rejects.toThrow(/No existe un cierre/);
    await expect(caller(1, 'ADMIN').cash.reconcile({ sessionId: manual, countedCash: 20000 })).rejects.toThrow(/ya tiene conteo/);
    expect(row(manual).finalCash).toBe(20000);
  });

  it('rechaza un conteo negativo', async () => {
    await expect(caller(1, 'ADMIN').cash.reconcile({ sessionId: autoClosed, countedCash: -5 })).rejects.toThrow();
    expect(row(autoClosed).finalCash).toBeNull();
  });

  it('el administrador concilia: guarda lo contado, la diferencia y quién lo hizo', async () => {
    const result = await caller(1, 'ADMIN').cash.reconcile({ sessionId: autoClosed, countedCash: 14500, note: 'faltó un billete' });
    expect(result).toEqual({ finalCash: 14500, expectedCash: 15000, difference: -500 });
    expect(row(autoClosed)).toMatchObject({ status: 'CLOSED', finalCash: 14500, expectedCash: 15000, difference: -500 });

    const [entry] = auditOf(autoClosed, 'cash-session:reconciled');
    expect(entry).toMatchObject({ accountId: 1, userId: 1, entity: 'CashSession' });
    expect(JSON.parse(entry.payload as string)).toEqual({ cashierId: 2, countedCash: 14500, expectedCash: 15000, difference: -500, note: 'faltó un billete' });
  });

  it('conciliada deja de estar pendiente pero sigue marcada como cierre automático', async () => {
    const closure = (await cashSessions.listCashClosures(1)).find((c) => c.id === autoClosed)!;
    expect(closure).toMatchObject({ autoClosed: true, pendingReconciliation: false, finalCash: 14500, difference: -500 });
  });

  it('solo se concilia una vez, aunque lo intenten dos a la vez', async () => {
    await expect(caller(1, 'ADMIN').cash.reconcile({ sessionId: autoClosed, countedCash: 15000 })).rejects.toThrow(/ya tiene conteo/);
    expect(row(autoClosed).finalCash).toBe(14500);
    expect(auditOf(autoClosed, 'cash-session:reconciled')).toHaveLength(1);

    await cashSessions.closeCashSession(stillOpen, 1000, 0, 1, 3);
    const second = (await cashSessions.openCashSession(1, 3, 3000)).id;
    await new Promise((r) => setTimeout(r, 5));
    await cashSessions.autoCloseInactiveSessions(0); // cierra `second` sola
    const results = await Promise.allSettled([
      caller(1, 'ADMIN').cash.reconcile({ sessionId: second, countedCash: 3000 }),
      caller(1, 'SUPERVISOR').cash.reconcile({ sessionId: second, countedCash: 2000 }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(auditOf(second, 'cash-session:reconciled')).toHaveLength(1);
  });

  it('si no se puede guardar la auditoría, el conteo tampoco se guarda', async () => {
    const third = (await cashSessions.openCashSession(1, 2, 700)).id;
    await new Promise((r) => setTimeout(r, 5));
    await cashSessions.autoCloseInactiveSessions(0);
    const sqlite = new Database(process.env.DATABASE_URL as string);
    sqlite.exec('CREATE TRIGGER fail_audit BEFORE INSERT ON "AuditLog" WHEN NEW.action = \'cash-session:reconciled\' BEGIN SELECT RAISE(ABORT, \'auditoria no disponible\'); END;');
    try {
      await expect(caller(1, 'ADMIN').cash.reconcile({ sessionId: third, countedCash: 700 })).rejects.toThrow(/auditoria no disponible/);
      expect(row(third).finalCash).toBeNull();
    } finally {
      sqlite.exec('DROP TRIGGER fail_audit');
      sqlite.close();
    }
  });
});
