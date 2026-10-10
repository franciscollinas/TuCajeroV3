import { existsSync } from 'fs';
import type Database from 'better-sqlite3';

// Columnas que guardan dinero (COP) como pesos enteros. Las columnas conservan
// afinidad REAL (SQLite no permite cambiar el tipo sin reconstruir tablas con
// claves foraneas); la garantia de enteros la dan los triggers de abajo.
const MONEY_COLUMNS: Record<string, string[]> = {
  Product: ['price', 'cost'],
  CashSession: ['initialCash', 'finalCash', 'expectedCash', 'difference'],
  CashExpense: ['amount'],
  PurchaseOrder: ['subtotal', 'tax', 'freight', 'total'],
  PurchaseOrderItem: ['unitCost', 'total'],
  Sale: ['subtotal', 'tax', 'discount', 'deliveryFee', 'total', 'change'],
  SaleItem: ['unitPrice', 'subtotal', 'discount', 'total'],
  Debt: ['amount', 'balance'],
  Payment: ['amount'],
  User: ['hourlyRate'],
};

const TRIGGER_PREFIX = 'trg_money_int_';

function existingColumns(sqlite: Database.Database, table: string): Set<string> {
  const rows = sqlite.pragma(`table_info("${table}")`) as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

const isFractional = (column: string) => `"${column}" IS NOT NULL AND "${column}" <> CAST("${column}" AS INTEGER)`;

// Idempotente. Redondea a pesos los montos fraccionarios heredados (guardando
// antes una copia de la base si hay algo que redondear) e instala triggers que
// rechazan cualquier monto no entero en INSERT/UPDATE. Una vez instalados no
// vuelve a recorrer las tablas.
export function ensureMoneyIntegers(sqlite: Database.Database, backupPath?: string): void {
  const installed = sqlite
    .prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'trigger' AND name LIKE ?")
    .get(`${TRIGGER_PREFIX}%`) as { c: number };

  const targets: Array<{ table: string; columns: string[] }> = [];
  for (const [table, wanted] of Object.entries(MONEY_COLUMNS)) {
    const present = existingColumns(sqlite, table);
    const columns = wanted.filter((c) => present.has(c));
    if (columns.length > 0) targets.push({ table, columns });
  }
  if (targets.length === 0) return;

  if (installed.c === targets.length * 2) return;

  const hasFractions = targets.some(({ table, columns }) =>
    columns.some((c) => sqlite.prepare(`SELECT 1 FROM "${table}" WHERE ${isFractional(c)} LIMIT 1`).get() !== undefined),
  );
  if (hasFractions && backupPath) {
    const target = existsSync(backupPath) ? `${backupPath}.${Date.now()}` : backupPath;
    sqlite.prepare('VACUUM INTO ?').run(target);
  }

  const apply = sqlite.transaction(() => {
    for (const { table, columns } of targets) {
      for (const c of columns) {
        sqlite.exec(`UPDATE "${table}" SET "${c}" = CAST(ROUND("${c}") AS INTEGER) WHERE ${isFractional(c)};`);
      }
      const condition = columns.map((c) => `(NEW."${c}" IS NOT NULL AND NEW."${c}" <> CAST(NEW."${c}" AS INTEGER))`).join(' OR ');
      for (const [event, suffix] of [['INSERT', 'ins'], ['UPDATE', 'upd']] as const) {
        sqlite.exec(
          `CREATE TRIGGER IF NOT EXISTS "${TRIGGER_PREFIX}${table}_${suffix}" BEFORE ${event} ON "${table}" WHEN ${condition} ` +
            `BEGIN SELECT RAISE(ABORT, '${table}: los montos deben ser pesos enteros'); END;`,
        );
      }
    }
  });
  apply();
}
