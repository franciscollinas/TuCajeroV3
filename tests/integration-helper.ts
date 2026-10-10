import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

const ROOT = path.resolve(__dirname, '..');
const NOW = '2026-01-01T00:00:00.000Z';

// Cada test de integración trabaja sobre su propia base temporal, construida
// con las migraciones reales y datos de prueba fijos. No depende de
// database/tucajero.db (archivo local, fuera de git) ni lo modifica.
export async function setupTestDatabase(): Promise<string> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tucajero-it-'));
  const tempPath = path.join(tempDir, 'test.db');

  const sqlite = new Database(tempPath);
  sqlite.pragma('foreign_keys = ON');
  migrate(drizzle(sqlite), { migrationsFolder: path.join(ROOT, 'database', 'migrations') });

  sqlite.exec(`
    INSERT INTO "Account" (name, nit, email, phone, subscriptionStatus, subscriptionPlan, createdAt, updatedAt)
      VALUES ('Cuenta Test', '900000001', 'test@test.com', '', 'TRIAL', 'BASIC', '${NOW}', '${NOW}');
    INSERT INTO "User" (accountId, username, password, fullName, role, active, mustChangePassword, failedLoginAttempts, createdAt, updatedAt)
      VALUES (1, 'admin', 'hash', 'Administrador', 'ADMIN', 1, 0, 0, '${NOW}', '${NOW}');
    INSERT INTO "Category" (name, color, accountId, createdAt, updatedAt)
      VALUES ('General', '#0000ff', 1, '${NOW}', '${NOW}');
    INSERT INTO "Product" (accountId, code, name, categoryId, price, cost, stock, taxRate, createdAt, updatedAt)
      VALUES (1, 'P001', 'Producto 1', 1, 10000, 6000, 50, 0.19, '${NOW}', '${NOW}');
    INSERT INTO "Config" (accountId, key, value, updatedAt)
      VALUES (1, 'ivaEnabled', 'true', '${NOW}');
  `);
  sqlite.close();

  return tempPath;
}

export async function cleanupTestDatabase(tempPath: string): Promise<void> {
  try {
    fs.rmSync(path.dirname(tempPath), { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

export async function resetDatabaseState(): Promise<void> {
  const { closeDatabase, setDatabasePath, getDatabasePathForTesting } = await import('../app/main/db/index');
  const currentPath = getDatabasePathForTesting();
  closeDatabase();
  setDatabasePath(currentPath);
}
