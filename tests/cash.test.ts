import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, mkdirSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { eq, and } from 'drizzle-orm';

const dir = join(tmpdir(), `tucajero-cash-${Date.now()}`);
const dbPath = join(dir, 'test.db');

process.env.DATABASE_URL = dbPath;

const { CustomerService } = await import('../app/main/services/customer.service');
const { CashExpenseService } = await import('../app/main/services/cash-expense.service');
const { CashSessionService } = await import('../app/main/services/cash-session.service');
const { SalesService } = await import('../app/main/services/sales.service');
const { getDatabase, schema, closeDatabase } = await import('../app/main/db');
const { ErrorCode } = await import('../app/main/utils/errors');

const customerService = new CustomerService();
const cashExpenseService = new CashExpenseService();
const cashSessionService = new CashSessionService();
const salesService = new SalesService();

let nativeDbAvailable = true;
try {
  new Database(':memory:').close();
} catch {
  nativeDbAvailable = false;
}

const serviceDescribe = nativeDbAvailable ? describe : describe.skip;

const NOW = '2026-01-01T00:00:00.000Z';

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
      VALUES ('Cuenta Test', '900000001', 'test@test.com', '${NOW}', '${NOW}');
    INSERT INTO "User" (username, password, fullName, role, active, accountId, createdAt, updatedAt)
      VALUES ('admin', 'hash', 'Admin', 'ADMIN', 1, 1, '${NOW}', '${NOW}');
    INSERT INTO "Category" (name, color, accountId, createdAt, updatedAt)
      VALUES ('Bebidas', '#ff0000', 1, '${NOW}', '${NOW}');
    INSERT INTO "Customer" (accountId, name, phone, createdAt, updatedAt)
      VALUES (1, 'Cliente Test', '3000000000', '${NOW}', '${NOW}');
    INSERT INTO "CashSession" (accountId, userId, initialCash, expectedCash, openedAt, status)
      VALUES (1, 1, 0, 0, '${NOW}', 'OPEN');
    INSERT INTO "CashSession" (accountId, userId, initialCash, expectedCash, openedAt, status)
      VALUES (1, 1, 0, 0, '${NOW}', 'OPEN');
    INSERT INTO "CashSession" (accountId, userId, initialCash, expectedCash, openedAt, status)
      VALUES (1, 1, 0, 0, '${NOW}', 'CLOSED');
    INSERT INTO "Product" (accountId, code, name, categoryId, price, cost, stock, taxRate, createdAt, updatedAt)
      VALUES (1, 'P001', 'Producto 1', 1, 1000, 600, 10, 0.19, '${NOW}', '${NOW}');
    INSERT INTO "Debt" (accountId, customerId, amount, balance, status, createdAt, updatedAt)
      VALUES (1, 1, 5000, 5000, 'PENDING', '${NOW}', '${NOW}');
    INSERT INTO "Sale" (accountId, saleNumber, userId, subtotal, tax, discount, deliveryFee, total, change, status, customerId, dianStatus, createdAt)
      VALUES (1, 'CR-0001', 1, 1000, 190, 0, 0, 1190, 0, 'COMPLETED', 1, 'PENDING', '${NOW}');
    INSERT INTO "SaleItem" (saleId, productId, quantity, unitPrice, taxRate, subtotal, discount, total, unitType)
      VALUES (1, 1, 1, 1000, 0.19, 1000, 0, 1190, 'UNIT');
    INSERT INTO "Debt" (accountId, customerId, saleId, amount, balance, status, createdAt, updatedAt)
      VALUES (1, 1, 1, 1190, 1190, 'PENDING', '${NOW}', '${NOW}');
    INSERT INTO "Sale" (accountId, saleNumber, userId, subtotal, tax, discount, deliveryFee, total, change, status, customerId, dianStatus, createdAt)
      VALUES (1, 'CR-0002', 1, 500, 95, 0, 0, 595, 0, 'COMPLETED', 1, 'PENDING', '${NOW}');
    INSERT INTO "SaleItem" (saleId, productId, quantity, unitPrice, taxRate, subtotal, discount, total, unitType)
      VALUES (2, 1, 1, 500, 0.19, 500, 0, 595, 'UNIT');
    INSERT INTO "Debt" (accountId, customerId, saleId, amount, balance, status, createdAt, updatedAt)
      VALUES (1, 1, 2, 595, 595, 'PENDING', '${NOW}', '${NOW}');
    INSERT INTO "Payment" (saleId, method, amount, createdAt)
      VALUES (1, 'credito', 1190, '${NOW}');
    INSERT INTO "Payment" (debtId, method, amount, createdAt)
      VALUES (3, 'efectivo', 300, '${NOW}');
  `);
  sqlite.close();
}

serviceDescribe('Bloque A: caja y deudas', () => {
  beforeAll(() => {
    createDatabase();
  });

  afterAll(() => {
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it('payDebt resuelve la caja OPEN y suma a expectedCash', async () => {
    const paid = await customerService.payDebt(1, 2000, 1, null, 1, 'efectivo');
    expect(paid.balance).toBe(3000);
    expect(paid.status).toBe('PENDING');

    const db = getDatabase();
    const session = db
      .select({ expectedCash: schema.cashSessions.expectedCash })
      .from(schema.cashSessions)
      .where(eq(schema.cashSessions.id, 1))
      .get();
    expect(session?.expectedCash).toBe(2000);

    const payment = db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.debtId, 1))
      .get();
    expect(payment?.cashSessionId).toBe(1);
    expect(payment?.method).toBe('efectivo');
    expect(payment?.amount).toBe(2000);
  });

  it('payDebt rechaza una sesión de caja cerrada', async () => {
    await expect(customerService.payDebt(1, 500, 1, 3, 1, 'efectivo')).rejects.toMatchObject({
      code: ErrorCode.NO_OPEN_SESSION,
    });
  });

  it('payDebt sin caja abierta lanza NO_OPEN_SESSION', async () => {
    const db = getDatabase();
    db.update(schema.cashSessions)
      .set({ status: 'CLOSED' })
      .where(eq(schema.cashSessions.status, 'OPEN'))
      .run();

    await expect(customerService.payDebt(1, 500, 1, null, 1, 'efectivo')).rejects.toMatchObject({
      code: ErrorCode.NO_OPEN_SESSION,
    });

    // Restaurar la caja 1 para no afectar los tests siguientes.
    db.update(schema.cashSessions)
      .set({ status: 'OPEN' })
      .where(eq(schema.cashSessions.id, 1))
      .run();
  });

  it('payDebt con abono no efectivo no altera expectedCash', async () => {
    const paid = await customerService.payDebt(1, 1000, 1, 1, 1, 'nequi');
    expect(paid.balance).toBe(2000);

    const db = getDatabase();
    const session = db
      .select({ expectedCash: schema.cashSessions.expectedCash })
      .from(schema.cashSessions)
      .where(eq(schema.cashSessions.id, 1))
      .get();
    expect(session?.expectedCash).toBe(2000);
  });

  it('createExpense descuenta expectedCash de la sesión', async () => {
    const db = getDatabase();
    const before = db
      .select({ expectedCash: schema.cashSessions.expectedCash })
      .from(schema.cashSessions)
      .where(eq(schema.cashSessions.id, 1))
      .get();

    await cashExpenseService.createExpense(1, 1, 500, 'Flete de mercancía', 1);

    const after = db
      .select({ expectedCash: schema.cashSessions.expectedCash })
      .from(schema.cashSessions)
      .where(eq(schema.cashSessions.id, 1))
      .get();
    expect(after?.expectedCash).toBe((before?.expectedCash ?? 0) - 500);
  });

  it('closeCashSession usa el expectedCash almacenado, no el del cliente', async () => {
    const session = await cashSessionService.closeCashSession(1, 99999, 99999, 1, 1, 'cierre de prueba');
    expect(session.expectedCash).not.toBe(99999);
    expect(session.difference).toBe(99999 - (session.expectedCash ?? 0));
  });
});

serviceDescribe('Bloque C: cancelación de venta con deuda', () => {
  beforeAll(() => {
    createDatabase();
  });

  afterAll(() => {
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it('cancela y elimina la deuda PENDING sin abonos', async () => {
    await salesService.cancelSale(1, 1, 1);

    const db = getDatabase();
    const debt = db
      .select()
      .from(schema.debts)
      .where(eq(schema.debts.id, 2))
      .get();
    expect(debt).toBeUndefined();

    const creditLeg = db
      .select()
      .from(schema.payments)
      .where(and(eq(schema.payments.saleId, 1), eq(schema.payments.method, 'credito')))
      .get();
    expect(creditLeg).toBeUndefined();

    const sale = db
      .select({ status: schema.sales.status })
      .from(schema.sales)
      .where(eq(schema.sales.id, 1))
      .get();
    expect(sale?.status).toBe('CANCELLED');

    const product = db
      .select({ stock: schema.products.stock })
      .from(schema.products)
      .where(eq(schema.products.id, 1))
      .get();
    expect(product?.stock).toBe(11);
  });

  it('bloquea la cancelación si la deuda tiene abonos', async () => {
    await expect(salesService.cancelSale(2, 1, 1)).rejects.toMatchObject({
      code: ErrorCode.VALIDATION,
    });

    const db = getDatabase();
    const sale = db
      .select({ status: schema.sales.status })
      .from(schema.sales)
      .where(eq(schema.sales.id, 2))
      .get();
    expect(sale?.status).toBe('COMPLETED');
  });
});

serviceDescribe('Bloque D: aislamiento de sesión y ownership', () => {
  beforeAll(() => {
    createDatabase();
  });

  afterAll(() => {
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it('getCashSessionSummary rechaza sessionId de otra cuenta', async () => {
    const db = getDatabase();

    db.insert(schema.accounts)
      .values({ name: 'Cuenta B', nit: '99999', email: 'b@test.com', createdAt: NOW, updatedAt: NOW })
      .run();

    db.insert(schema.users)
      .values({ username: 'other', password: 'hash', fullName: 'Other', role: 'ADMIN', active: true, accountId: 2, createdAt: NOW, updatedAt: NOW })
      .run();

    const foreignSessionRows = db.insert(schema.cashSessions)
      .values({ accountId: 2, userId: 2, initialCash: 50000, status: 'OPEN', openedAt: NOW })
      .returning()
      .all();
    const foreignSession = foreignSessionRows[0];

    await expect(cashSessionService.getCashSessionSummary(foreignSession.id, 1))
      .rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it('getCashSessionSummary funciona con accountId correcto', async () => {
    const summary = await cashSessionService.getCashSessionSummary(1, 1);
    expect(summary).toBeDefined();
    expect(typeof summary.total).toBe('number');
  });

  it('closeCashSession requiere userId — no se puede cerrar caja ajena', async () => {
    const db = getDatabase();

    db.insert(schema.cashSessions)
      .values({ accountId: 1, userId: 2, initialCash: 10000, status: 'OPEN', openedAt: NOW })
      .run();

    const [otherSession] = db.select({ id: schema.cashSessions.id })
      .from(schema.cashSessions)
      .where(and(eq(schema.cashSessions.userId, 2), eq(schema.cashSessions.status, 'OPEN')))
      .limit(1)
      .all();

    await expect(
      cashSessionService.closeCashSession(otherSession.id, 0, 0, 1, 1),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });
});
