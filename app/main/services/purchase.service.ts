import { eq, and, desc, asc, like } from 'drizzle-orm';

import { getDatabase, schema } from '../db';
import { AppError, ErrorCode } from '../utils/errors';
import { nowISO } from '../utils/date';
import type {
  Supplier,
  PurchaseOrder,
  PurchaseOrderStatus,
  CreateSupplierInput,
  CreatePurchaseOrderInput,
  ReceiveItemInput,
  PurchaseSummary,
} from '../../renderer/src/shared/types/purchase.types';

async function buildOrderNumber(): Promise<string> {
  const db = getDatabase();
  const year = new Date().getFullYear();
  const prefix = `PO-${year}-`;

  const [last] = await db
    .select({ orderNumber: schema.purchaseOrders.orderNumber })
    .from(schema.purchaseOrders)
    .where(like(schema.purchaseOrders.orderNumber, `${prefix}%`))
    .orderBy(desc(schema.purchaseOrders.orderNumber))
    .limit(1);

  const nextNumber = last ? Number(last.orderNumber.split('-')[2]) + 1 : 1;
  return `${prefix}${String(nextNumber).padStart(4, '0')}`;
}

export class PurchaseService {
  async getAllSuppliers(accountId?: number | null): Promise<Supplier[]> {
    const db = getDatabase();
    const rows = await db
      .select()
      .from(schema.suppliers)
      .where(accountId ? eq(schema.suppliers.accountId, accountId) : undefined)
      .orderBy(asc(schema.suppliers.name));

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      contactPerson: r.contactPerson ?? undefined,
      phone: r.phone,
      email: r.email ?? '',
      address: r.address ?? '',
      leadTimeDays: r.leadTimeDays,
      isActive: r.isActive,
      notes: r.notes ?? undefined,
      createdAt: r.createdAt,
    }));
  }

  async getSupplierById(id: number, accountId?: number | null): Promise<Supplier | null> {
    const db = getDatabase();
    const [row] = await db
      .select()
      .from(schema.suppliers)
      .where(and(eq(schema.suppliers.id, id), ...(accountId ? [eq(schema.suppliers.accountId, accountId)] : [])))
      .limit(1);

    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      contactPerson: row.contactPerson ?? undefined,
      phone: row.phone,
      email: row.email ?? '',
      address: row.address ?? '',
      leadTimeDays: row.leadTimeDays,
      isActive: row.isActive,
      notes: row.notes ?? undefined,
      createdAt: row.createdAt,
    };
  }

  async createSupplier(data: CreateSupplierInput, accountId?: number | null): Promise<Supplier> {
    const db = getDatabase();
    const now = nowISO();

    const [row] = await db
      .insert(schema.suppliers)
      .values({
        accountId: accountId ?? null,
        name: data.name,
        contactPerson: data.contactPerson ?? null,
        phone: data.phone,
        email: data.email ?? '',
        address: data.address ?? '',
        leadTimeDays: data.leadTimeDays ?? 7,
        isActive: data.isActive ?? true,
        notes: data.notes ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return {
      id: row.id,
      name: row.name,
      contactPerson: row.contactPerson ?? undefined,
      phone: row.phone,
      email: row.email ?? '',
      address: row.address ?? '',
      leadTimeDays: row.leadTimeDays,
      isActive: row.isActive,
      notes: row.notes ?? undefined,
      createdAt: row.createdAt,
    };
  }

  async updateSupplier(id: number, data: Partial<CreateSupplierInput>, accountId?: number | null): Promise<Supplier> {
    const db = getDatabase();
    const now = nowISO();

    await db
      .update(schema.suppliers)
      .set({
        name: data.name,
        contactPerson: data.contactPerson ?? undefined,
        phone: data.phone,
        email: data.email,
        address: data.address,
        leadTimeDays: data.leadTimeDays,
        isActive: data.isActive,
        notes: data.notes,
        updatedAt: now,
      })
      .where(and(eq(schema.suppliers.id, id), ...(accountId ? [eq(schema.suppliers.accountId, accountId)] : [])));

    return (await this.getSupplierById(id))!;
  }

  async deleteSupplier(id: number, accountId?: number | null): Promise<{ success: true }> {
    const db = getDatabase();

    const [order] = await db
      .select({ id: schema.purchaseOrders.id })
      .from(schema.purchaseOrders)
      .where(and(eq(schema.purchaseOrders.supplierId, id), ...(accountId ? [eq(schema.purchaseOrders.accountId, accountId)] : [])))
      .limit(1);

    if (order) {
      throw new AppError(ErrorCode.VALIDATION, 'No se puede eliminar proveedor con pedidos asociados.');
    }

    await db.delete(schema.suppliers).where(eq(schema.suppliers.id, id));
    return { success: true };
  }

  async getPurchaseOrders(branchId?: number, accountId?: number | null): Promise<PurchaseOrder[]> {
    const db = getDatabase();

    const conditions = [];
    if (branchId) conditions.push(eq(schema.purchaseOrders.branchId, branchId));
    if (accountId) conditions.push(eq(schema.purchaseOrders.accountId, accountId));

    const orders = await db
      .select()
      .from(schema.purchaseOrders)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(schema.purchaseOrders.createdAt));

    return Promise.all(orders.map((o) => this.enrichPurchaseOrder(o)));
  }

  async getPurchaseOrderById(id: number, accountId?: number | null): Promise<PurchaseOrder | null> {
    const db = getDatabase();

    const [order] = await db
      .select()
      .from(schema.purchaseOrders)
      .where(and(eq(schema.purchaseOrders.id, id), ...(accountId ? [eq(schema.purchaseOrders.accountId, accountId)] : [])))
      .limit(1);

    if (!order) return null;
    return this.enrichPurchaseOrder(order);
  }

  private async enrichPurchaseOrder(order: typeof schema.purchaseOrders.$inferSelect): Promise<PurchaseOrder> {
    const db = getDatabase();

    const [supplier] = await db
      .select()
      .from(schema.suppliers)
      .where(eq(schema.suppliers.id, order.supplierId))
      .limit(1);

    const [user] = await db
      .select({ id: schema.users.id, fullName: schema.users.fullName })
      .from(schema.users)
      .where(eq(schema.users.id, order.userId))
      .limit(1);

    const items = await db
      .select({
        id: schema.purchaseOrderItems.id,
        orderId: schema.purchaseOrderItems.orderId,
        productId: schema.purchaseOrderItems.productId,
        quantityOrdered: schema.purchaseOrderItems.quantityOrdered,
        quantityReceived: schema.purchaseOrderItems.quantityReceived,
        unitCost: schema.purchaseOrderItems.unitCost,
        total: schema.purchaseOrderItems.total,
        received: schema.purchaseOrderItems.received,
        observations: schema.purchaseOrderItems.observations,
        productName: schema.products.name,
        productCode: schema.products.code,
      })
      .from(schema.purchaseOrderItems)
      .innerJoin(schema.products, eq(schema.purchaseOrderItems.productId, schema.products.id))
      .where(eq(schema.purchaseOrderItems.orderId, order.id));

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      supplierId: order.supplierId,
      supplier: supplier ? {
        id: supplier.id,
        name: supplier.name,
        contactPerson: supplier.contactPerson ?? undefined,
        phone: supplier.phone,
        email: supplier.email ?? '',
        address: supplier.address ?? '',
        leadTimeDays: supplier.leadTimeDays,
        isActive: supplier.isActive,
        createdAt: supplier.createdAt,
      } : undefined,
      status: order.status as PurchaseOrderStatus,
      items: items.map((i) => ({
        id: i.id,
        orderId: i.orderId,
        productId: i.productId,
        product: { id: i.productId, name: i.productName, code: i.productCode },
        quantityOrdered: i.quantityOrdered,
        quantityReceived: i.quantityReceived,
        unitCost: i.unitCost,
        total: i.total,
        received: i.received,
        observations: i.observations ?? undefined,
      })),
      subtotal: order.subtotal,
      tax: order.tax,
      freight: order.freight,
      total: order.total,
      expectedDate: order.expectedDate ?? undefined,
      receivedDate: order.receivedDate ?? undefined,
      observations: order.observations ?? undefined,
      notes: order.notes ?? undefined,
      userId: order.userId,
      user: user ?? undefined,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  async createPurchaseOrder(userId: number, data: CreatePurchaseOrderInput, accountId?: number | null): Promise<PurchaseOrder> {
    const db = getDatabase();
    const orderNumber = await buildOrderNumber();
    const now = nowISO();

    // Get user's branch if not provided
    let branchId = data.branchId;
    if (!branchId) {
      const user = await db
        .select({ branchId: schema.users.branchId })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .get();
      branchId = user?.branchId ?? undefined;
    }

    const subtotal = data.items.reduce((sum, item) => sum + item.quantityOrdered * item.unitCost, 0);
    const totalValue = subtotal + (data.freight ?? 0);

    const [order] = await db
      .insert(schema.purchaseOrders)
      .values({
        orderNumber,
        supplierId: data.supplierId,
        userId,
        accountId: accountId ?? null,
        branchId,
        status: 'DRAFT',
        subtotal,
        tax: 0,
        freight: data.freight ?? 0,
        total: totalValue,
        expectedDate: data.expectedDate ?? null,
        notes: data.notes ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    for (const item of data.items) {
      await db.insert(schema.purchaseOrderItems).values({
        orderId: order.id,
        productId: item.productId,
        quantityOrdered: item.quantityOrdered,
        quantityReceived: 0,
        unitCost: item.unitCost,
        total: item.quantityOrdered * item.unitCost,
        received: false,
      });
    }

    return this.getPurchaseOrderById(order.id) as Promise<PurchaseOrder>;
  }

  async updatePurchaseOrderStatus(id: number, status: PurchaseOrderStatus, accountId?: number | null): Promise<PurchaseOrder> {
    const db = getDatabase();
    const now = nowISO();

    const updateData: Record<string, unknown> = { status };
    if (status === 'RECEIVED') {
      updateData.receivedDate = now;
    }

    await db
      .update(schema.purchaseOrders)
      .set({ ...updateData, updatedAt: now })
      .where(and(eq(schema.purchaseOrders.id, id), ...(accountId ? [eq(schema.purchaseOrders.accountId, accountId)] : [])));

    return (await this.getPurchaseOrderById(id))!;
  }

  async receiveItems(orderId: number, userId: number, items: ReceiveItemInput[], accountId?: number | null): Promise<PurchaseOrder> {
    const db = getDatabase();

    const [order] = await db
      .select()
      .from(schema.purchaseOrders)
      .where(and(eq(schema.purchaseOrders.id, orderId), ...(accountId ? [eq(schema.purchaseOrders.accountId, accountId)] : [])))
      .limit(1);

    if (!order) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Pedido no encontrado.');
    }

    if (order.status === 'CANCELLED' || order.status === 'RECEIVED') {
      throw new AppError(ErrorCode.VALIDATION, 'No se puede recibir este pedido.');
    }

    const now = nowISO();

    await db.transaction((tx) => {
      for (const item of items) {
        const orderItem = tx
          .select()
          .from(schema.purchaseOrderItems)
          .where(eq(schema.purchaseOrderItems.id, item.orderItemId))
          .get();

        if (!orderItem) continue;

        const newQuantityReceived = item.received
          ? item.quantityReceived
          : orderItem.quantityReceived;
        const received = item.received && item.quantityReceived > 0;

        tx.update(schema.purchaseOrderItems)
          .set({
            quantityReceived: newQuantityReceived,
            received,
            observations: item.observations ?? null,
          })
          .where(eq(schema.purchaseOrderItems.id, item.orderItemId))
          .run();

        if (received && item.quantityReceived > 0) {
          const product = tx
            .select()
            .from(schema.products)
            .where(eq(schema.products.id, orderItem.productId))
            .get();

          if (product) {
            const newStock = product.stock + item.quantityReceived;
            tx.update(schema.products)
              .set({ stock: newStock, updatedAt: now })
              .where(eq(schema.products.id, orderItem.productId))
              .run();

            tx.insert(schema.stockMovements)
              .values({
                accountId: accountId ?? null,
                productId: orderItem.productId,
                type: 'entrada',
                quantity: item.quantityReceived,
                previousStock: product.stock,
                newStock,
                reason: `Recibido pedido ${order.orderNumber}`,
                userId,
                branchId: order.branchId,
                createdAt: now,
              })
              .run();
          }
        }
      }

      const updatedItems = tx
        .select()
        .from(schema.purchaseOrderItems)
        .where(eq(schema.purchaseOrderItems.orderId, orderId))
        .all();

      const allReceived = updatedItems.every((i) => i.received);
      if (allReceived) {
        tx.update(schema.purchaseOrders)
          .set({ status: 'RECEIVED', receivedDate: now, updatedAt: now })
          .where(eq(schema.purchaseOrders.id, orderId))
          .run();
      }
    });

    return (await this.getPurchaseOrderById(orderId))!;
  }

  async updatePurchaseOrder(id: number, data: Partial<CreatePurchaseOrderInput>, accountId?: number | null): Promise<PurchaseOrder> {
    const db = getDatabase();

    const [existing] = await db
      .select({ status: schema.purchaseOrders.status })
      .from(schema.purchaseOrders)
      .where(and(eq(schema.purchaseOrders.id, id), ...(accountId ? [eq(schema.purchaseOrders.accountId, accountId)] : [])))
      .limit(1);

    if (!existing) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Pedido no encontrado.');
    }
    if (existing.status !== 'DRAFT') {
      throw new AppError(ErrorCode.VALIDATION, 'Solo se pueden editar pedidos en borrador.');
    }

    const now = nowISO();
    await db
      .update(schema.purchaseOrders)
      .set({
        supplierId: data.supplierId,
        freight: data.freight,
        expectedDate: data.expectedDate ?? null,
        notes: data.notes,
        updatedAt: now,
      })
      .where(eq(schema.purchaseOrders.id, id));

    return (await this.getPurchaseOrderById(id))!;
  }

  async deletePurchaseOrder(id: number, accountId?: number | null): Promise<{ success: true }> {
    const db = getDatabase();

    const [order] = await db
      .select({ status: schema.purchaseOrders.status })
      .from(schema.purchaseOrders)
      .where(and(eq(schema.purchaseOrders.id, id), ...(accountId ? [eq(schema.purchaseOrders.accountId, accountId)] : [])))
      .limit(1);

    if (!order) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Pedido no encontrado.');
    }
    if (order.status !== 'DRAFT') {
      throw new AppError(ErrorCode.VALIDATION, 'Solo se pueden eliminar pedidos en borrador.');
    }

    await db.delete(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, id));
    return { success: true };
  }

  async getPurchaseSummary(accountId?: number | null): Promise<PurchaseSummary> {
    const db = getDatabase();

    const orders = await db
      .select()
      .from(schema.purchaseOrders)
      .where(accountId ? eq(schema.purchaseOrders.accountId, accountId) : undefined);

    const totalOrders = orders.length;
    const totalValue = orders.reduce((sum, o) => sum + o.total, 0);
    const pendingOrders = orders.filter(
      (o) => o.status === 'DRAFT' || o.status === 'CONFIRMED' || o.status === 'SENT',
    ).length;
    const receivedOrders = orders.filter((o) => o.status === 'RECEIVED').length;

    const supplierMap = new Map<number, { supplierId: number; supplierName: string; orderCount: number; totalValue: number }>();

    for (const order of orders) {
      const [supplier] = await db
        .select({ name: schema.suppliers.name })
        .from(schema.suppliers)
        .where(eq(schema.suppliers.id, order.supplierId))
        .limit(1);

      const existing = supplierMap.get(order.supplierId);
      if (existing) {
        existing.orderCount++;
        existing.totalValue += order.total;
      } else {
        supplierMap.set(order.supplierId, {
          supplierId: order.supplierId,
          supplierName: supplier?.name ?? 'Unknown',
          orderCount: 1,
          totalValue: order.total,
        });
      }
    }

    return {
      totalOrders,
      totalValue,
      pendingOrders,
      receivedOrders,
      ordersBySupplier: Array.from(supplierMap.values()),
    };
  }
}
