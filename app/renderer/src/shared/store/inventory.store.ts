import { create } from 'zustand';
import { trpc } from '../../trpc';
import type { Product, Category, StockAlerts, ExpiryAlerts } from '../types/inventory.types';

interface InventoryState {
  products: Product[];
  total: number;
  categories: Category[];
  stockAlerts: StockAlerts | null;
  expiryAlerts: ExpiryAlerts | null;
  loading: boolean;
  search: string;
  categoryFilter: string;
  page: number;

  fetchProducts: (opts?: { search?: string; categoryId?: string; page?: number }) => Promise<void>;
  fetchCategories: () => Promise<void>;
  fetchStockAlerts: (branchId?: number) => Promise<void>;
  setSearch: (search: string) => void;
  setCategoryFilter: (id: string) => void;
  setPage: (page: number) => void;
  clearProducts: () => void;
}

const PAGE_SIZE = 20;

export const useInventoryStore = create<InventoryState>((set) => ({
  products: [],
  total: 0,
  categories: [],
  stockAlerts: null,
  expiryAlerts: null,
  loading: false,
  search: '',
  categoryFilter: '',
  page: 1,

  fetchProducts: async (opts) => {
    set({ loading: true });
    try {
      const result = await trpc.inventory.getAll.query({
        search: opts?.search ?? '',
        categoryId: opts?.categoryId ? Number(opts.categoryId) : undefined,
        page: opts?.page ?? 1,
        pageSize: PAGE_SIZE,
      });
      const data = result as { products: Product[]; total: number };
      set({
        products: data.products ?? [],
        total: data.total ?? 0,
        search: opts?.search ?? '',
        categoryFilter: opts?.categoryId ?? '',
        page: opts?.page ?? 1,
      });
    } finally {
      set({ loading: false });
    }
  },

  fetchCategories: async () => {
    try {
      const result = await trpc.inventory.getCategories.query();
      set({ categories: result as Category[] });
    } catch {
      // silently fail
    }
  },

  fetchStockAlerts: async (branchId?: number) => {
    try {
      const [stock, expiry] = await Promise.all([
        trpc.inventory.getStockAlerts.query(branchId ? { branchId } : undefined),
        trpc.inventory.getExpiryAlerts.query(branchId ? { branchId } : undefined),
      ]);
      set({
        stockAlerts: stock as StockAlerts,
        expiryAlerts: expiry as ExpiryAlerts,
      });
    } catch {
      // silently fail
    }
  },

  setSearch: (search) => set({ search }),
  setCategoryFilter: (id) => set({ categoryFilter: id }),
  setPage: (page) => set({ page }),
  clearProducts: () =>
    set({
      products: [],
      total: 0,
      stockAlerts: null,
      expiryAlerts: null,
    }),
}));
