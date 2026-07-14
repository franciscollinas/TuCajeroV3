export interface Supplier {
  id: number;
  name: string;
  contactPerson?: string;
  phone: string;
  email: string;
  address: string;
  leadTimeDays: number;
  isActive: boolean;
  notes?: string;
  createdAt: string;
}

export type PurchaseOrderStatus = 'DRAFT' | 'CONFIRMED' | 'SENT' | 'RECEIVED' | 'CANCELLED';

export interface PurchaseOrder {
  id: number;
  orderNumber: string;
  supplierId: number;
  supplier?: Supplier;
  status: PurchaseOrderStatus;
  items: PurchaseOrderItem[];
  subtotal: number;
  tax: number;
  freight: number;
  total: number;
  expectedDate?: string;
  receivedDate?: string;
  observations?: string;
  notes?: string;
  userId: number;
  user?: { id: number; fullName: string };
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseOrderItem {
  id: number;
  orderId: number;
  productId: number;
  product: { id: number; name: string; code: string };
  quantityOrdered: number;
  quantityReceived: number;
  unitCost: number;
  total: number;
  received: boolean;
  observations?: string;
}

export interface CreateSupplierInput {
  name: string;
  contactPerson?: string;
  phone: string;
  email?: string;
  address?: string;
  leadTimeDays?: number;
  isActive?: boolean;
  notes?: string;
}

export interface CreatePurchaseOrderInput {
  supplierId: number;
  items: { productId: number; quantityOrdered: number; unitCost: number }[];
  freight?: number;
  expectedDate?: string;
  notes?: string;
  branchId?: number;
}

export interface ReceiveItemInput {
  orderItemId: number;
  quantityReceived: number;
  received: boolean;
  observations?: string;
}

export interface PurchaseSummary {
  totalOrders: number;
  totalValue: number;
  pendingOrders: number;
  receivedOrders: number;
  ordersBySupplier: {
    supplierId: number;
    supplierName: string;
    orderCount: number;
    totalValue: number;
  }[];
}


