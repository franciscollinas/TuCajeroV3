import bcrypt from 'bcryptjs';
import { count } from 'drizzle-orm';

import { getDatabase, schema } from '../db';
import { nowISO } from '../utils/date';

const DEFAULT_PASSWORD = 'admin123';
const BCRYPT_ROUNDS = 12;

// En una instalación limpia la base de datos queda vacía tras las migraciones.
// Se crean la cuenta principal y los usuarios iniciales (mismos datos que
// scripts/seed.ts) para que la app sea usable: el login y la activación de
// licencia requieren un ADMIN existente.
export async function ensureBootstrap(): Promise<void> {
  const db = getDatabase();

  const [row] = await db.select({ value: count() }).from(schema.users);
  if ((row?.value ?? 0) > 0) return;

  const now = nowISO();
  const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, BCRYPT_ROUNDS);

  const [account] = await db
    .insert(schema.accounts)
    .values({
      name: 'Cuenta Principal',
      nit: '000000000000',
      email: 'local@tucajero.local',
      phone: '',
      subscriptionStatus: 'TRIAL',
      subscriptionPlan: 'BASIC',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: schema.accounts.id });

  const accountId = account.id;

  await db.insert(schema.users).values([
    {
      accountId,
      username: 'admin',
      password: hashedPassword,
      fullName: 'Administrador',
      role: 'ADMIN',
      active: true,
      mustChangePassword: true,
      failedLoginAttempts: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      accountId,
      username: 'cajero1',
      password: hashedPassword,
      fullName: 'Cajero Principal',
      role: 'CASHIER',
      active: true,
      mustChangePassword: true,
      failedLoginAttempts: 0,
      createdAt: now,
      updatedAt: now,
    },
  ]);
}
