import { readdirSync, copyFileSync, unlinkSync, existsSync, mkdirSync, statSync } from 'fs';
import { join, extname, resolve } from 'path';
import { closeDatabase, getDatabase } from '../db';
import { nowISO, toFileDate } from '../utils/date';
import { getDatabasePath, getBackupsDir } from '../utils/paths';

const DB_PATH = getDatabasePath();
const BACKUP_DIR = getBackupsDir();

export interface BackupEntry {
  id: string;
  fileName: string;
  createdAt: string;
  size: string;
  valid: boolean;
}

const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

function sanitizeBackupId(backupId: string): string {
  if (!backupId || backupId.length > 100 || !SAFE_ID_REGEX.test(backupId)) {
    throw new Error('ID de backup inválido. Solo se permiten letras, números, guiones y guiones bajos.');
  }
  return backupId;
}

function assertInsideBackupDir(backupPath: string): void {
  const resolved = resolve(backupPath);
  const dir = resolve(BACKUP_DIR);
  if (!resolved.startsWith(dir + '\\') && !resolved.startsWith(dir + '/') && resolved !== dir) {
    throw new Error('Ruta de backup fuera del directorio permitido.');
  }
}

export class BackupService {
  private ensureBackupDir(): void {
    if (!existsSync(BACKUP_DIR)) {
      mkdirSync(BACKUP_DIR, { recursive: true });
    }
  }

  async listBackups(): Promise<BackupEntry[]> {
    this.ensureBackupDir();
    const files = readdirSync(BACKUP_DIR)
      .filter((f) => extname(f) === '.db')
      .sort()
      .reverse();

    return files.map((fileName) => {
      const filePath = join(BACKUP_DIR, fileName);
      const stats = statSync(filePath);
      const sizeBytes = stats.size;
      const sizeStr = sizeBytes >= 1048576
        ? `${(sizeBytes / 1048576).toFixed(1)} MB`
        : `${(sizeBytes / 1024).toFixed(1)} KB`;

      return {
        id: fileName.replace(extname(fileName), ''),
        fileName,
        createdAt: stats.mtime.toISOString(),
        size: sizeStr,
        valid: true,
      };
    });
  }

  async createBackup(): Promise<BackupEntry> {
    this.ensureBackupDir();
    closeDatabase();

    const timestamp = toFileDate(new Date());
    const backupFileName = `backup_${timestamp}.db`;
    const backupPath = join(BACKUP_DIR, backupFileName);

    try {
      copyFileSync(DB_PATH, backupPath);
    } finally {
      getDatabase();
    }

    const stats = statSync(backupPath);
    const sizeBytes = stats.size;
    const sizeStr = sizeBytes >= 1048576
      ? `${(sizeBytes / 1048576).toFixed(1)} MB`
      : `${(sizeBytes / 1024).toFixed(1)} KB`;

    return {
      id: backupFileName.replace(extname(backupFileName), ''),
      fileName: backupFileName,
      createdAt: nowISO(),
      size: sizeStr,
      valid: true,
    };
  }

  async restoreBackup(backupId: string): Promise<void> {
    this.ensureBackupDir();
    const safeId = sanitizeBackupId(backupId);
    const backupPath = join(BACKUP_DIR, `${safeId}.db`);
    assertInsideBackupDir(backupPath);

    if (!existsSync(backupPath)) {
      throw new Error(`Backup no encontrado: ${safeId}.db`);
    }

    closeDatabase();
    try {
      // SQLite conserva transacciones pendientes en estos archivos cuando usa
      // WAL. Deben eliminarse antes de reemplazar la base para que un WAL de
      // la instalación actual no se reproduzca sobre el respaldo restaurado.
      for (const suffix of ['-wal', '-shm']) {
        const sidecar = `${DB_PATH}${suffix}`;
        if (existsSync(sidecar)) unlinkSync(sidecar);
      }
      copyFileSync(backupPath, DB_PATH);
    } finally {
      getDatabase();
    }
  }

  async deleteBackup(backupId: string): Promise<void> {
    this.ensureBackupDir();
    const safeId = sanitizeBackupId(backupId);
    const backupPath = join(BACKUP_DIR, `${safeId}.db`);
    assertInsideBackupDir(backupPath);

    if (!existsSync(backupPath)) {
      throw new Error(`Backup no encontrado: ${safeId}.db`);
    }

    unlinkSync(backupPath);
  }

  getDatabaseInfo(): { path: string; size: string; lastBackup: string | null } {
    const stats = statSync(DB_PATH);
    const sizeBytes = stats.size;
    const sizeStr = sizeBytes >= 1048576
      ? `${(sizeBytes / 1048576).toFixed(1)} MB`
      : `${(sizeBytes / 1024).toFixed(1)} KB`;

    let lastBackup: string | null = null;
    try {
      this.ensureBackupDir();
      const files = readdirSync(BACKUP_DIR)
        .filter((f) => extname(f) === '.db')
        .sort()
        .reverse();
      if (files.length > 0) {
        const latest = join(BACKUP_DIR, files[0]);
        lastBackup = statSync(latest).mtime.toISOString();
      }
    } catch {
      // ignore
    }

    return {
      path: DB_PATH,
      size: sizeStr,
      lastBackup,
    };
  }
}
