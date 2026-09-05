import { ipcMain, shell, Notification } from 'electron';
import { appRouter } from './index';
import { AuthService, AuthUser } from '../services/auth.service';
import { logger } from '../utils/logger';
import { toApiError } from '../utils/errors';
import { getAppDataDir } from '../utils/paths';
import { downloadUpdate, installUpdate } from '../updater';
import { resolve, sep } from 'path';

const ALLOWED_OPEN_DIRS = ['exports', 'invoices', 'build', 'release'];

function isPathAllowed(filePath: string): boolean {
  try {
    const resolved = resolve(filePath);
    const baseDir = getAppDataDir();
    return ALLOWED_OPEN_DIRS.some((dir) => {
      const dirPath = resolve(baseDir, dir);
      return resolved === dirPath || resolved.startsWith(dirPath + sep);
    });
  } catch {
    return false;
  }
}

const authService = new AuthService();

export const ALLOWED_PROCEDURE_PATHS = new Set<string>([
  'auth.login', 'auth.validate', 'auth.logout',
  'health.check',
  'inventory.getAll', 'inventory.getById', 'inventory.getByBarcode', 'inventory.getCategories',
  'inventory.create', 'inventory.update', 'inventory.delete', 'inventory.adjustStock',
  'inventory.getStockAlerts', 'inventory.getExpiryAlerts', 'inventory.getNoRotation', 'inventory.bulkImport',
  'cash.getActive', 'cash.getTodaySalesTotal', 'cash.getTodayExpenses', 'cash.listExpenses',
  'cash.listClosures', 'cash.getTodayPaymentsByMethod', 'cash.open', 'cash.close', 'cash.createExpense', 'cash.touchActivity',
  'customers.search', 'customers.create', 'customers.update', 'customers.getHistory',
  'customers.getDebts', 'customers.payDebt',
  'sales.create', 'sales.getById', 'sales.getByNumber', 'sales.getByCashRegister',
  'sales.getByUser', 'sales.getByDateRange', 'sales.cancel', 'sales.getDashboardSummary', 'sales.generateInvoice',
  'users.list', 'users.create', 'users.update', 'users.toggleActive', 'users.getStats',
  'config.getBusiness', 'config.setBusiness', 'config.getAll', 'config.getPrinter', 'config.setPrinter', 'config.testPrinter', 'config.listPrinters', 'config.printReceipt',
  'purchase.orders.list', 'purchase.orders.getById', 'purchase.orders.create', 'purchase.orders.updateStatus',
  'purchase.orders.receiveItems', 'purchase.orders.delete', 'purchase.orders.summary',
  'purchase.suppliers.list', 'purchase.suppliers.create', 'purchase.suppliers.update', 'purchase.suppliers.delete',
  'quotes.list', 'quotes.getById', 'quotes.create', 'quotes.update', 'quotes.delete', 'quotes.convertToSale',
  'export.inventory', 'export.sales', 'export.payroll', 'export.audit', 'export.dailyAudit', 'export.cashSessions', 'export.noRotation',
  'audit.list', 'audit.daily', 'audit.saveToday',
  'branches.list', 'branches.listAll', 'branches.create', 'branches.update', 'branches.delete',
  'labels.generate',
  'payroll.getPayroll',
  'backup.list', 'backup.create', 'backup.restore', 'backup.delete', 'backup.dbInfo',
  'migration.detect', 'migration.importV2',
  'license.getStatus', 'license.getFingerprint', 'license.activate',
]);

export function isSafePath(path: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*){0,3}$/.test(path);
}

export function resolveProcedurePath(caller: Record<string, unknown>, path: string): (...args: unknown[]) => Promise<unknown> {
  const parts = path.split('.');
  let current: unknown = caller;
  for (const part of parts) {
    if (part === '__proto__' || part === 'constructor' || part === 'prototype') {
      throw new Error('Ruta inválida: segmento no permitido.');
    }
    // In tRPC v11 the caller and sub-routers are functions, not plain objects.
    // We must allow both 'object' and 'function' types when traversing segments.
    if (current == null || (typeof current !== 'object' && typeof current !== 'function')) {
      throw new Error('Ruta inválida.');
    }
    current = (current as Record<string, unknown>)[part];
  }
  if (typeof current !== 'function') {
    throw new Error('Ruta inválida: no es una función.');
  }
  return current as (...args: unknown[]) => Promise<unknown>;
}

async function resolveContext(token: string | null | undefined): Promise<{ user: AuthUser | null }> {
  if (!token) return { user: null };
  try {
    const user = await authService.validateSession(token);
    return { user };
  } catch {
    return { user: null };
  }
}

export function registerIpc(): void {
  ipcMain.handle('trpc:query', async (_event, { path, input, token }: { path: string; input?: unknown; token?: string | null }) => {
    try {
      if (!isSafePath(path)) {
        logger.warn({ path }, 'Rejected unsafe tRPC path');
        return { success: false, error: { code: 'BAD_REQUEST', message: 'Ruta inválida.' } };
      }
      if (!ALLOWED_PROCEDURE_PATHS.has(path)) {
        logger.warn({ path }, 'Rejected unknown tRPC procedure path');
        return { success: false, error: { code: 'NOT_FOUND', message: 'Ruta no encontrada.' } };
      }
      const ctx = await resolveContext(token);
      const caller = appRouter.createCaller(ctx);
      const fn = resolveProcedurePath(caller as unknown as Record<string, unknown>, path);
      const result = await fn(input);
      return { success: true, data: result };
    } catch (err) {
      logger.error({ err, path }, 'tRPC query failed');
      return { success: false, error: toApiError(err) };
    }
  });

  ipcMain.handle('trpc:mutate', async (_event, { path, input, token }: { path: string; input?: unknown; token?: string | null }) => {
    try {
      if (!isSafePath(path)) {
        logger.warn({ path }, 'Rejected unsafe tRPC path');
        return { success: false, error: { code: 'BAD_REQUEST', message: 'Ruta inválida.' } };
      }
      if (!ALLOWED_PROCEDURE_PATHS.has(path)) {
        logger.warn({ path }, 'Rejected unknown tRPC procedure path');
        return { success: false, error: { code: 'NOT_FOUND', message: 'Ruta no encontrada.' } };
      }
      const ctx = await resolveContext(token);
      const caller = appRouter.createCaller(ctx);
      const fn = resolveProcedurePath(caller as unknown as Record<string, unknown>, path);
      const result = await fn(input);
      return { success: true, data: result };
    } catch (err) {
      logger.error({ err, path }, 'tRPC mutation failed');
      return { success: false, error: toApiError(err) };
    }
  });

  ipcMain.handle('update:download', async () => {
    downloadUpdate();
    return { success: true };
  });

  ipcMain.handle('update:install', async () => {
    installUpdate();
    return { success: true };
  });

  ipcMain.handle('file:open', async (_event, filePath: string) => {
    if (!isPathAllowed(filePath)) {
      logger.warn({ filePath }, 'Blocked attempt to open file outside allowed directories');
      return { success: false, error: 'Acceso denegado: ruta no permitida' };
    }
    try {
      await shell.openPath(filePath);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  ipcMain.handle('notification:show', async (_event, { title, body }: { title: string; body: string }) => {
    try {
      const notification = new Notification({ title, body });
      notification.show();
      return { success: true };
    } catch (err) {
      logger.error({ err }, 'Notification failed');
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });
}
