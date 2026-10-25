import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dir = join(tmpdir(), `tucajero-validation-${Date.now()}`);
process.env.DATABASE_URL = join(dir, 'test.db');
process.env.TUCAJERO_BACKUP_DIR = join(dir, 'backups');

const { appRouter } = await import('../app/main/router/index');
const { CashSessionService } = await import('../app/main/services/cash-session.service');
const { getDatabase, schema, closeDatabase } = await import('../app/main/db');
const { eq } = await import('drizzle-orm');

let nativeDbAvailable = true;
try {
  new Database(':memory:').close();
} catch {
  nativeDbAvailable = false;
}
const serviceDescribe = nativeDbAvailable ? describe : describe.skip;

const NOW = '2026-01-01T00:00:00.000Z';

// Fija cómo se validan las entradas del router (zod): si una actualización de la librería cambia
// qué se acepta o cómo se redondea el dinero, estas pruebas lo avisan.
serviceDescribe('validación de las entradas del router', () => {
  const admin = () => appRouter.createCaller({
    user: { id: 1, username: 'admin', role: 'ADMIN', fullName: 'Admin', mustChangePassword: false, branchId: null, branchName: null, accountId: 1 },
  });
  let session = 0;

  beforeAll(async () => {
    mkdirSync(dir, { recursive: true });
    const sqlite = new Database(process.env.DATABASE_URL as string);
    sqlite.pragma('foreign_keys = ON');
    migrate(drizzle(sqlite), { migrationsFolder: resolve('database/migrations') });
    sqlite.exec(`
      INSERT INTO "Account" (name, nit, email, createdAt, updatedAt) VALUES ('A', '1', 'a@a.com', '${NOW}', '${NOW}');
      INSERT INTO "User" (accountId, username, password, fullName, role, active, createdAt, updatedAt) VALUES (1, 'admin', 'h', 'Admin', 'ADMIN', 1, '${NOW}', '${NOW}');
    `);
    sqlite.close();
    session = (await new CashSessionService().openCashSession(1, 1, 1000)).id;
  });

  afterAll(() => {
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it('rechaza dinero negativo, infinito, NaN, demasiado grande y con tipo equivocado', async () => {
    for (const finalCash of [-1, Infinity, NaN, 1_000_000_000, '5000' as unknown as number]) {
      await expect(admin().cash.close({ sessionId: session, finalCash })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    }
    expect(getDatabase().select().from(schema.cashSessions).where(eq(schema.cashSessions.id, session)).get()!.status).toBe('OPEN');
  });

  it('rechaza campos obligatorios ausentes', async () => {
    await expect(admin().cash.close({ finalCash: 100 } as never)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(admin().cash.close({ sessionId: session } as never)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('el dinero se redondea a pesos enteros al entrar', async () => {
    const result = await admin().cash.close({ sessionId: session, finalCash: 999.6 });
    expect(result.finalCash).toBe(1000);
  });

  it('acepta una entrada opcional ausente y descarta los campos que no conoce', async () => {
    await expect(admin().users.list()).resolves.toBeDefined();
    await expect(admin().users.list({ campoDeMas: 1 } as never)).resolves.toBeDefined();
  });

  it('valida las listas de opciones (roles)', async () => {
    await expect(
      admin().users.create({ data: { username: 'x', password: 'y', fullName: 'Z', role: 'DUEÑO' as never } }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
