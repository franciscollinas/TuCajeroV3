import { describe, expect, it } from 'vitest';

import { auditActionLabel, auditDetailPairs } from '../app/renderer/src/shared/utils/auditFormat';

describe('registro de auditoría legible', () => {
  it('traduce las acciones conocidas y deja legible una desconocida', () => {
    expect(auditActionLabel('cash-session:closed')).toBe('Cierre de caja');
    expect(auditActionLabel('sale:cancelled')).toBe('Venta cancelada');
    expect(auditActionLabel('inventory:recount-done')).toBe('Inventory recount done');
  });

  it('formatea el cierre de caja con dinero y diferencia con signo', () => {
    const pairs = auditDetailPairs('{"finalCash":104800,"expectedCash":105800,"difference":-1000,"reason":"faltó un billete"}');
    const byLabel = Object.fromEntries(pairs.map((p) => [p.label, p.value]));
    expect(byLabel.Contado).toMatch(/104\.800/);
    expect(byLabel.Esperado).toMatch(/105\.800/);
    expect(byLabel.Diferencia).toMatch(/-.*1\.000|.*1\.000/);
    expect(byLabel.Diferencia?.startsWith('+')).toBe(false);
    expect(byLabel.Motivo).toBe('faltó un billete');
    expect(auditDetailPairs('{"difference":500}')[0].value.startsWith('+')).toBe(true);
  });

  it('no muestra campos vacíos y tolera JSON vacío, inválido o no objeto', () => {
    expect(auditDetailPairs('')).toEqual([]);
    expect(auditDetailPairs('{}')).toEqual([]);
    expect(auditDetailPairs('{"reason":"","x":null}')).toEqual([]);
    expect(auditDetailPairs('texto suelto')).toEqual([{ label: 'Detalle', value: 'texto suelto' }]);
    expect(auditDetailPairs('[1,2]')).toEqual([{ label: 'Detalle', value: '[1,2]' }]);
  });

  it('formatea booleanos y deja la clave si no hay etiqueta', () => {
    expect(auditDetailPairs('{"ok":true,"foo":"bar"}')).toEqual([
      { label: 'ok', value: 'Sí' },
      { label: 'foo', value: 'bar' },
    ]);
  });
});

describe('registro de auditoría: ventas y sesiones', () => {
  it('muestra los pagos con su método y oculta datos internos', () => {
    const pairs = auditDetailPairs('{"saleNumber":"V-1","total":30400,"items":4,"payments":[{"method":"efectivo","amount":17350},{"method":"nequi","amount":2750}]}');
    const byLabel = Object.fromEntries(pairs.map((p) => [p.label, p.value]));
    expect(byLabel['N.º']).toBe('V-1');
    expect(byLabel.Pagos).toMatch(/^Efectivo .*17\.350, Nequi .*2\.750$/);
    expect(auditDetailPairs('{"username":"admin","previousFailedAttempts":0,"expiresAt":"2026-10-12T01:09:51.624Z"}')).toEqual([
      { label: 'Usuario', value: 'admin' },
    ]);
  });

  it('si los pagos no tienen la forma esperada, los deja como texto', () => {
    expect(auditDetailPairs('{"payments":[{"x":1}]}')[0].value).toBe('[{"x":1}]');
  });
});
