import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SalesService } from '../app/main/services/sales.service';
import { CashSessionService } from '../app/main/services/cash-session.service';
import { CashExpenseService } from '../app/main/services/cash-expense.service';
import { InventoryService } from '../app/main/services/inventory.service';
import { setupTestDatabase, cleanupTestDatabase, resetDatabaseState } from './integration-helper';
import { setDatabasePath, closeDatabase, getDatabase, schema } from '../app/main/db/index';
import { LicenseService } from '../app/main/services/license.service';
import { eq } from 'drizzle-orm';

let nativeDbAvailable = true;
try {
  new Database(':memory:').close();
} catch {
  nativeDbAvailable = false;
}

// better-sqlite3 está compilado para el ABI de Electron; si se ejecuta vitest con
// el Node del sistema y el binario no coincide (NODE_MODULE_VERSION), se salta.
const serviceDescribe = nativeDbAvailable ? describe : describe.skip;

serviceDescribe('Sales integration', () => {
  let tempDbPath: string;
  let salesService: SalesService;
  let inventoryService: InventoryService;
  let cashSessionService: CashSessionService;

  beforeAll(async () => {
    tempDbPath = await setupTestDatabase();
    setDatabasePath(tempDbPath);
    salesService = new SalesService();
    inventoryService = new InventoryService();
    cashSessionService = new CashSessionService();
  });

  afterAll(async () => {
    closeDatabase();
    await cleanupTestDatabase(tempDbPath);
  });

  beforeEach(async () => {
    await resetDatabaseState();
  });

  afterEach(async () => {
    try {
      const active = await cashSessionService.getActiveCashSession(1);
      if (active) {
        await cashSessionService.closeCashSession(active.id, active.expectedCash ?? active.initialCash, active.expectedCash ?? active.initialCash, 1, 1);
      }
    } catch {
      // ignore cleanup errors
    }
  });

  it('creates a sale and decreases stock atomically', async () => {
    const accountId = 1;
    const userId = 1;

    const { products } = await inventoryService.getAllProducts(undefined, accountId);
    expect(products.length).toBeGreaterThan(0);

    const product = products[0];
    const initialStock = product.stock;
    const taxRate = product.taxRate ?? 0.19;
    const expectedTotal = product.price * 1 + product.price * taxRate;

    const session = await cashSessionService.openCashSession(accountId, userId, 100000);
    const cashSessionId = session.id;

    const sale = await salesService.createSale(
      cashSessionId,
      userId,
      [{ productId: product.id, quantity: 1, unitPrice: product.price, discount: 0 }],
      [{ method: 'efectivo', amount: expectedTotal }],
      accountId,
      0,
      0,
      undefined,
      false,
      undefined,
      'percentage',
    );

    expect(sale).toBeDefined();
    expect(sale.saleNumber).toBeTruthy();
    expect(sale.status).toBe('COMPLETED');
    expect(sale.items).toHaveLength(1);
    expect(sale.items[0].productId).toBe(product.id);
    expect(sale.total).toBeCloseTo(expectedTotal, 2);

    const updatedProduct = await inventoryService.getProductById(product.id, accountId);
    expect(updatedProduct.stock).toBe(initialStock - 1);
  });

  it('prevents sale with insufficient stock', async () => {
    const accountId = 1;
    const userId = 1;

    const { products } = await inventoryService.getAllProducts(undefined, accountId);
    const product = products[0];

    const session = await cashSessionService.openCashSession(accountId, userId, 100000);
    const cashSessionId = session.id;

    await expect(
      salesService.createSale(
        cashSessionId,
        userId,
        [{ productId: product.id, quantity: 9999, unitPrice: product.price, discount: 0 }],
        [{ method: 'efectivo', amount: product.price * 9999 * 1.19 }],
        accountId,
        0,
        0,
        undefined,
        false,
        undefined,
        'percentage',
      ),
    ).rejects.toThrow();
  });

  it('rejects a sale registered against another cashier\'s open session', async () => {
    const accountId = 1;
    const db = getDatabase();
    const now = new Date().toISOString();
    const [otherUser] = await db.insert(schema.users).values({
      accountId,
      username: `cashier-${Date.now()}`,
      password: 'test',
      fullName: 'Otro Cajero',
      role: 'CASHIER',
      active: true,
      mustChangePassword: false,
      createdAt: now,
      updatedAt: now,
    }).returning();
    const { products } = await inventoryService.getAllProducts(undefined, accountId);
    const product = products[0];
    const foreignSession = await cashSessionService.openCashSession(accountId, otherUser.id, 100000);

    await expect(salesService.createSale(
      foreignSession.id,
      1,
      [{ productId: product.id, quantity: 1, unitPrice: product.price, discount: 0 }],
      [{ method: 'efectivo', amount: product.price * 1.19 }],
      accountId,
    )).rejects.toThrow('caja de otro usuario');
  });

  it('rejects payment mismatch', async () => {
    const accountId = 1;
    const userId = 1;

    const { products } = await inventoryService.getAllProducts(undefined, accountId);
    const product = products[0];

    const session = await cashSessionService.openCashSession(accountId, userId, 100000);
    const cashSessionId = session.id;

    await expect(
      salesService.createSale(
        cashSessionId,
        userId,
        [{ productId: product.id, quantity: 1, unitPrice: product.price, discount: 0 }],
        [{ method: 'efectivo', amount: 1 }],
        accountId,
        0,
        0,
        undefined,
        false,
        undefined,
        'percentage',
      ),
    ).rejects.toThrow();
  });
});

serviceDescribe('Cash integration', () => {
  let tempDbPath: string;
  let cashSessionService: CashSessionService;
  let cashExpenseService: CashExpenseService;

  beforeAll(async () => {
    tempDbPath = await setupTestDatabase();
    setDatabasePath(tempDbPath);
    cashSessionService = new CashSessionService();
    cashExpenseService = new CashExpenseService();
  });

  afterAll(async () => {
    closeDatabase();
    await cleanupTestDatabase(tempDbPath);
  });

  beforeEach(async () => {
    await resetDatabaseState();
  });

  afterEach(async () => {
    try {
      const active = await cashSessionService.getActiveCashSession(1);
      if (active) {
        await cashSessionService.closeCashSession(active.id, active.expectedCash ?? active.initialCash, active.expectedCash ?? active.initialCash, 1, 1);
      }
    } catch {
      // ignore cleanup errors
    }
  });

  it('opens and closes a cash session', async () => {
    const accountId = 1;
    const userId = 1;

    const session = await cashSessionService.openCashSession(accountId, userId, 200000);
    expect(session.status).toBe('OPEN');
    expect(session.initialCash).toBe(200000);

    const active = await cashSessionService.getActiveCashSession(userId);
    expect(active).not.toBeNull();
    expect(active?.id).toBe(session.id);

    const closeResult = await cashSessionService.closeCashSession(session.id, session.initialCash, session.initialCash, accountId, userId);
    expect(closeResult.difference).toBe(0);

    const afterClose = await cashSessionService.getActiveCashSession(userId);
    expect(afterClose).toBeNull();
  });

  it('records cash expense against session', async () => {
    const accountId = 1;
    const userId = 1;

    const session = await cashSessionService.openCashSession(accountId, userId, 200000);
    const cashSessionId = session.id;

    const expensesBefore = await cashExpenseService.getExpensesBySession(cashSessionId, accountId);
    expect(expensesBefore).toHaveLength(0);

    await cashExpenseService.createExpense(cashSessionId, userId, 15000, 'Papelería', accountId);

    const expensesAfter = await cashExpenseService.getExpensesBySession(cashSessionId, accountId);
    expect(expensesAfter).toHaveLength(1);
    expect(expensesAfter[0].amount).toBe(15000);
    expect(expensesAfter[0].reason).toBe('Papelería');
  });
});

serviceDescribe('DianService integration', () => {
  let tempDbPath: string;

  beforeAll(async () => {
    tempDbPath = await setupTestDatabase();
    setDatabasePath(tempDbPath);
  });

  afterAll(async () => {
    closeDatabase();
    await cleanupTestDatabase(tempDbPath);
  });

  beforeEach(async () => {
    await resetDatabaseState();
  });

  it('returns invalid license when no license is stored', async () => {
    // El archivo fuente copiado (database/tucajero.db) puede contener una
    // licencia y first_run_at reales; se limpian para probar el estado "none".
    const db = getDatabase();
    db.delete(schema.configs).where(eq(schema.configs.key, 'license_data')).run();
    db.delete(schema.configs).where(eq(schema.configs.key, 'first_run_at')).run();

    const licenseService = new LicenseService();
    const status = await licenseService.getLicenseStatus();
    expect(status.status).toBe('none');
    expect(status.license).toBeNull();
  });
});
