import { eq, and, or, like, desc, asc } from 'drizzle-orm';

import { getDatabase, schema } from '../db';
import { AppError, ErrorCode } from '../utils/errors';
import { nowISO } from '../utils/date';
import { AuditService } from './audit.service';

const auditService = new AuditService();

export interface CustomerData {
  id: number;
  document: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerDebt {
  id: number;
  customerId: number;
  saleId: number | null;
  amount: number;
  balance: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  saleNumber?: string;
  customerName?: string;
}

export interface CustomerHistory {
  id: number;
  saleNumber: string;
  total: number;
  createdAt: string;
  status: string;
}

function mapCustomer(row: typeof schema.customers.$inferSelect): CustomerData {
  return {
    id: row.id,
    document: row.document,
    name: row.name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function buildLikePattern(query: string): string {
  const escaped = query.replace(/%/g, '\\%').replace(/_/g, '\\_');
  return `%${escaped}%`;
}

export class CustomerService {
  async searchCustomers(query: string, accountId?: number | null): Promise<CustomerData[]> {
    const db = getDatabase();
    const pattern = buildLikePattern(query);
    const rows = await db
      .select()
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.isActive, true),
          ...(accountId ? [eq(schema.customers.accountId, accountId)] : []),
          or(
            like(schema.customers.name, pattern),
            like(schema.customers.document, pattern),
            like(schema.customers.phone, pattern),
          ),
        ),
      )
      .orderBy(asc(schema.customers.name))
      .limit(20);

    return rows.map(mapCustomer);
  }

  async createCustomer(data: {
    document?: string | null;
    name: string;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    accountId?: number;
  }, accountId?: number | null): Promise<CustomerData> {
    const db = getDatabase();
    const now = nowISO();

    const [customer] = await db
      .insert(schema.customers)
      .values({
        accountId: accountId ?? null,
        document: data.document ?? null,
        name: data.name,
        email: data.email ?? null,
        phone: data.phone ?? null,
        address: data.address ?? null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return mapCustomer(customer);
  }

  async updateCustomer(id: number, data: Partial<CustomerData>, accountId?: number | null): Promise<CustomerData> {
    const db = getDatabase();
    const now = nowISO();

    const [customer] = await db
      .update(schema.customers)
      .set({
        document: data.document ?? undefined,
        name: data.name,
        email: data.email ?? undefined,
        phone: data.phone ?? undefined,
        address: data.address ?? undefined,
        updatedAt: now,
      })
      .where(and(eq(schema.customers.id, id), ...(accountId ? [eq(schema.customers.accountId, accountId)] : [])))
      .returning();

    return mapCustomer(customer);
  }

  async getCustomerHistory(customerId: number, accountId?: number | null): Promise<{
    customer: CustomerData;
    sales: CustomerHistory[];
    debts: CustomerDebt[];
  }> {
    const db = getDatabase();

    const [customer] = await db
      .select()
      .from(schema.customers)
      .where(and(eq(schema.customers.id, customerId), ...(accountId ? [eq(schema.customers.accountId, accountId)] : [])))
      .limit(1);

    if (!customer) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Cliente no encontrado.');
    }

    const salesRows = await db
      .select({
        id: schema.sales.id,
        saleNumber: schema.sales.saleNumber,
        total: schema.sales.total,
        createdAt: schema.sales.createdAt,
        status: schema.sales.status,
      })
      .from(schema.sales)
      .where(eq(schema.sales.customerId, customerId))
      .orderBy(desc(schema.sales.createdAt))
      .limit(50);

    const debtRows = await db
      .select()
      .from(schema.debts)
      .where(
        and(eq(schema.debts.customerId, customerId), eq(schema.debts.status, 'PENDING')),
      )
      .orderBy(desc(schema.debts.createdAt));

    const debtWithSales = await Promise.all(
      debtRows.map(async (debt) => {
        let saleNumber: string | undefined;
        if (debt.saleId) {
          const [sale] = await db
            .select({ saleNumber: schema.sales.saleNumber })
            .from(schema.sales)
            .where(eq(schema.sales.id, debt.saleId))
            .limit(1);
          saleNumber = sale?.saleNumber;
        }
        return {
          id: debt.id,
          customerId: debt.customerId,
          saleId: debt.saleId,
          amount: debt.amount,
          balance: debt.balance,
          status: debt.status,
          createdAt: debt.createdAt,
          updatedAt: debt.updatedAt,
          saleNumber,
          customerName: customer.name,
        };
      }),
    );

    return {
      customer: mapCustomer(customer),
      sales: salesRows,
      debts: debtWithSales,
    };
  }

  async getCustomerDebts(customerId: number, accountId?: number | null): Promise<CustomerDebt[]> {
    const db = getDatabase();

    const debtRows = await db
      .select()
      .from(schema.debts)
      .where(
        and(eq(schema.debts.customerId, customerId), eq(schema.debts.status, 'PENDING'), ...(accountId ? [eq(schema.debts.accountId, accountId)] : [])),
      )
      .orderBy(desc(schema.debts.createdAt));

    const [customer] = await db
      .select({ name: schema.customers.name })
      .from(schema.customers)
      .where(and(eq(schema.customers.id, customerId), ...(accountId ? [eq(schema.customers.accountId, accountId)] : [])))
      .limit(1);

    return debtRows.map((debt) => ({
      id: debt.id,
      customerId: debt.customerId,
      saleId: debt.saleId,
      amount: debt.amount,
      balance: debt.balance,
      status: debt.status,
      createdAt: debt.createdAt,
      updatedAt: debt.updatedAt,
      customerName: customer?.name,
    }));
  }

  async payDebt(
    debtId: number,
    amount: number,
    userId: number,
    cashSessionId?: number | null,
    accountId?: number | null,
    method: string = 'efectivo',
  ): Promise<CustomerDebt> {
    const db = getDatabase();
    const now = nowISO();

    const [debt] = await db
      .select()
      .from(schema.debts)
      .where(and(eq(schema.debts.id, debtId), ...(accountId ? [eq(schema.debts.accountId, accountId)] : [])))
      .limit(1);

    if (!debt) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Deuda no encontrada.');
    }

    if (debt.status !== 'PENDING') {
      throw new AppError(ErrorCode.VALIDATION, 'La deuda ya está pagada.');
    }

    if (amount <= 0) {
      throw new AppError(ErrorCode.VALIDATION, 'El monto del pago debe ser mayor a cero.');
    }

    if (amount > debt.balance) {
      throw new AppError(ErrorCode.VALIDATION, 'El monto del pago excede el saldo de la deuda.');
    }

    let sessionId = cashSessionId ?? null;
    if (!sessionId) {
      const [openSession] = await db
        .select({ id: schema.cashSessions.id })
        .from(schema.cashSessions)
        .where(and(eq(schema.cashSessions.userId, userId), eq(schema.cashSessions.status, 'OPEN')))
        .limit(1);
      if (openSession) sessionId = openSession.id;
    }

    if (!sessionId) {
      throw new AppError(ErrorCode.NO_OPEN_SESSION, 'No hay una caja abierta para registrar el abono.');
    }

    const [session] = await db
      .select({ id: schema.cashSessions.id, status: schema.cashSessions.status, accountId: schema.cashSessions.accountId })
      .from(schema.cashSessions)
      .where(eq(schema.cashSessions.id, sessionId))
      .limit(1);

    if (!session || session.status !== 'OPEN') {
      throw new AppError(ErrorCode.NO_OPEN_SESSION, 'No hay una caja abierta para registrar el abono.');
    }

    if (accountId && session.accountId !== accountId) {
      throw new AppError(ErrorCode.FORBIDDEN, 'La sesión de caja no pertenece a tu cuenta.');
    }

    const newBalance = debt.balance - amount;

    await db.transaction((tx) => {
      tx.update(schema.debts)
        .set({
          balance: Math.max(0, newBalance),
          status: newBalance <= 0 ? 'PAID' : 'PENDING',
          updatedAt: now,
        })
        .where(eq(schema.debts.id, debtId))
        .run();

      tx.insert(schema.payments)
        .values({
          debtId,
          cashSessionId: sessionId,
          method,
          amount,
          createdAt: now,
        })
        .run();

      if (method === 'efectivo') {
        const cs = tx
          .select({ expectedCash: schema.cashSessions.expectedCash, initialCash: schema.cashSessions.initialCash })
          .from(schema.cashSessions)
          .where(eq(schema.cashSessions.id, sessionId))
          .get();

        if (cs) {
          tx.update(schema.cashSessions)
            .set({ expectedCash: (cs.expectedCash ?? cs.initialCash) + amount })
            .where(eq(schema.cashSessions.id, sessionId))
            .run();
        }
      }
    });

    await auditService.log({
      userId,
      action: 'customer:debt-paid',
      entity: 'Debt',
      entityId: debtId,
      payload: {
        customerId: debt.customerId,
        amount,
        remainingBalance: Math.max(0, newBalance),
      },
    });

    return {
      id: debt.id,
      customerId: debt.customerId,
      saleId: debt.saleId,
      amount: debt.amount,
      balance: Math.max(0, newBalance),
      status: newBalance <= 0 ? 'PAID' : 'PENDING',
      createdAt: debt.createdAt,
      updatedAt: now,
    };
  }
}
