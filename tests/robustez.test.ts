import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { afterAll, describe, expect, it } from 'vitest';

import { rotateLogIfNeeded } from '../app/main/utils/log-rotation';

const dir = join(tmpdir(), `tucajero-robustez-${Date.now()}`);
process.env.DATABASE_URL = join(dir, 'database', 'test.db');
process.env.TUCAJERO_BACKUP_DIR = join(dir, 'backups');

const { getDatabase, closeDatabase } = await import('../app/main/db');

let nativeDbAvailable = true;
try {
  new Database(':memory:').close();
} catch {
  nativeDbAvailable = false;
}
const serviceDescribe = nativeDbAvailable ? describe : describe.skip;

describe('rotación del registro de errores', () => {
  const logDir = join(dir, 'logs');
  const logFile = join(logDir, 'app.log');
  const write = (path: string, content: string): void => {
    mkdirSync(logDir, { recursive: true });
    writeFileSync(path, content);
  };

  it('no toca un registro pequeño', () => {
    write(logFile, 'poco');
    rotateLogIfNeeded(logFile, 1000, 3);
    expect(readFileSync(logFile, 'utf8')).toBe('poco');
    expect(existsSync(`${logFile}.1`)).toBe(false);
  });

  it('pasa el registro grande a .1 y desplaza los anteriores, conservando solo 3', () => {
    write(logFile, 'x'.repeat(2000));
    write(`${logFile}.1`, 'uno');
    write(`${logFile}.2`, 'dos');
    write(`${logFile}.3`, 'tres (se descarta)');
    rotateLogIfNeeded(logFile, 1000, 3);
    expect(existsSync(logFile)).toBe(false);
    expect(readFileSync(`${logFile}.1`, 'utf8')).toBe('x'.repeat(2000));
    expect(readFileSync(`${logFile}.2`, 'utf8')).toBe('uno');
    expect(readFileSync(`${logFile}.3`, 'utf8')).toBe('dos');
    expect(existsSync(`${logFile}.4`)).toBe(false);
  });

  it('si el archivo no existe, no falla', () => {
    expect(() => rotateLogIfNeeded(join(logDir, 'no-existe.log'))).not.toThrow();
  });
});

serviceDescribe('índices de la base de datos', () => {
  afterAll(() => {
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  const indexNames = (): string[] => {
    getDatabase();
    const sqlite = new Database(process.env.DATABASE_URL as string, { readonly: true });
    try {
      return (sqlite.prepare("select name from sqlite_master where type = 'index'").all() as Array<{ name: string }>).map((r) => r.name);
    } finally {
      sqlite.close();
    }
  };

  it('una base nueva tiene los índices que usan los reportes y los abonos', () => {
    const names = indexNames();
    for (const expected of ['idx_payment_debt', 'idx_payment_created', 'idx_debt_sale', 'idx_sale_account_status_created']) {
      expect(names, expected).toContain(expected);
    }
  });

  it('una base existente sin ellos los recibe al abrirse, y abrirla otra vez no falla', () => {
    closeDatabase();
    const sqlite = new Database(process.env.DATABASE_URL as string);
    for (const name of ['idx_payment_debt', 'idx_payment_created', 'idx_debt_sale', 'idx_sale_account_status_created']) {
      sqlite.exec(`DROP INDEX IF EXISTS ${name}`);
    }
    sqlite.close();

    expect(indexNames()).toContain('idx_debt_sale');
    closeDatabase();
    expect(() => getDatabase()).not.toThrow();
  });
});
