import { describe, expect, it } from 'vitest';

import { formatExpiryDate, isProductExpired } from '../app/renderer/src/shared/utils/product-status';

const at = (y: number, m: number, d: number, h = 12): Date => new Date(y, m - 1, d, h, 0, 0);

describe('productos vencidos en el punto de venta', () => {
  const today = at(2026, 10, 24);

  it('vence ayer o antes: vencido', () => {
    expect(isProductExpired('2026-10-23', today)).toBe(true);
    expect(isProductExpired('2025-01-01', today)).toBe(true);
  });

  it('vence hoy: todavía se puede vender (igual que en el servidor)', () => {
    expect(isProductExpired('2026-10-24', today)).toBe(false);
    expect(isProductExpired('2026-10-24', at(2026, 10, 24, 23))).toBe(false);
    expect(isProductExpired('2026-10-24', at(2026, 10, 24, 0))).toBe(false);
  });

  it('vence mañana o después: vigente', () => {
    expect(isProductExpired('2026-10-25', today)).toBe(false);
    expect(isProductExpired('2027-01-01', today)).toBe(false);
  });

  it('sin fecha de vencimiento: vigente', () => {
    expect(isProductExpired(null, today)).toBe(false);
    expect(isProductExpired(undefined, today)).toBe(false);
    expect(isProductExpired('', today)).toBe(false);
  });

  it('acepta una fecha con hora y usa solo el día', () => {
    expect(isProductExpired('2026-10-23T23:59:59.000Z', today)).toBe(true);
    expect(isProductExpired('2026-10-24T00:00:00.000Z', today)).toBe(false);
  });

  it('da formato día/mes/año', () => {
    expect(formatExpiryDate('2026-10-05')).toBe('05/10/2026');
    expect(formatExpiryDate('2026-10-05T10:00:00.000Z')).toBe('05/10/2026');
  });
});
