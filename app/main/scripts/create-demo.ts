import bcrypt from 'bcryptjs';
import { getDatabase, schema } from '../db';
import { logger } from '../utils/logger';
import type { SubscriptionPlan } from '../../renderer/src/shared/types/dian.types';

interface DemoAccount {
  name: string;
  nit: string;
  email: string;
  plan: SubscriptionPlan;
  trialDays?: number;
}

const BCRYPT_ROUNDS = 10;

export async function createDemoAccount(config: DemoAccount): Promise<number> {
  const db = getDatabase();
  const now = new Date().toISOString();

  const [account] = await db
    .insert(schema.accounts)
    .values({
      name: config.name,
      nit: config.nit,
      email: config.email,
      subscriptionStatus: 'TRIAL',
      subscriptionPlan: config.plan,
      trialEndsAt: new Date(Date.now() + (config.trialDays || 14) * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  logger.info({ accountId: account.id }, 'Demo account created');

  const [branch] = await db
    .insert(schema.branches)
    .values({
      accountId: account.id,
      name: 'Sucursal Principal',
      code: 'MAIN',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const password = await bcrypt.hash('admin123', BCRYPT_ROUNDS);
  const [adminUser] = await db
    .insert(schema.users)
    .values({
      accountId: account.id,
      branchId: branch.id,
      username: 'admin',
      password,
      fullName: 'Administrador',
      role: 'ADMIN',
      active: true,
      mustChangePassword: true,
      hourlyRate: 15000,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  logger.info({ accountId: account.id, userId: adminUser.id }, 'Demo user created');

  return account.id;
}
