import { describe, expect, it, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

import { ensureMoneyIntegers } from '../app/main/db/money-integrity';

let nativeDbAvailable = true;
try {
  new Database(':memory:').close();
} catch {
  nativeDbAvailable = false;
}
const serviceDescribe = nativeDbAvailable ? describe : describe.skip;

const root = join(tmpdir(), `tucajero-money-${Date.now()}`);
const NOW = '2026-01-01T00:00:00.000Z';

function newDatabase(name: string): Database.Database {
  mkdirSync(root, { recursive: true });
  const sqlite = new Database(join(root, name));
  sqlite.pragma('foreign_keys = ON');
  migrate(drizzle(sqlite), { migrationsFolder: resolve('database/migrations') });
  sqlite.exec(`
    INSERT INTO "Account" (name, nit, email, createdAt, updatedAt) VALUES ('T', '1', 't@t.com', '${NOW}', '${NOW}');
    INSERT INTO "User" (username, password, fullName, role, active, accountId, createdAt, updatedAt)
      VALUES ('a', 'h', 'A', 'ADMIN', 1, 1, '${NOW}', '${NOW}');
    INSERT INTO "Category" (name, color, accountId, createdAt, updatedAt) VALUES ('C', '#fff', 1, '${NOW}', '${NOW}');
  `);
  return sqlite;
}

const insertProduct = (sqlite: Database.Database, code: string, price: number, cost = 100) =>
  sqlite
    .prepare(`INSERT INTO "Product" (accountId, code, name, categoryId, price, cost, stock, taxRate, createdAt, updatedAt)
      VALUES (1, ?, 'x', 1, ?, ?, 1, 0.19, '${NOW}', '${NOW}')`)
    .run(code, price, cost);

serviceDescribe('montos como pesos enteros', () => {
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('redondea datos existentes, respalda la base y deja intactos los enteros', () => {
    const sqlite = newDatabase('upgrade.db');
    insertProduct(sqlite, 'P1', 1999.5, 1200.4);
    insertProduct(sqlite, 'P2', 5000, 3000);
    const backup = join(root, 'upgrade.bak');

    ensureMoneyIntegers(sqlite, backup);

    const rows = sqlite.prepare('SELECT price, cost, taxRate FROM "Product" ORDER BY id').all();
    expect(rows[0]).toMatchObject({ price: 2000, cost: 1200, taxRate: 0.19 });
    expect(rows[1]).toMatchObject({ price: 5000, cost: 3000 });
    expect(existsSync(backup)).toBe(true);
    const old = new Database(backup, { readonly: true });
    expect((old.prepare('SELECT price FROM "Product" WHERE code = ?').get('P1') as { price: number }).price).toBe(1999.5);
    old.close();
    sqlite.close();
  });

  it('es idempotente y no respalda si no hay nada que redondear', () => {
    const sqlite = newDatabase('clean.db');
    insertProduct(sqlite, 'P1', 1000);
    const backup = join(root, 'clean.bak');

    ensureMoneyIntegers(sqlite, backup);
    ensureMoneyIntegers(sqlite, backup);

    expect(existsSync(backup)).toBe(false);
    const triggers = sqlite.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_money_int_%'").get() as { c: number };
    expect(triggers.c).toBe(20);
    sqlite.close();
  });

  it('rechaza montos fraccionarios al insertar y al actualizar, pero no cantidades ni tasas', () => {
    const sqlite = newDatabase('guard.db');
    ensureMoneyIntegers(sqlite);

    expect(() => insertProduct(sqlite, 'OK', 1000)).not.toThrow();
    expect(() => insertProduct(sqlite, 'BAD', 1000.5)).toThrow(/pesos enteros/);
    expect(() => sqlite.prepare('UPDATE "Product" SET price = 10.25 WHERE code = ?').run('OK')).toThrow(/pesos enteros/);
    expect(() => sqlite.prepare('UPDATE "Product" SET taxRate = 0.19, stock = 2.5 WHERE code = ?').run('OK')).not.toThrow();
    sqlite.close();
  });
});
