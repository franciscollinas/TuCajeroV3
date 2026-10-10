import { describe, expect, it } from 'vitest';

import { lineAmount, percentOf, roundMoney, sumMoney } from '../app/main/utils/money';

describe('money', () => {
  it('redondea a pesos enteros, mitad hacia afuera de cero', () => {
    expect(roundMoney(10.4)).toBe(10);
    expect(roundMoney(10.5)).toBe(11);
    expect(roundMoney(-10.5)).toBe(-11);
    expect(roundMoney(1.005 * 100)).toBe(101);
  });

  it('no devuelve -0 ni valores no finitos', () => {
    expect(Object.is(roundMoney(-0.2), 0)).toBe(true);
    expect(roundMoney(Number.NaN)).toBe(0);
    expect(roundMoney(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('el error clasico de float no se acumula', () => {
    let total = 0;
    for (let i = 0; i < 1000; i++) total += lineAmount(1, 0.1 + 0.2);
    expect(total).toBe(0);
    expect(sumMoney([0.1, 0.2, 0.3])).toBe(0);
  });

  it('calcula lineas y porcentajes con redondeo por linea', () => {
    expect(lineAmount(3, 3333.33)).toBe(10000);
    expect(lineAmount(0.5, 1999)).toBe(1000);
    expect(percentOf(10001, 19)).toBe(1900);
    expect(roundMoney(10001 * 0.19)).toBe(1900);
  });
});
