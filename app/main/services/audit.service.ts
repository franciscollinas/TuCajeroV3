import { getDatabase, schema } from '../db';
import { nowISO, parseLocalDateOnly } from '../utils/date';
import { logger } from '../utils/logger';
import { desc, eq, and, gte, lt } from 'drizzle-orm';

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
}
