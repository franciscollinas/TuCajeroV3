import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const copyFile = promisify(fs.copyFile);
const unlink = promisify(fs.unlink);

const ROOT = path.resolve(__dirname, '..');
const DB_SOURCE = path.join(ROOT, 'database', 'tucajero.db');

export async function setupTestDatabase(): Promise<string> {
  const tempDir = path.join(ROOT, 'backups');
  fs.mkdirSync(tempDir, { recursive: true });
  
  const timestamp = Date.now();
  const tempPath = path.join(tempDir, `test-${timestamp}.db`);
  
  await copyFile(DB_SOURCE, tempPath);
  
  return tempPath;
}

export async function cleanupTestDatabase(tempPath: string): Promise<void> {
  try {
    await unlink(tempPath);
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
