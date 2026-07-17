import { spawn } from 'child_process';
import { build } from 'esbuild';
import { writeFile } from 'fs/promises';
import { resolve } from 'path';

const root = resolve(import.meta.dirname, '..');

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
  const electronPath = resolve(root, 'node_modules/.bin/electron');
  const mainPath = resolve(root, 'dist/main/main.js');
  const child = spawn(electronPath, [mainPath], {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      // license.service.ts requires LICENSE_SECRET at module load. In dev we
      // fall back to a dev-only secret (tests use the same value). Production
      // must inject a real secret via the environment.
      LICENSE_SECRET: process.env.LICENSE_SECRET ?? 'test-secret-for-unit-tests',
    },
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
