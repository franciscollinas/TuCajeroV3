import { create } from 'zustand';
import { trpc } from '../../trpc';
import type { Product, StockAlerts, ExpiryAlerts } from '../types/inventory.types';
import { rendererLogger } from '../utils/rendererLogger';

export type AlertSeverity = 'critical' | 'warning' | 'info';
export type AlertCategory = 'stock' | 'expiry' | 'system';

export interface Alert {
  id: string;
  category: AlertCategory;
  severity: AlertSeverity;
  title: string;
  message: string;
  productId?: number;
  createdAt: string;
  dismissed: boolean;
}

interface AlertState {
  alerts: Alert[];
  stockAlerts: StockAlerts | null;
  expiryAlerts: ExpiryAlerts | null;
  loading: boolean;
  lastFetched: string | null;
  fetchAlerts: (branchId?: number) => Promise<void>;
  dismissAlert: (id: string) => void;
  clearAlerts: () => void;
  getCriticalCount: () => number;
  getWarningCount: () => number;
}

export const useAlertStore = create<AlertState>((set, get) => ({
  alerts: [],
  stockAlerts: null,
  expiryAlerts: null,
  loading: false,
  lastFetched: null,

  fetchAlerts: async (branchId?: number) => {
    set({ loading: true });
    try {
      const [stock, expiry] = await Promise.all([
        trpc.inventory.getStockAlerts.query(branchId ? { branchId } : undefined),
        trpc.inventory.getExpiryAlerts.query(branchId ? { branchId } : undefined),
      ]);
      const stockData = stock as StockAlerts;
      const expiryData = expiry as ExpiryAlerts;

      const criticalProducts: Product[] = [
        ...(stockData?.critical ?? []),
        ...(expiryData?.expired ?? []),
      ];
      const warningProducts: Product[] = [
        ...(stockData?.warning ?? []),
        ...(expiryData?.expiringSoon ?? []),
      ];

      const alerts: Alert[] = [
        ...criticalProducts.map((p) => ({
          id: `critical-${p.id}-${Date.now()}`,
          category: 'stock' as AlertCategory,
          severity: 'critical' as AlertSeverity,
          title: `Stock crítico: ${p.name}`,
          message: `Stock actual: ${p.stock}. Mínimo: ${p.minStock}`,
          productId: p.id,
          createdAt: new Date().toISOString(),
          dismissed: false,
        })),
        ...warningProducts.map((p) => ({
          id: `warning-${p.id}-${Date.now()}`,
          category: 'stock' as AlertCategory,
          severity: 'warning' as AlertSeverity,
          title: `Stock bajo: ${p.name}`,
          message: `Stock actual: ${p.stock}`,
          productId: p.id,
          createdAt: new Date().toISOString(),
          dismissed: false,
        })),
      ];

      set({
        alerts,
        stockAlerts: stockData,
        expiryAlerts: expiryData,
        loading: false,
        lastFetched: new Date().toISOString(),
      });
    } catch (err) {
      rendererLogger.error('AlertStore', 'fetchAlerts failed:', err);
      set({ loading: false });
    }
  },

  dismissAlert: (id: string) => {
    set((state) => ({
      alerts: state.alerts.map((a) => (a.id === id ? { ...a, dismissed: true } : a)),
    }));
  },

  clearAlerts: () => {
    set({ alerts: [], stockAlerts: null, expiryAlerts: null });
  },

  getCriticalCount: () => {
    return get().alerts.filter((a) => a.severity === 'critical' && !a.dismissed).length;
  },

  getWarningCount: () => {
    return get().alerts.filter((a) => a.severity === 'warning' && !a.dismissed).length;
  },
}));
