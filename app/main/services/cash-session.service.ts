import { eq, and, desc, sum, gte, lte, inArray } from 'drizzle-orm';

import { getDatabase, schema } from '../db';
import { AppError, ErrorCode } from '../utils/errors';
import { nowISO } from '../utils/date';
import { AuditService } from './audit.service';
import type {
  CashRegister,
  CashCloseSummary,
  CashClosureRow,
  CashSessionSummary,
} from '../../renderer/src/shared/types/cash.types';

const auditService = new AuditService();

function mapCashSession(row: {
  id: number;
  userId: number;
  initialCash: number;
  finalCash: number | null;
  expectedCash: number | null;
  difference: number | null;
  openedAt: string;
  closedAt: string | null;
  status: string;
}): CashRegister {
  return {
    id: row.id,
    userId: row.userId,
    initialCash: row.initialCash,
    finalCash: row.finalCash,
    expectedCash: row.expectedCash,
    difference: row.difference,
    openedAt: row.openedAt,
    closedAt: row.closedAt,
    status: row.status,
  };
}

export class CashSessionService {
  async listCashClosures(accountId: number, take = 60, branchId?: number): Promise<CashClosureRow[]> {
    const db = getDatabase();
    const safeTake = Math.max(1, Math.min(500, Math.trunc(take)));

    const conditions = [eq(schema.cashSessions.status, 'CLOSED'), eq(schema.users.accountId, accountId)];
    if (branchId) conditions.push(eq(schema.cashSessions.branchId, branchId));

    const rows = await db
      .select({
        id: schema.cashSessions.id,
        initialCash: schema.cashSessions.initialCash,
        finalCash: schema.cashSessions.finalCash,
        expectedCash: schema.cashSessions.expectedCash,
        difference: schema.cashSessions.difference,
        openedAt: schema.cashSessions.openedAt,
        closedAt: schema.cashSessions.closedAt,
        status: schema.cashSessions.status,
        userId: schema.users.id,
        username: schema.users.username,
        fullName: schema.users.fullName,
        role: schema.users.role,
      })
      .from(schema.cashSessions)
      .innerJoin(schema.users, eq(schema.cashSessions.userId, schema.users.id))
      .where(and(...conditions))
      .orderBy(desc(schema.cashSessions.closedAt))
      .limit(safeTake);

    return rows.map((r) => ({
      id: r.id,
      initialCash: r.initialCash,
      finalCash: r.finalCash,
      expectedCash: r.expectedCash,
      difference: r.difference,
      openedAt: r.openedAt,
      closedAt: r.closedAt!,
      status: r.status,
      user: {
        id: r.userId,
        username: r.username,
        fullName: r.fullName,
        role: r.role,
      },
    }));
  }

  async openCashSession(accountId: number, userId: number, initialCash: number, branchId?: number): Promise<CashRegister> {
    const db = getDatabase();

    const conditions = [eq(schema.cashSessions.userId, userId), eq(schema.cashSessions.status, 'OPEN')];
    if (branchId) conditions.push(eq(schema.cashSessions.branchId, branchId));

    const [activeSession] = await db
      .select({ id: schema.cashSessions.id })
      .from(schema.cashSessions)
      .where(and(...conditions))
      .limit(1);

    if (activeSession) {
      throw new AppError(ErrorCode.SESSION_ALREADY_OPEN, 'Ya tienes una caja abierta.');
    }

    const now = nowISO();
    const [session] = await db
      .insert(schema.cashSessions)
      .values({
        accountId,
        userId,
        branchId: branchId ?? null,
        initialCash,
        status: 'OPEN',
        openedAt: now,
      })
      .returning();

    await auditService.log({
      userId,
      action: 'cash-session:opened',
      entity: 'CashSession',
      entityId: session.id,
      payload: { initialCash },
    });

    return mapCashSession(session);
  }

  async closeCashSession(
    sessionId: number,
    finalCash: number,
    expectedCash: number,
    accountId: number,
  ): Promise<CashCloseSummary> {
    const db = getDatabase();

    const [session] = await db
      .select()
      .from(schema.cashSessions)
      .where(and(eq(schema.cashSessions.id, sessionId), eq(schema.cashSessions.accountId, accountId)))
      .limit(1);

    if (!session || session.status !== 'OPEN') {
      throw new AppError(ErrorCode.NO_OPEN_SESSION, 'No existe una caja abierta para cerrar.');
    }

    const difference = finalCash - expectedCash;
    const now = nowISO();

    await db
      .update(schema.cashSessions)
      .set({
        closedAt: now,
        finalCash,
        expectedCash,
        difference,
        status: 'CLOSED',
      })
      .where(eq(schema.cashSessions.id, sessionId));

    await auditService.log({
      userId: session.userId,
      action: 'cash-session:closed',
      entity: 'CashSession',
      entityId: sessionId,
      payload: { finalCash, expectedCash, difference },
    });

    return { finalCash, expectedCash, difference };
  }

  async getActiveCashSession(userId: number, branchId?: number): Promise<CashRegister | null> {
    const db = getDatabase();

    const conditions = [eq(schema.cashSessions.userId, userId), eq(schema.cashSessions.status, 'OPEN')];
    if (branchId) conditions.push(eq(schema.cashSessions.branchId, branchId));

    const [session] = await db
      .select()
      .from(schema.cashSessions)
      .where(and(...conditions))
      .limit(1);

    return session ? mapCashSession(session) : null;
  }

  async getCashSessionSummary(sessionId: number): Promise<CashSessionSummary> {
    const db = getDatabase();

    const payments = await db
      .select({
        id: schema.payments.id,
        method: schema.payments.method,
        amount: schema.payments.amount,
        saleChange: schema.sales.change,
        saleId: schema.payments.saleId,
        debtId: schema.payments.debtId,
      })
      .from(schema.payments)
      .leftJoin(schema.sales, eq(schema.payments.saleId, schema.sales.id))
      .where(eq(schema.payments.cashSessionId, sessionId));

    const cashChangeBySaleId = new Set<number>();
    let totalCambio = 0;
    let totalEfectivoBruto = 0;

    const summary = payments.reduce<Record<string, number>>((acc, p) => {
      const method = p.method.toLowerCase();
      let amount = Number(p.amount);

      if (method === 'efectivo' && p.saleId) {
        totalEfectivoBruto += amount;
        if (!cashChangeBySaleId.has(p.saleId)) {
          totalCambio += Number(p.saleChange || 0);
          amount -= Number(p.saleChange || 0);
          cashChangeBySaleId.add(p.saleId);
        } else {
          amount = 0;
        }
      }

      acc[method] = (acc[method] || 0) + amount;
      acc.total = (acc.total || 0) + amount;
      return acc;
    }, { total: 0 });

    summary.efectivoBruto = totalEfectivoBruto;
    summary.cambio = totalCambio;

    const creditPayments = payments
      .filter((p) => p.method === 'credito' || p.debtId)
      .reduce((sum, p) => sum + Number(p.amount), 0);
    summary.credito = creditPayments;

    return summary as unknown as CashSessionSummary;
  }

  async getTodaySalesTotal(userId: number): Promise<number> {
    const db = getDatabase();
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString();

    const [row] = await db
      .select({ total: sum(schema.sales.total).mapWith(Number) })
      .from(schema.sales)
      .where(
        and(
          eq(schema.sales.userId, userId),
          eq(schema.sales.status, 'COMPLETED'),
          gte(schema.sales.createdAt, startOfDay),
          lte(schema.sales.createdAt, endOfDay),
        ),
      );

    return row?.total ?? 0;
  }

  async getTodayPaymentsByMethod(userId: number): Promise<Record<string, number>> {
    const db = getDatabase();
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString();

    const todaySales = await db
      .select({ id: schema.sales.id })
      .from(schema.sales)
      .where(
        and(
          eq(schema.sales.userId, userId),
          eq(schema.sales.status, 'COMPLETED'),
          gte(schema.sales.createdAt, startOfDay),
          lte(schema.sales.createdAt, endOfDay),
        ),
      );

    if (todaySales.length === 0) return {};

    const saleIds = todaySales.map((s) => s.id);
    const payments = await db
      .select({
        method: schema.payments.method,
        amount: schema.payments.amount,
      })
      .from(schema.payments)
      .where(inArray(schema.payments.saleId, saleIds));

    const result: Record<string, number> = {};
    for (const p of payments) {
      const method = p.method === 'efectivo' ? 'efectivo' : p.method;
      result[method] = (result[method] || 0) + Number(p.amount);
    }
    return result;
  }

  async getMonthSalesTotal(userId: number): Promise<number> {
    const db = getDatabase();
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).toISOString();

    const [row] = await db
      .select({ total: sum(schema.sales.total).mapWith(Number) })
      .from(schema.sales)
      .where(
        and(
          eq(schema.sales.userId, userId),
          eq(schema.sales.status, 'COMPLETED'),
          gte(schema.sales.createdAt, startOfMonth),
          lte(schema.sales.createdAt, endOfMonth),
        ),
      );

    return row?.total ?? 0;
  }
}
