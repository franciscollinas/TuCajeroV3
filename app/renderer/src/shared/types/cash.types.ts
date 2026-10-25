export interface CashRegister {
  id: number;
  userId: number;
  initialCash: number;
  finalCash: number | null;
  expectedCash: number | null;
  difference: number | null;
  openedAt: string;
  closedAt: string | null;
  status: string;
}

export interface CashCloseSummary {
  finalCash: number;
  expectedCash: number;
  difference: number;
}

export interface CashSessionSummary {
  total: number;
  efectivo?: number;
  efectivoBruto?: number;
  cambio?: number;
  tarjeta?: number;
  nequi?: number;
  daviplata?: number;
  transferencia?: number;
  credito?: number;
}

export interface CashClosureUser {
  id: number;
  username: string;
  fullName: string;
  role: string;
}

export interface CashClosureRow {
  id: number;
  /** true si la caja se cerró sola por inactividad (aunque ya se haya conciliado). */
  autoClosed: boolean;
  /** true si falta contar el efectivo: sin conteo ni diferencia hasta que alguien lo concilie. */
  pendingReconciliation: boolean;
  initialCash: number;
  finalCash: number | null;
  expectedCash: number | null;
  difference: number | null;
  openedAt: string;
  closedAt: string;
  status: string;
  user: CashClosureUser;
}

/** Resumen de UNA sesión de caja (no del día): lo vendido, lo cobrado y lo gastado en ella. */
export interface CashSessionOverview {
  sessionId: number;
  initialCash: number;
  /** Ventas completadas de esta sesión. */
  salesCount: number;
  salesTotal: number;
  /** Cobrado por método, neto del cambio e incluyendo abonos a deudas y créditos (fiados). */
  payments: Record<string, number>;
  /** Efectivo neto cobrado en la sesión. */
  cashCollected: number;
  /** Monto vendido a crédito (fiado) en la sesión; no entra a la caja. */
  creditSales: number;
  expensesCount: number;
  expensesTotal: number;
  /** El efectivo esperado registrado: con el que se calcula la diferencia al cerrar. */
  expectedCash: number;
  /** Control cruzado: inicial + efectivo neto − egresos. Debe coincidir con expectedCash. */
  computedExpectedCash: number;
}

/** Conceptos de egreso (lista fija). «Otro» exige describirlo. */
export const EXPENSE_CONCEPTS = ['Cambio dado', 'Pago de servicio', 'Retiro personal', 'Gasto operativo', 'Otro'] as const;
export type ExpenseConcept = (typeof EXPENSE_CONCEPTS)[number];

const EXPENSE_NOTE_SEPARATOR = ' — ';
export const EXPENSE_NOTE_MAX = 200;

/** Arma el texto que se guarda en `reason`: «Concepto» o «Concepto — detalle». */
export function buildExpenseReason(concept: ExpenseConcept, note?: string): string {
  const detail = (note ?? '').trim().slice(0, EXPENSE_NOTE_MAX);
  if (concept === 'Otro' && detail.length === 0) {
    throw new Error('Describe el egreso cuando eliges «Otro».');
  }
  return detail ? `${concept}${EXPENSE_NOTE_SEPARATOR}${detail}` : concept;
}

/** Separa un `reason` en concepto y detalle; los registros antiguos de texto libre quedan como detalle de «Otro». */
export function parseExpenseReason(reason: string): { concept: string; note: string } {
  const index = reason.indexOf(EXPENSE_NOTE_SEPARATOR);
  const head = index === -1 ? reason : reason.slice(0, index);
  if ((EXPENSE_CONCEPTS as readonly string[]).includes(head)) {
    return { concept: head, note: index === -1 ? '' : reason.slice(index + EXPENSE_NOTE_SEPARATOR.length) };
  }
  return { concept: 'Otro', note: reason };
}

export interface CashExpense {
  id: number;
  cashSessionId: number;
  userId: number;
  amount: number;
  reason: string;
  createdAt: string;
}
