import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { getDatabasePath } from '../app/main/utils/paths';

const DB_PATH = getDatabasePath();

async function main(): Promise<void> {
  const sqlite = new Database(DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  console.log('Seeding database...');

  const existingAdmin = sqlite.prepare('SELECT id FROM User WHERE username = ?').get('admin') as { id: number } | undefined;

  if (existingAdmin) {
    console.log('Admin user already exists, skipping seed.');
    sqlite.close();
    return;
  }

  const now = new Date().toISOString();
  const hashedPassword = await bcrypt.hash('admin123', 12);

  const accountResult = sqlite.prepare(
    'INSERT INTO Account (name, nit, email, phone, subscriptionStatus, subscriptionPlan, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('Cuenta Principal', '000000000000', 'local@tucajero.local', '', 'TRIAL', 'BASIC', now, now);

  const accountId = Number(accountResult.lastInsertRowid);

  sqlite.prepare(
    'INSERT INTO User (accountId, username, password, fullName, role, active, mustChangePassword, failedLoginAttempts, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(accountId, 'admin', hashedPassword, 'Administrador', 'ADMIN', 1, 0, 0, now, now);

  sqlite.prepare(
    'INSERT INTO User (accountId, username, password, fullName, role, active, mustChangePassword, failedLoginAttempts, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(accountId, 'cajero1', hashedPassword, 'Cajero Principal', 'CASHIER', 1, 0, now, now);

  console.log(`Seed completed: admin/admin123, cajero1/admin123 (accountId=${accountId})`);
  sqlite.close();
}

main().catch(console.error);
