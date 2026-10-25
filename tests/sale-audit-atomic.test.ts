import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const dir = join(tmpdir(), `tucajero-sale-audit-${Date.now()}`);
process.env.DATABASE_URL = join(dir, 'test.db');
process.env.TUCAJERO_BACKUP_DIR = join(dir, 'backups');

const { CashSessionService } = await import('../app/main/services/cash-session.service');
const { SalesService } = await import('../app/main/services/sales.service');
const { AuditService } = await import('../app/main/services/audit.service');
const { getDatabase, schema, closeDatabase } = await import('../app/main/db');
const { eq, and } = await import('drizzle-orm');

let nativeDbAvailable = true;
try {
  new Database(':memory:').close();
} catch {
  nativeDbAvailable = false;
}
const serviceDescribe = nativeDbAvailable ? describe : describe.skip;

const NOW = '2026-01-01T00:00:00.000Z';

serviceDescribe('la auditoría de una venta se guarda junto con la venta', () => {
  const cashSessions = new CashSessionService();
  const sales = new SalesService();
  let session = 0;

  const line = [{ productId: 1, quantity: 2, unitPrice: 1000, discount: 0 }];
  const pay = [{ method: 'efectivo', amount: 2000 }];
  const stock = (): number => getDatabase().select().from(schema.products).where(eq(schema.products.id, 1)).get()!.stock;
  const expectedCash = (): number => getDatabase().select().from(schema.cashSessions).where(eq(schema.cashSessions.id, session)).get()!.expectedCash!;
  const saleCount = (): number => getDatabase().select().from(schema.sales).all().length;
  const audits = (action: string) => getDatabase().select().from(schema.auditLogs).where(eq(schema.auditLogs.action, action)).all();

  beforeAll(async () => {
    mkdirSync(dir, { recursive: true });
    const sqlite = new Database(process.env.DATABASE_URL as string);
    sqlite.pragma('foreign_keys = ON');
    migrate(drizzle(sqlite), { migrationsFolder: resolve('database/migrations') });
    sqlite.exec(`
      INSERT INTO "Account" (name, nit, email, createdAt, updatedAt) VALUES ('A', '1', 'a@a.com', '${NOW}', '${NOW}');
      INSERT INTO "User" (accountId, username, password, fullName, role, active, createdAt, updatedAt) VALUES (1, 'admin', 'h', 'Admin', 'ADMIN', 1, '${NOW}', '${NOW}');
      INSERT INTO "Category" (name, color, accountId, createdAt, updatedAt) VALUES ('Cat', '#fff', 1, '${NOW}', '${NOW}');
      INSERT INTO "Product" (accountId, code, name, categoryId, price, cost, stock, taxRate, isActive, createdAt, updatedAt) VALUES (1, 'P1', 'Producto 1', 1, 1000, 600, 100, 0, 1, '${NOW}', '${NOW}');
    `);
    sqlite.close();
    session = (await cashSessions.openCashSession(1, 1, 10000)).id;
  });

  afterAll(() => {
    vi.restoreAllMocks();
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it('una venta normal deja su registro de auditoría con la cuenta y el detalle', async () => {
    const sale = await sales.createSale(session, 1, line, pay, 1);
    const [entry] = audits('sale:created');
    expect(entry).toMatchObject({ accountId: 1, userId: 1, entity: 'Sale', entityId: sale.id });
    expect(JSON.parse(entry.payload as string)).toMatchObject({ saleNumber: sale.saleNumber, total: 2000, items: 1 });
  });

  it('si no se puede guardar la auditoría, la venta completa se deshace (ni venta, ni stock, ni caja)', async () => {
    const before = { sales: saleCount(), stock: stock(), cash: expectedCash(), audits: audits('sale:created').length };
    const spy = vi.spyOn(AuditService.prototype, 'logInTransaction').mockImplementation(() => {
      throw new Error('disco lleno');
    });

    await expect(sales.createSale(session, 1, line, pay, 1)).rejects.toThrow(/disco lleno/);
    spy.mockRestore();

    expect({ sales: saleCount(), stock: stock(), cash: expectedCash(), audits: audits('sale:created').length }).toEqual(before);
  });

  it('anular una venta guarda su auditoría en la misma transacción', async () => {
    const sale = await sales.createSale(session, 1, line, pay, 1);
    await sales.cancelSale(sale.id, 1, 1);
    const entries = getDatabase()
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.action, 'sale:cancelled'), eq(schema.auditLogs.entityId, sale.id)))
      .all();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ accountId: 1, userId: 1 });
  });

  it('si no se puede guardar la auditoría de la anulación, la venta sigue vigente con su stock y su caja', async () => {
    const sale = await sales.createSale(session, 1, line, pay, 1);
    const before = { stock: stock(), cash: expectedCash() };
    const spy = vi.spyOn(AuditService.prototype, 'logInTransaction').mockImplementation(() => {
      throw new Error('disco lleno');
    });

    await expect(sales.cancelSale(sale.id, 1, 1)).rejects.toThrow(/disco lleno/);
    spy.mockRestore();

    const row = getDatabase().select().from(schema.sales).where(eq(schema.sales.id, sale.id)).get()!;
    expect(row.status).toBe('COMPLETED');
    expect({ stock: stock(), cash: expectedCash() }).toEqual(before);
    // y se puede anular normalmente después
    await sales.cancelSale(sale.id, 1, 1);
    expect(getDatabase().select().from(schema.sales).where(eq(schema.sales.id, sale.id)).get()!.status).toBe('CANCELLED');
  });
});
