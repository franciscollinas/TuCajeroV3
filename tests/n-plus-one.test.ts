import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dir = join(tmpdir(), `tucajero-nplus1-${Date.now()}`);
process.env.DATABASE_URL = join(dir, 'test.db');
process.env.TUCAJERO_BACKUP_DIR = join(dir, 'backups');

const { PurchaseService } = await import('../app/main/services/purchase.service');
const { CustomerService } = await import('../app/main/services/customer.service');
const { SalesService } = await import('../app/main/services/sales.service');
const { CashSessionService } = await import('../app/main/services/cash-session.service');
const { closeDatabase } = await import('../app/main/db');

let nativeDbAvailable = true;
try {
  new Database(':memory:').close();
} catch {
  nativeDbAvailable = false;
}
const serviceDescribe = nativeDbAvailable ? describe : describe.skip;

const NOW = '2026-01-01T00:00:00.000Z';

serviceDescribe('consultas que antes hacían una búsqueda por fila', () => {
  let sqlite: Database.Database;

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
      INSERT INTO "Product" (accountId, code, name, categoryId, price, cost, stock, taxRate, isActive, createdAt, updatedAt) VALUES (1, 'P1', 'Producto', 1, 1000, 600, 1000, 0, 1, '${NOW}', '${NOW}');
      INSERT INTO "Customer" (accountId, name, phone, createdAt, updatedAt) VALUES (1, 'Cliente Uno', '300', '${NOW}', '${NOW}');
      INSERT INTO "Supplier" (accountId, name, phone, leadTimeDays, isActive, createdAt, updatedAt) VALUES (1, 'Proveedor A', '1', 7, 1, '${NOW}', '${NOW}');
      INSERT INTO "Supplier" (accountId, name, phone, leadTimeDays, isActive, createdAt, updatedAt) VALUES (1, 'Proveedor B', '2', 7, 1, '${NOW}', '${NOW}');
      INSERT INTO "Supplier" (accountId, name, phone, leadTimeDays, isActive, createdAt, updatedAt) VALUES (2, 'Proveedor Otra Cuenta', '3', 7, 1, '${NOW}', '${NOW}');
    `);
    const order = (n: string, supplier: number, status: string, total: number, account = 1): string =>
      `INSERT INTO "PurchaseOrder" (accountId, orderNumber, supplierId, status, subtotal, tax, freight, total, userId, createdAt, updatedAt) VALUES (${account}, '${n}', ${supplier}, '${status}', ${total}, 0, 0, ${total}, 1, '${NOW}', '${NOW}');`;
    setup.exec(`
      ${order('OC-1', 1, 'DRAFT', 100)}
      ${order('OC-2', 1, 'RECEIVED', 300)}
      ${order('OC-3', 2, 'SENT', 50)}
      ${order('OC-4', 2, 'CANCELLED', 25)}
      ${order('OC-5', 3, 'CONFIRMED', 999, 2)}
    `);
    setup.close();
    sqlite = new Database(process.env.DATABASE_URL as string);

    // Cliente 1: dos ventas, una deuda pendiente con venta, otra sin venta y una ya pagada.
    const session = (await new CashSessionService().openCashSession(1, 1, 0)).id;
    const sales = new SalesService();
    for (let i = 0; i < 2; i++) {
      await sales.createSale(session, 1, [{ productId: 1, quantity: 1, unitPrice: 1000, discount: 0 }], [{ method: 'efectivo', amount: 1000 }], 1, 0, 0, 1);
    }
    const saleId = (sqlite.prepare('select id from "Sale" order by id limit 1').get() as { id: number }).id;
    sqlite.exec(`
      INSERT INTO "Debt" (accountId, customerId, saleId, amount, balance, status, createdAt, updatedAt) VALUES (1, 1, ${saleId}, 5000, 3000, 'PENDING', '2026-02-01T00:00:00.000Z', '${NOW}');
      INSERT INTO "Debt" (accountId, customerId, saleId, amount, balance, status, createdAt, updatedAt) VALUES (1, 1, NULL, 700, 700, 'PENDING', '2026-03-01T00:00:00.000Z', '${NOW}');
      INSERT INTO "Debt" (accountId, customerId, saleId, amount, balance, status, createdAt, updatedAt) VALUES (1, 1, ${saleId}, 900, 0, 'PAID', '2026-01-15T00:00:00.000Z', '${NOW}');
    `);
  });

  afterAll(() => {
    sqlite.close();
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('resumen de compras', () => {
    it('cuenta pedidos, valor, pendientes y recibidos de la cuenta', async () => {
      const summary = await new PurchaseService().getPurchaseSummary(1);
      expect(summary).toMatchObject({ totalOrders: 4, totalValue: 475, pendingOrders: 2, receivedOrders: 1 });
    });

    it('agrupa por proveedor con su nombre, sin mezclar otras cuentas', async () => {
      const { ordersBySupplier } = await new PurchaseService().getPurchaseSummary(1);
      const sorted = [...ordersBySupplier].sort((a, b) => a.supplierId - b.supplierId);
      expect(sorted).toEqual([
        { supplierId: 1, supplierName: 'Proveedor A', orderCount: 2, totalValue: 400 },
        { supplierId: 2, supplierName: 'Proveedor B', orderCount: 2, totalValue: 75 },
      ]);
    });

    it('sin pedidos devuelve ceros y lista vacía', async () => {
      const summary = await new PurchaseService().getPurchaseSummary(999);
      expect(summary).toMatchObject({ totalOrders: 0, totalValue: 0, pendingOrders: 0, receivedOrders: 0, ordersBySupplier: [] });
    });
  });

  describe('historial de cliente', () => {
    it('trae el cliente, sus ventas (más recientes primero) y solo las deudas pendientes', async () => {
      const history = await new CustomerService().getCustomerHistory(1, 1);
      expect(history.customer.name).toBe('Cliente Uno');
      expect(history.sales).toHaveLength(2);
      expect(history.debts).toHaveLength(2);
      // más recientes primero
      expect(history.debts.map((d) => d.amount)).toEqual([700, 5000]);
    });

    it('cada deuda lleva el número de su venta (o nada si no tiene) y el nombre del cliente', async () => {
      const history = await new CustomerService().getCustomerHistory(1, 1);
      const withSale = history.debts.find((d) => d.amount === 5000)!;
      const withoutSale = history.debts.find((d) => d.amount === 700)!;
      expect(withSale.saleNumber).toMatch(/^V-\d{4}-\d{4,}$/);
      expect(withSale.balance).toBe(3000);
      expect(withoutSale.saleNumber).toBeUndefined();
      expect(history.debts.every((d) => d.customerName === 'Cliente Uno')).toBe(true);
    });

    it('un cliente de otra cuenta o inexistente da «no encontrado»', async () => {
      await expect(new CustomerService().getCustomerHistory(1, 2)).rejects.toThrow(/no encontrado/i);
      await expect(new CustomerService().getCustomerHistory(777, 1)).rejects.toThrow(/no encontrado/i);
    });
  });
});
