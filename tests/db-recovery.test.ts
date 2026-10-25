import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dir = join(tmpdir(), `tucajero-recovery-${Date.now()}`);
process.env.DATABASE_URL = join(dir, 'database', 'tucajero.db');
process.env.TUCAJERO_BACKUP_DIR = join(dir, 'backups');

const { getDatabase, closeDatabase, consumeRecoveryNotice, setBeforeUpgradeHook } = await import('../app/main/db');
const { BackupService } = await import('../app/main/services/backup.service');

let nativeDbAvailable = true;
try {
  new Database(':memory:').close();
} catch {
  nativeDbAvailable = false;
}
const serviceDescribe = nativeDbAvailable ? describe : describe.skip;

const NOW = '2026-01-01T00:00:00.000Z';

serviceDescribe('al abrir la aplicación con la base dañada', () => {
  beforeAll(() => {
    mkdirSync(dir, { recursive: true });
  });

  afterAll(() => {
    closeDatabase();
    setBeforeUpgradeHook(null);
    rmSync(dir, { recursive: true, force: true });
  });

  const userCount = (): number => {
    const sqlite = new Database(process.env.DATABASE_URL as string, { readonly: true });
    try {
      return (sqlite.prepare('select count(*) as n from "User"').get() as { n: number }).n;
    } finally {
      sqlite.close();
    }
  };

  it('la primera apertura crea la base y una instalación nueva no hace copia previa', async () => {
    let hookCalls = 0;
    setBeforeUpgradeHook(() => { hookCalls++; });
    getDatabase();
    expect(hookCalls).toBe(0); // base vacía: no hay nada que proteger
    closeDatabase();
  });

  it('con una base existente, la copia previa a la actualización se hace antes de tocar el esquema', async () => {
    const sqlite = new Database(process.env.DATABASE_URL as string);
    sqlite.exec(`
      INSERT INTO "Account" (name, nit, email, createdAt, updatedAt) VALUES ('A', '1', 'a@a.com', '${NOW}', '${NOW}');
      INSERT INTO "User" (accountId, username, password, fullName, role, active, createdAt, updatedAt) VALUES (1, 'admin', 'h', 'Admin', 'ADMIN', 1, '${NOW}', '${NOW}');
    `);
    sqlite.close();

    setBeforeUpgradeHook((raw) => {
      void new BackupService({ getRawDatabase: () => raw }).createPreUpgradeBackupIfNeeded('9.9.9');
    });
    getDatabase();
    closeDatabase();
    setBeforeUpgradeHook(null);

    const backups = readdirSync(process.env.TUCAJERO_BACKUP_DIR as string).filter((f) => f.startsWith('pre-actualizacion_'));
    expect(backups).toHaveLength(1);
  });

  it('un archivo que no es una base de datos se reemplaza por la última copia sana', async () => {
    getDatabase();
    await new BackupService().createBackup();
    closeDatabase();

    writeFileSync(process.env.DATABASE_URL as string, 'esto ya no es una base de datos '.repeat(300));

    getDatabase(); // no debe lanzar
    const notice = consumeRecoveryNotice();
    expect(notice).not.toBeNull();
    expect(notice!.restoredFrom.startsWith('backup_')).toBe(true);
    expect(existsSync(notice!.quarantinedTo)).toBe(true);
    expect(consumeRecoveryNotice()).toBeNull(); // el aviso se entrega una sola vez
    closeDatabase();
    expect(userCount()).toBe(1);
  });

  it('sin copias sanas, no se pierde nada y el error dice qué hacer', async () => {
    for (const f of readdirSync(process.env.TUCAJERO_BACKUP_DIR as string)) {
      rmSync(join(process.env.TUCAJERO_BACKUP_DIR as string, f), { force: true });
    }
    writeFileSync(process.env.DATABASE_URL as string, 'dañada '.repeat(400));
    expect(() => getDatabase()).toThrow(/copia de seguridad/i);
  });
});
