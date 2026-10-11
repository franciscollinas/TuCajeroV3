/* eslint-disable no-console */
// Historial de demostración: ventas, cajas y egresos de los últimos N días.
//
// Sirve para ver los reportes y gráficos con datos realistas y para medir
// rendimiento. Es reproducible (misma semilla = mismos datos) y NO toca el
// catálogo: usa los productos que ya existan (p. ej. los de seed-mockup.cjs).
//
// Uso (siempre sobre una COPIA de la base, nunca sobre la de uso real):
//
//   node scripts/run-with-electron.cjs scripts/seed-demo-history.cjs --db <ruta/copia.db>
//
// Opciones:
//   --db <ruta>       Base de datos a la que agregar historial (obligatoria).
//   --days <n>        Días de historial hacia atrás, incluido el último (42).
//   --end <AAAA-MM-DD> Último día simulado (hoy).
//   --seed <n>        Semilla del generador pseudoaleatorio (42).
//   --replace         Borra antes el historial de demostración previo.
//   --allow-dev-db    Permite escribir en database/tucajero.db (no recomendado).
//
// Las ventas de demostración se numeran DEMO-0001, DEMO-0002… para poder
// reconocerlas y borrarlas (--replace) sin tocar ventas reales.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DEMO_PREFIX = 'DEMO-';

function parseArgs(argv) {
  const args = { days: 42, seed: 42, replace: false, allowDevDb: false, db: null, end: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--db') args.db = argv[++i];
    else if (a === '--days') args.days = Number(argv[++i]);
    else if (a === '--end') args.end = argv[++i];
    else if (a === '--seed') args.seed = Number(argv[++i]);
    else if (a === '--replace') args.replace = true;
    else if (a === '--allow-dev-db') args.allowDevDb = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`Argumento desconocido: ${a}`);
  }
  return args;
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.db) {
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 22).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(args.help ? 0 : 1);
}
if (!Number.isInteger(args.days) || args.days < 1 || args.days > 400) fail('--days debe ser un entero entre 1 y 400.');
if (!Number.isInteger(args.seed)) fail('--seed debe ser un entero.');

const dbPath = path.resolve(args.db);
const devDb = path.resolve(process.cwd(), 'database', 'tucajero.db');
if (!fs.existsSync(dbPath)) fail(`No existe la base de datos: ${dbPath}`);
if (dbPath === devDb && !args.allowDevDb) {
  fail('Esa es la base de desarrollo real. Haz una copia y usa --db <copia>, o agrega --allow-dev-db si de verdad quieres escribir en ella.');
}

const endDay = args.end ? new Date(`${args.end}T00:00:00`) : new Date();
if (Number.isNaN(endDay.getTime())) fail('--end debe tener el formato AAAA-MM-DD.');
const lastDay = new Date(endDay.getFullYear(), endDay.getMonth(), endDay.getDate());

// Generador pseudoaleatorio determinista (LCG).
let state = args.seed >>> 0;
const rnd = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
const rint = (a, b) => a + Math.floor(rnd() * (b - a + 1));

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

const user = db.prepare('SELECT id, accountId FROM "User" ORDER BY id LIMIT 1').get();
if (!user) fail('La base no tiene usuarios.');
const products = db.prepare('SELECT id, price FROM "Product" WHERE isActive IS NULL OR isActive = 1').all();
if (products.length === 0) fail('La base no tiene productos. Siembra primero el catálogo (scripts/seed-mockup.cjs).');

const existing = db.prepare('SELECT COUNT(*) AS c FROM "Sale" WHERE saleNumber LIKE ?').get(`${DEMO_PREFIX}%`).c;
if (existing > 0 && !args.replace) fail(`Ya hay ${existing} ventas de demostración. Usa --replace para regenerarlas.`);

const REASONS = ['Cambio dado', 'Pago de servicio', 'Retiro personal', 'Gasto operativo'];
// Reparto de medios de pago (suma 100).
const METHODS = [['efectivo', 55], ['transferencia', 25], ['nequi', 8], ['daviplata', 6], ['tarjeta', 6]];
const pickMethod = () => {
  let roll = rint(1, 100);
  for (const [method, weight] of METHODS) {
    if (roll <= weight) return method;
    roll -= weight;
  }
  return 'efectivo';
};

const insSession = db.prepare(
  'INSERT INTO "CashSession" (accountId,userId,initialCash,finalCash,expectedCash,difference,openedAt,closedAt,status,lastActivityAt) VALUES (?,?,?,?,?,?,?,?,?,?)',
);
const insSale = db.prepare(
  'INSERT INTO "Sale" (accountId,saleNumber,userId,cashSessionId,subtotal,tax,discount,deliveryFee,total,change,status,dianStatus,createdAt) VALUES (?,?,?,?,?,0,0,0,?,0,?,\'PENDING\',?)',
);
const insItem = db.prepare(
  'INSERT INTO "SaleItem" (saleId,productId,quantity,unitPrice,taxRate,subtotal,discount,total,unitType) VALUES (?,?,?,?,0,?,0,?,\'UNIT\')',
);
const insPay = db.prepare('INSERT INTO "Payment" (saleId,cashSessionId,method,amount,createdAt) VALUES (?,?,?,?,?)');
const insExp = db.prepare('INSERT INTO "CashExpense" (accountId,cashSessionId,userId,amount,reason,createdAt) VALUES (?,?,?,?,?,?)');

function removePreviousDemo() {
  const sessionIds = db
    .prepare('SELECT DISTINCT cashSessionId AS id FROM "Sale" WHERE saleNumber LIKE ? AND cashSessionId IS NOT NULL')
    .all(`${DEMO_PREFIX}%`)
    .map((r) => r.id);
  db.prepare('DELETE FROM "Payment" WHERE saleId IN (SELECT id FROM "Sale" WHERE saleNumber LIKE ?)').run(`${DEMO_PREFIX}%`);
  db.prepare('DELETE FROM "SaleItem" WHERE saleId IN (SELECT id FROM "Sale" WHERE saleNumber LIKE ?)').run(`${DEMO_PREFIX}%`);
  db.prepare('DELETE FROM "Sale" WHERE saleNumber LIKE ?').run(`${DEMO_PREFIX}%`);
  // Solo se borran las cajas que quedaron sin ninguna venta real.
  for (const id of sessionIds) {
    if (db.prepare('SELECT COUNT(*) AS c FROM "Sale" WHERE cashSessionId = ?').get(id).c === 0) {
      db.prepare('DELETE FROM "CashExpense" WHERE cashSessionId = ?').run(id);
      db.prepare('DELETE FROM "Payment" WHERE cashSessionId = ?').run(id);
      db.prepare('DELETE FROM "CashSession" WHERE id = ?').run(id);
    }
  }
  return sessionIds.length;
}

let sales = 0;
let cancelled = 0;
let revenue = 0;
let counter = 0;

db.transaction(() => {
  if (args.replace && existing > 0) console.log(`Borrando historial de demostración previo (${existing} ventas)…`);
  if (args.replace && existing > 0) removePreviousDemo();

  for (let d = args.days - 1; d >= 0; d--) {
    const day = new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate() - d);
    const at = (h, m) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).toISOString();
    const initial = 100000;
    const sessionId = Number(
      insSession.run(user.accountId, user.id, initial, null, null, null, at(8, 0), null, 'OPEN', at(8, 0)).lastInsertRowid,
    );

    let cash = 0;
    const count = rint(15, 29);
    for (let s = 0; s < count; s++) {
      const items = [];
      for (let l = rint(1, 4); l > 0; l--) items.push({ p: products[rint(0, products.length - 1)], q: rint(1, 3) });
      const total = items.reduce((acc, i) => acc + i.p.price * i.q, 0);
      const when = at(rint(8, 15), rint(0, 59));
      const isCancelled = rnd() < 0.03;
      const saleId = Number(
        insSale.run(user.accountId, `${DEMO_PREFIX}${String(++counter).padStart(4, '0')}`, user.id, sessionId, total, total, isCancelled ? 'CANCELLED' : 'COMPLETED', when).lastInsertRowid,
      );
      for (const i of items) insItem.run(saleId, i.p.id, i.q, i.p.price, i.p.price * i.q, i.p.price * i.q);
      const method = pickMethod();
      insPay.run(saleId, sessionId, method, total, when);
      if (isCancelled) {
        cancelled++;
        continue;
      }
      if (method === 'efectivo') cash += total;
      sales++;
      revenue += total;
    }

    let expenses = 0;
    for (let e = rint(0, 2); e > 0; e--) {
      const amount = rint(2, 20) * 1000;
      expenses += amount;
      insExp.run(user.accountId, sessionId, user.id, amount, REASONS[rint(0, REASONS.length - 1)], at(rint(9, 14), rint(0, 59)));
    }

    const expected = initial + cash - expenses;
    const difference = rnd() < 0.15 ? rint(-4, 3) * 500 : 0;
    db.prepare(
      "UPDATE \"CashSession\" SET finalCash=?, expectedCash=?, difference=?, closedAt=?, status='CLOSED', lastActivityAt=? WHERE id=?",
    ).run(expected + difference, expected, difference, at(16, 0), at(16, 0), sessionId);
  }
})();

db.close();
console.log(`✓ Historial de demostración listo en ${dbPath}`);
console.log(`  ${args.days} días, ${sales} ventas completadas, ${cancelled} canceladas, ingresos $${revenue.toLocaleString('es-CO')}`);
console.log('  Para verlo en la app:');
console.log(`    DATABASE_URL="${dbPath}" npm run dev`);
