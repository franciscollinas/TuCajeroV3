import { create } from 'zustand';
import { trpc } from '../../trpc';
import type { CashRegister, CashClosureRow, CashExpense } from '../types/cash.types';
import { rendererLogger } from '../utils/rendererLogger';

interface CashState {
  session: CashRegister | null;
  loading: boolean;
  todaySales: number;
  todayExpenses: number;
  expenses: CashExpense[];
  closures: CashClosureRow[];

  fetchSession: (userId: number, branchId?: number) => Promise<void>;
  fetchTodayTotals: (userId: number) => Promise<void>;
  fetchExpenses: (sessionId: number) => Promise<void>;
  fetchClosures: (branchId?: number) => Promise<void>;
  openCash: (userId: number, initialCash: number, branchId?: number) => Promise<void>;
  closeCash: (id: number, finalCash: number, userId: number) => Promise<void>;
  addExpense: (sessionId: number, userId: number, amount: number, reason: string) => Promise<void>;
  clearSession: () => void;
}

export const useCashStore = create<CashState>((set, get) => ({
  session: null,
  loading: false,
  todaySales: 0,
  todayExpenses: 0,
  expenses: [],
  closures: [],

  fetchSession: async (userId, branchId?) => {
    set({ loading: true });
    try {
      const result = await trpc.cash.getActive.query({ userId, branchId });
      set({ session: result as CashRegister | null });
    } finally {
      set({ loading: false });
    }
  },

  fetchTodayTotals: async (userId) => {
    try {
      const [sales, expenses] = await Promise.all([
        trpc.cash.getTodaySalesTotal.query({ userId }),
        trpc.cash.getTodayExpenses.query({ userId }),
      ]);
      set({
        todaySales: Number(sales ?? 0),
        todayExpenses: Number(expenses ?? 0),
      });
    } catch (err) {
      rendererLogger.error('CashStore', 'fetchTodayTotals failed:', err);
    }
  },

  fetchExpenses: async (sessionId) => {
    try {
      const result = await trpc.cash.listExpenses.query({ sessionId });
      set({ expenses: result as CashExpense[] });
    } catch (err) {
      rendererLogger.error('CashStore', 'fetchExpenses failed:', err);
    }
  },

  fetchClosures: async (branchId?) => {
    try {
      const result = await trpc.cash.listClosures.query({ branchId });
      set({ closures: result as CashClosureRow[] });
    } catch (err) {
      rendererLogger.error('CashStore', 'fetchClosures failed:', err);
    }
  },

  openCash: async (userId, initialCash, branchId?) => {
    const result = await trpc.cash.open.mutate({ userId, initialCash, branchId });
    set({ session: result as CashRegister });
  },

  closeCash: async (id, finalCash, _userId) => {
    const currentSession = get().session;
    const expectedCash = currentSession ? (currentSession.expectedCash ?? currentSession.initialCash) : finalCash;
    await trpc.cash.close.mutate({ sessionId: id, finalCash, expectedCash });
    get().clearSession();
  },

  addExpense: async (sessionId, userId, amount, reason) => {
    await trpc.cash.createExpense.mutate({ sessionId, userId, amount, reason });
    await get().fetchExpenses(sessionId);
  },

  clearSession: () =>
    set({
      session: null,
      todaySales: 0,
      todayExpenses: 0,
      expenses: [],
    }),
}));
