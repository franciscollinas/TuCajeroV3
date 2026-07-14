import Database from 'better-sqlite3';
import { getDatabasePath } from '../utils/paths';

const DB_PATH = getDatabasePath();
const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

const DEFAULT_ACCOUNT_NAME = 'Cuenta Principal';
const DEFAULT_ACCOUNT_NIT = '000000000000';
const DEFAULT_ACCOUNT_EMAIL = 'local@tucajero.local';
const DEFAULT_ACCOUNT_PHONE = '';

async function backfillAccounts(): Promise<void> {
  const now = new Date().toISOString();

  let account = sqlite.prepare('SELECT * FROM Account LIMIT 1').get() as { id: number } | undefined;

  if (!account) {
    const result = sqlite.prepare(
      'INSERT INTO Account (name, nit, email, phone, subscriptionStatus, subscriptionPlan, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(DEFAULT_ACCOUNT_NAME, DEFAULT_ACCOUNT_NIT, DEFAULT_ACCOUNT_EMAIL, DEFAULT_ACCOUNT_PHONE, 'TRIAL', 'BASIC', now, now);

    console.log(`Cuenta por defecto creada: id=${result.lastInsertRowid}`);
    account = { id: Number(result.lastInsertRowid) };
  } else {
    console.log(`Cuenta por defecto existente: id=${account.id}`);
  }

  const defaultAccountId = account.id;

  const tablesToBackfill = [
    'User',
    'Product',
    'Category',
    'Customer',
    'Sale',
    'Debt',
    'Supplier',
    'PurchaseOrder',
    'StockMovement',
  ];

  for (const table of tablesToBackfill) {
    try {
      const result = sqlite.prepare(`UPDATE ${table} SET accountId = ? WHERE accountId IS NULL`).run(defaultAccountId);
      if (result.changes > 0) {
        console.log(`Backfill ${table}: ${result.changes} filas actualizadas`);
      }
    } catch (err) {
      console.error(`Error backfill ${table}:`, err);
    }
  }

  const sessionsWithNullAccount = sqlite.prepare('SELECT id, userId FROM CashSession WHERE accountId IS NULL').all() as { id: number; userId: number }[];
  for (const s of sessionsWithNullAccount) {
    const user = sqlite.prepare('SELECT accountId FROM User WHERE id = ?').get(s.userId) as { accountId: number | null } | undefined;
    const derivedAccountId = user?.accountId ?? defaultAccountId;
    sqlite.prepare('UPDATE CashSession SET accountId = ? WHERE id = ?').run(derivedAccountId, s.id);
  }
  if (sessionsWithNullAccount.length > 0) {
    console.log(`Backfill CashSession: ${sessionsWithNullAccount.length} filas actualizadas`);
  }

  const expensesWithNullAccount = sqlite.prepare('SELECT id, cashSessionId FROM CashExpense WHERE accountId IS NULL').all() as { id: number; cashSessionId: number }[];
  for (const e of expensesWithNullAccount) {
    const cs = sqlite.prepare('SELECT accountId FROM CashSession WHERE id = ?').get(e.cashSessionId) as { accountId: number | null } | undefined;
    const derivedAccountId = cs?.accountId ?? defaultAccountId;
    sqlite.prepare('UPDATE CashExpense SET accountId = ? WHERE id = ?').run(derivedAccountId, e.id);
  }
  if (expensesWithNullAccount.length > 0) {
    console.log(`Backfill CashExpense: ${expensesWithNullAccount.length} filas actualizadas`);
  }

  const auditLogsWithNullAccount = sqlite.prepare('SELECT id, userId FROM AuditLog WHERE accountId IS NULL').all() as { id: number; userId: number }[];
  for (const a of auditLogsWithNullAccount) {
    const user = sqlite.prepare('SELECT accountId FROM User WHERE id = ?').get(a.userId) as { accountId: number | null } | undefined;
    const derivedAccountId = user?.accountId ?? defaultAccountId;
    sqlite.prepare('UPDATE AuditLog SET accountId = ? WHERE id = ?').run(derivedAccountId, a.id);
  }
  if (auditLogsWithNullAccount.length > 0) {
    console.log(`Backfill AuditLog: ${auditLogsWithNullAccount.length} filas actualizadas`);
  }

  const globalConfigs = sqlite.prepare('SELECT id, key, value FROM Config').all() as { id: number; key: string; value: string }[];
  let migratedConfigs = 0;
  for (const row of globalConfigs) {
    const existing = sqlite.prepare('SELECT id FROM Config WHERE accountId = ? AND key = ?').get(defaultAccountId, row.key) as { id: number } | undefined;
    if (!existing) {
      sqlite.prepare('INSERT INTO Config (accountId, key, value, updatedAt) VALUES (?, ?, ?, ?)').run(defaultAccountId, row.key, row.value, now);
      sqlite.prepare('DELETE FROM Config WHERE id = ?').run(row.id);
      migratedConfigs++;
    }
  }
  if (migratedConfigs > 0) {
    console.log(`Backfill Config: ${migratedConfigs} filas migradas a cuenta`);
  }

  console.log('Backfill completado.');
  sqlite.close();
}

backfillAccounts().catch((err) => {
  console.error('Error en backfill:', err);
  process.exit(1);
});
