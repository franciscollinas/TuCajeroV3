import { build } from 'esbuild';
import { resolve } from 'path';

const root = resolve(import.meta.dirname, '..');

async function main(): Promise<void> {
  await build({
    entryPoints: [
      resolve(root, 'app/main/main.ts'),
      resolve(root, 'app/main/preload.ts'),
    ],
    outdir: resolve(root, 'dist/main'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    external: ['electron', 'better-sqlite3', 'pino', 'bcryptjs', 'systeminformation', 'node-thermal-printer', 'pdfkit', 'exceljs'],
    minify: true,
    sourcemap: false,
  });
  // eslint-disable-next-line no-console
  console.log('Main process built successfully');
}

main().catch(console.error);
