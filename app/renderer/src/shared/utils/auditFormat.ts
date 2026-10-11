import { formatCurrency } from './formatters';

const ACTION_LABELS: Record<string, string> = {
  'auth:login': 'Inicio de sesión',
  'auth:logout': 'Cierre de sesión',
  'auth:password-changed': 'Cambio de contraseña',
  'auth:account-locked': 'Cuenta bloqueada',
  'auth:account-unlocked': 'Cuenta desbloqueada',
  'cash-session:opened': 'Apertura de caja',
  'cash-session:closed': 'Cierre de caja',
  'cash-session:auto-closed': 'Cierre automático de caja',
  'customer:debt-paid': 'Abono a deuda',
  'product:created': 'Producto creado',
  'product:bulk-imported': 'Importación de productos',
  'product:stock-adjusted': 'Ajuste de inventario',
  'quote:created': 'Cotización creada',
  'quote:updated': 'Cotización editada',
  'quote:deleted': 'Cotización eliminada',
  'quote:converted': 'Cotización convertida en venta',
  'sale:created': 'Venta registrada',
  'sale:cancelled': 'Venta cancelada',
  'user:created': 'Usuario creado',
  'user:edited': 'Usuario editado',
};

const FIELD_LABELS: Record<string, string> = {
  finalCash: 'Contado',
  expectedCash: 'Esperado',
  initialCash: 'Inicial',
  difference: 'Diferencia',
  reason: 'Motivo',
  amount: 'Monto',
  total: 'Total',
  subtotal: 'Subtotal',
  method: 'Método',
  quantity: 'Cantidad',
  stock: 'Stock',
  previousStock: 'Stock anterior',
  newStock: 'Stock nuevo',
  username: 'Usuario',
  role: 'Rol',
  count: 'Cantidad',
  saleId: 'Venta',
  customerId: 'Cliente',
  saleNumber: 'N.º',
  items: 'Ítems',
  payments: 'Pagos',
};

/** Datos internos sin valor para quien revisa el registro. */
const HIDDEN_FIELDS = new Set(['expiresAt', 'previousFailedAttempts']);

const METHOD_LABELS: Record<string, string> = {
  efectivo: 'Efectivo', nequi: 'Nequi', daviplata: 'Daviplata', transferencia: 'Transferencia', tarjeta: 'Tarjeta', credito: 'Crédito',
};

function formatPayments(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const parts = value.map((p) => {
    if (p === null || typeof p !== 'object') return null;
    const { method, amount } = p as { method?: unknown; amount?: unknown };
    if (typeof method !== 'string' || typeof amount !== 'number') return null;
    return `${METHOD_LABELS[method] ?? method} ${formatCurrency(amount)}`;
  });
  return parts.every((p) => p !== null) ? parts.join(', ') : null;
}

/** Campos cuyo valor es dinero (pesos enteros). */
const MONEY_FIELDS = new Set(['finalCash', 'expectedCash', 'initialCash', 'difference', 'amount', 'total', 'subtotal']);

/** «cash-session:closed» → «Cierre de caja»; si no se conoce, un texto legible en lugar del código. */
export function auditActionLabel(action: string): string {
  const known = ACTION_LABELS[action];
  if (known) return known;
  const text = action.replace(/[:_-]+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatValue(key: string, value: unknown): string {
  if (typeof value === 'number' && MONEY_FIELDS.has(key)) {
    const sign = key === 'difference' && value > 0 ? '+' : '';
    return `${sign}${formatCurrency(value)}`;
  }
  if (key === 'payments') {
    const text = formatPayments(value);
    if (text) return text;
  }
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Convierte el JSON crudo del registro en pares «Etiqueta: valor» legibles; `[]` si no hay datos. */
export function auditDetailPairs(payload: string): Array<{ label: string; value: string }> {
  if (!payload) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return [{ label: 'Detalle', value: payload }];
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return [{ label: 'Detalle', value: formatValue('', parsed) }];
  }
  return Object.entries(parsed as Record<string, unknown>)
    .filter(([key, value]) => !HIDDEN_FIELDS.has(key) && value !== undefined && value !== null && value !== '')
    .map(([key, value]) => ({ label: FIELD_LABELS[key] ?? key, value: formatValue(key, value) }));
}
