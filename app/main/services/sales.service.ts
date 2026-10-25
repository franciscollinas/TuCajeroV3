import { eq, and, gte, lt, lte, desc, sum, count, inArray, sql } from 'drizzle-orm';

import { getDatabase, schema } from '../db';
import { AppError, ErrorCode } from '../utils/errors';
import { nextDocumentNumber } from '../utils/document-number';
import { nowISO, toLocalIsoDate } from '../utils/date';
import { AuditService } from './audit.service';
import { ReportsService } from './reports.service';
import { ConfigService } from './config.service';
import type {
  SaleRecord,
  CartItemInput,
  PaymentInput,
  PaymentMethod,
  DailySummary,
  DashboardSummary,
} from '../../renderer/src/shared/types/sales.types';
import { lineAmount, percentOf, roundMoney } from '../utils/money';

const auditService = new AuditService();
const reportsService = new ReportsService();

function mapPaymentMethod(method: string): PaymentMethod {
  const allowed: PaymentMethod[] = [
    'efectivo', 'nequi', 'daviplata', 'tarjeta', 'transferencia', 'credito',
  ];
  return allowed.includes(method as PaymentMethod) ? (method as PaymentMethod) : 'transferencia';
}

function groupBy<T extends Record<string, unknown>>(items: T[], key: string): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const item of items) {
    const k = item[key] as number;
    const arr = map.get(k) || [];
    arr.push(item);
    map.set(k, arr);
  }
  return map;
}

function allSaleDataCustomerIds(sales: Array<{ customerId: number | null }>): number[] {
  const ids = new Set<number>();
  for (const s of sales) {
    if (s.customerId) ids.add(s.customerId);
  }
  return Array.from(ids);
}

async function buildSaleNumber(): Promise<string> {
  return nextDocumentNumber(`V-${new Date().getFullYear()}-`, 'venta');
}

export class SalesService {
  async createSale(
    cashSessionId: number,
    userId: number,
    items: CartItemInput[],
    payments: PaymentInput[],
    accountId: number,
    discount = 0,
    deliveryFee = 0,
    customerId?: number,
    isCreditSale = false,
    branchId?: number,
    discountType: 'percentage' | 'fixed' = 'percentage',
  ): Promise<SaleRecord> {
    items = items.map((i) => ({ ...i, unitPrice: roundMoney(i.unitPrice), discount: roundMoney(i.discount ?? 0) }));
    payments = payments.map((p) => ({ ...p, amount: roundMoney(p.amount) }));
    deliveryFee = roundMoney(deliveryFee);
    if (items.length === 0) {
      throw new AppError(ErrorCode.EMPTY_CART, 'El carrito está vacío.');
    }

    for (const line of items) {
      if (!(line.quantity > 0)) {
        throw new AppError(ErrorCode.VALIDATION, 'La cantidad de cada producto debe ser mayor a cero.');
      }
    }
    if (discount < 0 || (discountType === 'percentage' && discount > 100)) {
      throw new AppError(ErrorCode.VALIDATION, 'El descuento no es válido: debe estar entre 0 y 100 %.');
    }

    if (payments.length === 0 && !isCreditSale) {
      throw new AppError(ErrorCode.PAYMENT_MISMATCH, 'Debes registrar al menos un pago.');
    }

    if (isCreditSale && !customerId) {
      throw new AppError(ErrorCode.VALIDATION, 'Se requiere seleccionar un cliente para ventas a crédito.');
    }

    const db = getDatabase();

    const [cashSession] = await db
      .select({ id: schema.cashSessions.id, userId: schema.cashSessions.userId, status: schema.cashSessions.status, initialCash: schema.cashSessions.initialCash, expectedCash: schema.cashSessions.expectedCash, branchId: schema.cashSessions.branchId, accountId: schema.cashSessions.accountId })
      .from(schema.cashSessions)
      .where(eq(schema.cashSessions.id, cashSessionId))
      .limit(1);

    if (!cashSession || cashSession.status !== 'OPEN') {
      throw new AppError(ErrorCode.NO_OPEN_SESSION, 'Debes abrir una caja antes de vender.');
    }

    if (cashSession.accountId !== accountId) {
      throw new AppError(ErrorCode.FORBIDDEN, 'La sesion de caja no pertenece a tu cuenta.');
    }
    if (cashSession.userId !== userId) {
      throw new AppError(ErrorCode.FORBIDDEN, 'No puedes registrar ventas en la caja de otro usuario.');
    }

    if (branchId) {
      const [branch] = await db
        .select({ id: schema.branches.id })
        .from(schema.branches)
        .where(and(eq(schema.branches.id, branchId), eq(schema.branches.accountId, accountId), eq(schema.branches.isActive, true)))
        .limit(1);
      if (!branch) throw new AppError(ErrorCode.FORBIDDEN, 'La sucursal no pertenece a tu cuenta o está inactiva.');
    }

    const productRows = await db
      .select({
        id: schema.products.id,
        name: schema.products.name,
        stock: schema.products.stock,
        price: schema.products.price,
        taxRate: schema.products.taxRate,
        unitType: schema.products.unitType,
        expiryDate: schema.products.expiryDate,
        isActive: schema.products.isActive,
        code: schema.products.code,
        barcode: schema.products.barcode,
        categoryName: schema.categories.name,
      })
      .from(schema.products)
      .leftJoin(schema.categories, eq(schema.products.categoryId, schema.categories.id))
      .where(and(inArray(schema.products.id, items.map((i) => i.productId)), eq(schema.products.accountId, accountId)));

    const productMap = new Map(productRows.map((p) => [p.id, p]));

    const configService = new ConfigService();
    const businessConfig = await configService.getBusinessConfig(accountId);
    const ivaEnabled = businessConfig.ivaEnabled;

    let subtotal = 0;
    let tax = 0;

    for (const item of items) {
      const product = productMap.get(item.productId);
      if (!product) {
        throw new AppError(ErrorCode.PRODUCT_NOT_FOUND, `Producto ${item.productId} no encontrado.`);
      }
      const lineSubtotal = lineAmount(item.quantity, item.unitPrice);
      if (item.discount < 0 || item.discount > lineSubtotal) {
        throw new AppError(ErrorCode.VALIDATION, `El descuento de "${product.name}" no puede ser negativo ni mayor que su valor.`);
      }
      const lineNet = lineSubtotal - item.discount;
      subtotal += lineNet;
      if (ivaEnabled) {
        tax += roundMoney(lineNet * (product.taxRate || 0));
      }
    }

    const finalDiscount = discountType === 'percentage' ? percentOf(subtotal, discount) : roundMoney(discount);
    if (finalDiscount > subtotal) {
      throw new AppError(ErrorCode.VALIDATION, 'El descuento no puede ser mayor al subtotal de la venta.');
    }
    const total = subtotal + tax + deliveryFee - finalDiscount;

    const paidPayments = payments.filter((p) => p.method !== 'credito');
    const paidTotal = paidPayments.reduce((sum, p) => sum + p.amount, 0);
    const creditRemainder = isCreditSale && customerId ? Math.max(0, total - paidTotal) : 0;

    const effectivePayments = creditRemainder > 0
      ? [...paidPayments, { method: 'credito' as const, amount: creditRemainder }]
      : paidPayments;

    const totalPaid = effectivePayments.reduce((sum, p) => sum + p.amount, 0);
    const change = totalPaid > total ? totalPaid - total : 0;

    if (totalPaid < total && !isCreditSale) {
      throw new AppError(
        ErrorCode.PAYMENT_MISMATCH,
        `Monto insuficiente. Total pagado (${totalPaid}) es menor al total (${total}).`,
      );
    }

    let saleNumber = await buildSaleNumber();
    const now = nowISO();

    let createdSale: (typeof schema.sales.$inferSelect) | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        createdSale = await db.transaction((tx) => {
          for (const item of items) {
            const product = productMap.get(item.productId);
            if (!product || !product.isActive) {
              throw new AppError(ErrorCode.PRODUCT_NOT_FOUND, `Producto ${item.productId} no encontrado.`);
            }
            if (product.expiryDate && product.expiryDate.slice(0, 10) < toLocalIsoDate(new Date())) {
              throw new AppError(ErrorCode.PRODUCT_EXPIRED, `"${product.name}" está vencido.`);
            }
            if (product.stock < item.quantity) {
              throw new AppError(ErrorCode.INSUFFICIENT_STOCK, `Stock insuficiente para ${product.name}. Disponible: ${product.stock}.`);
            }
          }

          const creditPayment = effectivePayments.find((p) => p.method === 'credito');
          if ((creditPayment || isCreditSale) && !customerId) {
            throw new AppError(ErrorCode.VALIDATION, 'Se requiere seleccionar un cliente para ventas a crédito.');
          }

          tx.insert(schema.sales).values({
            saleNumber,
            cashSessionId,
            userId,
            branchId: branchId ?? cashSession.branchId ?? undefined,
            accountId,
            subtotal,
            tax,
            discount: finalDiscount,
            deliveryFee,
            total,
            change,
            status: 'COMPLETED',
            customerId: customerId || null,
            createdAt: now,
          }).run();

          const created = tx
            .select()
            .from(schema.sales)
            .where(eq(schema.sales.saleNumber, saleNumber))
            .get()!;

          for (const item of items) {
            const product = productMap.get(item.productId)!;
            const lineSubtotal = lineAmount(item.quantity, item.unitPrice);

            tx.insert(schema.saleItems).values({
              saleId: created.id,
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              taxRate: ivaEnabled ? (product.taxRate || 0) : 0,
              subtotal: lineSubtotal,
              discount: item.discount,
              total: lineSubtotal - item.discount,
              unitType: product.unitType ?? 'UNIT',
            }).run();
          }

          for (const payment of effectivePayments) {
            tx.insert(schema.payments).values({
              saleId: created.id,
              cashSessionId,
              method: payment.method,
              amount: payment.amount,
              reference: payment.reference ?? null,
              createdAt: now,
            }).run();
          }

          if ((creditPayment || isCreditSale) && customerId) {
            const debtAmount = Math.max(0, total - paidTotal);
            if (debtAmount > 0) {
              tx.insert(schema.debts).values({
                customerId,
                accountId,
                saleId: created.id,
                amount: debtAmount,
                balance: debtAmount,
                status: 'PENDING',
                createdAt: now,
                updatedAt: now,
              }).run();
            }
          }

          for (const item of items) {
            const product = productMap.get(item.productId)!;

            const updated = tx.update(schema.products)
              .set({ stock: sql`${schema.products.stock} - ${item.quantity}`, updatedAt: now })
              .where(and(eq(schema.products.id, item.productId), gte(schema.products.stock, item.quantity)))
              .returning({ stock: schema.products.stock })
              .get();

            if (!updated) {
              throw new AppError(ErrorCode.INSUFFICIENT_STOCK, `Stock insuficiente para ${product.name}. Disponible: ${product.stock}.`);
            }

            const newStock = updated.stock;
            const previousStock = newStock + item.quantity;

            tx.insert(schema.stockMovements).values({
              accountId,
              productId: item.productId,
              type: 'venta',
              quantity: item.quantity,
              previousStock,
              newStock,
              reason: `Venta ${saleNumber}`,
              userId,
              branchId: branchId ?? cashSession.branchId ?? undefined,
              createdAt: now,
            }).run();
          }

          const cashPayment = payments
            .filter((p) => p.method === 'efectivo')
            .reduce((sum, p) => sum + p.amount, 0);

          if (cashPayment > 0) {
            const netCashIncrease = cashPayment - change;
            const cs = tx
              .select({ expectedCash: schema.cashSessions.expectedCash, initialCash: schema.cashSessions.initialCash })
              .from(schema.cashSessions)
              .where(eq(schema.cashSessions.id, cashSessionId))
              .get();

            const currentExpected = cs ? (cs.expectedCash ?? cs.initialCash) : 0;
            tx.update(schema.cashSessions)
              .set({ expectedCash: currentExpected + netCashIncrease })
              .where(eq(schema.cashSessions.id, cashSessionId))
              .run();
          }

          return created;
        });
        break;
      } catch (err) {
        const message = err instanceof Error ? err.message : '';
        if (message.includes('UNIQUE constraint failed: Sale.saleNumber') && attempt < 2) {
          saleNumber = await buildSaleNumber();
          continue;
        }
        throw err;
      }
    }

    if (!createdSale) {
      throw new AppError(ErrorCode.VALIDATION, 'Error al crear la venta.');
    }

    await auditService.log({
      userId,
      action: 'sale:created',
      entity: 'Sale',
      entityId: createdSale.id,
      payload: {
        saleNumber: createdSale.saleNumber,
        total: Number(createdSale.total),
        items: items.length,
        payments: effectivePayments.map((p) => ({ method: p.method, amount: p.amount })),
      },
    });

    const fullSale = await this.getSaleById(createdSale.id, accountId);
    if (!fullSale) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Error al crear la venta.');
    }
    return fullSale;
  }

  async getSaleById(id: number, accountId: number): Promise<SaleRecord | null> {
    return this.getSaleWithJoins(eq(schema.sales.id, id), accountId);
  }

  async getSaleByNumber(saleNumber: string, accountId: number): Promise<SaleRecord | null> {
    return this.getSaleWithJoins(eq(schema.sales.saleNumber, saleNumber), accountId);
  }

  private async getSaleWithJoins(where: import('drizzle-orm').SQL<unknown>, accountId: number): Promise<SaleRecord | null> {
    const db = getDatabase();

    const [sale] = await db
      .select({
        id: schema.sales.id,
        saleNumber: schema.sales.saleNumber,
        cashSessionId: schema.sales.cashSessionId,
        userId: schema.sales.userId,
        subtotal: schema.sales.subtotal,
        tax: schema.sales.tax,
        discount: schema.sales.discount,
        deliveryFee: schema.sales.deliveryFee,
        total: schema.sales.total,
        change: schema.sales.change,
        customerId: schema.sales.customerId,
        status: schema.sales.status,
        createdAt: schema.sales.createdAt,
        userName: schema.users.fullName,
        userUsername: schema.users.username,
        user: schema.users,
      })
      .from(schema.sales)
      .innerJoin(schema.users, eq(schema.sales.userId, schema.users.id))
      .where(and(where, eq(schema.sales.accountId, accountId)))
      .limit(1);

    if (!sale) return null;

    const saleItems = await db
      .select({
        id: schema.saleItems.id,
        productId: schema.saleItems.productId,
        quantity: schema.saleItems.quantity,
        unitPrice: schema.saleItems.unitPrice,
        taxRate: schema.saleItems.taxRate,
        subtotal: schema.saleItems.subtotal,
        discount: schema.saleItems.discount,
        total: schema.saleItems.total,
        unitType: schema.saleItems.unitType,
        productCode: schema.products.code,
        productBarcode: schema.products.barcode,
        productName: schema.products.name,
        categoryName: schema.categories.name,
      })
      .from(schema.saleItems)
      .innerJoin(schema.products, eq(schema.saleItems.productId, schema.products.id))
      .leftJoin(schema.categories, eq(schema.products.categoryId, schema.categories.id))
      .where(eq(schema.saleItems.saleId, sale.id));

    const payments = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.saleId, sale.id));

    const [cs] = await db
      .select()
      .from(schema.cashSessions)
      .where(eq(schema.cashSessions.id, sale.cashSessionId ?? 0))
      .limit(1);

    let customer: { id: number; name: string; phone: string | null } | null = null;
    if (sale.customerId) {
      const [c] = await db
        .select({ id: schema.customers.id, name: schema.customers.name, phone: schema.customers.phone })
        .from(schema.customers)
        .where(eq(schema.customers.id, sale.customerId))
        .limit(1);
      customer = c ?? null;
    }

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
      change: sale.change,
      customerId: sale.customerId,
      customer,
      status: sale.status,
      createdAt: sale.createdAt,
      items: saleItems.map((item) => ({
        id: item.id,
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        taxRate: item.taxRate,
        subtotal: item.subtotal,
        discount: item.discount,
        total: item.total,
        unitType: item.unitType,
        product: {
          id: item.productId,
          code: item.productCode,
          barcode: item.productBarcode,
          name: item.productName,
          categoryName: item.categoryName ?? '',
        },
      })),
      payments: payments.map((p) => ({
        id: p.id,
        method: mapPaymentMethod(p.method),
        amount: p.amount,
        reference: p.reference,
        createdAt: p.createdAt,
      })),
      user: {
        id: sale.user.id,
        username: sale.user.username,
        fullName: sale.user.fullName,
      },
      cashSession: cs
        ? {
            id: cs.id,
            initialCash: cs.initialCash,
            expectedCash: cs.expectedCash,
            openedAt: cs.openedAt,
            closedAt: cs.closedAt,
            status: cs.status,
          }
        : null,
    };
  }

  async getSalesByCashRegister(cashSessionId: number, accountId: number, userId?: number): Promise<SaleRecord[]> {
    const conditions = [eq(schema.sales.cashSessionId, cashSessionId)];
    if (userId) conditions.push(eq(schema.sales.userId, userId));
    return this.getSalesBatch(and(...conditions) as import('drizzle-orm').SQL<unknown>, accountId);
  }

  async getSalesByUser(userId: number, accountId: number): Promise<SaleRecord[]> {
    return this.getSalesBatch(eq(schema.sales.userId, userId), accountId);
  }

  async getSalesByDateRange(startDate: Date, endDate: Date, accountId: number, branchId?: number, userId?: number): Promise<SaleRecord[]> {
    const endExclusive = new Date(endDate);
    endExclusive.setDate(endExclusive.getDate() + 1);
    const conditions = [
      gte(schema.sales.createdAt, startDate.toISOString()),
      lt(schema.sales.createdAt, endExclusive.toISOString()),
      eq(schema.sales.accountId, accountId),
    ];
    if (branchId) conditions.push(eq(schema.sales.branchId, branchId));
    if (userId) conditions.push(eq(schema.sales.userId, userId));
    return this.getSalesBatch(and(...conditions) as import('drizzle-orm').SQL<unknown>, accountId);
  }

  private async getSalesBatch(where: import('drizzle-orm').SQL<unknown>, accountId: number): Promise<SaleRecord[]> {
    const db = getDatabase();

    const sales = await db
      .select({ id: schema.sales.id })
      .from(schema.sales)
      .where(and(where, eq(schema.sales.accountId, accountId)))
      .orderBy(desc(schema.sales.createdAt))
      .limit(5000);

    if (sales.length === 0) return [];

    const saleIds = sales.map((s) => s.id);

    const [allSaleData, allSaleItems, allPayments] = await Promise.all([
      db
        .select({
          id: schema.sales.id,
          saleNumber: schema.sales.saleNumber,
          cashSessionId: schema.sales.cashSessionId,
          userId: schema.sales.userId,
          subtotal: schema.sales.subtotal,
          tax: schema.sales.tax,
          discount: schema.sales.discount,
          deliveryFee: schema.sales.deliveryFee,
          total: schema.sales.total,
          change: schema.sales.change,
          customerId: schema.sales.customerId,
          status: schema.sales.status,
          createdAt: schema.sales.createdAt,
          userName: schema.users.fullName,
          userUsername: schema.users.username,
          userId2: schema.users.id,
        })
        .from(schema.sales)
        .innerJoin(schema.users, eq(schema.sales.userId, schema.users.id))
        .where(inArray(schema.sales.id, saleIds)),
      db
        .select({
          saleId: schema.saleItems.saleId,
          id: schema.saleItems.id,
          productId: schema.saleItems.productId,
          quantity: schema.saleItems.quantity,
          unitPrice: schema.saleItems.unitPrice,
          taxRate: schema.saleItems.taxRate,
          subtotal: schema.saleItems.subtotal,
          discount: schema.saleItems.discount,
          total: schema.saleItems.total,
          unitType: schema.saleItems.unitType,
          productCode: schema.products.code,
          productBarcode: schema.products.barcode,
          productName: schema.products.name,
          categoryName: schema.categories.name,
        })
        .from(schema.saleItems)
        .innerJoin(schema.products, eq(schema.saleItems.productId, schema.products.id))
        .leftJoin(schema.categories, eq(schema.products.categoryId, schema.categories.id))
        .where(inArray(schema.saleItems.saleId, saleIds)),
      db.select().from(schema.payments).where(inArray(schema.payments.saleId, saleIds)),
    ]);

    const cashSessionIds = [...new Set(allSaleData.map(s => s.cashSessionId).filter(Boolean))] as number[];
    const allCashSessions = cashSessionIds.length > 0
      ? await db.select().from(schema.cashSessions).where(inArray(schema.cashSessions.id, cashSessionIds))
      : [];

    const customerIds = allSaleDataCustomerIds(allSaleData);
    const allCustomers = customerIds.length > 0
      ? await db
          .select({ id: schema.customers.id, name: schema.customers.name, phone: schema.customers.phone })
          .from(schema.customers)
          .where(inArray(schema.customers.id, customerIds))
      : [];

    const saleDataMap = new Map(allSaleData.map((s) => [s.id, s]));
    const itemsBySale = groupBy(allSaleItems, 'saleId');
    const paymentsBySale = groupBy(allPayments, 'saleId');
    const csMap = new Map(allCashSessions.map((cs) => [cs.id, cs]));
    const customerMap = new Map(allCustomers.map((c) => [c.id, c]));

    return saleIds.map((id) => {
      const sale = saleDataMap.get(id);
      if (!sale) return null;

      const items = (itemsBySale.get(id) || []).map((item) => ({
        id: item.id,
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        taxRate: item.taxRate,
        subtotal: item.subtotal,
        discount: item.discount,
        total: item.total,
        unitType: item.unitType,
        product: {
          id: item.productId,
          code: item.productCode,
          barcode: item.productBarcode,
          name: item.productName,
          categoryName: item.categoryName ?? '',
        },
      }));

      const payments = (paymentsBySale.get(id) || []).map((p) => ({
        id: p.id,
        method: mapPaymentMethod(p.method),
        amount: p.amount,
        reference: p.reference,
        createdAt: p.createdAt,
      }));

      const cs = sale.cashSessionId ? csMap.get(sale.cashSessionId) : null;
      const customer = sale.customerId ? customerMap.get(sale.customerId) ?? null : null;

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
        change: sale.change,
        customerId: sale.customerId,
        customer,
        status: sale.status,
        createdAt: sale.createdAt,
        items,
        payments,
        user: { id: sale.userId2, username: sale.userUsername, fullName: sale.userName },
        cashSession: cs
          ? { id: cs.id, initialCash: cs.initialCash, expectedCash: cs.expectedCash, openedAt: cs.openedAt, closedAt: cs.closedAt, status: cs.status }
          : null,
      } as SaleRecord;
    }).filter(Boolean) as SaleRecord[];
  }

  async cancelSale(id: number, userId: number, accountId: number): Promise<{ success: true }> {
    const db = getDatabase();

    const [sale] = await db
      .select({
        id: schema.sales.id,
        status: schema.sales.status,
        saleNumber: schema.sales.saleNumber,
        cashSessionId: schema.sales.cashSessionId,
        change: schema.sales.change,
        branchId: schema.sales.branchId,
        total: schema.sales.total,
      })
      .from(schema.sales)
      .where(and(eq(schema.sales.id, id), eq(schema.sales.accountId, accountId)))
      .limit(1);

    if (!sale) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Venta no encontrada.');
    }

    if (sale.status === 'CANCELLED') {
      throw new AppError(ErrorCode.VALIDATION, 'La venta ya fue cancelada.');
    }

    const saleItems = await db
      .select()
      .from(schema.saleItems)
      .where(eq(schema.saleItems.saleId, id));

    const payments = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.saleId, id));

    const now = nowISO();

    await db.transaction((tx) => {
      // Se anula solo si sigue en el estado leído: dos anulaciones a la vez no
      // pueden devolver el stock ni descontar el efectivo dos veces.
      const cancelled = tx.update(schema.sales)
        .set({ status: 'CANCELLED' })
        .where(and(eq(schema.sales.id, id), eq(schema.sales.status, sale.status)))
        .run();
      if (cancelled.changes === 0) {
        throw new AppError(ErrorCode.VALIDATION, 'La venta ya fue cancelada.');
      }

      for (const item of saleItems) {
        const product = tx
          .select({ stock: schema.products.stock })
          .from(schema.products)
          .where(eq(schema.products.id, item.productId))
          .get();
        if (!product) continue;

        const restoredStock = product.stock + item.quantity;

        tx.update(schema.products)
          .set({ stock: sql`${schema.products.stock} + ${item.quantity}`, updatedAt: now })
          .where(eq(schema.products.id, item.productId))
          .run();

        tx.insert(schema.stockMovements).values({
          accountId,
          productId: item.productId,
          type: 'entrada',
          quantity: item.quantity,
          previousStock: product.stock,
          newStock: restoredStock,
          reason: `Cancelación venta ${sale.saleNumber}`,
          userId,
          branchId: sale.branchId ?? undefined,
          createdAt: now,
        }).run();
      }

      if (sale.cashSessionId) {
        const cashAmount = payments
          .filter((p) => p.method === 'efectivo')
          .reduce((sum, p) => sum + p.amount, 0);
        const netCashAmount = Math.max(0, cashAmount - (sale.change ?? 0));

        if (netCashAmount > 0) {
          const cs = tx
            .select({ status: schema.cashSessions.status })
            .from(schema.cashSessions)
            .where(eq(schema.cashSessions.id, sale.cashSessionId))
            .get();

          if (cs && cs.status === 'OPEN') {
            tx.update(schema.cashSessions)
              .set({ expectedCash: sql`coalesce(${schema.cashSessions.expectedCash}, ${schema.cashSessions.initialCash}) - ${netCashAmount}` })
              .where(eq(schema.cashSessions.id, sale.cashSessionId))
              .run();
          } else {
            // La caja donde se cobró ya cerró: el efectivo se devuelve desde la caja
            // abierta de quien anula, y queda registrado como egreso.
            const current = tx
              .select({ id: schema.cashSessions.id })
              .from(schema.cashSessions)
              .where(and(
                eq(schema.cashSessions.userId, userId),
                eq(schema.cashSessions.accountId, accountId),
                eq(schema.cashSessions.status, 'OPEN'),
              ))
              .get();
            if (!current) {
              throw new AppError(
                ErrorCode.NO_OPEN_SESSION,
                'Esta venta se cobró en una caja que ya cerró. Necesitas una caja abierta para registrar la devolución del efectivo: ábrela y vuelve a anularla.',
              );
            }
            tx.insert(schema.cashExpenses).values({
              accountId,
              cashSessionId: current.id,
              userId,
              amount: netCashAmount,
              reason: `Devolución de venta ${sale.saleNumber}`,
              createdAt: now,
            }).run();
            tx.update(schema.cashSessions)
              .set({ expectedCash: sql`coalesce(${schema.cashSessions.expectedCash}, ${schema.cashSessions.initialCash}) - ${netCashAmount}` })
              .where(eq(schema.cashSessions.id, current.id))
              .run();
          }
        }
      }

      const debt = tx
        .select({ id: schema.debts.id })
        .from(schema.debts)
        .where(eq(schema.debts.saleId, id))
        .get();

      if (debt) {
        const debtPayment = tx
          .select({ id: schema.payments.id })
          .from(schema.payments)
          .where(eq(schema.payments.debtId, debt.id))
          .limit(1)
          .get();

        if (debtPayment) {
          throw new AppError(ErrorCode.VALIDATION, 'La venta tiene abonos de deuda realizados; no se puede cancelar.');
        }

        tx.delete(schema.debts)
          .where(eq(schema.debts.id, debt.id))
          .run();

        tx.delete(schema.payments)
          .where(and(eq(schema.payments.saleId, id), eq(schema.payments.method, 'credito')))
          .run();
      }
    });

    await auditService.log({
      userId,
      action: 'sale:cancelled',
      entity: 'Sale',
      entityId: sale.id,
      payload: { saleNumber: sale.saleNumber, total: sale.total },
    });

    return { success: true };
  }

  async getDashboardSummary(accountId: number, branchId?: number): Promise<DashboardSummary> {
    const db = getDatabase();
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const day = now.getDate();

    const todayStart = new Date(year, month, day).toISOString();
    const todayEnd = new Date(year, month, day, 23, 59, 59, 999).toISOString();
    const thirtyDaysAgo = new Date(year, month, day - 29).toISOString();

    const branchFilter = branchId ? eq(schema.sales.branchId, branchId) : undefined;
    const accountFilter = eq(schema.sales.accountId, accountId);

    // Today's aggregation
    const [todayAgg] = await db
      .select({
        count: count(schema.sales.id).mapWith(Number),
        total: sum(schema.sales.total).mapWith(Number),
      })
      .from(schema.sales)
      .where(
        and(
          gte(schema.sales.createdAt, todayStart),
          lte(schema.sales.createdAt, todayEnd),
          eq(schema.sales.status, 'COMPLETED'),
          accountFilter,
          ...(branchFilter ? [branchFilter] : []),
        ),
      );

    // Mes en curso: mismas cifras que Reportes (ingresos sin multiplicar por ítems).
    const monthTotals = await reportsService.getPeriodTotals(
      { start: new Date(year, month, 1), end: new Date(year, month, day) },
      accountId,
      branchId,
    );

    // Recent sales
    const recentSales = await db
      .select({ id: schema.sales.id })
      .from(schema.sales)
      .where(
        and(
          gte(schema.sales.createdAt, thirtyDaysAgo),
          eq(schema.sales.status, 'COMPLETED'),
          accountFilter,
          ...(branchFilter ? [branchFilter] : []),
        ),
      )
      .orderBy(desc(schema.sales.createdAt))
      .limit(10);

    const recentFull: SaleRecord[] = [];
    for (const s of recentSales) {
      const full = await this.getSaleById(s.id, accountId);
      if (full) recentFull.push(full);
    }

    // Gráficos de 7 y 30 días: una sola consulta con las ventas por día local (antes eran dos
    // consultas que traían todas las ventas del mes y formateaban la fecha de cada una con
    // toLocaleDateString: con miles de ventas el resumen tardaba más de medio segundo).
    const dailySales = await reportsService.getSalesByDay(
      { start: new Date(year, month, day - 29), end: new Date(year, month, day) },
      accountId,
      branchId,
    );
    const labelOf = (isoDate: string, options: Intl.DateTimeFormatOptions): string => {
      const [y, m, d] = isoDate.split('-').map(Number);
      return new Date(y, m - 1, d).toLocaleDateString('es-CO', options);
    };

    const weeklyChart = dailySales.slice(-7).map((point) => {
      const name = labelOf(point.date, { weekday: 'short' });
      return { name: name.charAt(0).toUpperCase() + name.slice(1), ventas: point.sales, ingresos: point.revenue };
    });

    const monthlyChart = dailySales.map((point) => ({
      name: labelOf(point.date, { day: 'numeric', month: 'short' }),
      ventas: point.sales,
      ingresos: point.revenue,
    }));

    // Top products (30 days)
    const topProductsFull = await db
      .select({
        id: schema.saleItems.productId,
        name: schema.products.name,
        code: schema.products.code,
        quantity: sum(schema.saleItems.quantity).mapWith(Number),
        total: sum(schema.saleItems.total).mapWith(Number),
      })
      .from(schema.saleItems)
      .innerJoin(schema.sales, eq(schema.sales.id, schema.saleItems.saleId))
      .innerJoin(schema.products, eq(schema.products.id, schema.saleItems.productId))
      .where(
        and(
          gte(schema.sales.createdAt, thirtyDaysAgo),
          eq(schema.sales.status, 'COMPLETED'),
          accountFilter,
          ...(branchFilter ? [branchFilter] : []),
        ),
      )
      .groupBy(schema.saleItems.productId)
      .orderBy(desc(sum(schema.saleItems.quantity)))
      .limit(10);

    // Payment methods distribution (30 days), neto del cambio entregado.
    const paymentMethods = await reportsService.getPaymentMix(
      { start: new Date(year, month, day - 29), end: new Date(year, month, day) },
      accountId,
      branchId,
    );

    // Top categories (30 days)
    const topCategoriesRaw = await db
      .select({
        name: schema.categories.name,
        total: sum(schema.saleItems.total).mapWith(Number),
      })
      .from(schema.saleItems)
      .innerJoin(schema.sales, eq(schema.sales.id, schema.saleItems.saleId))
      .innerJoin(schema.products, eq(schema.products.id, schema.saleItems.productId))
      .leftJoin(schema.categories, eq(schema.categories.id, schema.products.categoryId))
      .where(
        and(
          gte(schema.sales.createdAt, thirtyDaysAgo),
          eq(schema.sales.status, 'COMPLETED'),
          accountFilter,
          ...(branchFilter ? [branchFilter] : []),
        ),
      )
      .groupBy(schema.products.categoryId)
      .orderBy(desc(sum(schema.saleItems.quantity)))
      .limit(10);

    const topCategories = topCategoriesRaw.map((c) => ({ name: c.name ?? 'Sin categoría', value: c.total }));

    return {
      today: {
        totalVendidos: todayAgg?.count ?? 0,
        totalMonto: todayAgg?.total ?? 0,
      },
      monthToDate: {
        totalVentas: monthTotals.sales,
        totalIngresos: monthTotals.revenue,
        totalProfit: monthTotals.profit,
      },
      topProducts: topProductsFull,
      paymentMethods,
      weeklyChart,
      monthlyChart,
      topCategories,
      recentSales: recentFull,
    };
  }

  async getDailySummary(cashSessionId: number, accountId: number): Promise<DailySummary> {
    const sales = await this.getSalesByCashRegister(cashSessionId, accountId);
    const completed = sales.filter((s) => s.status === 'COMPLETED');

    return {
      totalSales: completed.length,
      totalAmount: completed.reduce((sum, s) => sum + s.total, 0),
      paymentsByMethod: completed.reduce<Record<string, number>>((acc, sale) => {
        let changeApplied = false;
        sale.payments.forEach((payment) => {
          let amount = payment.amount;
          if (payment.method === 'efectivo' && !changeApplied) {
            amount -= sale.change ?? 0;
            changeApplied = true;
          }
          acc[payment.method] = (acc[payment.method] ?? 0) + amount;
        });
        return acc;
      }, {}),
      sales: completed,
    };
  }
}
