import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, mkdirSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

const dir = join(tmpdir(), `tucajero-inventory-${Date.now()}`);
const dbPath = join(dir, 'test.db');

process.env.DATABASE_URL = dbPath;

const { productCreateInputSchema, productUpdateInputSchema } = await import('../app/main/router/inventory-schemas');
const { InventoryService } = await import('../app/main/services/inventory.service');
const { closeDatabase } = await import('../app/main/db');

const service = new InventoryService();

let nativeDbAvailable = true;
try {
  const probe = new Database(':memory:');
  probe.close();
} catch {
  nativeDbAvailable = false;
}

// better-sqlite3 está compilado para el ABI de Electron; si se ejecuta vitest con
// el Node del sistema y el binario no coincide (NODE_MODULE_VERSION), se salta.
const serviceDescribe = nativeDbAvailable ? describe : describe.skip;

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
      VALUES ('Cuenta Test', '900000001', 'test@test.com', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    INSERT INTO "User" (username, password, fullName, role, active, accountId, createdAt, updatedAt)
      VALUES ('admin', 'hash', 'Admin', 'ADMIN', 1, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    INSERT INTO "Category" (name, color, accountId, createdAt, updatedAt)
      VALUES ('Bebidas', '#ff0000', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `);
  sqlite.close();
}

describe('Schemas de producto (inventory)', () => {
  it('conserva categoryId en el alta (regresión)', () => {
    const parsed = productCreateInputSchema.parse({
      code: 'P001',
      name: 'Coca Cola',
      categoryId: 3,
      price: 3000,
      cost: 2500,
      stock: 10,
      userId: 1,
    });
    expect(parsed.categoryId).toBe(3);
  });

  it('conserva categoryName como alternativa de compatibilidad', () => {
    const parsed = productCreateInputSchema.parse({
      code: 'P002',
      name: 'Papas',
      categoryName: 'Snacks',
      price: 1500,
      cost: 1000,
      stock: 5,
      userId: 1,
    });
    expect(parsed.categoryName).toBe('Snacks');
  });

  it('conserva los campos editables en update (regresión)', () => {
    const parsed = productUpdateInputSchema.parse({
      code: 'NUEVO',
      barcode: '770000099',
      description: 'Nueva descripción',
      categoryId: 2,
      unitType: 'KG',
      conversionFactor: 2,
    });
    expect(parsed.code).toBe('NUEVO');
    expect(parsed.barcode).toBe('770000099');
    expect(parsed.description).toBe('Nueva descripción');
    expect(parsed.categoryId).toBe(2);
    expect(parsed.unitType).toBe('KG');
    expect(parsed.conversionFactor).toBe(2);
  });

  it('conserva el stock en la edición', () => {
    const parsed = productUpdateInputSchema.parse({ stock: 999 });
    expect(parsed.stock).toBe(999);
  });
});

serviceDescribe('InventoryService.createProduct', () => {
  beforeAll(() => {
    createDatabase();
  });

  afterAll(() => {
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it('crea el producto con categoryId y registra el movimiento de stock', async () => {
    const created = await service.createProduct(
      {
        code: 'P001',
        name: 'Coca Cola',
        categoryId: 1,
        price: 3000,
        cost: 2500,
        stock: 10,
        userId: 1,
      },
      1,
    );

    expect(created.id).toBeGreaterThan(0);
    expect(created.code).toBe('P001');
    expect(created.stock).toBe(10);
    expect(created.category.id).toBe(1);
    expect(created.category.name).toBe('Bebidas');
    expect(created.stockMovements).toHaveLength(1);
    expect(created.stockMovements![0].type).toBe('entrada');
    expect(created.stockMovements![0].quantity).toBe(10);
    expect(created.stockMovements![0].newStock).toBe(10);

    const sqlite = new Database(dbPath, { readonly: true });
    try {
      const movement = sqlite
        .prepare('SELECT "accountId", "productId", "type", "quantity" FROM "StockMovement" WHERE "productId" = ?')
        .get(created.id) as { accountId: number | null; productId: number; type: string; quantity: number };
      expect(movement.accountId).toBe(1);
      expect(movement.type).toBe('entrada');
      expect(movement.quantity).toBe(10);
    } finally {
      sqlite.close();
    }
  });

  it('rechaza el alta sin categoría', async () => {
    await expect(
      service.createProduct(
        {
          code: 'P002',
          name: 'Sin categoría',
          price: 1000,
          cost: 800,
          stock: 1,
          userId: 1,
        },
        1,
      ),
    ).rejects.toThrow('La categoría es obligatoria.');
  });

  it('rechaza códigos duplicados', async () => {
    await expect(
      service.createProduct(
        {
          code: 'P001',
          name: 'Duplicado',
          categoryId: 1,
          price: 1000,
          cost: 800,
          stock: 1,
          userId: 1,
        },
        1,
      ),
    ).rejects.toThrow('Ya existe un producto con ese código o barcode.');
  });

  it('actualiza código, descripción, categoría y unidad y ajusta el stock', async () => {
    const updated = await service.updateProduct(
      1,
      {
        code: 'P001-X',
        barcode: '770000099',
        description: 'Nueva descripción',
        categoryId: 1,
        unitType: 'paquete',
        conversionFactor: 2,
        stock: 999,
        userId: 1,
      },
      1,
    );

    expect(updated.code).toBe('P001-X');
    expect(updated.barcode).toBe('770000099');
    expect(updated.description).toBe('Nueva descripción');
    expect(updated.unitType).toBe('paquete');
    expect(updated.conversionFactor).toBe(2);
    expect(updated.stock).toBe(999);

    const sqlite = new Database(dbPath, { readonly: true });
    try {
      const movement = sqlite
        .prepare('SELECT "type", "quantity", "reason" FROM "StockMovement" WHERE "productId" = ? ORDER BY id DESC LIMIT 1')
        .get(1) as { type: string; quantity: number; reason: string };
      expect(movement.type).toBe('entrada');
      expect(movement.quantity).toBe(989);
      expect(movement.reason).toBe('Ajuste por edición de producto');
    } finally {
      sqlite.close();
    }
  });
});
