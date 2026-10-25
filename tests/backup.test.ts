import { existsSync, mkdirSync, readdirSync, rmSync, utimesSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BackupService } from '../app/main/services/backup.service';
import { recoverFromBackups, verifyDatabaseFile } from '../app/main/db/database-files';

let nativeDbAvailable = true;
try {
  new Database(':memory:').close();
} catch {
  nativeDbAvailable = false;
}
const serviceDescribe = nativeDbAvailable ? describe : describe.skip;

serviceDescribe('copias de seguridad y recuperación de la base de datos', () => {
  let dir = '';
  let dbPath = '';
  let backupDir = '';
  let db: Database.Database;
  let service: BackupService;

  const open = (): Database.Database => {
    const d = new Database(dbPath);
    d.pragma('journal_mode = WAL');
    return d;
  };
  const rowsIn = (path: string): number => {
    const d = new Database(path, { readonly: true });
    try {
      return (d.prepare('select count(*) as n from t').get() as { n: number }).n;
    } finally {
      d.close();
    }
  };
  const ago = (path: string, hours: number): void => {
    const t = new Date(Date.now() - hours * 3600 * 1000);
    utimesSync(path, t, t);
  };
  const files = (prefix: string): string[] => readdirSync(backupDir).filter((f) => f.startsWith(prefix) && f.endsWith('.db'));

  beforeEach(() => {
    dir = join(tmpdir(), `tucajero-backup-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    dbPath = join(dir, 'database', 'tucajero.db');
    backupDir = join(dir, 'backups');
    mkdirSync(join(dir, 'database'), { recursive: true });
    db = open();
    db.exec('create table t(id integer primary key, v text)');
    db.prepare('insert into t(v) values (?)').run('uno');
    db.prepare('insert into t(v) values (?)').run('dos');
    service = new BackupService({
      dbPath,
      backupDir,
      getRawDatabase: () => db,
      closeDatabase: () => db.close(),
      openDatabase: () => {
        db = open();
      },
    });
  });

  afterEach(() => {
    if (db.open) db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('verifyDatabaseFile', () => {
    it('acepta una base sana y rechaza un archivo que no es una base', () => {
      db.close();
      expect(verifyDatabaseFile(dbPath).ok).toBe(true);
      const garbage = join(dir, 'basura.db');
      writeFileSync(garbage, 'esto no es sqlite, es texto cualquiera '.repeat(100));
      expect(verifyDatabaseFile(garbage).ok).toBe(false);
      expect(verifyDatabaseFile(join(dir, 'no-existe.db')).ok).toBe(false);
      db = open();
    });
  });

  describe('copia manual', () => {
    it('incluye lo escrito recientemente aunque la base siga abierta, y queda verificada', async () => {
      db.prepare('insert into t(v) values (?)').run('tres');
      const entry = await service.createBackup();
      expect(entry.valid).toBe(true);
      expect(rowsIn(join(backupDir, entry.fileName))).toBe(3);
      expect(db.open).toBe(true);
    });

    it('dos copias en el mismo instante no se pisan', async () => {
      const [a, b] = await Promise.all([service.createBackup(), service.createBackup()]);
      expect(a.fileName).not.toBe(b.fileName);
      expect(files('backup_')).toHaveLength(2);
    });
  });

  describe('copia automática diaria', () => {
    it('crea una la primera vez y no repite mientras la última sea reciente', async () => {
      const first = await service.createAutoBackupIfDue();
      expect(first).not.toBeNull();
      expect(first!.fileName.startsWith('auto_')).toBe(true);
      expect(await service.createAutoBackupIfDue()).toBeNull();
      expect(files('auto_')).toHaveLength(1);
    });

    it('crea otra cuando la última tiene más de 20 horas', async () => {
      const first = await service.createAutoBackupIfDue();
      ago(join(backupDir, first!.fileName), 21);
      const second = await service.createAutoBackupIfDue();
      expect(second).not.toBeNull();
      expect(files('auto_')).toHaveLength(2);
    });

    it('conserva solo las 14 más recientes y no toca las manuales', async () => {
      await service.createBackup();
      for (let i = 0; i < 16; i++) {
        expect(await service.createAutoBackupIfDue()).not.toBeNull();
        for (const f of files('auto_')) ago(join(backupDir, f), 25);
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(files('auto_')).toHaveLength(14);
      expect(files('backup_')).toHaveLength(1);
    });
  });

  describe('copia antes de actualizar la app', () => {
    it('se hace una vez por versión nueva y no al abrir la misma versión', async () => {
      const first = await service.createPreUpgradeBackupIfNeeded('3.1.0');
      expect(first).not.toBeNull();
      expect(first!.fileName.startsWith('pre-actualizacion_')).toBe(true);
      expect(await service.createPreUpgradeBackupIfNeeded('3.1.0')).toBeNull();

      const second = await service.createPreUpgradeBackupIfNeeded('3.2.0');
      expect(second).not.toBeNull();
      expect(files('pre-actualizacion_')).toHaveLength(2);
    });

    it('si la copia falla no marca la versión como hecha (se reintenta)', async () => {
      db.close();
      await expect(service.createPreUpgradeBackupIfNeeded('3.1.0')).rejects.toThrow();
      db = open();
      expect(await service.createPreUpgradeBackupIfNeeded('3.1.0')).not.toBeNull();
    });
  });

  describe('restaurar', () => {
    it('guarda primero una copia de la base actual y luego restaura', async () => {
      const entry = await service.createBackup();
      db.prepare('insert into t(v) values (?)').run('despues del respaldo');
      expect(rowsIn(dbPath)).toBe(3);

      await service.restoreBackup(entry.id);

      expect(rowsIn(dbPath)).toBe(2);
      const safety = files('antes-de-restaurar_');
      expect(safety).toHaveLength(1);
      expect(rowsIn(join(backupDir, safety[0]))).toBe(3);
      expect(db.open).toBe(true);
    });

    it('rechaza una copia dañada y deja la base como estaba', async () => {
      mkdirSync(backupDir, { recursive: true });
      writeFileSync(join(backupDir, 'backup_danado.db'), 'no soy una base de datos '.repeat(200));
      await expect(service.restoreBackup('backup_danado')).rejects.toThrow(/dañad|inválid|no es una base/i);
      expect(rowsIn(dbPath)).toBe(2);
      expect(db.open).toBe(true);
    });

    it('no acepta rutas fuera de la carpeta de copias', async () => {
      await expect(service.restoreBackup('../database/tucajero')).rejects.toThrow();
    });
  });

  describe('recuperación cuando la base se daña', () => {
    it('restaura la copia sana más reciente y aparta la dañada', async () => {
      const entry = await service.createBackup();
      db.close();
      writeFileSync(dbPath, 'archivo dañado '.repeat(500));

      const result = recoverFromBackups(dbPath, backupDir);

      expect(result.restoredFrom).toBe(entry.fileName);
      expect(existsSync(result.quarantinedTo)).toBe(true);
      expect(readFileSync(result.quarantinedTo, 'utf8')).toContain('archivo dañado');
      expect(verifyDatabaseFile(dbPath).ok).toBe(true);
      expect(rowsIn(dbPath)).toBe(2);
      db = open();
    });

    it('salta las copias dañadas y usa la siguiente sana', async () => {
      const good = await service.createBackup();
      ago(join(backupDir, good.fileName), 48);
      writeFileSync(join(backupDir, 'auto_2999-01-01.db'), 'dañada '.repeat(300));
      db.close();
      writeFileSync(dbPath, 'dañado '.repeat(500));

      expect(recoverFromBackups(dbPath, backupDir).restoredFrom).toBe(good.fileName);
      db = open();
    });

    it('sin ninguna copia sana, no toca nada y lo explica', () => {
      db.close();
      writeFileSync(dbPath, 'dañado '.repeat(500));
      expect(() => recoverFromBackups(dbPath, backupDir)).toThrow(/copia/i);
      expect(readFileSync(dbPath, 'utf8')).toContain('dañado');
      db = new Database(':memory:');
    });
  });
});
