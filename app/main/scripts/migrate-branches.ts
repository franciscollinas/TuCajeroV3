import { eq, isNull } from 'drizzle-orm';
import { getDatabase, schema } from '../db';

export async function migrateBranches(): Promise<{ branchId: number; message: string }> {
  const db = getDatabase();

  const existing = await db
    .select({ id: schema.branches.id })
    .from(schema.branches)
    .where(eq(schema.branches.isActive, true))
    .limit(1);

  if (existing.length > 0) {
    return { branchId: existing[0].id, message: 'Ya existe una sucursal activa.' };
  }

  const now = new Date().toISOString();

  const [branch] = await db
    .insert(schema.branches)
    .values({
      accountId: 1,
      name: 'Sucursal Principal',
      code: 'PRINCIPAL',
      address: null,
      phone: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  // Assign all existing cash sessions to this branch
  await db
    .update(schema.cashSessions)
    .set({ branchId: branch.id })
    .where(isNull(schema.cashSessions.branchId));

  // Assign all existing sales to this branch
  await db
    .update(schema.sales)
    .set({ branchId: branch.id })
    .where(isNull(schema.sales.branchId));

  // Assign all existing purchase orders to this branch
  await db
    .update(schema.purchaseOrders)
    .set({ branchId: branch.id })
    .where(isNull(schema.purchaseOrders.branchId));

  // Assign all existing stock movements to this branch
  await db
    .update(schema.stockMovements)
    .set({ branchId: branch.id })
    .where(isNull(schema.stockMovements.branchId));

  // Create BranchStock entries for all products
  const products = await db
    .select({ id: schema.products.id, stock: schema.products.stock, minStock: schema.products.minStock, criticalStock: schema.products.criticalStock, location: schema.products.location, expiryDate: schema.products.expiryDate })
    .from(schema.products);

  for (const product of products) {
    await db.insert(schema.branchStocks).values({
      branchId: branch.id,
      productId: product.id,
      stock: product.stock,
      minStock: product.minStock,
      criticalStock: product.criticalStock,
      location: product.location,
      expiryDate: product.expiryDate,
    }).onConflictDoNothing({ target: [schema.branchStocks.branchId, schema.branchStocks.productId] });
  }

  await db
    .update(schema.users)
    .set({ branchId: branch.id })
    .where(isNull(schema.users.branchId));

  return { branchId: branch.id, message: `Sucursal "${branch.name}" creada y datos migrados.` };
}