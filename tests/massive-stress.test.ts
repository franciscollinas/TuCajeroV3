/**
 * TuCajero V3 — Suite masiva de pruebas de estrés y fuzzing.
 *
 * Ejecuta ~50 000 iteraciones entre escenarios deterministas, fuzzing
 * y pruebas de propiedades sobre los servicios del dominio.
 *
 * Genera un reporte final en `tests/STRESS_REPORT.md` discriminado
 * por módulo, tipo de fallo y criticidad.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { eq, and, desc, count, sum, gte, lt } from 'drizzle-orm';

// ─── Setup DB de prueba ───────────────────────────────────────────────
const dir = join(tmpdir(), `tucajero-stress-${Date.now()}`);
const dbPath = join(dir, 'stress.db');
process.env.DATABASE_URL = dbPath;

const { SalesService } = await import('../app/main/services/sales.service');
const { CashSessionService } = await import('../app/main/services/cash-session.service');
const { CashExpenseService } = await import('../app/main/services/cash-expense.service');
const { InventoryService } = await import('../app/main/services/inventory.service');
const { CustomerService } = await import('../app/main/services/customer.service');
const { QuoteService } = await import('../app/main/services/quote.service');
const { PurchaseService } = await import('../app/main/services/purchase.service');
const { PayrollService } = await import('../app/main/services/payroll.service');
const { AuditService } = await import('../app/main/services/audit.service');
const { ExportService } = await import('../app/main/services/export.service');
const { getDatabase, schema, closeDatabase } = await import('../app/main/db');
const { ErrorCode } = await import('../app/main/utils/errors');
const { nowISO } = await import('../app/main/utils/date');

const salesService = new SalesService();
const cashSessionService = new CashSessionService();
const cashExpenseService = new CashExpenseService();
const inventoryService = new InventoryService();
const customerService = new CustomerService();
const quoteService = new QuoteService();
const purchaseService = new PurchaseService();
const payrollService = new PayrollService();
const auditService = new AuditService();
const exportService = new ExportService();

let nativeDbAvailable = true;
try { new Database(':memory:').close(); } catch { nativeDbAvailable = false; }
const stressDescribe = nativeDbAvailable ? describe : describe.skip;

// ─── Seeded PRNG (mulberry32) ────────────────────────────────────────
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);
const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const randFloat = (min: number, max: number) => +(rand() * (max - min) + min).toFixed(2);
const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const NOW = '2026-01-01T00:00:00.000Z';
// Cada `it` hereda este timeout de su suite (vitest 4: describe(name, { timeout }, fn)).
// 600s por prueba para que los loops de decenas de miles de iteraciones completen.
const STRESS_TIMEOUT = 600_000;

// ─── Reporte ─────────────────────────────────────────────────────────
interface FailureRecord {
  module: string;
  scenario: string;
  iteration: number;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  error: string;
  errorCode?: string;
}

const failures: FailureRecord[] = [];
const scenarioStats: Record<string, { passed: number; failed: number; expected: number; module: string }> = {};

let totalIterations = 0;
let totalPassed = 0;
let totalFailed = 0;
let totalExpected = 0;

function bumpScenario(module: string, scenario: string, kind: 'passed' | 'failed' | 'expected') {
  const s = (scenarioStats[scenario] ??= { passed: 0, failed: 0, expected: 0, module });
  s[kind]++;
}

function recordPass(module: string, scenario: string) {
  totalIterations++;
  totalPassed++;
  bumpScenario(module, scenario, 'passed');
}
function recordExpectedFailure(module: string, scenario: string, iteration: number, errorCode: string, severity: FailureRecord['severity']) {
  totalIterations++;
  totalExpected++;
  bumpScenario(module, scenario, 'expected');
}
function recordUnexpected(module: string, scenario: string, iteration: number, error: unknown, severity: FailureRecord['severity'], errorCode?: string) {
  totalIterations++;
  totalFailed++;
  bumpScenario(module, scenario, 'failed');
  const derivedCode = errorCode
    ?? (typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : undefined);
  failures.push({
    module,
    scenario,
    iteration,
    severity,
    error: error instanceof Error ? error.message : String(error),
    errorCode: derivedCode,
  });
}

// Devuelve una sesión de caja SIEMPRE abierta para el usuario: cierra primero
// cualquier sesión abierta anterior para evitar SESSION_ALREADY_OPEN en cascada,
// que contaminaba los conteos reales del estrés.
async function openStressSession(accountId: number, userId: number, initialCash: number, branchId?: number) {
  const active = await cashSessionService.getActiveCashSession(userId, branchId);
  if (active) {
    try {
      await cashSessionService.closeCashSession(active.id, 0, 0, accountId, userId);
    } catch {
      // sesión huérfana: se fuerza cierre directo por inactividad
      try { await cashSessionService.autoCloseInactiveSessions(0); } catch { /* noop */ }
    }
  }
  return cashSessionService.openCashSession(accountId, userId, initialCash, branchId);
}

// Garantiza que un producto tenga stock suficiente para una venta "válida",
// evitando falsos INSUFFICIENT_STOCK por productos ya agotados por iteraciones previas.
// Además, si el producto venció respecto al reloj real de ejecución, lo "des-vence"
// dándole 30 días de vida, para que las ventas válidas no fallen por PRODUCT_EXPIRED.
async function ensureStock(productId: number, min = 50): Promise<void> {
  const p = await inventoryService.getProductById(productId, 1);
  if (!p) return;
  const nowDate = new Date();
  const today = nowDate.toISOString().split('T')[0];
  if (p.expiryDate && p.expiryDate <= today) {
    const future = new Date(nowDate.getTime() + 30 * 86400000).toISOString().split('T')[0];
    getDatabase().update(schema.products).set({ expiryDate: future }).where(eq(schema.products.id, productId)).run();
  }
  if (Number(p.stock) < min) {
    await inventoryService.adjustStock(p.id, min - Number(p.stock), 'Top-up stress', 1, 1).catch(() => {});
  }
}

// ─── Setup DB ────────────────────────────────────────────────────────
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
    INSERT INTO "Account" (name, nit, email, createdAt, updatedAt) VALUES ('Test Account', '900000001', 'test@test.com', '${NOW}', '${NOW}');
    INSERT INTO "Account" (name, nit, email, createdAt, updatedAt) VALUES ('Account B', '900000002', 'b@test.com', '${NOW}', '${NOW}');
    INSERT INTO "User" (username, password, fullName, role, active, accountId, createdAt, updatedAt) VALUES ('admin', 'hash', 'Admin', 'ADMIN', 1, 1, '${NOW}', '${NOW}');
    INSERT INTO "User" (username, password, fullName, role, active, accountId, createdAt, updatedAt) VALUES ('cajero', 'hash', 'Cajero', 'CASHIER', 1, 1, '${NOW}', '${NOW}');
    INSERT INTO "User" (username, password, fullName, role, active, accountId, createdAt, updatedAt) VALUES ('super', 'hash', 'Super', 'SUPERVISOR', 1, 1, '${NOW}', '${NOW}');
    INSERT INTO "User" (username, password, fullName, role, active, accountId, createdAt, updatedAt) VALUES ('adminB', 'hash', 'Admin B', 'ADMIN', 1, 2, '${NOW}', '${NOW}');
    INSERT INTO "Branch" (accountId, name, code, isActive, createdAt, updatedAt) VALUES (1, 'Principal', 'PRIN', 1, '${NOW}', '${NOW}');
    INSERT INTO "Branch" (accountId, name, code, isActive, createdAt, updatedAt) VALUES (1, 'Secundaria', 'SECU', 1, '${NOW}', '${NOW}');
    INSERT INTO "Branch" (accountId, name, code, isActive, createdAt, updatedAt) VALUES (2, 'B1', 'B01', 1, '${NOW}', '${NOW}');
    INSERT INTO "Category" (name, color, accountId, createdAt, updatedAt) VALUES ('Bebidas', '#0000ff', 1, '${NOW}', '${NOW}');
    INSERT INTO "Category" (name, color, accountId, createdAt, updatedAt) VALUES ('Snacks', '#ff0000', 1, '${NOW}', '${NOW}');
    INSERT INTO "Category" (name, color, accountId, createdAt, updatedAt) VALUES ('Lacteos', '#00ff00', 1, '${NOW}', '${NOW}');
    INSERT INTO "Category" (name, color, accountId, createdAt, updatedAt) VALUES ('CatB', '#0000ff', 2, '${NOW}', '${NOW}');
    INSERT INTO "Supplier" (accountId, name, phone, leadTimeDays, isActive, createdAt, updatedAt) VALUES (1, 'Proveedor A', '3001112233', 7, 1, '${NOW}', '${NOW}');
    INSERT INTO "Customer" (accountId, name, phone, createdAt, updatedAt) VALUES (1, 'Cliente 1', '3001001000', '${NOW}', '${NOW}');
    INSERT INTO "Customer" (accountId, name, phone, createdAt, updatedAt) VALUES (1, 'Cliente 2', '3001002000', '${NOW}', '${NOW}');
  `);
  sqlite.close();
}

// ─── Seed products dynamically ────────────────────────────────────────
function seedProducts(count: number) {
  const db = getDatabase();
  for (let i = 0; i < count; i++) {
    const catId = (i % 3) + 1;
    const price = randFloat(500, 50000);
    const cost = +(price * randFloat(0.3, 0.8)).toFixed(2);
    const stock = randInt(0, 200);
    const taxRate = pick([0, 0.05, 0.08, 0.19]);
    const expiryDate = rand() > 0.7
      ? new Date(Date.now() + randInt(-30, 365) * 86400000).toISOString().split('T')[0]
      : null;
    db.insert(schema.products).values({
      accountId: 1,
      code: `PROD-${String(i + 1).padStart(4, '0')}`,
      barcode: rand() > 0.3 ? `770${String(1000000 + i)}` : null,
      name: `Producto ${i + 1}`,
      categoryId: catId,
      price,
      cost,
      stock,
      minStock: randInt(2, 10),
      criticalStock: randInt(1, 5),
      taxRate,
      unitType: pick(['UNIT', 'KG', 'L']),
      isActive: true,
      expiryDate,
      createdAt: NOW,
      updatedAt: NOW,
    }).run();
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SUITE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════
stressDescribe('TuCajero V3 — 50k Stress Test Suite', () => {
  beforeAll(() => {
    createDatabase();
    seedProducts(200);
  });

  afterAll(() => {
    closeDatabase();
    // Generar reporte
    generateReport();
    rmSync(dir, { recursive: true, force: true });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 1. INVENTORY — 10 000 iteraciones
  // ─────────────────────────────────────────────────────────────────────
  stressDescribe('1. Inventory (10 000 iteraciones)', { timeout: STRESS_TIMEOUT }, () => {

    it('1.1 CRUD de productos con datos válidos (2000)', async () => {
      for (let i = 0; i < 2000; i++) {
        try {
          const code = `STRESS-${Date.now()}-${i}`;
          const product = await inventoryService.createProduct({
            code,
            name: `Stress Product ${i}`,
            price: randFloat(100, 100000),
            cost: randFloat(50, 50000),
            stock: randInt(0, 1000),
            categoryId: randInt(1, 3),
            taxRate: pick([0, 0.05, 0.19]),
            unitType: pick(['UNIT', 'KG', 'L']),
            userId: 1,
          }, 1);
          expect(product).toBeDefined();
          expect(product.code).toBe(code);
          recordPass('inventory', 'create_valid');
        } catch (e) {
          recordUnexpected('inventory', 'create_valid', i, e, 'HIGH');
        }
      }
    });

    it('1.2 Productos duplicados → DUPLICATE_CODE (500)', async () => {
      for (let i = 0; i < 500; i++) {
        try {
          await inventoryService.createProduct({
            code: 'PROD-0001',
            name: 'Duplicate',
            price: 1000,
            cost: 500,
            stock: 10,
            categoryId: 1,
          }, 1);
          recordUnexpected('inventory', 'duplicate_code', i, new Error('Should have thrown'), 'HIGH', ErrorCode.DUPLICATE_CODE);
        } catch (e: any) {
          if (e?.code === ErrorCode.DUPLICATE_CODE) {
            recordExpectedFailure('inventory', 'duplicate_code', i, ErrorCode.DUPLICATE_CODE, 'LOW');
          } else {
            recordUnexpected('inventory', 'duplicate_code', i, e, 'MEDIUM');
          }
        }
      }
    });

    it('1.3 Búsqueda por LIKE con caracteres especiales (1000)', async () => {
      const specialQueries = ['%', '_', '%%', '%_', '_%', '%_%_', '', '   ', 'Producto%', '%Producto', 'a b c', '100%', '___', '%%1%%'];
      for (let i = 0; i < 1000; i++) {
        try {
          const q = i < specialQueries.length ? specialQueries[i] : `Producto ${randInt(1, 200)}`;
          const result = await inventoryService.getAllProducts({ search: q }, 1);
          expect(result).toBeDefined();
          expect(Array.isArray(result.products)).toBe(true);
          recordPass('inventory', 'search_like');
        } catch (e) {
          recordUnexpected('inventory', 'search_like', i, e, 'MEDIUM');
        }
      }
    });

    it('1.4 Ajuste de stock con valores extremos (2000)', async () => {
      const products = (await inventoryService.getAllProducts({}, 1)).products;
      for (let i = 0; i < 2000; i++) {
        try {
          const pickFrom = pick(products);
          const live = await inventoryService.getProductById(pickFrom.id, 1);
          const product = live ?? pickFrom;
          const qty = i < 100 ? -9999999 : i < 200 ? 9999999 : i < 400 ? -product.stock : randInt(-100, 100);
          const reason = `Stress test ${i}`;
          if (qty < 0 && Math.abs(qty) > product.stock) {
            try {
              await inventoryService.adjustStock(product.id, qty, reason, 1, 1);
              recordUnexpected('inventory', 'adjust_negative_overflow', i, new Error('Should throw INSUFFICIENT_STOCK'), 'HIGH', ErrorCode.INSUFFICIENT_STOCK);
            } catch (e: any) {
              if (e?.code === ErrorCode.INSUFFICIENT_STOCK) {
                recordExpectedFailure('inventory', 'adjust_negative_overflow', i, ErrorCode.INSUFFICIENT_STOCK, 'LOW');
              } else {
                recordUnexpected('inventory', 'adjust_negative_overflow', i, e, 'MEDIUM');
              }
            }
          } else {
            const result = await inventoryService.adjustStock(product.id, qty, reason, 1, 1);
            expect(result).toBeDefined();
            recordPass('inventory', 'adjust_valid');
          }
        } catch (e) {
          recordUnexpected('inventory', 'adjust_stock', i, e, 'HIGH');
        }
      }
    });

    it('1.5 Bulk import con datos mixtos (1000)', async () => {
      for (let i = 0; i < 1000; i++) {
        try {
          const rows = Array.from({ length: randInt(1, 10) }, (_, j) => ({
            code: rand() > 0.5 ? `PROD-${String(randInt(1, 10)).padStart(4, '0')}` : `NEW-${Date.now()}-${i}-${j}`,
            name: `Bulk ${i}-${j}`,
            category: pick(['Bebidas', 'Snacks', 'Lacteos', 'Nueva Cat']),
            price: String(randFloat(500, 50000)),
            cost: String(randFloat(200, 30000)),
            stock: String(randInt(0, 500)),
            barcode: rand() > 0.3 ? `770${randInt(1000000, 9999999)}` : undefined,
            expiryDate: rand() > 0.8 ? '2026-12-31' : undefined,
          }));
          const result = await inventoryService.bulkImportProducts(rows, 1, undefined, 1);
          expect(result).toBeDefined();
          expect(typeof result.success).toBe('number');
          recordPass('inventory', 'bulk_import');
        } catch (e) {
          recordUnexpected('inventory', 'bulk_import', i, e, 'MEDIUM');
        }
      }
    });

    it('1.6 Alertas de stock y vencimiento (1000)', async () => {
      for (let i = 0; i < 1000; i++) {
        try {
          const stockAlerts = await inventoryService.getStockAlerts(undefined, 1);
          const expiryAlerts = await inventoryService.getExpiryAlerts(undefined, 1);
          expect(stockAlerts).toBeDefined();
          expect(expiryAlerts).toBeDefined();
          expect(Array.isArray(stockAlerts.critical)).toBe(true);
          expect(Array.isArray(stockAlerts.warning)).toBe(true);
          expect(Array.isArray(expiryAlerts.expired)).toBe(true);
          expect(Array.isArray(expiryAlerts.expiringSoon)).toBe(true);
          recordPass('inventory', 'alerts');
        } catch (e) {
          recordUnexpected('inventory', 'alerts', i, e, 'MEDIUM');
        }
      }
    });

    it('1.7 Producto por código de barras (1000)', async () => {
      for (let i = 0; i < 1000; i++) {
        try {
          const barcode = `770${randInt(1000000, 9999999)}`;
          const result = await inventoryService.getProductByBarcode(barcode, 1);
          // null is valid (not found)
          recordPass('inventory', 'barcode_lookup');
        } catch (e) {
          recordUnexpected('inventory', 'barcode_lookup', i, e, 'MEDIUM');
        }
      }
    });

    it('1.8 Sin rotación (500)', async () => {
      for (let i = 0; i < 500; i++) {
        try {
          const result = await inventoryService.getNoRotationProducts(90, 1);
          expect(Array.isArray(result)).toBe(true);
          recordPass('inventory', 'no_rotation');
        } catch (e) {
          recordUnexpected('inventory', 'no_rotation', i, e, 'LOW');
        }
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 2. SALES / POS — 10 000 iteraciones
  // ─────────────────────────────────────────────────────────────────────
  stressDescribe('2. Sales / POS (10 000 iteraciones)', { timeout: STRESS_TIMEOUT }, () => {
    const methodos = ['efectivo', 'nequi', 'daviplata', 'tarjeta', 'transferencia'];

    it('2.1 Ventas válidas con diferentes combinaciones (3000)', async () => {
      const products = (await inventoryService.getAllProducts({}, 1)).products;
      for (let i = 0; i < 3000; i++) {
        try {
          const session = await openStressSession(1, 2, randInt(10000, 500000));
          const numItems = randInt(1, 8);
          const picked = Array.from({ length: numItems }, () => pick(products));
          for (const c of picked) await ensureStock(c.id);
          const items = picked.map((p) => ({
            productId: p.id, quantity: randInt(1, 5), unitPrice: Number(p.price), discount: 0,
          }));
          const total = items.reduce((s, it) => s + it.unitPrice * it.quantity, 0);
          const paymentMethod = pick(methodos);
          const payments = [{ method: paymentMethod, amount: total + randInt(0, 50000) }];

          const sale = await salesService.createSale(session.id, 2, items, payments, 1);
          expect(sale).toBeDefined();
          expect(sale.status).toBe('COMPLETED');
          recordPass('sales', 'valid_sale');

          await cashSessionService.closeCashSession(session.id, total, total, 1, 2);
        } catch (e) {
          recordUnexpected('sales', 'valid_sale', i, e, 'HIGH');
        }
      }
    });

    it('2.2 Descuento porcentaje y fijo (1000)', async () => {
      const products = (await inventoryService.getAllProducts({}, 1)).products;
      for (let i = 0; i < 1000; i++) {
        try {
          const session = await openStressSession(1, 2, 100000);
          const p = pick(products);
          await ensureStock(p.id, 4);
          const items = [{ productId: p.id, quantity: randInt(1, 3), unitPrice: Number(p.price), discount: 0 }];
          const subtotal = items.reduce((s, it) => s + it.unitPrice * it.quantity, 0);
          const discountType = pick(['percentage', 'fixed'] as const);
          const discount = discountType === 'percentage' ? randInt(1, 50) : randFloat(100, subtotal / 2);
          const effectiveDiscount = discountType === 'percentage' ? subtotal * discount / 100 : discount;
          const total = Math.max(0, subtotal - effectiveDiscount);
          const payments = [{ method: 'efectivo', amount: total + 10000 }];

          const sale = await salesService.createSale(session.id, 2, items, payments, 1, discount, 0, undefined, false, undefined, discountType);
          expect(sale).toBeDefined();
          expect(Number(sale.discount)).toBeCloseTo(effectiveDiscount, 0);
          recordPass('sales', 'discount');

          await cashSessionService.closeCashSession(session.id, total, total, 1, 2);
        } catch (e) {
          recordUnexpected('sales', 'discount', i, e, 'HIGH');
        }
      }
    });

    it('2.3 Ventas a crédito (500)', async () => {
      const products = (await inventoryService.getAllProducts({}, 1)).products;
      for (let i = 0; i < 500; i++) {
        try {
          const session = await openStressSession(1, 2, 100000);
          const p = pick(products);
          await ensureStock(p.id, 3);
          const items = [{ productId: p.id, quantity: randInt(1, 2), unitPrice: Number(p.price), discount: 0 }];
          const total = items.reduce((s, it) => s + it.unitPrice * it.quantity, 0);
          const payments = [{ method: 'credito', amount: total }];

          const sale = await salesService.createSale(session.id, 2, items, payments, 1, 0, 0, 1, true);
          expect(sale).toBeDefined();
          recordPass('sales', 'credit_sale');

          await cashSessionService.closeCashSession(session.id, 0, 0, 1, 2);
        } catch (e) {
          recordUnexpected('sales', 'credit_sale', i, e, 'HIGH');
        }
      }
    });

    it('2.4 Stock insuficiente → INSUFFICIENT_STOCK (500)', async () => {
      const products = (await inventoryService.getAllProducts({}, 1)).products;
      for (let i = 0; i < 500; i++) {
        try {
          const session = await openStressSession(1, 2, 100000);
          const lowStock = products.find(p => p.stock <= 3) || pick(products);
          const items = [{ productId: lowStock.id, quantity: 99999, unitPrice: Number(lowStock.price), discount: 0 }];
          const payments = [{ method: 'efectivo', amount: 999999999999 }];

          await salesService.createSale(session.id, 2, items, payments, 1);
          recordUnexpected('sales', 'insufficient_stock', i, new Error('Should throw INSUFFICIENT_STOCK'), 'HIGH', ErrorCode.INSUFFICIENT_STOCK);
        } catch (e: any) {
          if (e?.code === ErrorCode.INSUFFICIENT_STOCK || e?.code === ErrorCode.PRODUCT_NOT_FOUND) {
            recordExpectedFailure('sales', 'insufficient_stock', i, e.code, 'LOW');
          } else {
            recordUnexpected('sales', 'insufficient_stock', i, e, 'MEDIUM');
          }
        }
      }
    });

    it('2.5 Carrito vacío → EMPTY_CART (500)', async () => {
      for (let i = 0; i < 500; i++) {
        try {
          const session = await openStressSession(1, 2, 100000);
          await salesService.createSale(session.id, 2, [], [{ method: 'efectivo', amount: 1000 }], 1);
          recordUnexpected('sales', 'empty_cart', i, new Error('Should throw EMPTY_CART'), 'HIGH', ErrorCode.EMPTY_CART);
        } catch (e: any) {
          if (e?.code === ErrorCode.EMPTY_CART) {
            recordExpectedFailure('sales', 'empty_cart', i, ErrorCode.EMPTY_CART, 'LOW');
          } else {
            recordUnexpected('sales', 'empty_cart', i, e, 'MEDIUM');
          }
        }
      }
    });

    it('2.6 Pago insuficiente → PAYMENT_MISMATCH (500)', async () => {
      const products = (await inventoryService.getAllProducts({}, 1)).products;
      for (let i = 0; i < 500; i++) {
        try {
          const session = await openStressSession(1, 2, 100000);
          const p = pick(products);
          await ensureStock(p.id, 3);
          const items = [{ productId: p.id, quantity: 2, unitPrice: Number(p.price), discount: 0 }];
          const total = items.reduce((s, it) => s + it.unitPrice * it.quantity, 0);
          const payments = [{ method: 'efectivo', amount: total - 100 }];

          await salesService.createSale(session.id, 2, items, payments, 1);
          recordUnexpected('sales', 'payment_mismatch', i, new Error('Should throw PAYMENT_MISMATCH'), 'HIGH', ErrorCode.PAYMENT_MISMATCH);
        } catch (e: any) {
          if (e?.code === ErrorCode.PAYMENT_MISMATCH) {
            recordExpectedFailure('sales', 'payment_mismatch', i, ErrorCode.PAYMENT_MISMATCH, 'LOW');
          } else {
            recordUnexpected('sales', 'payment_mismatch', i, e, 'MEDIUM');
          }
        }
      }
    });

    it('2.7 Cancelación de ventas (500)', async () => {
      for (let i = 0; i < 500; i++) {
        try {
          const session = await openStressSession(1, 2, 100000);
          const products = (await inventoryService.getAllProducts({}, 1)).products;
          const p = pick(products);
          await ensureStock(p.id, 2);
          const items = [{ productId: p.id, quantity: 1, unitPrice: Number(p.price), discount: 0 }];
          const total = Number(p.price);
          const sale = await salesService.createSale(session.id, 2, items, [{ method: 'efectivo', amount: total + 1000 }], 1);

          await salesService.cancelSale(sale.id, 2, 1);
          const updated = await salesService.getSaleById(sale.id, 1);
          expect(updated?.status).toBe('CANCELLED');
          recordPass('sales', 'cancel_sale');

          await cashSessionService.closeCashSession(session.id, 0, 0, 1, 2);
        } catch (e) {
          recordUnexpected('sales', 'cancel_sale', i, e, 'HIGH');
        }
      }
    });

    it('2.8 Doble cancelación → VALIDATION (200)', async () => {
      for (let i = 0; i < 200; i++) {
        try {
          const session = await openStressSession(1, 2, 100000);
          const products = (await inventoryService.getAllProducts({}, 1)).products;
          const p = pick(products);
          await ensureStock(p.id, 2);
          const items = [{ productId: p.id, quantity: 1, unitPrice: Number(p.price), discount: 0 }];
          const sale = await salesService.createSale(session.id, 2, items, [{ method: 'efectivo', amount: Number(p.price) + 1000 }], 1);
          await salesService.cancelSale(sale.id, 2, 1);

          try {
            await salesService.cancelSale(sale.id, 2, 1);
            recordUnexpected('sales', 'double_cancel', i, new Error('Should throw VALIDATION'), 'MEDIUM');
          } catch (e: any) {
            if (e?.code === ErrorCode.VALIDATION) {
              recordExpectedFailure('sales', 'double_cancel', i, ErrorCode.VALIDATION, 'LOW');
            } else {
              recordUnexpected('sales', 'double_cancel', i, e, 'MEDIUM');
            }
          }
          await cashSessionService.closeCashSession(session.id, 0, 0, 1, 2);
        } catch (e) {
          recordUnexpected('sales', 'double_cancel', i, e, 'MEDIUM');
        }
      }
    });

    it('2.9 Dashboard y queries de lectura (800)', async () => {
      for (let i = 0; i < 800; i++) {
        try {
          if (i % 4 === 0) {
            const dash = await salesService.getDashboardSummary(1);
            expect(dash).toBeDefined();
          } else if (i % 4 === 1) {
            const sales = await salesService.getSalesByDateRange(new Date('2026-01-01'), new Date('2026-12-31'), 1);
            expect(Array.isArray(sales)).toBe(true);
          } else if (i % 4 === 2) {
            const sale = await salesService.getSaleByNumber('V-2026-0001', 1);
            // null is valid
          } else {
            const byUser = await salesService.getSalesByUser(2, 1);
            expect(Array.isArray(byUser)).toBe(true);
          }
          recordPass('sales', 'read_queries');
        } catch (e) {
          recordUnexpected('sales', 'read_queries', i, e, 'MEDIUM');
        }
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 3. CASH REGISTER — 8 000 iteraciones
  // ─────────────────────────────────────────────────────────────────────
  stressDescribe('3. Cash Register (8 000 iteraciones)', { timeout: STRESS_TIMEOUT }, () => {

    it('3.1 Abrir/cerrar sesión con variaciones (2000)', async () => {
      for (let i = 0; i < 2000; i++) {
        try {
          const initialCash = randFloat(0, 1000000);
          const session = await openStressSession(1, 2, initialCash);
          expect(session).toBeDefined();
          expect(session.status).toBe('OPEN');

          const finalCash = randFloat(0, 2000000);
          const close = await cashSessionService.closeCashSession(session.id, finalCash, finalCash, 1, 2);
          expect(close).toBeDefined();
          expect(typeof close.difference).toBe('number');
          recordPass('cash', 'open_close');
        } catch (e) {
          recordUnexpected('cash', 'open_close', i, e, 'HIGH');
        }
      }
    });

    it('3.2 Sesión ya abierta → SESSION_ALREADY_OPEN (500)', async () => {
      for (let i = 0; i < 500; i++) {
        try {
          const s1 = await openStressSession(1, 2, 10000);
          try {
            await cashSessionService.openCashSession(1, 2, 10000);
            recordUnexpected('cash', 'session_already_open', i, new Error('Should throw'), 'MEDIUM');
          } catch (e: any) {
            if (e?.code === ErrorCode.SESSION_ALREADY_OPEN) {
              recordExpectedFailure('cash', 'session_already_open', i, ErrorCode.SESSION_ALREADY_OPEN, 'LOW');
            } else {
              recordUnexpected('cash', 'session_already_open', i, e, 'MEDIUM');
            }
          }
          await cashSessionService.closeCashSession(s1.id, 10000, 10000, 1, 2);
        } catch (e) {
          recordUnexpected('cash', 'session_already_open', i, e, 'MEDIUM');
        }
      }
    });

    it('3.3 Egresos con validación (1000)', async () => {
      for (let i = 0; i < 1000; i++) {
        try {
          const session = await openStressSession(1, 2, 200000);
          const amount = randFloat(100, 50000);
          const expense = await cashExpenseService.createExpense(session.id, 2, amount, `Gasto stress ${i}`, 1);
          expect(expense).toBeDefined();
          expect(Number(expense.amount)).toBe(amount);
          recordPass('cash', 'expense_valid');

          await cashSessionService.closeCashSession(session.id, 0, 0, 1, 2);
        } catch (e) {
          recordUnexpected('cash', 'expense_valid', i, e, 'HIGH');
        }
      }
    });

    it('3.4 Egreso monto cero/negativo → VALIDATION (500)', async () => {
      for (let i = 0; i < 500; i++) {
        try {
          const session = await openStressSession(1, 2, 200000);
          const amount = pick([0, -100, -0.01, -999999]);
          try {
            await cashExpenseService.createExpense(session.id, 2, amount, 'Test', 1);
            recordUnexpected('cash', 'expense_zero_neg', i, new Error('Should throw VALIDATION'), 'MEDIUM');
          } catch (e: any) {
            if (e?.code === ErrorCode.VALIDATION) {
              recordExpectedFailure('cash', 'expense_zero_neg', i, ErrorCode.VALIDATION, 'LOW');
            } else {
              recordUnexpected('cash', 'expense_zero_neg', i, e, 'MEDIUM');
            }
          }
          await cashSessionService.closeCashSession(session.id, 0, 0, 1, 2);
        } catch (e) {
          recordUnexpected('cash', 'expense_zero_neg', i, e, 'MEDIUM');
        }
      }
    });

    it('3.5 Resumen de sesión (1000)', async () => {
      for (let i = 0; i < 1000; i++) {
        try {
          const session = await openStressSession(1, 2, 100000);
          const summary = await cashSessionService.getCashSessionSummary(session.id, 1);
          expect(summary).toBeDefined();
          expect(typeof summary.total).toBe('number');
          recordPass('cash', 'summary_valid');

          await cashSessionService.closeCashSession(session.id, 0, 0, 1, 2);
        } catch (e) {
          recordUnexpected('cash', 'summary_valid', i, e, 'HIGH');
        }
      }
    });

    it('3.6 Resumen cross-account → NOT_FOUND (500)', async () => {
      for (let i = 0; i < 500; i++) {
        try {
          const session = await openStressSession(1, 2, 100000);
          try {
            await cashSessionService.getCashSessionSummary(session.id, 2);
            recordUnexpected('cash', 'summary_cross_account', i, new Error('Should throw NOT_FOUND'), 'HIGH');
          } catch (e: any) {
            if (e?.code === ErrorCode.NOT_FOUND) {
              recordExpectedFailure('cash', 'summary_cross_account', i, ErrorCode.NOT_FOUND, 'LOW');
            } else {
              recordUnexpected('cash', 'summary_cross_account', i, e, 'MEDIUM');
            }
          }
          await cashSessionService.closeCashSession(session.id, 0, 0, 1, 2);
        } catch (e) {
          recordUnexpected('cash', 'summary_cross_account', i, e, 'MEDIUM');
        }
      }
    });

    it('3.7 Cerrar caja de otro usuario → FORBIDDEN (500)', async () => {
      for (let i = 0; i < 500; i++) {
        try {
          const session = await openStressSession(1, 2, 100000);
          try {
            await cashSessionService.closeCashSession(session.id, 0, 0, 1, 3);
            recordUnexpected('cash', 'close_other_user', i, new Error('Should throw FORBIDDEN'), 'HIGH');
          } catch (e: any) {
            if (e?.code === ErrorCode.FORBIDDEN) {
              recordExpectedFailure('cash', 'close_other_user', i, ErrorCode.FORBIDDEN, 'LOW');
            } else {
              recordUnexpected('cash', 'close_other_user', i, e, 'MEDIUM');
            }
          }
          await cashSessionService.closeCashSession(session.id, 0, 0, 1, 2);
        } catch (e) {
          recordUnexpected('cash', 'close_other_user', i, e, 'MEDIUM');
        }
      }
    });

    it('3.8 Auto-close de sesiones inactivas (500)', async () => {
      for (let i = 0; i < 500; i++) {
        try {
          const closed = await cashSessionService.autoCloseInactiveSessions(1);
          expect(Array.isArray(closed)).toBe(true);
          recordPass('cash', 'auto_close');
        } catch (e) {
          recordUnexpected('cash', 'auto_close', i, e, 'MEDIUM');
        }
      }
    });

    it('3.9 Touch activity (500)', async () => {
      for (let i = 0; i < 500; i++) {
        try {
          const session = await openStressSession(1, 2, 100000);
          await cashSessionService.touchActivity(2);
          await cashSessionService.closeCashSession(session.id, 0, 0, 1, 2);
          recordPass('cash', 'touch_activity');
        } catch (e) {
          recordUnexpected('cash', 'touch_activity', i, e, 'MEDIUM');
        }
      }
    });

    it('3.10 Totales del día (500)', async () => {
      for (let i = 0; i < 500; i++) {
        try {
          const total = await cashSessionService.getTodaySalesTotal(2);
          expect(typeof total).toBe('number');
          const methods = await cashSessionService.getTodayPaymentsByMethod(2);
          expect(typeof methods).toBe('object');
          recordPass('cash', 'daily_totals');
        } catch (e) {
          recordUnexpected('cash', 'daily_totals', i, e, 'MEDIUM');
        }
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 4. CUSTOMERS — 5 000 iteraciones
  // ─────────────────────────────────────────────────────────────────────
  stressDescribe('4. Customers (5 000 iteraciones)', { timeout: STRESS_TIMEOUT }, () => {

    it('4.1 CRUD de clientes (1500)', async () => {
      for (let i = 0; i < 1500; i++) {
        try {
          const name = `Cliente Stress ${Date.now()}-${i}`;
          const customer = await customerService.createCustomer({ name, phone: `300${randInt(1000000, 9999999)}` }, 1);
          expect(customer).toBeDefined();
          expect(customer.name).toBe(name);

          const updated = await customerService.updateCustomer(customer.id, { email: `test${i}@mail.com` }, 1);
          expect(updated.email).toBe(`test${i}@mail.com`);
          recordPass('customers', 'crud');
        } catch (e) {
          recordUnexpected('customers', 'crud', i, e, 'MEDIUM');
        }
      }
    });

    it('4.2 Búsqueda con caracteres especiales (1000)', async () => {
      const queries = ['%', '_', '%%', '', '   ', 'Cliente', '300', 'Cliente Stress', 'a\' OR 1=1', '<script>alert(1)</script>', 'null', 'undefined'];
      for (let i = 0; i < 1000; i++) {
        try {
          const q = i < queries.length ? queries[i] : `Cliente ${randInt(1, 100)}`;
          const results = await customerService.searchCustomers(q, 1);
          expect(Array.isArray(results)).toBe(true);
          recordPass('customers', 'search');
        } catch (e) {
          recordUnexpected('customers', 'search', i, e, 'MEDIUM');
        }
      }
    });

    it('4.3 Pago de deudas (1000)', async () => {
      for (let i = 0; i < 1000; i++) {
        try {
          const session = await openStressSession(1, 2, 200000);
          const products = (await inventoryService.getAllProducts({}, 1)).products;
          const p = pick(products);
          await ensureStock(p.id, 3);
          const total = Number(p.price) * 2;
          const sale = await salesService.createSale(
            session.id, 2,
            [{ productId: p.id, quantity: 2, unitPrice: Number(p.price), discount: 0 }],
            [{ method: 'credito', amount: total }],
            1, 0, 0, 1, true,
          );

          const debts = await customerService.getCustomerDebts(1, 1);
          if (debts.length > 0) {
            const debt = debts[0];
            const balanceNum = Number(debt.balance);
            if (balanceNum > 0.02) {
              const payAmount = +(balanceNum * randFloat(0.1, 0.9)).toFixed(2);
              const paid = await customerService.payDebt(debt.id, payAmount, 2, session.id, 1);
              expect(paid).toBeDefined();
              expect(Number(paid.balance)).toBeGreaterThanOrEqual(0);
              expect(Number(paid.balance)).toBeLessThan(balanceNum);
            }
          }
          recordPass('customers', 'pay_debt');

          await cashSessionService.closeCashSession(session.id, 0, 0, 1, 2);
        } catch (e) {
          recordUnexpected('customers', 'pay_debt', i, e, 'HIGH');
        }
      }
    });

    it('4.4 Pago excede saldo → VALIDATION (500)', async () => {
      for (let i = 0; i < 500; i++) {
        try {
          const session = await openStressSession(1, 2, 200000);
          const products = (await inventoryService.getAllProducts({}, 1)).products;
          const p = pick(products);
          await ensureStock(p.id, 5);
          const sale = await salesService.createSale(
            session.id, 2,
            [{ productId: p.id, quantity: 1, unitPrice: Number(p.price), discount: 0 }],
            [{ method: 'credito', amount: Number(p.price) }],
            1, 0, 0, 1, true,
          );
          const debts = await customerService.getCustomerDebts(1, 1);
          if (debts.length > 0) {
            const debt = debts[debts.length - 1];
            try {
              await customerService.payDebt(debt.id, 999999999, 2, session.id, 1);
              recordUnexpected('customers', 'pay_exceeds', i, new Error('Should throw'), 'MEDIUM');
            } catch (e: any) {
              if (e?.code === ErrorCode.VALIDATION) {
                recordExpectedFailure('customers', 'pay_exceeds', i, ErrorCode.VALIDATION, 'LOW');
              } else {
                recordUnexpected('customers', 'pay_exceeds', i, e, 'MEDIUM');
              }
            }
          }
          await cashSessionService.closeCashSession(session.id, 0, 0, 1, 2);
        } catch (e) {
          recordUnexpected('customers', 'pay_exceeds', i, e, 'MEDIUM');
        }
      }
    });

    it('4.5 Historial de cliente (1000)', async () => {
      for (let i = 0; i < 1000; i++) {
        try {
          const history = await customerService.getCustomerHistory(1, 1);
          expect(history).toBeDefined();
          expect(history.customer).toBeDefined();
          expect(Array.isArray(history.sales)).toBe(true);
          recordPass('customers', 'history');
        } catch (e) {
          recordUnexpected('customers', 'history', i, e, 'MEDIUM');
        }
      }
    });

    it('4.6 Cliente inexistente → NOT_FOUND (500)', async () => {
      for (let i = 0; i < 500; i++) {
        try {
          await customerService.getCustomerHistory(99999, 1);
          recordUnexpected('customers', 'not_found', i, new Error('Should throw'), 'MEDIUM');
        } catch (e: any) {
          if (e?.code === ErrorCode.NOT_FOUND) {
            recordExpectedFailure('customers', 'not_found', i, ErrorCode.NOT_FOUND, 'LOW');
          } else {
            recordUnexpected('customers', 'not_found', i, e, 'MEDIUM');
          }
        }
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 5. QUOTES / COTIZACIONES — 5 000 iteraciones
  // ─────────────────────────────────────────────────────────────────────
  stressDescribe('5. Quotes / Cotizaciones (5 000 iteraciones)', { timeout: STRESS_TIMEOUT }, () => {

    it('5.1 Crear/actualizar/eliminar cotizaciones (2000)', async () => {
      const products = (await inventoryService.getAllProducts({}, 1)).products;
      for (let i = 0; i < 2000; i++) {
        try {
          const p = pick(products);
          const items = [{ productId: p.id, quantity: randInt(1, 5), unitPrice: Number(p.price), discount: 0 }];
          const quote = await quoteService.create(2, 1, items, undefined, randFloat(0, 5000));
          expect(quote).toBeDefined();
          expect(quote.status).toBe('QUOTE');

          const updated = await quoteService.update(quote.id, 2, 1, items, undefined, randFloat(0, 1000));
          expect(updated).toBeDefined();

          await quoteService.delete(quote.id, 2, 1);
          const check = await quoteService.getById(quote.id, 1);
          expect(check).toBeNull();
          recordPass('quotes', 'crud');
        } catch (e) {
          recordUnexpected('quotes', 'crud', i, e, 'HIGH');
        }
      }
    });

    it('5.2 Convertir cotización a venta (1000)', async () => {
      const products = (await inventoryService.getAllProducts({}, 1)).products;
      for (let i = 0; i < 1000; i++) {
        try {
          const p = pick(products);
          await ensureStock(p.id, 2);
          const items = [{ productId: p.id, quantity: 1, unitPrice: Number(p.price), discount: 0 }];
          const quote = await quoteService.create(2, 1, items);
          const session = await openStressSession(1, 2, 100000);

          const sale = await quoteService.convertToSale(quote.id, session.id, 2, [{ method: 'efectivo', amount: Number(p.price) + 1000 }], 1);
          expect(sale).toBeDefined();
          expect(sale.status).toBe('COMPLETED');
          recordPass('quotes', 'convert');

          await cashSessionService.closeCashSession(session.id, 0, 0, 1, 2);
        } catch (e) {
          recordUnexpected('quotes', 'convert', i, e, 'HIGH');
        }
      }
    });

    it('5.3 Cotización vacía → EMPTY_CART (500)', async () => {
      for (let i = 0; i < 500; i++) {
        try {
          await quoteService.create(2, 1, []);
          recordUnexpected('quotes', 'empty', i, new Error('Should throw'), 'MEDIUM');
        } catch (e: any) {
          if (e?.code === ErrorCode.EMPTY_CART) {
            recordExpectedFailure('quotes', 'empty', i, ErrorCode.EMPTY_CART, 'LOW');
          } else {
            recordUnexpected('quotes', 'empty', i, e, 'MEDIUM');
          }
        }
      }
    });

    it('5.4 Listar cotizaciones (500)', async () => {
      for (let i = 0; i < 500; i++) {
        try {
          const quotes = await quoteService.list(2, 1);
          expect(Array.isArray(quotes)).toBe(true);
          recordPass('quotes', 'list');
        } catch (e) {
          recordUnexpected('quotes', 'list', i, e, 'MEDIUM');
        }
      }
    });

    it('5.5 Convertir con stock insuficiente (500)', async () => {
      for (let i = 0; i < 500; i++) {
        try {
          const products = (await inventoryService.getAllProducts({}, 1)).products;
          const lowStock = products.find(p => p.stock === 0) || pick(products);
          const items = [{ productId: lowStock.id, quantity: 99999, unitPrice: Number(lowStock.price), discount: 0 }];
          const quote = await quoteService.create(2, 1, items);
          const session = await openStressSession(1, 2, 100000);

          try {
            await quoteService.convertToSale(quote.id, session.id, 2, [{ method: 'efectivo', amount: 999999999999 }], 1);
            recordUnexpected('quotes', 'convert_insufficient', i, new Error('Should throw'), 'MEDIUM');
          } catch (e: any) {
            if (e?.code === ErrorCode.INSUFFICIENT_STOCK || e?.code === ErrorCode.PRODUCT_NOT_FOUND) {
              recordExpectedFailure('quotes', 'convert_insufficient', i, e.code, 'LOW');
            } else {
              recordUnexpected('quotes', 'convert_insufficient', i, e, 'MEDIUM');
            }
          }
          await cashSessionService.closeCashSession(session.id, 0, 0, 1, 2);
        } catch (e) {
          recordUnexpected('quotes', 'convert_insufficient', i, e, 'MEDIUM');
        }
      }
    });

    it('5.6 Cotización cross-account (500)', async () => {
      for (let i = 0; i < 500; i++) {
        try {
          const products = (await inventoryService.getAllProducts({}, 1)).products;
          const p = pick(products);
          const quote = await quoteService.create(2, 1, [{ productId: p.id, quantity: 1, unitPrice: Number(p.price), discount: 0 }]);
          const check = await quoteService.getById(quote.id, 2);
          expect(check).toBeNull();
          recordPass('quotes', 'cross_account');
        } catch (e) {
          recordUnexpected('quotes', 'cross_account', i, e, 'MEDIUM');
        }
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 6. PURCHASE ORDERS — 4 000 iteraciones
  // ─────────────────────────────────────────────────────────────────────
  stressDescribe('6. Purchase Orders (4 000 iteraciones)', { timeout: STRESS_TIMEOUT }, () => {

    it('6.1 Lifecycle completo DRAFT→CONFIRMED→SENT→RECEIVED (1000)', async () => {
      for (let i = 0; i < 1000; i++) {
        try {
          const products = (await inventoryService.getAllProducts({}, 1)).products;
          const p = pick(products);
          const order = await purchaseService.createPurchaseOrder(1, {
            supplierId: 1,
            items: [{ productId: p.id, quantityOrdered: randInt(10, 100), unitCost: Number(p.cost) || 500 }],
            freight: randFloat(0, 50000),
          }, 1);
          expect(order.status).toBe('DRAFT');

          await purchaseService.updatePurchaseOrderStatus(order.id, 'CONFIRMED', 1);
          await purchaseService.updatePurchaseOrderStatus(order.id, 'SENT', 1);

          const received = await purchaseService.receiveItems(order.id, 1, [{
            orderItemId: order.items![0].id,
            received: true,
            quantityReceived: order.items![0].quantityOrdered,
          }], 1);
          expect(received.status).toBe('RECEIVED');
          recordPass('purchase', 'lifecycle');
        } catch (e) {
          recordUnexpected('purchase', 'lifecycle', i, e, 'HIGH');
        }
      }
    });

    it('6.2 Editar/eliminar solo DRAFT (1000)', async () => {
      for (let i = 0; i < 1000; i++) {
        try {
          const products = (await inventoryService.getAllProducts({}, 1)).products;
          const p = pick(products);
          const order = await purchaseService.createPurchaseOrder(1, {
            supplierId: 1,
            items: [{ productId: p.id, quantityOrdered: 50, unitCost: Number(p.cost) || 500 }],
          }, 1);

          await purchaseService.updatePurchaseOrderStatus(order.id, 'CONFIRMED', 1);
          try {
            await purchaseService.updatePurchaseOrder(order.id, { freight: 1000 }, 1);
            recordUnexpected('purchase', 'edit_non_draft', i, new Error('Should throw'), 'MEDIUM');
          } catch (e: any) {
            if (e?.code === ErrorCode.VALIDATION) {
              recordExpectedFailure('purchase', 'edit_non_draft', i, ErrorCode.VALIDATION, 'LOW');
            } else {
              recordUnexpected('purchase', 'edit_non_draft', i, e, 'MEDIUM');
            }
          }
          recordPass('purchase', 'edit_guard');
        } catch (e) {
          recordUnexpected('purchase', 'edit_guard', i, e, 'MEDIUM');
        }
      }
    });

    it('6.3 Recepción parcial (1000)', async () => {
      for (let i = 0; i < 1000; i++) {
        try {
          const products = (await inventoryService.getAllProducts({}, 1)).products;
          const p = pick(products);
          const order = await purchaseService.createPurchaseOrder(1, {
            supplierId: 1,
            items: [{ productId: p.id, quantityOrdered: 100, unitCost: Number(p.cost) || 500 }],
          }, 1);
          await purchaseService.updatePurchaseOrderStatus(order.id, 'CONFIRMED', 1);
          await purchaseService.updatePurchaseOrderStatus(order.id, 'SENT', 1);

          const partial = await purchaseService.receiveItems(order.id, 1, [{
            orderItemId: order.items![0].id,
            received: false,
            quantityReceived: randInt(1, 99),
          }], 1);
          expect(partial.status).not.toBe('RECEIVED');
          recordPass('purchase', 'partial_receive');
        } catch (e) {
          recordUnexpected('purchase', 'partial_receive', i, e, 'MEDIUM');
        }
      }
    });

    it('6.4 Eliminar proveedor con pedidos → VALIDATION (500)', async () => {
      for (let i = 0; i < 500; i++) {
        try {
          const products = (await inventoryService.getAllProducts({}, 1)).products;
          await purchaseService.createPurchaseOrder(1, {
            supplierId: 1,
            items: [{ productId: products[0].id, quantityOrdered: 10, unitCost: 500 }],
          }, 1);
          try {
            await purchaseService.deleteSupplier(1, 1);
            recordUnexpected('purchase', 'delete_supplier_with_orders', i, new Error('Should throw'), 'MEDIUM');
          } catch (e: any) {
            if (e?.code === ErrorCode.VALIDATION) {
              recordExpectedFailure('purchase', 'delete_supplier_with_orders', i, ErrorCode.VALIDATION, 'LOW');
            } else {
              recordUnexpected('purchase', 'delete_supplier_with_orders', i, e, 'MEDIUM');
            }
          }
          recordPass('purchase', 'supplier_guard');
        } catch (e) {
          recordUnexpected('purchase', 'supplier_guard', i, e, 'MEDIUM');
        }
      }
    });

    it('6.5 Resumen de compras (500)', async () => {
      for (let i = 0; i < 500; i++) {
        try {
          const summary = await purchaseService.getPurchaseSummary(1);
          expect(summary).toBeDefined();
          expect(typeof summary.totalOrders).toBe('number');
          recordPass('purchase', 'summary');
        } catch (e) {
          recordUnexpected('purchase', 'summary', i, e, 'MEDIUM');
        }
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 7. REPORTS / EXPORT — 3 000 iteraciones
  // ─────────────────────────────────────────────────────────────────────
  stressDescribe('7. Reports & Export (3 000 iteraciones)', { timeout: 1_800_000 }, () => {

    it('7.1 Exportaciones CSV/XLSX (1000)', async () => {
      for (let i = 0; i < 1000; i++) {
        try {
          const format = pick(['csv', 'xlsx'] as const);
          const type = pick(['inventory', 'sales', 'audit', 'cash', 'noRotation'] as const);
          let path: string;
          switch (type) {
            case 'inventory': path = await exportService.exportInventory(format, 1); break;
            case 'sales': path = await exportService.exportSales(undefined, undefined, undefined, format, 1); break;
            case 'audit': path = await exportService.exportAudit(undefined, undefined, format, 1); break;
            case 'cash': path = await exportService.exportCashSessions(undefined, undefined, format, 1); break;
            case 'noRotation': path = await exportService.exportNoRotation(format, 1); break;
          }
          recordPass('reports', `export_${type}_${format}`);
        } catch (e) {
          recordUnexpected('reports', 'export', i, e, 'MEDIUM');
        }
      }
    });

    it('7.2 Queries de dashboard (1000)', async () => {
      for (let i = 0; i < 1000; i++) {
        try {
          const dash = await salesService.getDashboardSummary(1);
          expect(dash).toBeDefined();
          expect(typeof dash.today.totalVendidos).toBe('number');
          expect(typeof dash.monthToDate.totalVentas).toBe('number');
          expect(Array.isArray(dash.topProducts)).toBe(true);
          expect(Array.isArray(dash.weeklyChart)).toBe(true);
          recordPass('reports', 'dashboard');
        } catch (e) {
          recordUnexpected('reports', 'dashboard', i, e, 'MEDIUM');
        }
      }
    });

    it('7.3 Nómina (500)', async () => {
      for (let i = 0; i < 500; i++) {
        try {
          const period = pick(['daily', 'weekly', 'monthly'] as const);
          const result = await payrollService.getPayroll(period, '2026-01-01', '2026-01-31', 1);
          expect(result).toBeDefined();
          expect(Array.isArray(result.users)).toBe(true);
          recordPass('reports', 'payroll');
        } catch (e) {
          recordUnexpected('reports', 'payroll', i, e, 'MEDIUM');
        }
      }
    });

    it('7.4 Auditoría (500)', async () => {
      for (let i = 0; i < 500; i++) {
        try {
          const logs = await auditService.getAuditLogs({ limit: 100, accountId: 1 });
          expect(Array.isArray(logs)).toBe(true);
          recordPass('reports', 'audit');
        } catch (e) {
          recordUnexpected('reports', 'audit', i, e, 'MEDIUM');
        }
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 8. MULTI-TENANT ISOLATION — 3 000 iteraciones
  // ─────────────────────────────────────────────────────────────────────
  stressDescribe('8. Multi-Tenant Isolation (3 000 iteraciones)', { timeout: STRESS_TIMEOUT }, () => {

    it('8.1 Cross-account sale access (500)', async () => {
      for (let i = 0; i < 500; i++) {
        try {
          const session = await openStressSession(1, 2, 100000);
          const products = (await inventoryService.getAllProducts({}, 1)).products;
          const p = pick(products);
          await ensureStock(p.id, 2);
          const sale = await salesService.createSale(
            session.id, 2,
            [{ productId: p.id, quantity: 1, unitPrice: Number(p.price), discount: 0 }],
            [{ method: 'efectivo', amount: Number(p.price) + 1000 }],
            1,
          );
          const crossAccount = await salesService.getSaleById(sale.id, 2);
          expect(crossAccount).toBeNull();
          recordPass('tenant', 'cross_account_sale');

          await cashSessionService.closeCashSession(session.id, 0, 0, 1, 2);
        } catch (e) {
          recordUnexpected('tenant', 'cross_account_sale', i, e, 'HIGH');
        }
      }
    });

    it('8.2 Cross-account inventory (500)', async () => {
      for (let i = 0; i < 500; i++) {
        try {
          const acct1Products = await inventoryService.getAllProducts({}, 1);
          const acct2Products = await inventoryService.getAllProducts({}, 2);
          const acct1Ids = new Set(acct1Products.products.map(p => p.id));
          const overlap = acct2Products.products.filter(p => acct1Ids.has(p.id));
          expect(overlap.length).toBe(0);
          recordPass('tenant', 'cross_account_inventory');
        } catch (e) {
          recordUnexpected('tenant', 'cross_account_inventory', i, e, 'HIGH');
        }
      }
    });

    it('8.3 Cross-account customer (500)', async () => {
      for (let i = 0; i < 500; i++) {
        try {
          const results = await customerService.searchCustomers('Cliente', 2);
          const acct1 = results.filter((c: any) => c.accountId === 1);
          expect(acct1.length).toBe(0);
          recordPass('tenant', 'cross_account_customer');
        } catch (e) {
          recordUnexpected('tenant', 'cross_account_customer', i, e, 'HIGH');
        }
      }
    });

    it('8.4 Branch isolation (500)', async () => {
      for (let i = 0; i < 500; i++) {
        try {
          try {
            await openStressSession(1, 2, 10000, 3);
            recordUnexpected('tenant', 'branch_isolation', i, new Error('Should throw FORBIDDEN'), 'HIGH');
          } catch (e: any) {
            if (e?.code === ErrorCode.FORBIDDEN) {
              recordExpectedFailure('tenant', 'branch_isolation', i, ErrorCode.FORBIDDEN, 'LOW');
            } else {
              recordUnexpected('tenant', 'branch_isolation', i, e, 'MEDIUM');
            }
          }
        } catch (e) {
          recordUnexpected('tenant', 'branch_isolation', i, e, 'MEDIUM');
        }
      }
    });

    it('8.5 AccountId null → FORBIDDEN (500)', async () => {
      for (let i = 0; i < 500; i++) {
        try {
          const products = (await inventoryService.getAllProducts({}, 1)).products;
          const p = pick(products);
          await ensureStock(p.id, 2);
          const session = await openStressSession(1, 2, 100000);
          try {
            await salesService.createSale(
              session.id, 2,
              [{ productId: p.id, quantity: 1, unitPrice: Number(p.price), discount: 0 }],
              [{ method: 'efectivo', amount: Number(p.price) + 1000 }],
              99999,
            );
            recordUnexpected('tenant', 'null_account', i, new Error('Should throw'), 'HIGH');
          } catch (e: any) {
            if (e?.code === ErrorCode.FORBIDDEN || e?.code === ErrorCode.NOT_FOUND) {
              recordExpectedFailure('tenant', 'null_account', i, e.code, 'LOW');
            } else {
              recordUnexpected('tenant', 'null_account', i, e, 'MEDIUM');
            }
          }
          await cashSessionService.closeCashSession(session.id, 0, 0, 1, 2);
        } catch (e) {
          recordUnexpected('tenant', 'null_account', i, e, 'MEDIUM');
        }
      }
    });

    it('8.6 Caja cross-account (500)', async () => {
      for (let i = 0; i < 500; i++) {
        try {
          const session = await openStressSession(1, 2, 100000);
          try {
            await cashSessionService.getCashSessionSummary(session.id, 2);
            recordUnexpected('tenant', 'cash_cross_account', i, new Error('Should throw'), 'HIGH');
          } catch (e: any) {
            if (e?.code === ErrorCode.NOT_FOUND) {
              recordExpectedFailure('tenant', 'cash_cross_account', i, ErrorCode.NOT_FOUND, 'LOW');
            } else {
              recordUnexpected('tenant', 'cash_cross_account', i, e, 'MEDIUM');
            }
          }
          await cashSessionService.closeCashSession(session.id, 0, 0, 1, 2);
        } catch (e) {
          recordUnexpected('tenant', 'cash_cross_account', i, e, 'MEDIUM');
        }
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// GENERADOR DE REPORTE
// ═══════════════════════════════════════════════════════════════════════
function generateReport(): void {
  const byModule: Record<string, { passed: number; failed: number; expected: number }> = {};
  const bySeverity: Record<string, number> = {};
  const byError: Record<string, { count: number; scenarios: string[]; example: string }> = {};
  const distinctMessages: Record<string, { count: number; scenarios: string[] }> = {};

  for (const s of Object.values(scenarioStats)) {
    const m = (byModule[s.module] ??= { passed: 0, failed: 0, expected: 0 });
    m.passed += s.passed;
    m.failed += s.failed;
    m.expected += s.expected;
  }

  for (const f of failures) {
    bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
    const code = f.errorCode || 'UNKNOWN';
    const err = (byError[code] ??= { count: 0, scenarios: [], example: '' });
    err.count++;
    if (!err.scenarios.includes(f.scenario)) err.scenarios.push(f.scenario);
    if (!err.example || err.example === 'UNKNOWN') err.example = f.error;
    const msg = (distinctMessages[f.error] ??= { count: 0, scenarios: [] });
    msg.count++;
    if (!msg.scenarios.includes(f.scenario)) msg.scenarios.push(f.scenario);
  }

  const statMod = (code: string) => {
    const order: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    return order[code] ?? 4;
  };

  const lines: string[] = [
    '# TuCajero V3 — Reporte de Pruebas de Estrés',
    '',
    `**Fecha:** ${new Date().toISOString()}`,
    `**Total iteraciones:** ${totalIterations}`,
    `**Pasaron:** ${totalPassed}`,
    `**Fallos inesperados:** ${totalFailed}`,
    `**Fallos esperados (validación):** ${totalExpected}`,
    `**Tasa de éxito:** ${totalIterations > 0 ? ((totalPassed / totalIterations) * 100).toFixed(2) : '0'}%`,
    '',
    '---',
    '',
    '## Resumen por Módulo',
    '',
    '| Módulo | Iteraciones | Pasaron | Fallos | Esperados | Tasa fallo |',
    '|--------|------------|---------|--------|-----------|------------|',
  ];

  for (const [mod, data] of Object.entries(byModule)) {
    const total = data.passed + data.failed + data.expected;
    lines.push(`| ${mod} | ${total} | ${data.passed} | ${data.failed} | ${data.expected} | ${total > 0 ? ((data.failed / total) * 100).toFixed(2) : '0'}% |`);
  }

  lines.push('', '## Fallos por Criticidad', '', '| Criticidad | Cantidad |', '|------------|----------|');
  for (const [sev, count] of Object.entries(bySeverity).sort((a, b) => statMod(a[0]) - statMod(b[0]))) {
    lines.push(`| ${sev} | ${count} |`);
  }

  lines.push('', '## Detalle de Fallos por Error', '', '| Error Code | Ocurrencias | Ejemplo | Escenarios |', '|------------|-------------|---------|------------|');
  for (const [code, data] of Object.entries(byError).sort((a, b) => b[1].count - a[1].count)) {
    lines.push(`| ${code} | ${data.count} | ${(data.example ?? '').substring(0, 70)} | ${data.scenarios.join(', ')} |`);
  }

  lines.push('', '## Mensajes de Error Más Frecuentes', '', '| Mensaje | Ocurrencias | Escenarios |', '|---------|-------------|------------|');
  for (const [msg, data] of Object.entries(distinctMessages).sort((a, b) => b[1].count - a[1].count).slice(0, 25)) {
    lines.push(`| ${msg.substring(0, 90)} | ${data.count} | ${data.scenarios.slice(0, 5).join(', ')} |`);
  }

  lines.push('', '## Estado de cada Escenario', '', '| Escenario | Iteraciones | Pasaron | Fallos | Esperados |', '|-----------|------------|---------|--------|-----------|');
  const sortedScenarios = Object.entries(scenarioStats).sort((a, b) => (b[1].failed + b[1].expected + b[1].passed) - (a[1].failed + a[1].expected + a[1].passed));
  for (const [scenario, data] of sortedScenarios) {
    lines.push(`| ${scenario} | ${data.passed + data.failed + data.expected} | ${data.passed} | ${data.failed} | ${data.expected} |`);
  }

  if (failures.length > 0) {
    lines.push('', '## Muestra de Fallos (primeros 100)', '', '| # | Módulo | Escenario | Severidad | Error |', '|---|--------|-----------|-----------|-------|');
    for (const f of failures.slice(0, 100)) {
      lines.push(`| ${f.iteration} | ${f.module} | ${f.scenario} | ${f.severity} | ${f.error.substring(0, 80)} |`);
    }
  }

  lines.push('', '---', '', '*Generado automáticamente por massive-stress.test.ts*');

  try {
    writeFileSync(join(process.cwd(), 'tests', 'STRESS_REPORT.md'), lines.join('\n'), 'utf-8');
  } catch {
    // Fallback
    writeFileSync(join(dir, 'STRESS_REPORT.md'), lines.join('\n'), 'utf-8');
  }
}
