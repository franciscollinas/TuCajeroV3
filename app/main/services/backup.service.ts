import { readdirSync, copyFileSync, unlinkSync, existsSync, mkdirSync, statSync, openSync, readSync, closeSync, readFileSync, writeFileSync } from 'fs';
import { join, extname, resolve } from 'path';
import type Database from 'better-sqlite3';

import { closeDatabase, getDatabase, getRawDatabase } from '../db';
import { removeSidecars, vacuumInto, verifyDatabaseFile } from '../db/database-files';
import { nowISO, toFileDate } from '../utils/date';
import { getDatabasePath, getBackupsDir } from '../utils/paths';

export interface BackupEntry {
  id: string;
  fileName: string;
  createdAt: string;
  size: string;
  valid: boolean;
}

export interface BackupServiceOptions {
  dbPath?: string;
  backupDir?: string;
  /** Conexión abierta de la base (para copiar sin cerrarla). */
  getRawDatabase?: () => Database.Database;
  closeDatabase?: () => void;
  openDatabase?: () => void;
}

const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

/** Una copia automática se considera reciente durante este tiempo. */
const AUTO_BACKUP_MAX_AGE_HOURS = 20;
const AUTO_BACKUPS_TO_KEEP = 14;
const PRE_UPGRADE_BACKUPS_TO_KEEP = 5;
const SAFETY_BACKUPS_TO_KEEP = 5;

const SQLITE_HEADER = 'SQLite format 3\0';

function formatSize(sizeBytes: number): string {
  return sizeBytes >= 1048576 ? `${(sizeBytes / 1048576).toFixed(1)} MB` : `${(sizeBytes / 1024).toFixed(1)} KB`;
}

function sanitizeBackupId(backupId: string): string {
  if (!backupId || backupId.length > 100 || !SAFE_ID_REGEX.test(backupId)) {
    throw new Error('ID de backup inválido. Solo se permiten letras, números, guiones y guiones bajos.');
  }
  return backupId;
}

function hasSqliteHeader(path: string): boolean {
  let fd: number | null = null;
  try {
    fd = openSync(path, 'r');
    const buffer = Buffer.alloc(16);
    readSync(fd, buffer, 0, 16, 0);
    return buffer.toString('latin1') === SQLITE_HEADER;
  } catch {
    return false;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

export class BackupService {
  private readonly dbPath: string;
  private readonly backupDir: string;
  private readonly rawDatabase: () => Database.Database;
  private readonly closeDb: () => void;
  private readonly openDb: () => void;

  constructor(options: BackupServiceOptions = {}) {
    this.dbPath = options.dbPath ?? getDatabasePath();
    this.backupDir = options.backupDir ?? getBackupsDir();
    this.rawDatabase = options.getRawDatabase ?? getRawDatabase;
    this.closeDb = options.closeDatabase ?? closeDatabase;
    this.openDb = options.openDatabase ?? (() => { getDatabase(); });
  }

  private ensureBackupDir(): void {
    if (!existsSync(this.backupDir)) {
      mkdirSync(this.backupDir, { recursive: true });
    }
  }

  private assertInsideBackupDir(backupPath: string): void {
    const resolved = resolve(backupPath);
    const dir = resolve(this.backupDir);
    if (!resolved.startsWith(dir + '\\') && !resolved.startsWith(dir + '/') && resolved !== dir) {
      throw new Error('Ruta de backup fuera del directorio permitido.');
    }
  }

  private filesWithPrefix(prefix: string): string[] {
    this.ensureBackupDir();
    return readdirSync(this.backupDir).filter((f) => f.startsWith(prefix) && extname(f) === '.db');
  }

  /** Borra las copias más antiguas de un tipo (por fecha del archivo). */
  private prune(prefix: string, keep: number): void {
    const names = this.filesWithPrefix(prefix)
      .map((name) => ({ name, time: statSync(join(this.backupDir, name)).mtimeMs }))
      .sort((a, b) => (b.time - a.time) || b.name.localeCompare(a.name))
      .map((f) => f.name);
    for (const name of names.slice(keep)) {
      try {
        unlinkSync(join(this.backupDir, name));
      } catch {
        // Una copia vieja que no se puede borrar no debe impedir la nueva.
      }
    }
  }

  private entryFor(fileName: string, createdAt?: string): BackupEntry {
    const filePath = join(this.backupDir, fileName);
    return {
      id: fileName.replace(extname(fileName), ''),
      fileName,
      createdAt: createdAt ?? statSync(filePath).mtime.toISOString(),
      size: formatSize(statSync(filePath).size),
      valid: true,
    };
  }

  /**
   * Copia la base con `VACUUM INTO` (sin cerrarla, con lo que haya en el WAL),
   * la abre de nuevo para comprobarla y solo entonces la da por buena.
   */
  private writeVerifiedCopy(prefix: string): string {
    this.ensureBackupDir();
    const timestamp = toFileDate(new Date());
    let fileName = `${prefix}_${timestamp}.db`;
    for (let n = 2; existsSync(join(this.backupDir, fileName)); n++) {
      fileName = `${prefix}_${timestamp}_${n}.db`;
    }
    const target = join(this.backupDir, fileName);

    vacuumInto(this.rawDatabase(), target);

    const check = verifyDatabaseFile(target);
    if (!check.ok) {
      try {
        unlinkSync(target);
      } catch {
        // ignore
      }
      throw new Error(`La copia de seguridad no quedó válida y se descartó: ${check.detail}`);
    }
    return fileName;
  }

  async listBackups(): Promise<BackupEntry[]> {
    this.ensureBackupDir();
    const files = readdirSync(this.backupDir)
      .filter((f) => extname(f) === '.db')
      .sort()
      .reverse();

    return files.map((fileName) => ({
      ...this.entryFor(fileName),
      valid: hasSqliteHeader(join(this.backupDir, fileName)),
    }));
  }

  async createBackup(): Promise<BackupEntry> {
    const fileName = this.writeVerifiedCopy('backup');
    return this.entryFor(fileName, nowISO());
  }

  /** Copia diaria automática: solo si la última tiene más de 20 horas. Conserva las 14 más recientes. */
  async createAutoBackupIfDue(): Promise<BackupEntry | null> {
    const existing = this.filesWithPrefix('auto_');
    const newest = existing
      .map((f) => statSync(join(this.backupDir, f)).mtimeMs)
      .sort((a, b) => b - a)[0];
    if (newest !== undefined && Date.now() - newest < AUTO_BACKUP_MAX_AGE_HOURS * 3600 * 1000) {
      return null;
    }
    const fileName = this.writeVerifiedCopy('auto');
    this.prune('auto_', AUTO_BACKUPS_TO_KEEP);
    return this.entryFor(fileName, nowISO());
  }

  /**
   * Copia antes de que una versión nueva toque la base (migraciones al arrancar).
   * Se hace una vez por versión; si la copia falla no se marca como hecha.
   */
  async createPreUpgradeBackupIfNeeded(appVersion: string): Promise<BackupEntry | null> {
    this.ensureBackupDir();
    const marker = join(this.backupDir, '.ultima-version');
    const last = existsSync(marker) ? readFileSync(marker, 'utf8').trim() : null;
    if (last === appVersion) return null;

    const fileName = this.writeVerifiedCopy(`pre-actualizacion_${(last ?? 'anterior').replace(/[^0-9A-Za-z.-]/g, '')}-a-${appVersion.replace(/[^0-9A-Za-z.-]/g, '')}`.replace(/\./g, '-'));
    writeFileSync(marker, appVersion, 'utf8');
    this.prune('pre-actualizacion_', PRE_UPGRADE_BACKUPS_TO_KEEP);
    return this.entryFor(fileName, nowISO());
  }

  async restoreBackup(backupId: string): Promise<void> {
    this.ensureBackupDir();
    const safeId = sanitizeBackupId(backupId);
    const backupPath = join(this.backupDir, `${safeId}.db`);
    this.assertInsideBackupDir(backupPath);

    if (!existsSync(backupPath)) {
      throw new Error(`Backup no encontrado: ${safeId}.db`);
    }

    const check = verifyDatabaseFile(backupPath);
    if (!check.ok) {
      throw new Error(`La copia "${safeId}" está dañada o no es una base de datos válida. No se restauró nada. (${check.detail})`);
    }

    // Antes de reemplazar nada se guarda la base actual, para poder volver atrás.
    try {
      this.writeVerifiedCopy('antes-de-restaurar');
    } catch {
      if (existsSync(this.dbPath)) {
        this.closeDb();
        copyFileSync(this.dbPath, join(this.backupDir, `antes-de-restaurar_${toFileDate(new Date())}.db`));
      }
    }
    this.prune('antes-de-restaurar_', SAFETY_BACKUPS_TO_KEEP);

    this.closeDb();
    try {
      // SQLite conserva transacciones pendientes en estos archivos cuando usa
      // WAL. Deben eliminarse antes de reemplazar la base para que un WAL de
      // la instalación actual no se reproduzca sobre el respaldo restaurado.
      removeSidecars(this.dbPath);
      copyFileSync(backupPath, this.dbPath);
    } finally {
      this.openDb();
    }
  }

  async deleteBackup(backupId: string): Promise<void> {
    this.ensureBackupDir();
    const safeId = sanitizeBackupId(backupId);
    const backupPath = join(this.backupDir, `${safeId}.db`);
    this.assertInsideBackupDir(backupPath);

    if (!existsSync(backupPath)) {
      throw new Error(`Backup no encontrado: ${safeId}.db`);
    }

    unlinkSync(backupPath);
  }

  getDatabaseInfo(): { path: string; size: string; lastBackup: string | null } {
    const stats = statSync(this.dbPath);

    let lastBackup: string | null = null;
    try {
      this.ensureBackupDir();
      const times = readdirSync(this.backupDir)
        .filter((f) => extname(f) === '.db')
        .map((f) => statSync(join(this.backupDir, f)).mtimeMs);
      if (times.length > 0) lastBackup = new Date(Math.max(...times)).toISOString();
    } catch {
      // ignore
    }

    return {
      path: this.dbPath,
      size: formatSize(stats.size),
      lastBackup,
    };
  }
}
