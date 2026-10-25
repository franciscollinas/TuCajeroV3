// Totales del carrito calculados igual que el servidor (app/main/services/sales.service.ts):
// pesos enteros, redondeo de mitad hacia afuera de cero en cada línea y en el descuento.
// Si el cajero ve un total distinto al que guarda el servidor, el cambio sale mal.
// tests/cart-totals.test.ts compara ambos cálculos con ventas reales.

export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.sign(value) * Math.round(Math.abs(value) + 1e-9);
  return rounded === 0 ? 0 : rounded;
}

export interface CartTotalsLine {
  quantity: number;
  unitPrice: number;
  discount: number;
  /** Fracción (0.19 = 19 %). */
  taxRate: number;
}

export interface CartTotalsInput {
  lines: CartTotalsLine[];
  ivaEnabled: boolean;
  deliveryFee: number;
  discount: number;
  discountType: 'percentage' | 'fixed';
}

export interface CartTotals {
  subtotal: number;
  tax: number;
  discountAmount: number;
  total: number;
}

export function computeCartTotals(input: CartTotalsInput): CartTotals {
  let subtotal = 0;
  let tax = 0;
  for (const line of input.lines) {
    const lineNet = roundMoney(line.quantity * line.unitPrice) - roundMoney(line.discount);
    subtotal += lineNet;
    if (input.ivaEnabled) tax += roundMoney(lineNet * (line.taxRate || 0));
  }
  const discountAmount =
    input.discountType === 'percentage'
      ? roundMoney((subtotal * input.discount) / 100)
      : roundMoney(input.discount);
  const total = subtotal + tax + roundMoney(input.deliveryFee) - discountAmount;
  return { subtotal, tax, discountAmount, total };
}

/**
 * Montos de billete para el cobro en efectivo: el valor exacto y los billetes
 * comunes (5.000 a 100.000) que alcanzan, de menor a mayor, máximo cinco.
 */
export function quickCashAmounts(amountDue: number): number[] {
  if (amountDue <= 0) return [];
  const options = new Set<number>([amountDue]);
  for (const denomination of [5000, 10000, 20000, 50000, 100000]) {
    options.add(Math.ceil(amountDue / denomination) * denomination);
  }
  return [...options].filter((v) => v >= amountDue).sort((a, b) => a - b).slice(0, 5);
}
