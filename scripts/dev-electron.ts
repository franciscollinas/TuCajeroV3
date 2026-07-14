import { spawn } from 'child_process';
import { resolve } from 'path';

const root = resolve(import.meta.dirname, '..');
const electronPath = resolve(root, 'node_modules/.bin/electron');
const mainPath = resolve(root, 'app/main/main.ts');

const child = spawn(
  electronPath,
  ['--require', 'tsx/cjs', mainPath],
  {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development' },
  },
);

child.on('exit', (code) => process.exit(code ?? 0));
