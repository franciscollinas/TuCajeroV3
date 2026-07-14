export interface CashRegister {
  id: number;
  userId: number;
  initialCash: number;
  finalCash: number | null;
  expectedCash: number | null;
  difference: number | null;
  openedAt: string;
  closedAt: string | null;
  status: string;
}

export interface CashCloseSummary {
  finalCash: number;
  expectedCash: number;
  difference: number;
}

export interface CashSessionSummary {
  total: number;
  efectivo?: number;
  efectivoBruto?: number;
  cambio?: number;
  tarjeta?: number;
  nequi?: number;
  daviplata?: number;
  transferencia?: number;
  credito?: number;
}

export interface CashClosureUser {
  id: number;
  username: string;
  fullName: string;
  role: string;
}

export interface CashClosureRow {
  id: number;
  initialCash: number;
  finalCash: number | null;
  expectedCash: number | null;
  difference: number | null;
  openedAt: string;
  closedAt: string;
  status: string;
  user: CashClosureUser;
}

export interface CashExpense {
  id: number;
  cashSessionId: number;
  userId: number;
  amount: number;
  reason: string;
  createdAt: string;
}
