export type StockMovementType = 'entrada' | 'salida' | 'ajuste' | 'venta';

export interface Category {
  id: number;
  name: string;
  color: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: number;
  accountId?: number;
  code: string;
  barcode: string | null;
  name: string;
  description: string | null;
  categoryId: number | null;
  category: Category;
  price: number;
  cost: number;
  stock: number;
  minStock: number;
  criticalStock: number;
  taxRate: number;
  suggestedPurchaseQty: number | null;
  expiryDate: string | null;
  location: string | null;
  unitType: string;
  conversionFactor: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  stockMovements?: StockMovement[];
  salesLast30Days?: number;
}

export interface ProductDetail extends Product {
  stockMovements: StockMovement[];
}

export interface ProductInput {
  code: string;
  barcode?: string | null;
  name: string;
  description?: string | null;
  categoryId?: number;
  categoryName?: string;
  price: number;
  cost: number;
  stock: number;
  minStock?: number;
  criticalStock?: number;
  taxRate?: number;
  suggestedPurchaseQty?: number | null;
  expiryDate?: string | null;
  location?: string | null;
  unitType?: string;
  conversionFactor?: number;
  userId: number;
}

export interface StockMovement {
  id: number;
  accountId?: number;
  productId: number;
  type: StockMovementType;
  quantity: number;
  previousStock: number;
  newStock: number;
  reason: string | null;
  userId: number;
  branchId?: number;
  createdAt: string;
}

export interface BulkImportRow {
  code: string;
  barcode?: string | null;
  name: string;
  description?: string | null;
  category: string;
  categoryColor?: string | null;
  price: string;
  cost: string;
  stock: string;
  minStock?: string;
  criticalStock?: string;
  expiryDate?: string | null;
  location?: string | null;
}

export interface BulkImportError {
  row: number | BulkImportRow;
  code?: string;
  error?: string;
  message?: string;
}

export interface BulkImportResult {
  success: number;
  created: number;
  updated: number;
  errors: BulkImportError[];
}

export interface StockAlerts {
  critical: Product[];
  warning: Product[];
  ok: Product[];
  expired: Product[];
  expiringSoon: Product[];
}

export interface ExpiryAlerts {
  expired: Product[];
  expiringSoon: Product[];
  ok: Product[];
}

export interface StockAdjustmentResult {
  previousStock: number;
  newStock: number;
}

export interface NoRotationProduct {
  id: number;
  code: string;
  name: string;
  stock: number;
  price: number;
  cost: number;
  lastSaleDate: string | null;
  daysWithoutSale: number;
}