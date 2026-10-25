import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { generateKeyPairSync, sign } from 'crypto';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const dir = join(tmpdir(), `tucajero-security-${Date.now()}`);
process.env.DATABASE_URL = join(dir, 'test.db');

// La clave pública de pruebas debe estar antes de importar el servicio de licencias.
const testKeys = generateKeyPairSync('ed25519');
process.env.LICENSE_PUBLIC_KEY = testKeys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

const { appRouter } = await import('../app/main/router/index');
const { LicenseService } = await import('../app/main/services/license.service');
const { resetLicenseGuardCache } = await import('../app/main/services/license-guard');
const { resolveLicensePublicKey, EMBEDDED_LICENSE_PUBLIC_KEY } = await import('../app/main/services/license-keys');
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
const HOUR = 3600 * 1000;
const licenses = new LicenseService();

// La huella real consulta el hardware (CPU, disco, red) y en el servidor de CI tarda más que el tiempo
// de las pruebas: aquí no se prueba el hardware sino que la licencia se exija, así que es fija.
const FAKE_FINGERPRINT = 'a1'.repeat(32);
vi.spyOn(LicenseService.prototype, 'generateFingerprint').mockResolvedValue({
  cpuInfo: 'cpu', diskSerial: 'disco', macAddress: 'mac', hostname: 'equipo', fingerprint: FAKE_FINGERPRINT,
});

const caller = (mustChangePassword = false) =>
  appRouter.createCaller({
    user: { id: 1, username: 'admin', role: 'ADMIN', fullName: 'Admin', mustChangePassword, branchId: null, branchName: null, accountId: 1 },
  });

function setConfig(key: string, value: string): void {
  const db = getDatabase();
  db.delete(schema.configs).where(eq(schema.configs.key, key)).run();
  db.insert(schema.configs).values({ key, value, updatedAt: NOW }).run();
}
function clearConfig(key: string): void {
  getDatabase().delete(schema.configs).where(eq(schema.configs.key, key)).run();
}

describe('la clave pública de licencias en la app instalada', () => {
  it('en la app empaquetada se ignora LICENSE_PUBLIC_KEY y se usa la embebida', () => {
    expect(resolveLicensePublicKey(true)).toBe(EMBEDDED_LICENSE_PUBLIC_KEY);
  });

  it('en desarrollo y pruebas sí se puede sobreescribir', () => {
    expect(resolveLicensePublicKey(false)).toBe(process.env.LICENSE_PUBLIC_KEY);
  });
});

serviceDescribe('seguridad del programa de fondo', () => {
  beforeAll(async () => {
    mkdirSync(dir, { recursive: true });
    const sqlite = new Database(process.env.DATABASE_URL as string);
    sqlite.pragma('foreign_keys = ON');
    migrate(drizzle(sqlite), { migrationsFolder: resolve('database/migrations') });
    const hash = await bcrypt.hash('Inicial123', 4);
    sqlite.exec(`
      INSERT INTO "Account" (name, nit, email, createdAt, updatedAt) VALUES ('A', '1', 'a@a.com', '${NOW}', '${NOW}');
      INSERT INTO "User" (accountId, username, password, fullName, role, active, mustChangePassword, createdAt, updatedAt) VALUES (1, 'admin', '${hash}', 'Admin', 'ADMIN', 1, 1, '${NOW}', '${NOW}');
    `);
    sqlite.close();
  });

  afterAll(() => {
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('contraseña de fábrica', () => {
    it('mientras deba cambiarla, el servidor rechaza cualquier otra operación', async () => {
      await expect(caller(true).inventory.getAll()).rejects.toThrow(/cambiar tu contraseña/i);
      await expect(caller(true).cash.getActive({ userId: 1 })).rejects.toThrow(/cambiar tu contraseña/i);
    });

    it('pero deja cambiarla y consultar la licencia', async () => {
      await expect(caller(true).auth.changePassword({ currentPassword: 'mala', newPassword: 'Nueva1234' })).rejects.toThrow(/actual es incorrecta/i);
      await expect(caller(true).license.getStatus()).resolves.toBeDefined();
    });

    it('cambiarla con la contraseña actual correcta libera al usuario', async () => {
      await expect(caller(true).auth.changePassword({ currentPassword: 'Inicial123', newPassword: 'Nueva1234' })).resolves.toEqual({ success: true });
      const row = getDatabase().select().from(schema.users).where(eq(schema.users.id, 1)).get()!;
      expect(row.mustChangePassword).toBe(false);
      expect(await bcrypt.compare('Nueva1234', row.password)).toBe(true);
      await expect(caller(false).inventory.getAll()).resolves.toBeDefined();
    });

    it('la nueva contraseña debe cumplir las reglas', async () => {
      await expect(caller(false).auth.changePassword({ currentPassword: 'Nueva1234', newPassword: 'corta' })).rejects.toThrow(/8 caracteres/i);
    });
  });

  describe('licencia exigida en el programa de fondo', () => {
    beforeEach(() => {
      resetLicenseGuardCache();
      clearConfig('license_data');
      clearConfig('first_run_at');
      clearConfig('trial_last_seen_at');
      rmSync(join(dir, 'tucajero-trial.dat'), { force: true });
    });

    it('con la prueba gratuita vigente se puede trabajar', async () => {
      await expect(caller().inventory.getAll()).resolves.toBeDefined();
    });

    it('con la prueba vencida y sin licencia se bloquea todo menos la pantalla de licencia', async () => {
      setConfig('first_run_at', new Date(Date.now() - 30 * HOUR).toISOString());
      await expect(caller().inventory.getAll()).rejects.toThrow(/licencia/i);
      await expect(caller().sales.getDashboardSummary()).rejects.toThrow(/licencia/i);
      await expect(caller().license.getStatus()).resolves.toMatchObject({ status: 'none' });
      await expect(caller().license.getFingerprint()).resolves.toBeDefined();
    });

    it('con una licencia válida vuelve a funcionar', async () => {
      setConfig('first_run_at', new Date(Date.now() - 30 * HOUR).toISOString());
      const { fingerprint } = await licenses.generateFingerprint();
      const expiryDate = new Date(Date.now() + 30 * 24 * HOUR).toISOString();
      const signature = sign(null, Buffer.from(`${fingerprint}|${expiryDate}`, 'utf8'), testKeys.privateKey).toString('base64');
      setConfig('license_data', JSON.stringify({ fingerprint, expiryDate, signature }));
      await expect(caller().inventory.getAll()).resolves.toBeDefined();
    });

    it('una licencia vencida o de otro equipo no vale', async () => {
      setConfig('first_run_at', new Date(Date.now() - 30 * HOUR).toISOString());
      const { fingerprint } = await licenses.generateFingerprint();
      const expiryDate = new Date(Date.now() - 24 * HOUR).toISOString();
      const signature = sign(null, Buffer.from(`${fingerprint}|${expiryDate}`, 'utf8'), testKeys.privateKey).toString('base64');
      setConfig('license_data', JSON.stringify({ fingerprint, expiryDate, signature }));
      await expect(caller().inventory.getAll()).rejects.toThrow(/licencia/i);
    });
  });

  describe('prueba gratuita', () => {
    beforeEach(() => {
      resetLicenseGuardCache();
      clearConfig('license_data');
      clearConfig('first_run_at');
      clearConfig('trial_last_seen_at');
      rmSync(join(dir, 'tucajero-trial.dat'), { force: true });
    });

    it('borrar la fecha de la base no reinicia la prueba: queda la marca fuera de la base', async () => {
      await licenses.getLicenseStatus(); // crea la fecha de primer uso
      const marker = join(dir, 'tucajero-trial.dat');
      expect(existsSync(marker)).toBe(true);
      writeFileSync(marker, JSON.stringify({ firstRunAt: new Date(Date.now() - 30 * HOUR).toISOString(), lastSeenAt: new Date().toISOString() }));
      clearConfig('first_run_at');
      const status = await licenses.getLicenseStatus();
      expect(status.trial.trialBlocked).toBe(true);
    });

    it('atrasar el reloj no alarga la prueba', async () => {
      setConfig('first_run_at', new Date(Date.now() - 23 * HOUR).toISOString());
      // La última vez que se usó la app fue hace 2 horas en el futuro respecto al reloj actual (reloj atrasado).
      setConfig('trial_last_seen_at', new Date(Date.now() + 2 * HOUR).toISOString());
      const status = await licenses.getLicenseStatus();
      expect(status.trial.trialBlocked).toBe(true);
    });

    it('con el reloj normal, la prueba cuenta desde el primer uso', async () => {
      setConfig('first_run_at', new Date(Date.now() - 2 * HOUR).toISOString());
      const status = await licenses.getLicenseStatus();
      expect(status.trial.trialActive).toBe(true);
      expect(status.trial.trialRemainingHours).toBeGreaterThanOrEqual(21);
      expect(JSON.parse(readFileSync(join(dir, 'tucajero-trial.dat'), 'utf8')).firstRunAt).toBeDefined();
    });
  });
});
