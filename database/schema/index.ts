import { sqliteTable, text, integer, real, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

// ── Multi-Tenant Support ───────────────────────────────────────────────────────
export const accounts = sqliteTable('Account', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  nit: text('nit').notNull().unique(),
  email: text('email').notNull(),
  phone: text('phone'),
  address: text('address'),
  subscriptionStatus: text('subscriptionStatus').notNull().default('TRIAL'),
  subscriptionPlan: text('subscriptionPlan').notNull().default('BASIC'),
  trialEndsAt: text('trialEndsAt'),
  stripeCustomerId: text('stripeCustomerId'),
  dianResolution: text('dianResolution'),
  dianPrefix: text('dianPrefix').default('FV'),
  isActive: integer('isActive', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull(),
});

export const subscriptions = sqliteTable('Subscription', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('accountId').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  stripeSubscriptionId: text('stripeSubscriptionId'),
  plan: text('plan').notNull(),
  status: text('status').notNull(),
  startsAt: text('startsAt').notNull(),
  endsAt: text('endsAt'),
  createdAt: text('createdAt').notNull(),
});

export const invoices = sqliteTable('Invoice', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  saleId: integer('saleId').notNull().references(() => sales.id),
  accountId: integer('accountId').notNull().references(() => accounts.id),
  cufe: text('cufe').notNull().unique(),
  dianStatus: text('dianStatus').notNull().default('PENDING'),
  dianResponse: text('dianResponse'),
  pdfUrl: text('pdfUrl'),
  xmlUrl: text('xmlUrl'),
  sentAt: text('sentAt'),
  validatedAt: text('validatedAt'),
}, (table) => [
  index('idx_invoice_account').on(table.accountId),
  index('idx_invoice_sale').on(table.saleId),
]);

// ── Existing Tables (now tenant-aware) ──────────────────────────────────────────
export const branches = sqliteTable('Branch', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('accountId').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  code: text('code').notNull(),
  address: text('address'),
  phone: text('phone'),
  isActive: integer('isActive', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull(),
}, (table) => [
  uniqueIndex('idx_branch_account_code').on(table.accountId, table.code),
  index('idx_branch_account').on(table.accountId),
]);

export const branchStocks = sqliteTable('BranchStock', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  branchId: integer('branchId').notNull().references(() => branches.id, { onDelete: 'cascade' }),
  productId: integer('productId').notNull().references(() => products.id, { onDelete: 'cascade' }),
  stock: real('stock').notNull().default(0),
  minStock: integer('minStock').notNull().default(5),
  criticalStock: integer('criticalStock').notNull().default(2),
  location: text('location'),
  expiryDate: text('expiryDate'),
}, (table) => [
  uniqueIndex('idx_branchstock_branch_product').on(table.branchId, table.productId),
  index('idx_branchstock_branch').on(table.branchId),
  index('idx_branchstock_product').on(table.productId),
]);

export const users = sqliteTable('User', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('accountId').references(() => accounts.id, { onDelete: 'cascade' }),
  username: text('username').notNull(),
  password: text('password').notNull(),
  fullName: text('fullName').notNull(),
  role: text('role').notNull().default('CASHIER'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  mustChangePassword: integer('mustChangePassword', { mode: 'boolean' }).notNull().default(false),
  hourlyRate: real('hourlyRate'),
  failedLoginAttempts: integer('failedLoginAttempts').notNull().default(0),
  lockedUntil: text('lockedUntil'),
  branchId: integer('branchId').references(() => branches.id, { onDelete: 'set null' }),
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull(),
}, (table) => [
  uniqueIndex('idx_user_account_username').on(table.accountId, table.username),
]);

export const sessions = sqliteTable('Session', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('userId').notNull().references(() => users.id),
  token: text('token').notNull().unique(),
  expiresAt: text('expiresAt').notNull(),
  createdAt: text('createdAt').notNull(),
  closedAt: text('closedAt'),
}, (table) => [
  index('idx_session_user').on(table.userId),
  index('idx_session_expires').on(table.expiresAt),
]);

export const categories = sqliteTable('Category', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('accountId').references(() => accounts.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color'),
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull(),
}, (table) => [
  uniqueIndex('idx_category_account_name').on(table.accountId, table.name),
]);

export const products = sqliteTable('Product', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('accountId').references(() => accounts.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  barcode: text('barcode'),
  name: text('name').notNull(),
  description: text('description'),
  categoryId: integer('categoryId').references(() => categories.id),
  price: real('price').notNull(),
  cost: real('cost').notNull(),
  stock: real('stock').notNull().default(0),
  minStock: integer('minStock').notNull().default(5),
  criticalStock: integer('criticalStock').notNull().default(2),
  taxRate: real('taxRate').notNull().default(0.19),
  suggestedPurchaseQty: integer('suggestedPurchaseQty'),
  expiryDate: text('expiryDate'),
  location: text('location'),
  unitType: text('unitType').notNull().default('UNIT'),
  conversionFactor: real('conversionFactor').notNull().default(1),
  isActive: integer('isActive', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull(),
}, (table) => [
  index('idx_product_active_name').on(table.isActive, table.name),
  index('idx_product_category').on(table.categoryId),
  index('idx_product_active_category').on(table.isActive, table.categoryId),
  uniqueIndex('idx_product_account_barcode').on(table.accountId, table.barcode),
  uniqueIndex('idx_product_account_code').on(table.accountId, table.code),
]);

export const stockMovements = sqliteTable('StockMovement', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('accountId').references(() => accounts.id, { onDelete: 'cascade' }),
  productId: integer('productId').notNull().references(() => products.id),
  type: text('type').notNull(),
  quantity: real('quantity').notNull(),
  previousStock: real('previousStock').notNull(),
  newStock: real('newStock').notNull(),
  reason: text('reason'),
  userId: integer('userId').notNull().references(() => users.id),
  branchId: integer('branchId').references(() => branches.id),
  createdAt: text('createdAt').notNull(),
}, (table) => [
  index('idx_stockmovement_product').on(table.productId, table.createdAt),
  index('idx_stockmovement_user').on(table.userId),
  index('idx_stockmovement_branch').on(table.branchId),
  index('idx_stockmovement_account').on(table.accountId),
]);

export const customers = sqliteTable('Customer', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('accountId').references(() => accounts.id, { onDelete: 'cascade' }),
  document: text('document'),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  address: text('address'),
  isActive: integer('isActive', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull(),
}, (table) => [
  uniqueIndex('idx_customer_account_document').on(table.accountId, table.document),
]);

export const cashSessions = sqliteTable('CashSession', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('accountId').references(() => accounts.id, { onDelete: 'cascade' }),
  userId: integer('userId').notNull().references(() => users.id),
  branchId: integer('branchId').references(() => branches.id),
  initialCash: real('initialCash').notNull(),
  finalCash: real('finalCash'),
  expectedCash: real('expectedCash'),
  difference: real('difference'),
  openedAt: text('openedAt').notNull(),
  closedAt: text('closedAt'),
  status: text('status').notNull().default('OPEN'),
}, (table) => [
  index('idx_cashsession_status').on(table.status),
  index('idx_cashsession_branch').on(table.branchId),
  index('idx_cashsession_user').on(table.userId),
  index('idx_cashsession_account').on(table.accountId),
]);

export const cashExpenses = sqliteTable('CashExpense', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('accountId').references(() => accounts.id, { onDelete: 'cascade' }),
  cashSessionId: integer('cashSessionId').notNull().references(() => cashSessions.id),
  userId: integer('userId').notNull().references(() => users.id),
  amount: real('amount').notNull(),
  reason: text('reason').notNull(),
  createdAt: text('createdAt').notNull(),
}, (table) => [
  index('idx_cashexpense_session').on(table.cashSessionId),
  index('idx_cashexpense_account').on(table.accountId),
]);

export const suppliers = sqliteTable('Supplier', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('accountId').references(() => accounts.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  contactPerson: text('contactPerson'),
  phone: text('phone').notNull(),
  email: text('email'),
  address: text('address'),
  leadTimeDays: integer('leadTimeDays').notNull().default(7),
  isActive: integer('isActive', { mode: 'boolean' }).notNull().default(true),
  notes: text('notes'),
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull(),
});

export const purchaseOrders = sqliteTable('PurchaseOrder', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('accountId').references(() => accounts.id, { onDelete: 'cascade' }),
  orderNumber: text('orderNumber').notNull(),
  supplierId: integer('supplierId').notNull().references(() => suppliers.id),
  branchId: integer('branchId').references(() => branches.id),
  status: text('status').notNull().default('DRAFT'),
  subtotal: real('subtotal').notNull().default(0),
  tax: real('tax').notNull().default(0),
  freight: real('freight').notNull().default(0),
  total: real('total').notNull().default(0),
  expectedDate: text('expectedDate'),
  receivedDate: text('receivedDate'),
  observations: text('observations'),
  notes: text('notes'),
  userId: integer('userId').notNull().references(() => users.id),
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull(),
}, (table) => [
  index('idx_purchase_supplier').on(table.supplierId),
  index('idx_purchase_status').on(table.status),
  index('idx_purchase_created').on(table.createdAt),
  index('idx_purchase_branch').on(table.branchId),
]);

export const purchaseOrderItems = sqliteTable('PurchaseOrderItem', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orderId: integer('orderId').notNull().references(() => purchaseOrders.id, { onDelete: 'cascade' }),
  productId: integer('productId').notNull().references(() => products.id),
  quantityOrdered: real('quantityOrdered').notNull(),
  quantityReceived: real('quantityReceived').notNull().default(0),
  unitCost: real('unitCost').notNull(),
  total: real('total').notNull(),
  received: integer('received', { mode: 'boolean' }).notNull().default(false),
  observations: text('observations'),
}, (table) => [
  index('idx_poitem_order').on(table.orderId),
  index('idx_poitem_product').on(table.productId),
]);

export const sales = sqliteTable('Sale', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('accountId').references(() => accounts.id, { onDelete: 'cascade' }),
  saleNumber: text('saleNumber').notNull(),
  userId: integer('userId').notNull().references(() => users.id),
  cashSessionId: integer('cashSessionId').references(() => cashSessions.id),
  branchId: integer('branchId').references(() => branches.id),
  subtotal: real('subtotal').notNull(),
  tax: real('tax').notNull(),
  discount: real('discount').notNull().default(0),
  deliveryFee: real('deliveryFee').notNull().default(0),
  total: real('total').notNull(),
  change: real('change').notNull().default(0),
  status: text('status').notNull().default('COMPLETED'),
  customerId: integer('customerId').references(() => customers.id),
  cufe: text('cufe'),
  dianStatus: text('dianStatus').default('PENDING'),
  createdAt: text('createdAt').notNull(),
}, (table) => [
  index('idx_sale_created').on(table.createdAt),
  index('idx_sale_status_created').on(table.status, table.createdAt),
  index('idx_sale_cashsession').on(table.cashSessionId),
  index('idx_sale_user_created').on(table.userId, table.createdAt),
  index('idx_sale_customer').on(table.customerId),
  index('idx_sale_branch').on(table.branchId),
  index('idx_sale_account').on(table.accountId),
  uniqueIndex('idx_sale_number').on(table.saleNumber),
]);

export const saleItems = sqliteTable('SaleItem', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  saleId: integer('saleId').notNull().references(() => sales.id),
  productId: integer('productId').notNull().references(() => products.id),
  quantity: real('quantity').notNull(),
  unitPrice: real('unitPrice').notNull(),
  taxRate: real('taxRate').notNull(),
  subtotal: real('subtotal').notNull(),
  discount: real('discount').notNull().default(0),
  total: real('total').notNull().default(0),
  unitType: text('unitType').notNull(),
}, (table) => [
  index('idx_saleitem_sale').on(table.saleId),
  index('idx_saleitem_product').on(table.productId),
]);

export const debts = sqliteTable('Debt', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('accountId').references(() => accounts.id, { onDelete: 'cascade' }),
  customerId: integer('customerId').notNull().references(() => customers.id),
  saleId: integer('saleId').references(() => sales.id),
  branchId: integer('branchId').references(() => branches.id),
  amount: real('amount').notNull(),
  balance: real('balance').notNull(),
  status: text('status').notNull().default('PENDING'),
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull(),
}, (table) => [
  index('idx_debt_customer').on(table.customerId),
  index('idx_debt_status').on(table.status),
  index('idx_debt_customer_status').on(table.customerId, table.status),
]);

export const payments = sqliteTable('Payment', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  saleId: integer('saleId').references(() => sales.id),
  debtId: integer('debtId').references(() => debts.id),
  cashSessionId: integer('cashSessionId').references(() => cashSessions.id),
  method: text('method').notNull(),
  amount: real('amount').notNull(),
  reference: text('reference'),
  createdAt: text('createdAt').notNull(),
}, (table) => [
  index('idx_payment_sale').on(table.saleId),
  index('idx_payment_cashsession').on(table.cashSessionId),
  index('idx_payment_method').on(table.method),
]);

export const auditLogs = sqliteTable('AuditLog', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('accountId').references(() => accounts.id, { onDelete: 'cascade' }),
  userId: integer('userId').notNull().references(() => users.id),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: integer('entityId'),
  payload: text('payload'),
  createdAt: text('createdAt').notNull(),
}, (table) => [
  index('idx_audit_created').on(table.createdAt),
  index('idx_audit_user_created').on(table.userId, table.createdAt),
  index('idx_audit_action').on(table.action),
  index('idx_audit_entity').on(table.entity),
  index('idx_audit_account').on(table.accountId),
]);

export const configs = sqliteTable('Config', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('accountId').references(() => accounts.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  value: text('value').notNull(),
  updatedAt: text('updatedAt').notNull(),
}, (table) => [
  uniqueIndex('idx_config_account_key').on(table.accountId, table.key),
]);