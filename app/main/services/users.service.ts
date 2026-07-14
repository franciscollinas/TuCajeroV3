import bcrypt from 'bcryptjs';
import { eq, and, gte } from 'drizzle-orm';

import { getDatabase, schema } from '../db';
import { AppError, ErrorCode } from '../utils/errors';
import { validatePassword } from '../utils/password';
import { nowISO } from '../utils/date';
import { AuditService } from './audit.service';

const auditService = new AuditService();
const BCRYPT_ROUNDS = 12;

function mapUser(user: {
  id: number;
  username: string;
  fullName: string;
  role: string;
  active: boolean;
  hourlyRate: number | null;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role as 'ADMIN' | 'CASHIER' | 'SUPERVISOR',
    active: user.active,
    hourlyRate: user.hourlyRate ?? undefined,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export class UsersService {
  async listUsers(accountId: number) {
    const db = getDatabase();
    const users = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.accountId, accountId))
      .orderBy(schema.users.createdAt);

    return users.map(mapUser);
  }

  async createUser(data: {
    username: string;
    password: string;
    fullName: string;
    role: 'ADMIN' | 'CASHIER' | 'SUPERVISOR';
    hourlyRate?: number;
    actorUserId: number;
    accountId: number;
  }) {
    const db = getDatabase();

    const [existing] = await db
      .select()
      .from(schema.users)
      .where(and(eq(schema.users.username, data.username), eq(schema.users.accountId, data.accountId)))
      .limit(1);

    if (existing) {
      throw new AppError(ErrorCode.VALIDATION, 'Ese nombre de usuario ya existe.');
    }

    validatePassword(data.password);

    const password = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    const now = nowISO();

    const [user] = await db
      .insert(schema.users)
      .values({
        accountId: data.accountId,
        username: data.username.trim(),
        password,
        fullName: data.fullName.trim(),
        role: data.role,
        active: true,
        mustChangePassword: true,
        hourlyRate: data.hourlyRate ?? 15000,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await auditService.log({
      userId: data.actorUserId,
      action: 'user:created',
      entity: 'User',
      entityId: user.id,
      payload: {
        username: user.username,
        role: user.role,
        fullName: user.fullName,
      },
    });

    return mapUser(user);
  }

  async updateUser(id: number, data: {
    fullName?: string;
    role?: 'ADMIN' | 'CASHIER' | 'SUPERVISOR';
    password?: string;
    active?: boolean;
    hourlyRate?: number;
    actorUserId: number;
  }, accountId: number) {
    const db = getDatabase();

    const [existing] = await db
      .select()
      .from(schema.users)
      .where(and(eq(schema.users.id, id), eq(schema.users.accountId, accountId)))
      .limit(1);

    if (!existing) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Usuario no encontrado.');
    }

    const now = nowISO();
    const updateData: Record<string, unknown> = { updatedAt: now };

    if (data.fullName !== undefined) updateData.fullName = data.fullName.trim();
    if (data.role !== undefined) updateData.role = data.role;
    if (data.active !== undefined) updateData.active = data.active;
    if (data.hourlyRate !== undefined) updateData.hourlyRate = data.hourlyRate;

    if (data.password) {
      validatePassword(data.password);
      updateData.password = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    }

    await db
      .update(schema.users)
      .set(updateData)
      .where(and(eq(schema.users.id, id), eq(schema.users.accountId, accountId)));

    const [updated] = await db
      .select()
      .from(schema.users)
      .where(and(eq(schema.users.id, id), eq(schema.users.accountId, accountId)))
      .limit(1);

    await auditService.log({
      userId: data.actorUserId,
      action: 'user:edited',
      entity: 'User',
      entityId: id,
      payload: {
        before: { fullName: existing.fullName, role: existing.role, active: existing.active },
        after: { fullName: updated.fullName, role: updated.role, active: updated.active },
      },
    });

    return mapUser(updated);
  }

  async toggleUserActive(id: number, active: boolean, actorUserId: number, accountId: number) {
    const db = getDatabase();
    const now = nowISO();

    const [existing] = await db
      .select()
      .from(schema.users)
      .where(and(eq(schema.users.id, id), eq(schema.users.accountId, accountId)))
      .limit(1);

    if (!existing) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Usuario no encontrado.');
    }

    await db
      .update(schema.users)
      .set({ active, updatedAt: now })
      .where(and(eq(schema.users.id, id), eq(schema.users.accountId, accountId)));

    if (!active) {
      await db
        .delete(schema.sessions)
        .where(eq(schema.sessions.userId, id));
    }

    await auditService.log({
      userId: actorUserId,
      action: 'user:edited',
      entity: 'User',
      entityId: id,
      payload: { active },
    });

    const [user] = await db
      .select()
      .from(schema.users)
      .where(and(eq(schema.users.id, id), eq(schema.users.accountId, accountId)))
      .limit(1);

    return mapUser(user);
  }

  async getUserStats(userId: number, accountId: number) {
    const db = getDatabase();
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).toISOString();

    const [user] = await db
      .select({ username: schema.users.username, fullName: schema.users.fullName })
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), eq(schema.users.accountId, accountId)))
      .limit(1);

    if (!user) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Usuario no encontrado.');
    }

    const sessions = await db
      .select({
        createdAt: schema.sessions.createdAt,
        expiresAt: schema.sessions.expiresAt,
        closedAt: schema.sessions.closedAt,
      })
      .from(schema.sessions)
      .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
      .where(
        and(
          eq(schema.sessions.userId, userId),
          eq(schema.users.accountId, accountId),
          gte(schema.sessions.createdAt, startOfMonth),
        ),
      );

    let totalWorkedSeconds = 0;
    for (const s of sessions) {
      const start = new Date(s.createdAt).getTime();
      const end = s.closedAt
        ? new Date(s.closedAt).getTime()
        : new Date(s.expiresAt).getTime();
      totalWorkedSeconds += Math.max(0, (end - start) / 1000);
    }

    const [salesResult] = await db
      .select({ total: schema.sales.total })
      .from(schema.sales)
      .where(
        and(
          eq(schema.sales.userId, userId),
          eq(schema.sales.accountId, accountId),
          eq(schema.sales.status, 'COMPLETED'),
          gte(schema.sales.createdAt, startOfMonth),
        ),
      );

    return {
      id: userId,
      username: user.username,
      fullName: user.fullName,
      totalWorkedSeconds,
      monthlySales: Number(salesResult?.total ?? 0),
    };
  }

  async getAllUserStats(accountId: number) {
    const db = getDatabase();

    const cashiers = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(
        and(
          eq(schema.users.role, 'CASHIER'),
          eq(schema.users.active, true),
          eq(schema.users.accountId, accountId),
        ),
      );

    const stats = await Promise.all(cashiers.map((u) => this.getUserStats(u.id, accountId)));
    return stats;
  }
}
