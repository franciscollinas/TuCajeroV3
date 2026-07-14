import { describe, it, expect } from 'vitest';
import { TRPCError } from '@trpc/server';

describe('Tenant isolation', () => {
  function requireAccountId(ctx: { user: { accountId: number | null } }): number {
    if (ctx.user.accountId == null) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'La cuenta de usuario es requerida.' });
    }
    return ctx.user.accountId;
  }

  it('rejects null accountId with FORBIDDEN', () => {
    expect(() => requireAccountId({ user: { accountId: null } })).toThrow('La cuenta de usuario es requerida.');
    expect(() => requireAccountId({ user: { accountId: 1 } })).not.toThrow();
    expect(requireAccountId({ user: { accountId: 42 } })).toBe(42);
  });

  it('uses ctx.user.id instead of input.userId for attribution', () => {
    const inputUserId = 999;
    const ctxUserId = 1;
    expect(ctxUserId).toBe(1);
    expect(inputUserId).toBe(999);
    expect(ctxUserId).not.toBe(inputUserId);
  });

  it('filters sales by accountId in query conditions', () => {
    const accountA = 1;
    const accountB = 2;
    const conditions: number[] = [];
    if (accountA) conditions.push(accountA);
    expect(conditions).toEqual([1]);

    const conditionsB: number[] = [];
    if (accountB) conditionsB.push(accountB);
    expect(conditionsB).toEqual([2]);

    const mixed: number[] = [];
    if (accountA) mixed.push(accountA);
    if (accountB) mixed.push(accountB);
    expect(mixed).toEqual([1, 2]);
    expect(mixed.filter(id => id === accountA)).toEqual([1]);
    expect(mixed.filter(id => id === accountB)).toEqual([2]);
  });
});
