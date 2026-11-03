import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Base de V2 realista (la que usa un cliente real): creada con Prisma, fechas como NÚMEROS (milisegundos),
// sin tabla de egresos de caja, con un conteo de caja mal tecleado. Se prueba que V3 la importe completa.
const dir = join(tmpdir(), `tucajero-v2-prisma-${Date.now()}`);
const v2Path = join(dir, 'v2', 'tucajero.db');
const v3Path = join(dir, 'v3', 'tucajero.db');
mkdirSync(join(dir, 'v2'), { recursive: true });
mkdirSync(join(dir, 'v3'), { recursive: true });
process.env.V2_DATABASE_PATH = v2Path;
process.env.DATABASE_URL = v3Path;
process.env.TUCAJERO_BACKUP_DIR = join(dir, 'respaldos');

const { MigrationService } = await import('../app/main/services/migration.service');
const { ensureBootstrap } = await import('../app/main/services/bootstrap.service');
const { SalesService } = await import('../app/main/services/sales.service');
const { ReportsService } = await import('../app/main/services/reports.service');
const { CashSessionService } = await import('../app/main/services/cash-session.service');
const { InventoryService } = await import('../app/main/services/inventory.service');
const { getDatabase, closeDatabase } = await import('../app/main/db');

let nativeDbAvailable = true;
try {
  new Database(':memory:').close();
} catch {
  nativeDbAvailable = false;
}
const serviceDescribe = nativeDbAvailable ? describe : describe.skip;

const DAY = 24 * 3600 * 1000;
const at = (iso: string): number => new Date(iso).getTime();

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Crea la base de V2 con la estructura real (fixture) y datos inventados. */
function buildV2(): void {
  rmSync(v2Path, { force: true });
  const sqlite = new Database(v2Path);
  sqlite.exec(readFileSync(join(__dirname, 'fixtures', 'v2-prisma-schema.sql'), 'utf8'));
  const run = (sql: string, ...params: unknown[]): void => { sqlite.prepare(sql).run(...params); };

  run('INSERT INTO "User" (id, username, password, fullName, role, active, mustChangePassword, failedLoginAttempts, createdAt, updatedAt) VALUES (21, ?, ?, ?, ?, 1, 1, 0, ?, ?)',
    'admin', '$2a$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ0123456', 'Administrador', 'ADMIN', at('2026-04-24T19:00:00Z'), at('2026-04-24T19:00:00Z'));
  run('INSERT INTO "Category" (id, name, color, createdAt, updatedAt) VALUES (1, ?, ?, ?, ?)', 'Medicamentos', '#00ff00', at('2026-04-24T19:00:00Z'), at('2026-04-24T19:00:00Z'));
  run('INSERT INTO "Category" (id, name, color, createdAt, updatedAt) VALUES (2, ?, ?, ?, ?)', 'Bebidas', '#0000ff', at('2026-04-24T19:00:00Z'), at('2026-04-24T19:00:00Z'));

  const product = (id: number, code: string, name: string, cat: number, price: number, cost: number, stock: number, expiry: number | null): void => {
    run('INSERT INTO "Product" (id, code, barcode, name, categoryId, price, cost, stock, minStock, criticalStock, taxRate, expiryDate, unitType, conversionFactor, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 10, 3, 0, ?, ?, 1, 1, ?, ?)',
      id, code, `770${id}`, name, cat, price, cost, stock, expiry, 'UND', at('2026-04-24T19:00:00Z'), at('2026-04-24T19:00:00Z'));
  };
  product(1, 'ACE', 'Acetaminofén 500mg', 1, 1500, 900, 100, at('2026-02-01T00:00:00Z')); // vencido
  product(2, 'IBU', 'Ibuprofeno 400mg', 1, 2500, 1500, 40, Date.now() + 10 * DAY - (Date.now() % DAY)); // vence en 10 días
  product(3, 'AGU', 'Agua 600ml', 2, 2000, 1200, 6, 33450364800000); // «sin vencimiento»: año 3030
  product(4, 'COC', 'Coca Cola 1.5L', 2, 7000, 5000, 0, null);

  run('INSERT INTO "Customer" (id, document, name, isActive, createdAt, updatedAt) VALUES (1, ?, ?, 1, ?, ?)', '1043000079', 'Cliente Uno', at('2026-07-02T17:00:00Z'), at('2026-07-02T17:00:00Z'));

  const session = (id: number, opened: string, closed: string | null, initial: number, final: number | null, expected: number | null, diff: number | null, status: string): void => {
    run('INSERT INTO "CashSession" (id, userId, initialCash, finalCash, expectedCash, difference, openedAt, closedAt, status) VALUES (?, 21, ?, ?, ?, ?, ?, ?, ?)',
      id, initial, final, expected, diff, at(opened), closed ? at(closed) : null, status);
  };
  session(1, '2026-10-01T12:00:00Z', '2026-10-01T22:00:00Z', 40000, 46500, 46500, 0, 'CLOSED');
  session(2, '2026-10-02T12:00:00Z', '2026-10-02T22:00:00Z', 40000, 48000, 49000, -1000, 'CLOSED');
  session(3, '2026-10-03T12:00:00Z', '2026-10-03T22:00:00Z', 40000, 1.331e55, 133100, 1.331e55, 'CLOSED'); // conteo mal tecleado
  session(4, '2026-10-31T12:00:00Z', null, 40000, null, 71000, null, 'OPEN');

  const sale = (id: number, number: string, cash: number, iso: string, total: number, status: string, change: number): void => {
    run('INSERT INTO "Sale" (id, receiptNumber, userId, cashSessionId, subtotal, taxAmount, discount, deliveryFee, total, status, createdAt, "change") VALUES (?, ?, 21, ?, ?, 0, 0, 0, ?, ?, ?, ?)',
      id, number, cash, total, total, status, at(iso), change);
  };
  sale(1, 'V-2026-0001', 1, '2026-10-01T15:00:00Z', 6500, 'COMPLETED', 500);
  sale(2, 'V-2026-0002', 2, '2026-10-02T15:00:00Z', 9000, 'COMPLETED', 0);
  sale(3, 'V-2026-0003', 3, '2026-10-03T15:00:00Z', 3500, 'CANCELLED', 0);
  sale(4, 'V-2026-0004', 3, '2026-10-03T16:00:00Z', 7000, 'COMPLETED', 0);
  const item = (saleId: number, productId: number, qty: number, price: number): void => {
    run('INSERT INTO "SaleItem" (saleId, productId, quantity, unitPrice, taxRate, subtotal, discount, total, unitType) VALUES (?, ?, ?, ?, 0, ?, 0, ?, ?)', saleId, productId, qty, price, qty * price, qty * price, 'UND');
  };
  item(1, 1, 2, 1500); item(1, 2, 1, 2500); item(1, 3, 0.5 * 2, 2000 / 2 * 1); item(2, 4, 1, 7000); item(2, 3, 1, 2000); item(3, 1, 1, 1500); item(3, 3, 1, 2000); item(4, 4, 1, 7000);
  run('INSERT INTO "Payment" (saleId, cashSessionId, method, amount, createdAt) VALUES (1, 1, ?, 7000, ?)', 'efectivo', at('2026-10-01T15:00:00Z'));
  run('INSERT INTO "Payment" (saleId, cashSessionId, method, amount, createdAt) VALUES (2, 2, ?, 9000, ?)', 'nequi', at('2026-10-02T15:00:00Z'));
  run('INSERT INTO "Payment" (saleId, cashSessionId, method, amount, createdAt) VALUES (3, 3, ?, 3500, ?)', 'efectivo', at('2026-10-03T15:00:00Z'));
  run('INSERT INTO "Payment" (saleId, cashSessionId, method, amount, createdAt) VALUES (4, 3, ?, 7000, ?)', 'credito', at('2026-10-03T16:00:00Z'));
  run('INSERT INTO "Debt" (id, customerId, saleId, amount, balance, status, createdAt, updatedAt) VALUES (1, 1, 4, 7000, 0, ?, ?, ?)', 'PAID', at('2026-10-03T16:00:00Z'), at('2026-10-05T16:00:00Z'));
  run('INSERT INTO "Payment" (debtId, cashSessionId, method, amount, createdAt) VALUES (1, 3, ?, 7000, ?)', 'nequi', at('2026-10-05T16:00:00Z'));
  run('INSERT INTO "StockMovement" (productId, type, quantity, previousStock, newStock, reason, userId, createdAt) VALUES (1, ?, 2, 102, 100, ?, 21, ?)', 'venta', 'Venta V-2026-0001', at('2026-10-01T15:00:00Z'));
  run('INSERT INTO "AuditLog" (userId, action, entity, entityId, payload, createdAt) VALUES (21, ?, ?, 1, ?, ?)', 'sale:created', 'Sale', '{}', at('2026-10-01T15:00:00Z'));
  for (const [key, value] of [['businessName', 'DROGUERIA DE PRUEBA'], ['nit', '900123456-7'], ['email', 'prueba@correo.com'], ['phone', '3001112233'], ['address', 'CALLE 1 # 2-3'], ['logo', 'data:image/png;base64,AAAA'], ['first_run_at', '2026-04-24T19:00:03.910Z']]) {
    run('INSERT INTO "Config" (key, value, updatedAt) VALUES (?, ?, ?)', key, value, at('2026-04-24T19:00:00Z'));
  }
  sqlite.close();
}

/** Deja la base de V3 como queda tras instalarla y abrirla por primera vez: vacía, con los usuarios de fábrica. */
async function freshV3(): Promise<void> {
  closeDatabase();
  for (const suffix of ['', '-wal', '-shm']) rmSync(v3Path + suffix, { force: true });
  getDatabase();
  await ensureBootstrap();
}

const countOf = (path: string, table: string): number => {
  const sqlite = new Database(path, { readonly: true });
  try { return (sqlite.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get() as { c: number }).c; } finally { sqlite.close(); }
};

serviceDescribe('migración de una base de V2 real (Prisma, fechas numéricas, sin egresos)', () => {
  beforeAll(() => { buildV2(); });
  afterAll(() => { closeDatabase(); rmSync(dir, { recursive: true, force: true }); });
  beforeEach(async () => { await freshV3(); });

  it('detecta la base de V2 aunque la de V3 ya tenga los usuarios de fábrica, y cuenta lo que trae', () => {
    const detected = new MigrationService().detectV2();
    expect(detected).toMatchObject({ available: true, alreadyMigrated: false });
    expect(detected.summary).toEqual({ sales: 4, products: 4, customers: 1, cashSessions: 4, firstSale: '2026-10-01', lastSale: '2026-10-03' });
  });

  it('importa todo: mismas filas y mismos totales que V2, y deja la verificación como prueba', async () => {
    const report = await new MigrationService().migrateV2();
    expect(report.migrated).toBe(true);
    expect(report.integrity).toBe('ok');
    expect(report.verification?.datesNotConverted).toBe(0);
    for (const [table, counts] of Object.entries(report.verification?.tables ?? {})) {
      expect(counts.destino, table).toBe(counts.origen);
    }
    for (const [name, sums] of Object.entries(report.verification?.sums ?? {})) {
      expect(sums.destino, name).toBe(sums.origen);
    }
    // V3 trae egresos de caja y la tabla del log diario aunque V2 no los tuviera
    expect(report.rows.CashExpense).toBe(0);
    for (const [table, expected] of Object.entries({ Sale: 4, SaleItem: 8, Payment: 5, Product: 4, Category: 2, Customer: 1, CashSession: 4, StockMovement: 1, Debt: 1, User: 1, Config: 7 })) {
      expect(countOf(v3Path, table), table).toBe(expected);
    }
  });

  it('las fechas pasan de número a texto, también la de «sin vencimiento» (año 3030)', async () => {
    await new MigrationService().migrateV2();
    const sqlite = new Database(v3Path, { readonly: true });
    const types = (table: string, column: string): string[] =>
      (sqlite.prepare(`SELECT DISTINCT typeof("${column}") AS t FROM "${table}" WHERE "${column}" IS NOT NULL`).all() as Array<{ t: string }>).map((r) => r.t);
    expect(types('Sale', 'createdAt')).toEqual(['text']);
    expect(types('Payment', 'createdAt')).toEqual(['text']);
    expect(types('CashSession', 'openedAt')).toEqual(['text']);
    expect(types('Product', 'expiryDate')).toEqual(['text']);
    expect(types('StockMovement', 'createdAt')).toEqual(['text']);
    expect((sqlite.prepare('SELECT createdAt FROM "Sale" WHERE id = 1').get() as { createdAt: string }).createdAt).toBe('2026-10-01T15:00:00.000Z');
    expect((sqlite.prepare('SELECT expiryDate FROM "Product" WHERE id = 3').get() as { expiryDate: string }).expiryDate.slice(0, 4)).toBe('3030');
    sqlite.close();
  });

  it('los informes, la búsqueda de ventas y las alertas de V3 ven los datos de V2', async () => {
    const { accountId } = await new MigrationService().migrateV2();
    const range = { start: new Date('2026-10-01T00:00:00'), end: new Date('2026-10-31T00:00:00') };

    const totals = await new ReportsService().getPeriodTotals(range, accountId);
    expect(totals.sales).toBe(3); // la anulada no cuenta
    expect(totals.revenue).toBe(6500 + 9000 + 7000);

    const sale = await new SalesService().getSaleByNumber('V-2026-0001', accountId);
    expect(sale?.createdAt).toBe('2026-10-01T15:00:00.000Z');
    expect(sale?.total).toBe(6500);

    const mix = await new ReportsService().getPaymentMix(range, accountId);
    expect(mix.reduce((sum, row) => sum + row.total, 0)).toBe(6500 + 9000 + 7000);

    const expiry = await new InventoryService().getExpiryAlerts(undefined, accountId);
    expect(expiry.expired.map((p) => p.code)).toEqual(['ACE']);
    expect(expiry.expiringSoon.map((p) => p.code)).toEqual(['IBU']);
    expect(expiry.okCount).toBe(1); // el de «año 3030»
  });

  it('un conteo de caja imposible queda «sin conteo» (para conciliarlo) y su valor original se guarda en la auditoría', async () => {
    const report = await new MigrationService().migrateV2();
    expect(report.corrections).toEqual([
      { table: 'CashSession', id: 3, column: 'finalCash', original: '1.331e+55' },
      { table: 'CashSession', id: 3, column: 'difference', original: '1.331e+55' },
    ]);
    const closures = await new CashSessionService().listCashClosures(report.accountId);
    const bad = closures.find((c) => c.id === 3);
    expect(bad).toMatchObject({ finalCash: null, difference: null, expectedCash: 133100, pendingReconciliation: true });
    const sqlite = new Database(v3Path, { readonly: true });
    const logs = sqlite.prepare("SELECT payload FROM AuditLog WHERE action = 'migration:value-cleared' ORDER BY id").all() as Array<{ payload: string }>;
    expect(logs.map((l) => JSON.parse(l.payload).original)).toEqual(['1.331e+55', '1.331e+55']);
    // sumar los cierres ya no desborda
    expect(() => sqlite.prepare('SELECT SUM(finalCash), SUM(difference) FROM CashSession').get()).not.toThrow();
    sqlite.close();
  });

  it('la caja que estaba abierta en V2 sigue abierta, y los datos del negocio se llevan a la cuenta', async () => {
    const report = await new MigrationService().migrateV2();
    const sqlite = new Database(v3Path, { readonly: true });
    expect(sqlite.prepare("SELECT status FROM CashSession WHERE id = 4").get()).toEqual({ status: 'OPEN' });
    expect(sqlite.prepare('SELECT name, nit, email, phone, address FROM Account WHERE id = ?').get(report.accountId)).toEqual({
      name: 'DROGUERIA DE PRUEBA', nit: '900123456-7', email: 'prueba@correo.com', phone: '3001112233', address: 'CALLE 1 # 2-3',
    });
    expect(sqlite.prepare("SELECT value FROM Config WHERE key = 'logo'").get()).toEqual({ value: 'data:image/png;base64,AAAA' });
    sqlite.close();
  });

  it('la base de V2 nunca se modifica, y queda una copia de seguridad idéntica en datos', async () => {
    const before = sha256(v2Path);
    const report = await new MigrationService().migrateV2();
    expect(sha256(v2Path)).toBe(before);
    expect(existsSync(report.backupPath)).toBe(true);
    for (const table of ['Sale', 'Product', 'Payment', 'CashSession']) {
      expect(countOf(report.backupPath, table), table).toBe(countOf(v2Path, table));
    }
  });

  it('el usuario de V2 conserva su clave y debe cambiarla al entrar; el usuario de fábrica «cajero1» ya no está', async () => {
    await new MigrationService().migrateV2();
    const sqlite = new Database(v3Path, { readonly: true });
    const users = sqlite.prepare('SELECT username, role, mustChangePassword, substr(password, 1, 7) AS clave FROM "User"').all();
    sqlite.close();
    expect(users).toEqual([{ username: 'admin', role: 'ADMIN', mustChangePassword: 1, clave: '$2a$12$' }]);
  });

  it('si la base de V3 ya tiene datos propios, no se importa nada y no se toca ninguna de las dos', async () => {
    getDatabase().$client.prepare("INSERT INTO Category (name, color, accountId, createdAt, updatedAt) VALUES ('Propia', '#fff', 1, '2026-11-01', '2026-11-01')").run();
    getDatabase().$client.prepare("INSERT INTO Product (accountId, code, name, categoryId, price, cost, stock, taxRate, isActive, createdAt, updatedAt) VALUES (1, 'P', 'Producto propio', 1, 1000, 500, 5, 0, 1, '2026-11-01', '2026-11-01')").run();
    const before = sha256(v2Path);
    await expect(new MigrationService().migrateV2()).rejects.toThrow(/ya fue migrada|ya contiene datos/);
    expect(sha256(v2Path)).toBe(before);
    expect(countOf(v3Path, 'Product')).toBe(1);
  });

  it('si algo falla a mitad de camino, V3 queda exactamente como estaba (con sus usuarios de fábrica)', async () => {
    const service = new MigrationService();
    const spy = vi.spyOn(service as unknown as { transform: () => never }, 'transform').mockImplementation(() => { throw new Error('fallo simulado'); });
    const before = sha256(v2Path);
    await expect(service.migrateV2()).rejects.toThrow('fallo simulado');
    spy.mockRestore();
    expect(sha256(v2Path)).toBe(before);
    expect(countOf(v3Path, 'User')).toBe(2);
    expect(countOf(v3Path, 'Sale')).toBe(0);
    // y se puede volver a intentar sin problema
    const retry = await new MigrationService().migrateV2();
    expect(retry.migrated).toBe(true);
  });

  it('si después de migrar los totales no coinciden, se deshace todo en vez de dar la importación por buena', async () => {
    const service = new MigrationService();
    const original = (service as unknown as { transform: (p: string) => unknown }).transform.bind(service);
    vi.spyOn(service as unknown as { transform: (p: string) => unknown }, 'transform').mockImplementation((path: string) => {
      const result = original(path);
      const sqlite = new Database(path);
      sqlite.prepare('DELETE FROM "Payment" WHERE id = 1').run(); // se «pierde» un pago
      sqlite.close();
      return result;
    });
    await expect(service.migrateV2()).rejects.toThrow(/verificación/i);
    expect(countOf(v3Path, 'Payment')).toBe(0);
    expect(countOf(v3Path, 'User')).toBe(2);
  });
});
