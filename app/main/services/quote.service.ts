import { eq, and, desc, like } from 'drizzle-orm';
import { getDatabase, schema } from '../db';
import { AppError, ErrorCode } from '../utils/errors';
import { nowISO } from '../utils/date';
import { AuditService } from './audit.service';
import { SalesService } from './sales.service';
import { ConfigService } from './config.service';
import type { SaleRecord, SaleItem, CartItemInput } from '../../renderer/src/shared/types/sales.types';

const auditService = new AuditService();
const salesService = new SalesService();

async function buildQuoteNumber(): Promise<string> {
  const db = getDatabase();
  const year = new Date().getFullYear();
  const prefix = `COT-${year}-`;

  for (let attempt = 0; attempt < 5; attempt++) {
    const [lastQuote] = await db
      .select({ saleNumber: schema.sales.saleNumber })
      .from(schema.sales)
      .where(and(
        like(schema.sales.saleNumber, `${prefix}%`),
        eq(schema.sales.status, 'QUOTE'),
      ))
      .orderBy(desc(schema.sales.saleNumber))
      .limit(1);

    const nextNumber = lastQuote ? Number(lastQuote.saleNumber.split('-')[2]) + 1 : 1;
    const candidate = `${prefix}${String(nextNumber).padStart(4, '0')}`;

    try {
      const [existing] = await db
        .select({ id: schema.sales.id })
        .from(schema.sales)
        .where(eq(schema.sales.saleNumber, candidate))
        .limit(1);

      if (!existing) return candidate;
    } catch {
      if (attempt === 4) throw new AppError(ErrorCode.VALIDATION, 'No se pudo generar el número de cotización. Intente nuevamente.');
    }
  }

  throw new AppError(ErrorCode.VALIDATION, 'No se pudo generar el número de cotización. Intente nuevamente.');
}

function buildSaleItem(row: unknown, product: unknown): SaleItem {
  const r = row as Record<string, unknown>;
  const p = product as Record<string, unknown> | null;
  return {
    id: r.id as number,
    productId: r.productId as number,
    quantity: r.quantity as number,
    unitPrice: r.unitPrice as number,
    taxRate: r.taxRate as number,
    subtotal: r.subtotal as number,
    discount: r.discount as number,
    total: r.total as number,
    unitType: r.unitType as string,
    product: p ? {
      id: p.id as number,
      code: p.code as string,
      barcode: p.barcode as string | null,
      name: p.name as string,
      categoryName: (p.categoryName as string) ?? '',
    } : { id: r.productId as number, code: '', barcode: null, name: `#${r.productId}`, categoryName: '' },
  };
}

export class QuoteService {
  async list(userId: number, accountId: number): Promise<SaleRecord[]> {
    const db = getDatabase();

    const quotes = await db
      .select()
      .from(schema.sales)
      .where(and(
        eq(schema.sales.status, 'QUOTE'),
        eq(schema.sales.userId, userId),
        eq(schema.sales.accountId, accountId),
      ))
      .orderBy(desc(schema.sales.createdAt));

    const result: SaleRecord[] = [];
    for (const q of quotes) {
      const items = await db
        .select()
        .from(schema.saleItems)
        .where(eq(schema.saleItems.saleId, q.id));

      const [user] = await db
        .select({ id: schema.users.id, username: schema.users.username, fullName: schema.users.fullName })
        .from(schema.users)
        .where(eq(schema.users.id, q.userId))
        .limit(1);

      let customer: { id: number; name: string; phone: string | null } | null = null;
      if (q.customerId) {
        const [c] = await db
          .select({ id: schema.customers.id, name: schema.customers.name, phone: schema.customers.phone })
          .from(schema.customers)
          .where(eq(schema.customers.id, q.customerId))
          .limit(1);
        if (c) customer = c;
      }

      const saleItems: SaleItem[] = await Promise.all(
        items.map(async (i) => {
          const [p] = await db
            .select()
            .from(schema.products)
            .where(eq(schema.products.id, i.productId))
            .limit(1);
          return buildSaleItem(i, p);
        }),
      );

      result.push({
        id: q.id,
        saleNumber: q.saleNumber,
        cashSessionId: q.cashSessionId,
        userId: q.userId,
        subtotal: q.subtotal,
        tax: q.tax,
        discount: q.discount,
        deliveryFee: q.deliveryFee,
        total: q.total,
        customerId: q.customerId,
        customer,
        status: q.status,
        createdAt: q.createdAt,
        items: saleItems,
        payments: [],
        user: user ?? { id: q.userId, username: '', fullName: '' },
        cashSession: null,
        cashReceived: 0,
        change: q.change,
      });
    }

    return result;
  }

  async getById(id: number, accountId: number): Promise<SaleRecord | null> {
    const db = getDatabase();

    const [sale] = await db
      .select()
      .from(schema.sales)
      .where(and(eq(schema.sales.id, id), eq(schema.sales.accountId, accountId)))
      .limit(1);

    if (!sale || sale.status !== 'QUOTE') return null;

    const items = await db
      .select()
      .from(schema.saleItems)
      .where(eq(schema.saleItems.saleId, id));

    const [user] = await db
      .select({ id: schema.users.id, username: schema.users.username, fullName: schema.users.fullName })
      .from(schema.users)
      .where(eq(schema.users.id, sale.userId))
      .limit(1);

    let customer: { id: number; name: string; phone: string | null } | null = null;
    if (sale.customerId) {
      const [c] = await db
        .select({ id: schema.customers.id, name: schema.customers.name, phone: schema.customers.phone })
        .from(schema.customers)
        .where(eq(schema.customers.id, sale.customerId))
        .limit(1);
      if (c) customer = c;
    }

    const saleItems: SaleItem[] = await Promise.all(
      items.map(async (i) => {
        const [p] = await db
          .select()
          .from(schema.products)
          .where(eq(schema.products.id, i.productId))
          .limit(1);
        return buildSaleItem(i, p);
      }),
    );

    return {
      id: sale.id,
      saleNumber: sale.saleNumber,
      cashSessionId: sale.cashSessionId,
      userId: sale.userId,
      subtotal: sale.subtotal,
      tax: sale.tax,
      discount: sale.discount,
      deliveryFee: sale.deliveryFee,
      total: sale.total,
      customerId: sale.customerId,
      customer,
      status: sale.status,
      createdAt: sale.createdAt,
      items: saleItems,
      payments: [],
      user: user ?? { id: sale.userId, username: '', fullName: '' },
      cashSession: null,
      cashReceived: 0,
      change: sale.change,
    };
  }

  async create(
    userId: number,
    accountId: number,
    items: CartItemInput[],
    customerId?: number,
    discount = 0,
    deliveryFee = 0,
    _notes?: string,
  ): Promise<SaleRecord> {
    if (items.length === 0) {
      throw new AppError(ErrorCode.EMPTY_CART, 'La cotización debe tener al menos un producto.');
    }

    const db = getDatabase();
    const now = nowISO();
    const saleNumber = await buildQuoteNumber();

    const configService = new ConfigService();
    const businessConfig = await configService.getBusinessConfig(accountId);
    const ivaEnabled = businessConfig.ivaEnabled;

    let subtotal = 0;
    let tax = 0;

    const saleItemsData = await Promise.all(
      items.map(async (item) => {
        const [product] = await db
          .select()
          .from(schema.products)
          .where(eq(schema.products.id, item.productId))
          .limit(1);

        if (!product) throw new AppError(ErrorCode.NOT_FOUND, `Producto #${item.productId} no encontrado`);

        const lineSubtotal = item.unitPrice * item.quantity;
        const lineTax = ivaEnabled ? lineSubtotal * (product.taxRate || 0) : 0;
        const lineTotal = lineSubtotal - (item.discount ?? 0);

        subtotal += lineSubtotal;
        tax += lineTax;

        return {
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          taxRate: ivaEnabled ? (product.taxRate || 0) : 0,
          subtotal: lineSubtotal,
          discount: item.discount ?? 0,
          total: lineTotal,
          unitType: product.unitType,
          saleId: 0,
        };
      }),
    );

    const total = subtotal + tax - discount + deliveryFee;

    const [sale] = await db
      .insert(schema.sales)
      .values({
        saleNumber,
        userId,
        cashSessionId: null,
        accountId,
        subtotal,
        tax,
        discount,
        deliveryFee,
        total,
        change: 0,
        status: 'QUOTE',
        customerId: customerId ?? null,
        createdAt: now,
      })
      .returning();

    if (saleItemsData.length > 0) {
      await db.insert(schema.saleItems).values(
        saleItemsData.map((si) => ({ ...si, saleId: sale.id })),
      );
    }

    await auditService.log({
      userId,
      action: 'quote:created',
      entity: 'Sale',
      entityId: sale.id,
      payload: { saleNumber, total, items: items.length },
    });

    return (await this.getById(sale.id, accountId))!;
  }

  async update(
    id: number,
    userId: number,
    accountId: number,
    items: CartItemInput[],
    customerId?: number | null,
    discount?: number,
    deliveryFee?: number,
  ): Promise<SaleRecord> {
    const db = getDatabase();

    const [existing] = await db
      .select()
      .from(schema.sales)
      .where(and(eq(schema.sales.id, id), eq(schema.sales.status, 'QUOTE'), eq(schema.sales.accountId, accountId)))
      .limit(1);

    if (!existing) throw new AppError(ErrorCode.NOT_FOUND, 'Cotización no encontrada');

    if (items.length === 0) {
      throw new AppError(ErrorCode.EMPTY_CART, 'La cotización debe tener al menos un producto.');
    }

    const configService = new ConfigService();
    const businessConfig = await configService.getBusinessConfig(accountId);
    const ivaEnabled = businessConfig.ivaEnabled;

    let subtotal = 0;
    let tax = 0;

    const saleItemsData = await Promise.all(
      items.map(async (item) => {
        const [product] = await db
          .select()
          .from(schema.products)
          .where(and(eq(schema.products.id, item.productId), eq(schema.products.accountId, accountId)))
          .limit(1);

        if (!product) throw new AppError(ErrorCode.NOT_FOUND, `Producto #${item.productId} no encontrado`);

        const lineSubtotal = item.unitPrice * item.quantity;
        const lineTax = ivaEnabled ? lineSubtotal * (product.taxRate || 0) : 0;
        const lineTotal = lineSubtotal - (item.discount ?? 0);

        subtotal += lineSubtotal;
        tax += lineTax;

        return {
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          taxRate: ivaEnabled ? (product.taxRate || 0) : 0,
          subtotal: lineSubtotal,
          discount: item.discount ?? 0,
          total: lineTotal,
          unitType: product.unitType,
          saleId: id,
        };
      }),
    );

    const finalDiscount = discount ?? existing.discount;
    const finalDelivery = deliveryFee ?? existing.deliveryFee;
    const total = subtotal + tax - finalDiscount + finalDelivery;

    await db
      .update(schema.sales)
      .set({
        subtotal,
        tax,
        discount: finalDiscount,
        deliveryFee: finalDelivery,
        total,
        customerId: customerId ?? existing.customerId,
      })
      .where(and(eq(schema.sales.id, id), ...(accountId ? [eq(schema.sales.accountId, accountId)] : [])));

    await db.delete(schema.saleItems).where(eq(schema.saleItems.saleId, id));

    if (saleItemsData.length > 0) {
      await db.insert(schema.saleItems).values(saleItemsData);
    }

    await auditService.log({
      userId,
      action: 'quote:updated',
      entity: 'Sale',
      entityId: id,
      payload: { saleNumber: existing.saleNumber, total, items: items.length },
    });

    return (await this.getById(id, accountId))!;
  }

  async delete(id: number, userId: number, accountId: number): Promise<void> {
    const db = getDatabase();

    const [existing] = await db
      .select()
      .from(schema.sales)
      .where(and(eq(schema.sales.id, id), eq(schema.sales.status, 'QUOTE'), eq(schema.sales.accountId, accountId)))
      .limit(1);

    if (!existing) throw new AppError(ErrorCode.NOT_FOUND, 'Cotización no encontrada');

    await db.delete(schema.saleItems).where(eq(schema.saleItems.saleId, id));
    await db.delete(schema.sales).where(eq(schema.sales.id, id));

    await auditService.log({
      userId,
      action: 'quote:deleted',
      entity: 'Sale',
      entityId: id,
      payload: { saleNumber: existing.saleNumber },
    });
  }

  async convertToSale(
    id: number,
    cashSessionId: number,
    userId: number,
    payments: { method: string; amount: number; reference?: string }[],
    accountId: number,
  ): Promise<SaleRecord> {
    const db = getDatabase();

    const [existing] = await db
      .select()
      .from(schema.sales)
      .where(and(eq(schema.sales.id, id), eq(schema.sales.status, 'QUOTE'), eq(schema.sales.accountId, accountId)))
      .limit(1);

    if (!existing) throw new AppError(ErrorCode.NOT_FOUND, 'Cotización no encontrada');

    const session = await db
      .select({ id: schema.cashSessions.id, userId: schema.cashSessions.userId, status: schema.cashSessions.status, accountId: schema.cashSessions.accountId })
      .from(schema.cashSessions)
      .where(eq(schema.cashSessions.id, cashSessionId))
      .get();

    if (!session || session.accountId !== accountId) {
      throw new AppError(ErrorCode.NO_OPEN_SESSION, 'Sesión de caja no encontrada.');
    }
    if (session.status !== 'OPEN') {
      throw new AppError(ErrorCode.NO_OPEN_SESSION, 'No hay una sesión de caja abierta.');
    }
    if (session.userId !== userId) {
      throw new AppError(ErrorCode.FORBIDDEN, 'No puedes convertir una cotización en la caja de otro usuario.');
    }

    let totalPaid = 0;
    for (const p of payments) totalPaid += p.amount;
    if (totalPaid < existing.total) {
      throw new AppError(ErrorCode.VALIDATION, `El pago (${totalPaid}) es menor que el total de la venta (${existing.total}).`);
    }
    const change = Math.max(0, totalPaid - existing.total);

    // Fetch sale items
    const quoteItems = await db
      .select()
      .from(schema.saleItems)
      .where(eq(schema.saleItems.saleId, id));

    const year = new Date().getFullYear();
    const prefix = `V-${year}-`;

    const [lastSale] = await db
      .select({ saleNumber: schema.sales.saleNumber })
      .from(schema.sales)
      .where(and(eq(schema.sales.accountId, accountId), like(schema.sales.saleNumber, `${prefix}%`)))
      .orderBy(desc(schema.sales.saleNumber))
      .limit(1);

    const nextNumber = lastSale ? Number(lastSale.saleNumber.split('-')[2]) + 1 : 1;
    const saleNumber = `${prefix}${String(nextNumber).padStart(4, '0')}`;
    const now = nowISO();

    // Perform all mutations in a transaction: validate stock, update sale, deduct stock, record movements, update cash session
    await db.transaction((tx) => {
      // Validate stock availability for all products inside transaction
      for (const item of quoteItems) {
        const product = tx
          .select({ id: schema.products.id, name: schema.products.name, stock: schema.products.stock })
          .from(schema.products)
          .where(eq(schema.products.id, item.productId))
          .get();

        if (!product) {
          throw new AppError(ErrorCode.PRODUCT_NOT_FOUND, `Producto #${item.productId} no encontrado.`);
        }
        if (product.stock < item.quantity) {
          throw new AppError(ErrorCode.INSUFFICIENT_STOCK, `Stock insuficiente para ${product.name}. Disponible: ${product.stock}, requerido: ${item.quantity}.`);
        }
      }

      tx.update(schema.sales)
        .set({
          saleNumber,
          status: 'COMPLETED',
          cashSessionId,
          userId,
          change,
          createdAt: now,
        })
        .where(eq(schema.sales.id, id))
        .run();

      for (const item of quoteItems) {
        const product = tx
          .select({ stock: schema.products.stock })
          .from(schema.products)
          .where(eq(schema.products.id, item.productId))
          .get();

        if (product) {
          const newStock = product.stock - item.quantity;
          tx.update(schema.products)
            .set({ stock: newStock, updatedAt: now })
            .where(eq(schema.products.id, item.productId))
            .run();

          tx.insert(schema.stockMovements).values({
            accountId: accountId ?? null,
            productId: item.productId,
            type: 'venta',
            quantity: item.quantity,
            previousStock: product.stock,
            newStock,
            reason: `Cotización convertida ${saleNumber}`,
            userId,
            createdAt: now,
          }).run();
        }
      }

      for (const p of payments) {
        tx.insert(schema.payments).values({
          saleId: id,
          cashSessionId,
          method: p.method,
          amount: p.amount,
          reference: p.reference ?? null,
          createdAt: now,
        }).run();
      }

      // Update cash session expectedCash for cash payments
      const cashAmount = payments
        .filter((p) => p.method === 'efectivo')
        .reduce((sum, p) => sum + p.amount, 0);

      if (cashAmount > 0) {
        const cs = tx
          .select({ expectedCash: schema.cashSessions.expectedCash, initialCash: schema.cashSessions.initialCash })
          .from(schema.cashSessions)
          .where(eq(schema.cashSessions.id, cashSessionId))
          .get();

        if (cs) {
          const netCashIncrease = cashAmount - change;
          tx.update(schema.cashSessions)
            .set({ expectedCash: (cs.expectedCash ?? cs.initialCash) + netCashIncrease })
            .where(eq(schema.cashSessions.id, cashSessionId))
            .run();
        }
      }
    });

    await auditService.log({
      userId,
      action: 'quote:converted',
      entity: 'Sale',
      entityId: id,
      payload: { saleNumber, wasQuote: existing.saleNumber },
    });

    return (await salesService.getSaleById(id, accountId))!;
  }
}

