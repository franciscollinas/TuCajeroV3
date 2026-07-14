import { resolve } from 'path';

export const DATABASE_PATH = process.env.DATABASE_URL || './database/tucajero.db';

export function getDatabasePath(): string {
  return resolve(DATABASE_PATH);
}
