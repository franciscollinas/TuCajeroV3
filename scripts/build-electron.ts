import { build } from 'esbuild';
import { writeFile } from 'fs/promises';
import { resolve } from 'path';

const root = resolve(import.meta.dirname, '..');

async function main(): Promise<void> {
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
    minify: true,
    sourcemap: false,
  });
  // The root package.json sets "type": "module"; force dist/main to CommonJS so
  // the emitted .js (and the preload require) load correctly in Electron.
  await writeFile(resolve(outdir, 'package.json'), JSON.stringify({ type: 'commonjs' }, null, 2));
  // eslint-disable-next-line no-console
  console.log('Main process built successfully');
}

main().catch(console.error);
