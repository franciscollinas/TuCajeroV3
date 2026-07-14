import { describe, it, expect } from 'vitest';

import { isSafePath, resolveProcedurePath, ALLOWED_PROCEDURE_PATHS } from '../app/main/router/ipc-bridge';

describe('IPC Bridge Security', () => {
  describe('isSafePath', () => {
    it('accepts valid procedure paths', () => {
      expect(isSafePath('auth.login')).toBe(true);
      expect(isSafePath('inventory.getAll')).toBe(true);
      expect(isSafePath('sales.create')).toBe(true);
      expect(isSafePath('a.b.c.d')).toBe(true);
    });

    it('rejects paths with __proto__', () => {
      expect(isSafePath('auth.__proto__')).toBe(false);
      expect(isSafePath('__proto__.login')).toBe(false);
    });

    it('rejects paths with constructor', () => {
      expect(isSafePath('auth.constructor')).toBe(true);
      expect(isSafePath('constructor')).toBe(true);
      expect(() => resolveProcedurePath({ auth: { login: () => 'ok' } }, 'auth.constructor')).toThrow('Ruta inválida');
    });

    it('rejects paths with prototype', () => {
      expect(isSafePath('auth.prototype')).toBe(true);
      expect(isSafePath('prototype')).toBe(true);
      expect(() => resolveProcedurePath({ auth: { login: () => 'ok' } }, 'auth.prototype')).toThrow('Ruta inválida');
    });

    it('rejects paths with special characters', () => {
      expect(isSafePath('auth;login')).toBe(false);
      expect(isSafePath('auth/login')).toBe(false);
      expect(isSafePath('auth login')).toBe(false);
      expect(isSafePath('')).toBe(false);
    });

    it('rejects paths starting with number', () => {
      expect(isSafePath('1auth.login')).toBe(false);
    });
  });

  describe('ALLOWED_PROCEDURE_PATHS', () => {
    it('contains required auth procedures', () => {
      expect(ALLOWED_PROCEDURE_PATHS.has('auth.login')).toBe(true);
      expect(ALLOWED_PROCEDURE_PATHS.has('auth.validate')).toBe(true);
      expect(ALLOWED_PROCEDURE_PATHS.has('auth.logout')).toBe(true);
    });

    it('contains required sales procedures', () => {
      expect(ALLOWED_PROCEDURE_PATHS.has('sales.create')).toBe(true);
      expect(ALLOWED_PROCEDURE_PATHS.has('sales.cancel')).toBe(true);
      expect(ALLOWED_PROCEDURE_PATHS.has('sales.getById')).toBe(true);
    });

    it('does not contain unregistered procedures', () => {
      expect(ALLOWED_PROCEDURE_PATHS.has('evil.deleteAll')).toBe(false);
      expect(ALLOWED_PROCEDURE_PATHS.has('admin.secret')).toBe(false);
    });
  });

  describe('resolveProcedurePath', () => {
    it('resolves valid nested paths', () => {
      const obj = { auth: { login: () => 'ok' } };
      const fn = resolveProcedurePath(obj, 'auth.login');
      expect(fn()).toBe('ok');
    });

    it('throws for __proto__ segment', () => {
      const obj = { auth: { login: () => 'ok' } };
      expect(() => resolveProcedurePath(obj, 'auth.__proto__')).toThrow('Ruta inválida');
    });

    it('throws for prototype segment', () => {
      const obj = { auth: { login: () => 'ok' } };
      expect(() => resolveProcedurePath(obj, 'auth.prototype')).toThrow('Ruta inválida');
    });

    it('throws for constructor segment', () => {
      const obj = { auth: { login: () => 'ok' } };
      expect(() => resolveProcedurePath(obj, 'auth.constructor')).toThrow('Ruta inválida');
    });

    it('throws for non-function terminal', () => {
      const obj = { auth: { login: 'not-a-function' } };
      expect(() => resolveProcedurePath(obj, 'auth.login')).toThrow('no es una función');
    });
  });
});
