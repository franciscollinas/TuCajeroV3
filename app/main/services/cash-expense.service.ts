import { eq, and, desc, sum, gte, lte } from 'drizzle-orm';

import { getDatabase, schema } from '../db';
import { AppError, ErrorCode } from '../utils/errors';
import { nowISO } from '../utils/date';
import type { CashExpense } from '../../renderer/src/shared/types/cash.types';

export class CashExpenseService {
  async createExpense(
    sessionId: number,
    userId: number,
    amount: number,
    reason: string,
    accountId: number,
  ): Promise<CashExpense> {
    const db = getDatabase();

    const [session] = await db
      .select({ id: schema.cashSessions.id, status: schema.cashSessions.status })
      .from(schema.cashSessions)
      .where(and(eq(schema.cashSessions.id, sessionId), eq(schema.cashSessions.accountId, accountId)))
      .limit(1);

    if (!session || session.status !== 'OPEN') {
      throw new AppError(ErrorCode.NO_OPEN_SESSION, 'No existe una caja abierta para registrar el egreso.');
    }

    if (amount <= 0) {
      throw new AppError(ErrorCode.VALIDATION, 'El monto del egreso debe ser mayor a cero.');
    }

    if (!reason || reason.trim().length === 0) {
      throw new AppError(ErrorCode.VALIDATION, 'El concepto del egreso es obligatorio.');
    }

    const now = nowISO();
    const [expense] = await db
      .insert(schema.cashExpenses)
      .values({
        accountId,
        cashSessionId: sessionId,
        userId,
        amount,
        reason: reason.trim(),
        createdAt: now,
      })
      .returning();

    return {
      id: expense.id,
      cashSessionId: expense.cashSessionId,
      userId: expense.userId,
      amount: expense.amount,
      reason: expense.reason,
      createdAt: expense.createdAt,
    };
  }

  async getExpensesBySession(sessionId: number, accountId: number): Promise<CashExpense[]> {
    const db = getDatabase();

    const rows = await db
      .select()
      .from(schema.cashExpenses)
      .where(and(eq(schema.cashExpenses.cashSessionId, sessionId), eq(schema.cashExpenses.accountId, accountId)))
      .orderBy(desc(schema.cashExpenses.createdAt));

    return rows.map((r) => ({
      id: r.id,
      cashSessionId: r.cashSessionId,
      userId: r.userId,
      amount: r.amount,
      reason: r.reason,
      createdAt: r.createdAt,
    }));
  }

  async getTodayExpensesTotal(userId: number): Promise<number> {
    const db = getDatabase();
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString();

    const [row] = await db
      .select({ total: sum(schema.cashExpenses.amount).mapWith(Number) })
      .from(schema.cashExpenses)
      .where(
        and(
          eq(schema.cashExpenses.userId, userId),
          gte(schema.cashExpenses.createdAt, startOfDay),
          lte(schema.cashExpenses.createdAt, endOfDay),
        ),
      );

    return row?.total ?? 0;
  }

  async getSessionExpensesTotal(sessionId: number): Promise<number> {
    const db = getDatabase();

    const [row] = await db
      .select({ total: sum(schema.cashExpenses.amount).mapWith(Number) })
      .from(schema.cashExpenses)
      .where(eq(schema.cashExpenses.cashSessionId, sessionId));

    return row?.total ?? 0;
  }
}
