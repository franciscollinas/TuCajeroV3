const pad = (n: number): string => String(n).padStart(2, '0');

/** Fecha de hoy como «AAAA-MM-DD» en la zona horaria del equipo. */
function localToday(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Un producto está vencido cuando su fecha de vencimiento es anterior a hoy; el mismo día todavía
 * se puede vender. Es la misma regla que aplica el servidor al cobrar (sales.service.ts), para que
 * la pantalla no deje elegir algo que luego el cobro va a rechazar.
 */
export function isProductExpired(expiryDate: string | null | undefined, now: Date = new Date()): boolean {
  if (!expiryDate) return false;
  return expiryDate.slice(0, 10) < localToday(now);
}

/** «2026-10-24» → «24/10/2026» para mostrarlo al cajero. */
export function formatExpiryDate(expiryDate: string): string {
  const [y, m, d] = expiryDate.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
