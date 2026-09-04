import { eq, and, desc, sum, gte, isNull, lte, or } from 'drizzle-orm';

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
  async listCashClosures(accountId: number, take = 60, branchId?: number, userId?: number): Promise<CashClosureRow[]> {
    const db = getDatabase();
    const safeTake = Math.max(1, Math.min(500, Math.trunc(take)));

    const conditions = [eq(schema.cashSessions.status, 'CLOSED'), eq(schema.users.accountId, accountId)];
    if (branchId) conditions.push(eq(schema.cashSessions.branchId, branchId));
    if (userId) conditions.push(eq(schema.cashSessions.userId, userId));

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

    if (branchId) {
      const [branch] = await db
        .select({ id: schema.branches.id })
        .from(schema.branches)
        .where(and(eq(schema.branches.id, branchId), eq(schema.branches.accountId, accountId), eq(schema.branches.isActive, true)))
        .limit(1);
      if (!branch) throw new AppError(ErrorCode.FORBIDDEN, 'La sucursal no pertenece a tu cuenta o está inactiva.');
    }

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
    userId: number,
    reason?: string,
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

    if (userId != null && session.userId !== userId) {
      throw new AppError(ErrorCode.FORBIDDEN, 'No puede cerrar la caja de otro usuario.');
    }

    // El esperado lo calcula el servidor a partir del valor registrado en la
    // sesión; no se confía en el enviado por el cliente (evita cuadres falsos).
    const serverExpected = session.expectedCash ?? session.initialCash;
    const difference = finalCash - serverExpected;
    const now = nowISO();

    await db
      .update(schema.cashSessions)
      .set({
        closedAt: now,
        finalCash,
        expectedCash: serverExpected,
        difference,
        status: 'CLOSED',
      })
      .where(eq(schema.cashSessions.id, sessionId));

    await auditService.log({
      userId: session.userId,
      action: 'cash-session:closed',
      entity: 'CashSession',
      entityId: sessionId,
      payload: { finalCash, expectedCash: serverExpected, difference, ...(reason ? { reason } : {}) },
    });

    return { finalCash, expectedCash: serverExpected, difference };
  }

  async touchActivity(userId: number, branchId?: number): Promise<void> {
    const db = getDatabase();

    const conditions = [eq(schema.cashSessions.userId, userId), eq(schema.cashSessions.status, 'OPEN')];
    if (branchId) conditions.push(eq(schema.cashSessions.branchId, branchId));

    const [session] = await db
      .select({ id: schema.cashSessions.id })
      .from(schema.cashSessions)
      .where(and(...conditions))
      .limit(1);

    if (!session) return;

    await db
      .update(schema.cashSessions)
      .set({ lastActivityAt: nowISO() })
      .where(eq(schema.cashSessions.id, session.id));
  }

  async autoCloseInactiveSessions(thresholdHours: number): Promise<Array<{ sessionId: number; userId: number; accountId: number }>> {
    const db = getDatabase();
    const cutoff = new Date(Date.now() - thresholdHours * 60 * 60 * 1000).toISOString();

    const sessions = await db
      .select({
        id: schema.cashSessions.id,
        accountId: schema.cashSessions.accountId,
        userId: schema.cashSessions.userId,
        initialCash: schema.cashSessions.initialCash,
        expectedCash: schema.cashSessions.expectedCash,
        openedAt: schema.cashSessions.openedAt,
        lastActivityAt: schema.cashSessions.lastActivityAt,
      })
      .from(schema.cashSessions)
      .where(eq(schema.cashSessions.status, 'OPEN'));

    const closed: Array<{ sessionId: number; userId: number; accountId: number }> = [];

    for (const session of sessions) {
      const lastActivityAt = session.lastActivityAt ?? session.openedAt;
      if (lastActivityAt && lastActivityAt >= cutoff) continue;

      const accountId = session.accountId ?? 0;
      if (accountId <= 0) continue;

      // Cierre automático sin fabricar arqueo: no se registra finalCash ni
      // difference (quedan NULL); el cierre queda pendiente de conciliación.
      const now = nowISO();
      await db
        .update(schema.cashSessions)
        .set({ closedAt: now, status: 'CLOSED' })
        .where(and(eq(schema.cashSessions.id, session.id), eq(schema.cashSessions.status, 'OPEN')));

      await auditService.log({
        userId: session.userId,
        action: 'cash-session:auto-closed',
        entity: 'CashSession',
        entityId: session.id,
        payload: { reason: 'auto-close-inactivity', expectedCash: session.expectedCash ?? session.initialCash },
      });

      closed.push({ sessionId: session.id, userId: session.userId, accountId });
    }

    return closed;
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

  async getCashSessionSummary(sessionId: number, accountId: number): Promise<CashSessionSummary> {
    const db = getDatabase();

    const [session] = await db
      .select({ id: schema.cashSessions.id })
      .from(schema.cashSessions)
      .where(and(eq(schema.cashSessions.id, sessionId), eq(schema.cashSessions.accountId, accountId)))
      .limit(1);

    if (!session) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Sesión de caja no encontrada.');
    }

    const payments = await db
      .select({
        id: schema.payments.id,
        method: schema.payments.method,
        amount: schema.payments.amount,
        saleChange: schema.sales.change,
        saleId: schema.payments.saleId,
        debtId: schema.payments.debtId,
        saleStatus: schema.sales.status,
      })
      .from(schema.payments)
      .leftJoin(schema.sales, eq(schema.payments.saleId, schema.sales.id))
      .where(eq(schema.payments.cashSessionId, sessionId));

    const activePayments = payments.filter((p) => p.saleStatus !== 'CANCELLED');

    const cashChangeBySaleId = new Set<number>();
    let totalCambio = 0;
    let totalEfectivoBruto = 0;

    const summary = activePayments.reduce<Record<string, number>>((acc, p) => {
      const method = p.method.toLowerCase();
      let amount = Number(p.amount);

      if (method === 'efectivo' && p.saleId) {
        totalEfectivoBruto += amount;
        if (!cashChangeBySaleId.has(p.saleId)) {
          totalCambio += Number(p.saleChange || 0);
          amount -= Number(p.saleChange || 0);
          cashChangeBySaleId.add(p.saleId);
        }
      }

      acc[method] = (acc[method] || 0) + amount;
      acc.total = (acc.total || 0) + amount;
      return acc;
    }, { total: 0 });

    summary.efectivoBruto = totalEfectivoBruto;
    summary.cambio = totalCambio;

    const creditPayments = activePayments
      .filter((p) => p.method === 'credito')
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

    // Los abonos a deudas no tienen saleId. Consultar los pagos de las
    // sesiones del cajero incluye tanto ventas como abonos ingresados hoy.
    const payments = await db
      .select({
        method: schema.payments.method,
        amount: schema.payments.amount,
        saleId: schema.payments.saleId,
        saleChange: schema.sales.change,
      })
      .from(schema.payments)
      .leftJoin(schema.sales, eq(schema.payments.saleId, schema.sales.id))
      .innerJoin(schema.cashSessions, eq(schema.payments.cashSessionId, schema.cashSessions.id))
      .where(
        and(
          eq(schema.cashSessions.userId, userId),
          gte(schema.payments.createdAt, startOfDay),
          lte(schema.payments.createdAt, endOfDay),
          or(isNull(schema.payments.saleId), eq(schema.sales.status, 'COMPLETED')),
        ),
      );

    const result: Record<string, number> = {};
    const cashChangeBySaleId = new Set<number>();
    for (const p of payments) {
      let amount = Number(p.amount);
      if (p.method === 'efectivo' && p.saleId && !cashChangeBySaleId.has(p.saleId)) {
        amount -= Number(p.saleChange || 0);
        cashChangeBySaleId.add(p.saleId);
      }
      result[p.method] = (result[p.method] || 0) + amount;
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
