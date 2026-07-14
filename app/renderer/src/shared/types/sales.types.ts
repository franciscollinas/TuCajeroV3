export type PaymentMethod =
  | 'efectivo'
  | 'nequi'
  | 'daviplata'
  | 'tarjeta'
  | 'transferencia'
  | 'credito';

export interface CartItemInput {
  productId: number;
  quantity: number;
  unitPrice: number;
  discount: number;
}

export interface PaymentInput {
  method: PaymentMethod;
  amount: number;
  reference?: string;
}

export interface SaleProductSnapshot {
  id: number;
  code: string;
  barcode: string | null;
  name: string;
  categoryName: string;
}

export interface SaleItem {
  id: number;
  productId: number;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  subtotal: number;
  discount: number;
  total: number;
  unitType: string;
  product: SaleProductSnapshot;
}

export interface SalePayment {
  id: number;
  method: PaymentMethod;
  amount: number;
  reference: string | null;
  createdAt: string;
}

export interface SaleUser {
  id: number;
  username: string;
  fullName: string;
}

export interface SaleCashSession {
  id: number;
  initialCash: number;
  expectedCash: number | null;
  openedAt: string;
  closedAt: string | null;
  status: string;
}

export interface SaleRecord {
  id: number;
  saleNumber: string;
  cashSessionId: number | null;
  userId: number;
  subtotal: number;
  tax: number;
  discount: number;
  deliveryFee: number;
  total: number;
  customerId: number | null;
  customer?: { id: number; name: string; phone: string | null } | null;
  status: string;
  createdAt: string;
  items: SaleItem[];
  payments: SalePayment[];
  user: SaleUser;
  cashSession: SaleCashSession | null;
  cashReceived?: number;
  change: number;
  // Electronic invoice fields
  cufe?: string;
  dianStatus?: 'PENDING' | 'VALIDATED' | 'REJECTED';
}

export interface DailySummary {
  totalSales: number;
  totalAmount: number;
  paymentsByMethod: Record<string, number>;
  sales: SaleRecord[];
}

export interface DashboardSummary {
  today: {
    totalVendidos: number;
    totalMonto: number;
  };
  monthToDate: {
    totalVentas: number;
    totalIngresos: number;
    totalProfit: number;
  };
  topProducts: {
    id: number;
    name: string;
    code: string;
    quantity: number;
    total: number;
  }[];
  paymentMethods: {
    method: string;
    label: string;
    total: number;
  }[];
  weeklyChart: {
    name: string;
    ventas: number;
    ingresos: number;
  }[];
  monthlyChart: {
    name: string;
    ventas: number;
    ingresos: number;
  }[];
  topCategories: {
    name: string;
    value: number;
    color?: string;
  }[];
  recentSales: SaleRecord[];
}
