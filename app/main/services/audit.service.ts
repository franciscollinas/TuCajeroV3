import { getDatabase, schema } from '../db';
import { nowISO, parseLocalDateOnly, toLocalIsoDate, startOfDay, addDays } from '../utils/date';
import { logger } from '../utils/logger';
import { desc, eq, and, gte, lt, lte } from 'drizzle-orm';

export interface DailyAuditUserSummary {
  userId: number;
  userName: string;
  total: number;
  actions: Record<string, number>;
}

export interface DailyAuditSummary {
  date: string;
  totalEvents: number;
  byUser: DailyAuditUserSummary[];
}

export interface DailyAuditLogEntry {
  id: number;
  date: string;
  summary: DailyAuditSummary;
  createdAt: string;
  updatedAt: string;
}

export class AuditService {
  async log(input: {
    userId: number;
    action: string;
    entity: string;
    entityId?: number;
    payload: unknown;
  }): Promise<void> {
    const db = getDatabase();
    let accountId: number | null = null;
    try {
      const [user] = await db
        .select({ accountId: schema.users.accountId })
        .from(schema.users)
        .where(eq(schema.users.id, input.userId))
        .limit(1);
      accountId = user?.accountId ?? null;
    } catch (err) {
      logger.error({ err, userId: input.userId }, 'Could not resolve audit account, retrying');
      try {
        const [user] = await db
          .select({ accountId: schema.users.accountId })
          .from(schema.users)
          .where(eq(schema.users.id, input.userId))
          .limit(1);
        accountId = user?.accountId ?? null;
      } catch (retryErr) {
        logger.error({ retryErr, userId: input.userId }, 'Audit account lookup retry failed');
      }
    }
    const entry = {
      accountId,
      userId: input.userId,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      payload: JSON.stringify(input.payload ?? {}),
      createdAt: nowISO(),
    };

    try {
      await db.insert(schema.auditLogs).values(entry).run();
    } catch (err) {
      logger.error({ err }, 'Audit log failed, retrying once');
      try {
        await db.insert(schema.auditLogs).values(entry).run();
      } catch (retryErr) {
        logger.error({ retryErr }, 'Audit log retry failed; la operación continúa sin auditoría');
      }
    }
  }

  async getAuditLogs(opts?: {
    limit?: number;
    offset?: number;
    startDate?: string;
    endDate?: string;
    userId?: number;
    action?: string;
    entity?: string;
    accountId?: number | null;
  }): Promise<Array<{
    id: number;
    date: string;
    user: string;
    action: string;
    entity: string;
    details: string;
  }>> {
    const db = getDatabase();
    const conditions = [];

    if (opts?.startDate) conditions.push(gte(schema.auditLogs.createdAt, parseLocalDateOnly(opts.startDate).toISOString()));
    if (opts?.endDate) {
      const endExclusive = parseLocalDateOnly(opts.endDate);
      endExclusive.setDate(endExclusive.getDate() + 1);
      conditions.push(lt(schema.auditLogs.createdAt, endExclusive.toISOString()));
    }
    if (opts?.userId) conditions.push(eq(schema.auditLogs.userId, opts.userId));
    if (opts?.action) conditions.push(eq(schema.auditLogs.action, opts.action));
    if (opts?.entity) conditions.push(eq(schema.auditLogs.entity, opts.entity));
    if (opts?.accountId) conditions.push(eq(schema.auditLogs.accountId, opts.accountId));

    const rows = await db
      .select({
        id: schema.auditLogs.id,
        createdAt: schema.auditLogs.createdAt,
        action: schema.auditLogs.action,
        entity: schema.auditLogs.entity,
        payload: schema.auditLogs.payload,
        userId: schema.auditLogs.userId,
        fullName: schema.users.fullName,
      })
      .from(schema.auditLogs)
      .innerJoin(schema.users, eq(schema.users.id, schema.auditLogs.userId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.auditLogs.createdAt))
      .limit(opts?.limit ?? 50)
      .offset(opts?.offset ?? 0);

    return rows.map((r) => ({
      id: r.id,
      date: r.createdAt,
      user: r.fullName,
      action: r.action,
      entity: r.entity,
      details: r.payload ?? '',
    }));
  }

  // ─── Log diario de auditoría ────────────────────────────────────────

  /** Calcula el resumen del día: eventos de AuditLog agrupados por usuario. */
  async computeDailySummary(date: string, accountId: number): Promise<DailyAuditSummary> {
    const db = getDatabase();
    const start = parseLocalDateOnly(date);
    const end = addDays(start, 1);

    const rows = await db
      .select({
        userId: schema.auditLogs.userId,
        action: schema.auditLogs.action,
        fullName: schema.users.fullName,
      })
      .from(schema.auditLogs)
      .innerJoin(schema.users, eq(schema.users.id, schema.auditLogs.userId))
      .where(and(
        eq(schema.auditLogs.accountId, accountId),
        gte(schema.auditLogs.createdAt, start.toISOString()),
        lt(schema.auditLogs.createdAt, end.toISOString()),
      ));

    const byUser = new Map<number, DailyAuditUserSummary>();
    for (const r of rows) {
      let entry = byUser.get(r.userId);
      if (!entry) {
        entry = { userId: r.userId, userName: r.fullName ?? `#${r.userId}`, total: 0, actions: {} };
        byUser.set(r.userId, entry);
      }
      entry.total += 1;
      entry.actions[r.action] = (entry.actions[r.action] ?? 0) + 1;
    }

    const sorted = [...byUser.values()].sort((a, b) => b.total - a.total);
    return { date, totalEvents: rows.length, byUser: sorted };
  }

  private mapDailyLog(row: typeof schema.dailyAuditLogs.$inferSelect): DailyAuditLogEntry {
    let summary: DailyAuditSummary = { date: row.date, totalEvents: 0, byUser: [] };
    try {
      summary = JSON.parse(row.summary) as DailyAuditSummary;
    } catch {
      logger.warn({ id: row.id }, 'Daily audit log has corrupt JSON summary');
    }
    return { id: row.id, date: row.date, summary, createdAt: row.createdAt, updatedAt: row.updatedAt };
  }

  /** Devuelve el log diario existente para (fecha, cuenta), o null. */
  async findDailyLog(date: string, accountId: number): Promise<DailyAuditLogEntry | null> {
    const db = getDatabase();
    const [row] = await db
      .select()
      .from(schema.dailyAuditLogs)
      .where(and(eq(schema.dailyAuditLogs.accountId, accountId), eq(schema.dailyAuditLogs.date, date)))
      .limit(1);
    return row ? this.mapDailyLog(row) : null;
  }

  /** Si no existe el log diario de la fecha, lo calcula desde AuditLog y lo persiste. */
  async getOrCreateDailyLog(date: string, accountId: number): Promise<{ created: boolean; log: DailyAuditLogEntry }> {
    const existing = await this.findDailyLog(date, accountId);
    if (existing) return { created: false, log: existing };

    const summary = await this.computeDailySummary(date, accountId);
    // No se crean "logs vacíos": días sin actividad no generan fila.
    if (summary.totalEvents === 0) {
      return { created: false, log: { id: 0, date, summary, createdAt: '', updatedAt: '' } };
    }

    const db = getDatabase();
    const now = nowISO();

    try {
      const inserted = await db
        .insert(schema.dailyAuditLogs)
        .values({ accountId, date, summary: JSON.stringify(summary), createdAt: now, updatedAt: now })
        .onConflictDoNothing({ target: [schema.dailyAuditLogs.accountId, schema.dailyAuditLogs.date] })
        .returning()
        .get();
      if (inserted) return { created: true, log: this.mapDailyLog(inserted) };
    } catch (err) {
      logger.error({ err, date, accountId }, 'Daily audit insert failed (race), reusing existing row');
    }

    const log = await this.findDailyLog(date, accountId);
    if (!log) throw new Error('No se pudo generar el log diario de auditoría.');
    return { created: false, log };
  }

  /**
   * Genera los logs diarios faltantes de días ya terminados (hasta `daysBack` días
   * hacia atrás, máximo `maxDays` pendientes). Devuelve cuántos se crearon.
   */
  async ensureDailyLogs(accountId: number, daysBack = 7, maxDays = 90): Promise<number> {
    const db = getDatabase();
    const existing = await db
      .select({ date: schema.dailyAuditLogs.date })
      .from(schema.dailyAuditLogs)
      .where(eq(schema.dailyAuditLogs.accountId, accountId));
    const existingDates = new Set(existing.map((row) => row.date));

    const today = startOfDay(new Date());
    const pending: string[] = [];
    for (let back = daysBack; back >= 1; back--) {
      const date = toLocalIsoDate(addDays(today, -back));
      if (!existingDates.has(date)) pending.push(date);
    }

    let generated = 0;
    for (const date of pending.slice(0, maxDays)) {
      const result = await this.getOrCreateDailyLog(date, accountId);
      if (result.created) generated += 1;
    }
    return generated;
  }

  /** Guarda (o actualiza) el log diario de HOY. Útil para el cierre manual del día. */
  async saveTodayLog(accountId: number): Promise<DailyAuditLogEntry> {
    const date = toLocalIsoDate(new Date());
    const summary = await this.computeDailySummary(date, accountId);
    const db = getDatabase();
    const now = nowISO();

    await db
      .insert(schema.dailyAuditLogs)
      .values({ accountId, date, summary: JSON.stringify(summary), createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [schema.dailyAuditLogs.accountId, schema.dailyAuditLogs.date],
        set: { summary: JSON.stringify(summary), updatedAt: now },
      })
      .run();

    const log = await this.findDailyLog(date, accountId);
    if (!log) throw new Error('No se pudo guardar el log diario de hoy.');
    return log;
  }

  /** Lista los logs diarios de la cuenta, opcionalmente filtrados por rango de fechas. */
  async getDailyLogs(opts?: {
    accountId?: number | null;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  }): Promise<DailyAuditLogEntry[]> {
    const db = getDatabase();
    const conditions: ReturnType<typeof gte>[] = [];
    if (opts?.accountId) conditions.push(eq(schema.dailyAuditLogs.accountId, opts.accountId));
    if (opts?.startDate) conditions.push(gte(schema.dailyAuditLogs.date, opts.startDate));
    if (opts?.endDate) conditions.push(lte(schema.dailyAuditLogs.date, opts.endDate));

    const rows = await db
      .select()
      .from(schema.dailyAuditLogs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.dailyAuditLogs.date), desc(schema.dailyAuditLogs.id))
      .limit(opts?.limit ?? 100)
      .offset(opts?.offset ?? 0);

    return rows.map((row) => this.mapDailyLog(row));
  }

  /** Genera logs diarios faltantes para todas las cuentas. Se llama al iniciar la app. */
  async ensureDailyLogsForAllAccounts(daysBack = 7): Promise<number> {
    const db = getDatabase();
    const accounts = await db.select({ id: schema.accounts.id }).from(schema.accounts);
    let total = 0;
    for (const account of accounts) {
      try {
        total += await this.ensureDailyLogs(account.id, daysBack);
      } catch (err) {
        logger.error({ err, accountId: account.id }, 'Daily audit log generation failed for account');
      }
    }
    return total;
  }
}
