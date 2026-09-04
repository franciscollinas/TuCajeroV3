import bcrypt from 'bcryptjs';
import { eq, and, gt, isNull } from 'drizzle-orm';
import crypto from 'crypto';

import { getDatabase, schema } from '../db';
import { ErrorCode, AppError } from '../utils/errors';
import { validatePassword, generateToken } from '../utils/password';
import { nowISO } from '../utils/date';
import { AuditService } from './audit.service';
import { BranchService } from './branch.service';

const auditService = new AuditService();
const branchService = new BranchService();

const SESSION_EXPIRY_MS = 8 * 60 * 60 * 1000;
const BCRYPT_ROUNDS = 12;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export type UserRole = 'ADMIN' | 'CASHIER' | 'SUPERVISOR';

export interface AuthUser {
  id: number;
  username: string;
  role: UserRole;
  fullName: string;
  mustChangePassword: boolean;
  branchId: number | null;
  branchName: string | null;
  accountId: number | null;
}

export interface AuthSession {
  token: string;
  user: AuthUser;
}

function mapUser(user: { id: number; username: string; role: string; fullName: string; mustChangePassword: boolean; branchId?: number | null; accountId?: number | null }): AuthUser {
  return {
    id: user.id,
    username: user.username,
    role: user.role as UserRole,
    fullName: user.fullName,
    mustChangePassword: !!user.mustChangePassword,
    branchId: user.branchId ?? null,
    branchName: null,
    accountId: user.accountId ?? null,
  };
}

export class AuthService {
  async login(username: string, password: string): Promise<AuthSession> {
    const db = getDatabase();

    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, username))
      .limit(1);

    if (!user || !user.active) {
      throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Credenciales inválidas.');
    }

    const lockedUntil = user.lockedUntil ? new Date(user.lockedUntil) : null;
    if (lockedUntil && lockedUntil > new Date()) {
      const minutesLeft = Math.ceil((lockedUntil.getTime() - Date.now()) / 60000);
      throw new AppError(
        ErrorCode.ACCOUNT_LOCKED,
        `Cuenta bloqueada. Intente de nuevo en ${minutesLeft} minuto(s).`,
      );
    }

    if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS && (!lockedUntil || lockedUntil <= new Date())) {
      await db
        .update(schema.users)
        .set({ failedLoginAttempts: 0, lockedUntil: null })
        .where(eq(schema.users.id, user.id));
    }

    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      const newAttempts = user.failedLoginAttempts + 1;

      if (newAttempts >= MAX_FAILED_ATTEMPTS) {
        const lockUntil = new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString();
        await db
          .update(schema.users)
          .set({ failedLoginAttempts: newAttempts, lockedUntil: lockUntil })
          .where(eq(schema.users.id, user.id));

        await auditService.log({
          userId: user.id,
          action: 'auth:account-locked',
          entity: 'User',
          entityId: user.id,
          payload: { username: user.username, attempts: newAttempts, lockedUntil: lockUntil },
        });

        throw new AppError(
          ErrorCode.ACCOUNT_LOCKED,
          `Demasiados intentos fallidos. Cuenta bloqueada por ${LOCKOUT_DURATION_MS / 60000} minutos.`,
        );
      }

      await db
        .update(schema.users)
        .set({ failedLoginAttempts: newAttempts })
        .where(eq(schema.users.id, user.id));

      const remaining = MAX_FAILED_ATTEMPTS - newAttempts;
      throw new AppError(
        ErrorCode.TOO_MANY_ATTEMPTS,
        `Credenciales inválidas. Quedan ${remaining} intento(s) antes del bloqueo.`,
      );
    }

    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await db
        .update(schema.users)
        .set({ failedLoginAttempts: 0, lockedUntil: null })
        .where(eq(schema.users.id, user.id));
    }

    const token = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_EXPIRY_MS).toISOString();

    await db.insert(schema.sessions).values({
      userId: user.id,
      token: hashToken(token),
      expiresAt,
      createdAt: nowISO(),
    });

    await auditService.log({
      userId: user.id,
      action: 'auth:login',
      entity: 'Session',
      payload: {
        username: user.username,
        previousFailedAttempts: user.failedLoginAttempts,
        expiresAt,
      },
    });

    const authUser = mapUser(user);
    if (user.branchId) {
      const branch = await branchService.getById(user.branchId);
      if (branch) authUser.branchName = branch.name;
    }

    return { token, user: authUser };
  }

  async validateSession(token: string): Promise<AuthUser> {
    const db = getDatabase();
    const now = nowISO();

    const [session] = await db
      .select()
      .from(schema.sessions)
      .where(
        and(
          eq(schema.sessions.token, hashToken(token)),
          gt(schema.sessions.expiresAt, now),
          isNull(schema.sessions.closedAt),
        ),
      )
      .limit(1);

    if (!session) {
      throw new AppError(ErrorCode.SESSION_EXPIRED, 'Sesión inválida o expirada.');
    }

    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, session.userId))
      .limit(1);

    if (!user || !user.active) {
      throw new AppError(ErrorCode.SESSION_EXPIRED, 'Sesión inválida o expirada.');
    }

    const authUser = mapUser(user);
    if (user.branchId) {
      const branch = await branchService.getById(user.branchId);
      if (branch) authUser.branchName = branch.name;
    }

    return authUser;
  }

  async logout(token: string): Promise<void> {
    const db = getDatabase();
    const tokenHash = hashToken(token);

    const [session] = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.token, tokenHash))
      .limit(1);

    await db
      .update(schema.sessions)
      .set({ closedAt: nowISO() })
      .where(eq(schema.sessions.token, tokenHash));

    if (session) {
      const [user] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, session.userId))
        .limit(1);

      if (user) {
        await auditService.log({
          userId: user.id,
          action: 'auth:logout',
          entity: 'Session',
          payload: { username: user.username },
        });
      }
    }
  }

  async changePassword(userId: number, currentPassword: string, newPassword: string): Promise<void> {
    const db = getDatabase();

    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (!user) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Usuario no encontrado.');
    }

    const validCurrent = await bcrypt.compare(currentPassword, user.password);
    if (!validCurrent) {
      throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'La contraseña actual es incorrecta.');
    }

    validatePassword(newPassword);

    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await db
      .update(schema.users)
      .set({ password: hashedPassword, mustChangePassword: false })
      .where(eq(schema.users.id, userId));

    await db
      .delete(schema.sessions)
      .where(eq(schema.sessions.userId, userId));

    await auditService.log({
      userId,
      action: 'auth:password-changed',
      entity: 'User',
      entityId: userId,
      payload: { changedAt: nowISO(), sessionsInvalidated: true },
    });
  }

  async unlockAccount(userId: number, actorUserId: number): Promise<void> {
    const db = getDatabase();

    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (!user) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Usuario no encontrado.');
    }

    await db
      .update(schema.users)
      .set({ failedLoginAttempts: 0, lockedUntil: null })
      .where(eq(schema.users.id, userId));

    await auditService.log({
      userId: actorUserId,
      action: 'auth:account-unlocked',
      entity: 'User',
      entityId: userId,
      payload: { targetUsername: user.username, previousAttempts: user.failedLoginAttempts },
    });
  }

  async getLoginStatus(userId: number): Promise<{ failedAttempts: number; isLocked: boolean; lockedUntil: string | null }> {
    const db = getDatabase();

    const [user] = await db
      .select({
        failedLoginAttempts: schema.users.failedLoginAttempts,
        lockedUntil: schema.users.lockedUntil,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (!user) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Usuario no encontrado.');
    }

    const lockedUntil = user.lockedUntil ? new Date(user.lockedUntil) : null;
    const isLocked = !!(lockedUntil && lockedUntil > new Date());

    return {
      failedAttempts: user.failedLoginAttempts,
      isLocked,
      lockedUntil: isLocked ? user.lockedUntil : null,
    };
  }
}
