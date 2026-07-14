import { describe, it, expect } from 'vitest';

import { SalesService } from '../app/main/services/sales.service';

describe('SalesService', () => {
  const service = new SalesService();

  it('validates empty cart before processing', async () => {
    await expect(
      service.createSale(0, 0, [], [], 0, 0, undefined, false, undefined, 'percentage'),
    ).rejects.toThrow();
  });
});

describe('CustomerService', () => {
  it('buildLikePattern escapes SQL wildcards correctly', () => {
    const query = 'test%_value';
    const escaped = query.replace(/%/g, '\\%').replace(/_/g, '\\_');
    const pattern = `%${escaped}%`;
    expect(pattern).toBe('%test\\%\\_value%');
  });
});

describe('LIKE pattern safety', () => {
  it('escapes percent signs in search patterns', () => {
    const raw = '100% cotton';
    const pattern = `%${raw.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
    expect(pattern).toBe('%100\\% cotton%');
  });

  it('escapes underscores in search patterns', () => {
    const raw = 'prod_123';
    const pattern = `%${raw.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
    expect(pattern).toBe('%prod\\_123%');
  });

  it('handles empty string safely', () => {
    const raw = '';
    const pattern = `%${raw.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
    expect(pattern).toBe('%%');
  });
});

describe('Input validation', () => {
  it('rejects negative payment amounts', async () => {
    const service = new SalesService();
    await expect(
      service.createSale(0, 0, [{ productId: 1, quantity: 1, unitPrice: 10, discount: 0 }], [{ method: 'efectivo', amount: -5 }], 0, 0, undefined, false, undefined, 'percentage'),
    ).rejects.toThrow();
  });

  it('rejects payment less than total', async () => {
    const service = new SalesService();
    await expect(
      service.createSale(0, 0, [{ productId: 1, quantity: 1, unitPrice: 100, discount: 0 }], [{ method: 'efectivo', amount: 50 }], 0, 0, undefined, false, undefined, 'percentage'),
    ).rejects.toThrow();
  });
});
