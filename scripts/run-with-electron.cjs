// Ejecuta un script de Node con el Node embebido de Electron.
//
// better-sqlite3 está compilado para el ABI de Electron, así que con el Node del
// sistema falla con NODE_MODULE_VERSION. Este lanzador es multiplataforma
// (no depende de `set VAR=` ni de `VAR=valor`):
//
//   node scripts/run-with-electron.cjs scripts/seed-demo-history.cjs --db <ruta>
const { spawnSync } = require('child_process');

const [script, ...args] = process.argv.slice(2);
if (!script) {
  console.error('Uso: node scripts/run-with-electron.cjs <script.cjs> [argumentos]');
  process.exit(2);
}

const electronBinary = require('electron');
const result = spawnSync(electronBinary, [script, ...args], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
