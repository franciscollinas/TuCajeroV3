import { copyFileSync, existsSync, readdirSync, renameSync, statSync, unlinkSync } from 'fs';
import { extname, join } from 'path';
import Database from 'better-sqlite3';

import { toFileDate } from '../utils/date';

export interface VerifyResult {
  ok: boolean;
  detail: string;
}

/**
 * Abre un archivo en solo lectura y comprueba que sea una base de datos sana
 * (estructura completa, `integrity_check`) y que sea la de TuCajero (tabla User).
 * No lanza: devuelve `ok: false` con el motivo.
 */
export function verifyDatabaseFile(path: string): VerifyResult {
  if (!existsSync(path)) return { ok: false, detail: 'El archivo no existe.' };
  let sqlite: Database.Database | null = null;
  try {
    sqlite = new Database(path, { readonly: true, fileMustExist: true });
    const rows = sqlite.pragma('integrity_check') as Array<{ integrity_check: string }>;
    const result = rows[0]?.integrity_check;
    if (result !== 'ok') return { ok: false, detail: `La base está dañada: ${result ?? 'sin respuesta'}.` };
    return { ok: true, detail: 'ok' };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? `El archivo no es una base de datos válida (${err.message}).` : 'Archivo inválido.' };
  } finally {
    sqlite?.close();
  }
}

/** Copia consistente de una base abierta (incluye lo que aún está en el WAL). */
export function vacuumInto(sqlite: Database.Database, destination: string): void {
  const escaped = destination.replace(/'/g, "''");
  sqlite.exec(`VACUUM INTO '${escaped}'`);
}

export function removeSidecars(dbPath: string): void {
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${dbPath}${suffix}`;
    if (existsSync(sidecar)) unlinkSync(sidecar);
  }
}

export interface RecoveryResult {
  restoredFrom: string;
  quarantinedTo: string;
}

/**
 * Se usa cuando la base principal está dañada: busca la copia sana más reciente en
 * `backupDir`, aparta el archivo dañado (no lo borra) y restaura la copia.
 * Si no hay ninguna copia sana, no toca nada y lanza un error explicativo.
 */
export function recoverFromBackups(dbPath: string, backupDir: string): RecoveryResult {
  const candidates = existsSync(backupDir)
    ? readdirSync(backupDir)
        .filter((f) => extname(f) === '.db')
        .map((f) => ({ name: f, time: statSync(join(backupDir, f)).mtimeMs }))
        .sort((a, b) => b.time - a.time)
    : [];

  for (const candidate of candidates) {
    const source = join(backupDir, candidate.name);
    if (!verifyDatabaseFile(source).ok) continue;

    const quarantinedTo = `${dbPath}.danada-${toFileDate(new Date())}`;
    renameSync(dbPath, quarantinedTo);
    removeSidecars(dbPath);
    copyFileSync(source, dbPath);
    return { restoredFrom: candidate.name, quarantinedTo };
  }

  throw new Error(
    'La base de datos está dañada y no hay ninguna copia de seguridad sana para recuperarla. '
    + 'No se modificó nada: contacta a soporte antes de volver a abrir la aplicación.',
  );
}
