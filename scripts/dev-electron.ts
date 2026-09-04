import { spawn } from 'child_process';
import { build } from 'esbuild';
import { writeFile } from 'fs/promises';
import { readFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';

const root = resolve(import.meta.dirname, '..');

// Carga un archivo `.env` simple (KEY=valor) en process.env sin sobrescribir
// variables ya definidas en el entorno. Sin dependencias externas.
function loadRootEnv(): void {
  const envPath = join(root, '.env');
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

async function buildElectron(): Promise<void> {
  const outdir = resolve(root, 'dist/main');
  await build({
    entryPoints: [
      resolve(root, 'app/main/main.ts'),
      resolve(root, 'app/main/preload.ts'),
    ],
    outdir,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    // Keep all node_modules external (required at runtime from node_modules).
    // Bundling @trpc/server into CJS duplicates/mangles its internals and breaks
    // appRouter.createCaller (every procedure path resolves as undefined).
    packages: 'external',
    minify: false,
    sourcemap: true,
  });
  // The root package.json sets "type": "module", so the emitted .js files are
  // treated as ESM. This shim forces the dist/main dir to CommonJS so the CJS
  // output (and the preload require) loads correctly in Electron.
  await writeFile(resolve(outdir, 'package.json'), JSON.stringify({ type: 'commonjs' }, null, 2));
}

async function main(): Promise<void> {
  await buildElectron();
  loadRootEnv();
  const electronPath = resolve(root, 'node_modules/.bin/electron');
  const mainPath = resolve(root, 'dist/main/main.js');
  const child = spawn(electronPath, [mainPath], {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'development',
    },
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
