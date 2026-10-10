// Los montos (COP) se guardan y calculan como pesos enteros. Todo resultado de
// una multiplicacion, porcentaje o division debe pasar por roundMoney antes de
// sumarse o persistirse, para que los totales nunca arrastren error de float.

export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  // Mitad hacia afuera de cero; el epsilon absorbe ruido binario (p. ej. 1.005).
  const rounded = Math.sign(value) * Math.round(Math.abs(value) + 1e-9);
  return rounded === 0 ? 0 : rounded;
}

export function sumMoney(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) total += roundMoney(value);
  return total;
}

export function percentOf(amount: number, percent: number): number {
  return roundMoney((amount * percent) / 100);
}

export function lineAmount(quantity: number, unitPrice: number): number {
  return roundMoney(quantity * unitPrice);
}
