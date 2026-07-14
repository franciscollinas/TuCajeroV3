import { defineConfig } from 'drizzle-kit';
import { DATABASE_PATH } from './app/main/utils/paths';

export default defineConfig({
  schema: './database/schema/index.ts',
  out: './database/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: DATABASE_PATH,
  },
});
