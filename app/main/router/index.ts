import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import { parseLocalDateOnly } from '../utils/date';
import { productCreateInputSchema, productUpdateInputSchema } from './inventory-schemas';

import { AuthService, AuthUser } from '../services/auth.service';
import { InventoryService } from '../services/inventory.service';
import { CashSessionService } from '../services/cash-session.service';
import { CashExpenseService } from '../services/cash-expense.service';
import { CustomerService } from '../services/customer.service';
import { SalesService } from '../services/sales.service';
import { UsersService } from '../services/users.service';
import { ConfigService } from '../services/config.service';
import { ExportService } from '../services/export.service';
import { AuditService } from '../services/audit.service';
import { BranchService } from '../services/branch.service';
import { LabelService } from '../services/label.service';
import { PayrollService } from '../services/payroll.service';
import { PurchaseService } from '../services/purchase.service';
import { QuoteService } from '../services/quote.service';
import { BackupService } from '../services/backup.service';
import { MigrationService } from '../services/migration.service';
import { LicenseService } from '../services/license.service';
import { PrinterService } from '../services/printer.service';
import { DianService } from '../services/dian.service';


const authService = new AuthService();
const inventoryService = new InventoryService();
const cashSessionService = new CashSessionService();
const cashExpenseService = new CashExpenseService();
const customerService = new CustomerService();
const salesService = new SalesService();
const usersService = new UsersService();
const configService = new ConfigService();
const exportService = new ExportService();
const auditService = new AuditService();
const branchService = new BranchService();
const labelService = new LabelService();
const payrollService = new PayrollService();
const purchaseService = new PurchaseService();
const quoteService = new QuoteService();
const backupService = new BackupService();
const migrationService = new MigrationService();
const licenseService = new LicenseService();
const printerService = new PrinterService();
const dianService = new DianService();




export const t = initTRPC.context<{ user: AuthUser | null }>().create({
  isServer: true,
});

const enforceAuth = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'No autorizado.' });
  }
  return next({ ctx: { user: ctx.user } });
});

const authenticatedProcedure = t.procedure.use(enforceAuth);

type UserRole = 'ADMIN' | 'CASHIER' | 'SUPERVISOR';

function requireRole(...allowedRoles: UserRole[]) {
  return t.middleware(async ({ ctx, next }) => {
    if (!ctx.user) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'No autorizado.' });
    }
    if (!allowedRoles.includes(ctx.user.role)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'No tiene permisos para realizar esta acción.' });
    }
    return next({ ctx: { user: ctx.user } });
  });
}

const adminOnly = authenticatedProcedure.use(requireRole('ADMIN'));
const adminOrSupervisor = authenticatedProcedure.use(requireRole('ADMIN', 'SUPERVISOR'));

const moneyAmount = z.number().finite().min(0).max(999_999_999);
const positiveMoney = z.number().finite().positive().max(999_999_999);
const nonNegativeQty = z.number().finite().min(0).max(9_999_999);

function requireAccountId(ctx: { user: AuthUser }): number {
  if (ctx.user.accountId == null) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'La cuenta de usuario es requerida.' });
  }
  return ctx.user.accountId;
}

export const authRouter = t.router({
  login: t.procedure
    .input(z.object({ username: z.string().min(1).max(100), password: z.string().min(1).max(200) }))
    .mutation(async ({ input }) => {
      try {
        const result = await authService.login(input.username, input.password);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Credenciales inválidas.';
        const code = err instanceof TRPCError ? err.code : 'UNAUTHORIZED';
        throw new TRPCError({ code, message });
      }
    }),

  validate: authenticatedProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      return authService.validateSession(input.token);
    }),

  logout: authenticatedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ input }) => {
      await authService.logout(input.token);
      return { success: true };
    }),
});

export const healthRouter = t.router({
  check: t.procedure.query(() => ({ status: 'ok', version: '3.0.0', mode: 'local' })),
});

export const inventoryRouter = t.router({
  getAll: authenticatedProcedure
    .input(z.object({ search: z.string().optional(), categoryId: z.number().optional(), page: z.number().optional(), pageSize: z.number().optional() }).optional())
    .query(async ({ input, ctx }) => {
      return inventoryService.getAllProducts(input, requireAccountId(ctx));
    }),

  getById: authenticatedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      return inventoryService.getProductById(input.id, requireAccountId(ctx));
    }),

  getByBarcode: authenticatedProcedure
    .input(z.object({ barcode: z.string() }))
    .query(async ({ input, ctx }) => {
      return inventoryService.getProductByBarcode(input.barcode, requireAccountId(ctx));
    }),

  getCategories: authenticatedProcedure.query(async ({ ctx }) => {
    return inventoryService.getCategories(requireAccountId(ctx));
  }),

  create: adminOrSupervisor
    .input(z.object({ data: productCreateInputSchema }))
    .mutation(async ({ input, ctx }) => {
      return inventoryService.createProduct(input.data, requireAccountId(ctx));
    }),

  update: adminOrSupervisor
    .input(z.object({ id: z.number(), data: productUpdateInputSchema }))
    .mutation(async ({ input, ctx }) => {
      return inventoryService.updateProduct(input.id, input.data, requireAccountId(ctx));
    }),

    delete: adminOrSupervisor
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        return inventoryService.deleteProduct(input.id, requireAccountId(ctx));
      }),

  adjustStock: adminOrSupervisor
    .input(z.object({ productId: z.number(), quantity: z.number().finite().min(-9_999_999).max(9_999_999), reason: z.string(), userId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      return inventoryService.adjustStock(input.productId, input.quantity, input.reason, ctx.user.id, requireAccountId(ctx));
    }),

  getStockAlerts: authenticatedProcedure
    .input(z.object({ branchId: z.number().optional() }).optional())
    .query(async ({ input, ctx }) => {
      return inventoryService.getStockAlerts(input?.branchId, requireAccountId(ctx));
    }),

  getExpiryAlerts: authenticatedProcedure
    .input(z.object({ branchId: z.number().optional() }).optional())
    .query(async ({ input, ctx }) => {
      return inventoryService.getExpiryAlerts(input?.branchId, requireAccountId(ctx));
    }),

  getNoRotation: authenticatedProcedure
    .input(z.object({ days: z.number().optional() }).optional())
    .query(async ({ input, ctx }) => {
      return inventoryService.getNoRotationProducts(input?.days, requireAccountId(ctx));
    }),

  bulkImport: adminOrSupervisor
    .input(z.object({ products: z.array(z.object({ code: z.string(), barcode: z.string().optional().nullable(), name: z.string(), description: z.string().optional().nullable(), category: z.string(), categoryColor: z.string().optional().nullable(), taxRate: z.string().optional(), price: z.string(), cost: z.string(), stock: z.string(), minStock: z.string().optional(), criticalStock: z.string().optional(), expiryDate: z.string().optional().nullable(), location: z.string().optional().nullable() })), userId: z.number(), branchId: z.number().optional() }))
    .mutation(async ({ input, ctx }) => {
      return inventoryService.bulkImportProducts(input.products, ctx.user.id, input.branchId, requireAccountId(ctx));
    }),
});

export const cashRouter = t.router({
  getActive: authenticatedProcedure
    .input(z.object({ userId: z.number(), branchId: z.number().optional() }))
    .query(async ({ input, ctx }) => {
      return cashSessionService.getActiveCashSession(ctx.user.id, input.branchId);
    }),

  getTodaySalesTotal: authenticatedProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ ctx }) => {
      return cashSessionService.getTodaySalesTotal(ctx.user.id);
    }),

  getTodayExpenses: authenticatedProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ ctx }) => {
      return cashExpenseService.getTodayExpensesTotal(ctx.user.id);
    }),

  listExpenses: authenticatedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ input, ctx }) => {
      return cashExpenseService.getExpensesBySession(input.sessionId, requireAccountId(ctx), ctx.user.role === 'CASHIER' ? ctx.user.id : undefined);
    }),

  listClosures: authenticatedProcedure
    .input(z.object({ branchId: z.number().optional() }).optional())
    .query(async ({ input, ctx }) => {
      return cashSessionService.listCashClosures(requireAccountId(ctx), 60, input?.branchId, ctx.user.role === 'CASHIER' ? ctx.user.id : undefined);
    }),

  getTodayPaymentsByMethod: authenticatedProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ ctx }) => {
      return cashSessionService.getTodayPaymentsByMethod(ctx.user.id);
    }),

  open: authenticatedProcedure
    .input(z.object({ userId: z.number(), initialCash: moneyAmount, branchId: z.number().optional() }))
    .mutation(async ({ input, ctx }) => {
      return cashSessionService.openCashSession(requireAccountId(ctx), ctx.user.id, input.initialCash, input.branchId);
    }),

  close: authenticatedProcedure
    .input(z.object({ sessionId: z.number(), finalCash: moneyAmount, expectedCash: moneyAmount }))
    .mutation(async ({ input, ctx }) => {
      return cashSessionService.closeCashSession(input.sessionId, input.finalCash, input.expectedCash, requireAccountId(ctx), ctx.user.id);
    }),

  createExpense: authenticatedProcedure
    .input(z.object({ sessionId: z.number(), userId: z.number(), amount: moneyAmount, reason: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return cashExpenseService.createExpense(input.sessionId, ctx.user.id, input.amount, input.reason, requireAccountId(ctx));
    }),

  touchActivity: authenticatedProcedure
    .input(z.object({ branchId: z.number().optional() }).optional())
    .mutation(async ({ input, ctx }) => {
      await cashSessionService.touchActivity(ctx.user.id, input?.branchId);
      return { success: true };
    }),
});

export const customerRouter = t.router({
  search: authenticatedProcedure
    .input(z.object({ query: z.string() }))
    .query(async ({ input, ctx }) => {
      return customerService.searchCustomers(input.query, requireAccountId(ctx));
    }),

  create: authenticatedProcedure
    .input(z.object({ data: z.object({ name: z.string(), document: z.string().optional(), email: z.string().optional(), phone: z.string().optional(), address: z.string().optional(), accountId: z.number().optional() }) }))
    .mutation(async ({ input, ctx }) => {
      return customerService.createCustomer(input.data, requireAccountId(ctx));
    }),

  update: authenticatedProcedure
    .input(z.object({ id: z.number(), data: z.object({ name: z.string().optional(), document: z.string().optional(), email: z.string().optional(), phone: z.string().optional(), address: z.string().optional() }) }))
    .mutation(async ({ input, ctx }) => {
      return customerService.updateCustomer(input.id, input.data, requireAccountId(ctx));
    }),

  getHistory: authenticatedProcedure
    .input(z.object({ customerId: z.number() }))
    .query(async ({ input, ctx }) => {
      return customerService.getCustomerHistory(input.customerId, requireAccountId(ctx));
    }),

  getDebts: authenticatedProcedure
    .input(z.object({ customerId: z.number() }))
    .query(async ({ input, ctx }) => {
      return customerService.getCustomerDebts(input.customerId, requireAccountId(ctx));
    }),

  payDebt: authenticatedProcedure
    .input(z.object({ debtId: z.number(), amount: positiveMoney, userId: z.number(), cashSessionId: z.number().optional(), method: z.enum(['efectivo', 'nequi', 'daviplata', 'tarjeta', 'transferencia']).optional() }))
    .mutation(async ({ input, ctx }) => {
      return customerService.payDebt(input.debtId, input.amount, ctx.user.id, input.cashSessionId ?? null, requireAccountId(ctx), input.method ?? 'efectivo');
    }),
});

export const salesRouter = t.router({
   create: authenticatedProcedure
     .input(z.object({ cashSessionId: z.number(), userId: z.number(), items: z.array(z.object({ productId: z.number(), quantity: nonNegativeQty, unitPrice: moneyAmount, discount: moneyAmount })), payments: z.array(z.object({ method: z.enum(['efectivo', 'nequi', 'daviplata', 'tarjeta', 'transferencia', 'credito']), amount: positiveMoney, reference: z.string().optional() })), discount: moneyAmount.optional(), deliveryFee: moneyAmount.optional(), customerId: z.number().optional(), branchId: z.number().optional(), isCreditSale: z.boolean().optional(), discountType: z.enum(["percentage", "fixed"]).optional() }))
      .mutation(async ({ input, ctx }) => {
       return salesService.createSale(input.cashSessionId, ctx.user.id, input.items, input.payments, requireAccountId(ctx), input.discount, input.deliveryFee, input.customerId, input.isCreditSale ?? false, input.branchId, input.discountType ?? "percentage");
     }),

  getById: authenticatedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      return salesService.getSaleById(input.id, requireAccountId(ctx));
    }),

  getByNumber: authenticatedProcedure
    .input(z.object({ saleNumber: z.string() }))
    .query(async ({ input, ctx }) => {
      return salesService.getSaleByNumber(input.saleNumber, requireAccountId(ctx));
    }),

  getByCashRegister: authenticatedProcedure
    .input(z.object({ cashSessionId: z.number() }))
    .query(async ({ input, ctx }) => {
      return salesService.getSalesByCashRegister(input.cashSessionId, requireAccountId(ctx), ctx.user.role === 'CASHIER' ? ctx.user.id : undefined);
    }),

  getByUser: authenticatedProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ input, ctx }) => {
      return salesService.getSalesByUser(ctx.user.role === 'CASHIER' ? ctx.user.id : input.userId, requireAccountId(ctx));
    }),

  getByDateRange: authenticatedProcedure
    .input(z.object({ startDate: z.string(), endDate: z.string(), branchId: z.number().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const start = input?.startDate ? parseLocalDateOnly(input.startDate) : new Date();
      const end = input?.endDate ? parseLocalDateOnly(input.endDate) : new Date();
      return salesService.getSalesByDateRange(start, end, requireAccountId(ctx), input?.branchId, ctx.user.role === 'CASHIER' ? ctx.user.id : undefined);
    }),

  cancel: adminOrSupervisor
    .input(z.object({ id: z.number(), userId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      return salesService.cancelSale(input.id, ctx.user.id, requireAccountId(ctx));
    }),

  getDashboardSummary: authenticatedProcedure
    .input(z.object({ branchId: z.number().optional() }).optional())
    .query(async ({ input, ctx }) => {
      return salesService.getDashboardSummary(requireAccountId(ctx), input?.branchId);
    }),

  generateInvoice: authenticatedProcedure
    .input(z.object({ saleId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const sale = await salesService.getSaleById(input.saleId, requireAccountId(ctx));
      if (!sale) throw new TRPCError({ code: 'NOT_FOUND', message: 'Venta no encontrada.' });
      return dianService.generateInvoice(sale, requireAccountId(ctx));
    }),
});

export const usersRouter = t.router({
  list: adminOrSupervisor
    .input(z.object({}).optional())
    .query(async ({ ctx }) => {
      return usersService.listUsers(requireAccountId(ctx));
    }),

  create: adminOnly
    .input(z.object({ data: z.object({ username: z.string(), password: z.string(), fullName: z.string(), role: z.enum(['ADMIN', 'CASHIER', 'SUPERVISOR']), hourlyRate: z.number().optional() }) }))
    .mutation(async ({ input, ctx }) => {
      return usersService.createUser({ ...input.data, accountId: requireAccountId(ctx), actorUserId: ctx.user.id });
    }),

  update: adminOnly
    .input(z.object({ id: z.number(), data: z.object({ fullName: z.string().optional(), role: z.enum(['ADMIN', 'CASHIER', 'SUPERVISOR']).optional(), password: z.string().optional(), active: z.boolean().optional(), hourlyRate: z.number().optional() }) }))
    .mutation(async ({ input, ctx }) => {
      return usersService.updateUser(input.id, { ...input.data, actorUserId: ctx.user.id }, requireAccountId(ctx));
    }),

  toggleActive: adminOnly
    .input(z.object({ id: z.number(), active: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      return usersService.toggleUserActive(input.id, input.active, ctx.user.id, requireAccountId(ctx));
    }),

  getStats: adminOrSupervisor
    .input(z.object({ userId: z.number() }))
    .query(async ({ input, ctx }) => {
      return usersService.getUserStats(input.userId, requireAccountId(ctx));
    }),
});

export const configRouter = t.router({
  getBusiness: authenticatedProcedure.query(async ({ ctx }) => {
    return configService.getBusinessConfig(requireAccountId(ctx));
  }),

  setBusiness: adminOnly
    .input(z.object({ config: z.object({ businessName: z.string(), address: z.string(), email: z.string(), phone: z.string(), nit: z.string(), logo: z.string(), ivaEnabled: z.boolean() }) }))
    .mutation(async ({ input, ctx }) => {
      return configService.setBusinessConfig(input.config, requireAccountId(ctx));
    }),

  getAll: adminOrSupervisor.query(async ({ ctx }) => {
    return configService.getAllFiltered(requireAccountId(ctx), ctx.user.role === 'ADMIN');
  }),

  getPrinter: adminOnly.query(async ({ ctx }) => {
    return printerService.getConfig(requireAccountId(ctx));
  }),

  setPrinter: adminOnly
    .input(z.object({ printer: z.object({ type: z.enum(['USB', 'TCP', 'Windows']), paperWidth: z.number(), characterSet: z.string(), connectionString: z.string() }) }))
    .mutation(async ({ input, ctx }) => {
      return printerService.setConfig(input.printer, requireAccountId(ctx));
    }),

  testPrinter: adminOnly
    .input(z.object({ printer: z.object({ type: z.enum(['USB', 'TCP', 'Windows']), paperWidth: z.number(), characterSet: z.string(), connectionString: z.string() }) }))
    .mutation(async ({ input }) => {
      return printerService.testPrint(input.printer);
    }),

  listPrinters: adminOnly.query(async () => {
    return printerService.listWindowsPrinters();
  }),

  printReceipt: authenticatedProcedure
    .input(z.object({
      sale: z.object({
        saleNumber: z.string(),
        total: z.number(),
        subtotal: z.number(),
        tax: z.number(),
        discount: z.number(),
        deliveryFee: z.number(),
        change: z.number(),
        createdAt: z.string(),
        items: z.array(z.object({
          productName: z.string().optional(),
          product: z.object({ name: z.string() }).optional(),
          quantity: z.number(),
          unitPrice: z.number(),
          total: z.number(),
          discount: z.number(),
        })),
        payments: z.array(z.object({ method: z.string(), amount: z.number() })),
        customer: z.object({ name: z.string() }).nullable().optional(),
        user: z.object({ fullName: z.string() }).nullable().optional(),
      }),
      businessConfig: z.object({
        businessName: z.string().optional(),
        address: z.string().optional(),
        phone: z.string().optional(),
        nit: z.string().optional(),
      }),
    }))
    .mutation(async ({ input, ctx }) => {
      return printerService.printReceipt(input.sale, input.businessConfig, requireAccountId(ctx));
    }),
});

export const purchaseRouter = t.router({
  orders: t.router({
    list: authenticatedProcedure
      .input(z.object({ branchId: z.number().optional() }).optional())
      .query(async ({ input, ctx }) => {
        return purchaseService.getPurchaseOrders(input?.branchId, requireAccountId(ctx));
      }),

    getById: authenticatedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => {
        return purchaseService.getPurchaseOrderById(input.id, requireAccountId(ctx));
      }),

    create: adminOrSupervisor
      .input(z.object({ userId: z.number(), data: z.object({ supplierId: z.number(), items: z.array(z.object({ productId: z.number(), quantityOrdered: nonNegativeQty, unitCost: moneyAmount })), branchId: z.number().optional(), freight: moneyAmount.optional(), expectedDate: z.string().optional(), notes: z.string().optional() }) }))
      .mutation(async ({ input, ctx }) => {
        return purchaseService.createPurchaseOrder(ctx.user.id, input.data, requireAccountId(ctx));
      }),

    updateStatus: adminOrSupervisor
      .input(z.object({ id: z.number(), status: z.enum(['DRAFT', 'CONFIRMED', 'SENT', 'RECEIVED', 'CANCELLED']) }))
      .mutation(async ({ input, ctx }) => {
        return purchaseService.updatePurchaseOrderStatus(input.id, input.status, requireAccountId(ctx));
      }),

    receiveItems: adminOrSupervisor
      .input(z.object({ id: z.number(), userId: z.number(), items: z.array(z.object({ orderItemId: z.number(), received: z.boolean(), quantityReceived: nonNegativeQty, observations: z.string().optional() })) }))
      .mutation(async ({ input, ctx }) => {
        return purchaseService.receiveItems(input.id, ctx.user.id, input.items, requireAccountId(ctx));
      }),

    delete: adminOrSupervisor
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        return purchaseService.deletePurchaseOrder(input.id, requireAccountId(ctx));
      }),

    summary: authenticatedProcedure.query(async ({ ctx }) => {
      return purchaseService.getPurchaseSummary(requireAccountId(ctx));
    }),
  }),

  suppliers: t.router({
    list: authenticatedProcedure.query(async ({ ctx }) => {
      return purchaseService.getAllSuppliers(requireAccountId(ctx));
    }),

    create: adminOrSupervisor
      .input(z.object({ data: z.object({ name: z.string(), contactPerson: z.string().optional(), phone: z.string(), email: z.string().optional(), address: z.string().optional(), leadTimeDays: z.number().optional(), isActive: z.boolean().optional(), notes: z.string().optional() }) }))
      .mutation(async ({ input, ctx }) => {
        return purchaseService.createSupplier(input.data, requireAccountId(ctx));
      }),

    update: adminOrSupervisor
      .input(z.object({ id: z.number(), data: z.object({ name: z.string().optional(), contactPerson: z.string().optional(), phone: z.string().optional(), email: z.string().optional(), address: z.string().optional(), leadTimeDays: z.number().optional(), isActive: z.boolean().optional(), notes: z.string().optional() }) }))
      .mutation(async ({ input, ctx }) => {
        return purchaseService.updateSupplier(input.id, input.data, requireAccountId(ctx));
      }),

    delete: adminOrSupervisor
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        return purchaseService.deleteSupplier(input.id, requireAccountId(ctx));
      }),
  }),
});

export const quoteRouter = t.router({
  list: authenticatedProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ ctx }) => {
      return quoteService.list(ctx.user.id, requireAccountId(ctx));
    }),

  getById: authenticatedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      return quoteService.getById(input.id, requireAccountId(ctx));
    }),

  create: authenticatedProcedure
    .input(z.object({ userId: z.number(), items: z.array(z.object({ productId: z.number(), unitPrice: moneyAmount, quantity: nonNegativeQty, discount: moneyAmount })), customerId: z.number().optional(), discount: moneyAmount.optional(), deliveryFee: moneyAmount.optional(), notes: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      return quoteService.create(input.userId, requireAccountId(ctx), input.items, input.customerId, input.discount, input.deliveryFee, input.notes);
    }),

  update: authenticatedProcedure
    .input(z.object({ id: z.number(), userId: z.number(), items: z.array(z.object({ productId: z.number(), unitPrice: moneyAmount, quantity: nonNegativeQty, discount: moneyAmount })), customerId: z.number().optional(), discount: moneyAmount.optional(), deliveryFee: moneyAmount.optional() }))
    .mutation(async ({ input, ctx }) => {
      return quoteService.update(input.id, ctx.user.id, requireAccountId(ctx), input.items, input.customerId, input.discount, input.deliveryFee);
    }),

  delete: authenticatedProcedure
    .input(z.object({ id: z.number(), userId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      return quoteService.delete(input.id, ctx.user.id, requireAccountId(ctx));
    }),

  convertToSale: authenticatedProcedure
    .input(z.object({ id: z.number(), cashSessionId: z.number(), userId: z.number(), payments: z.array(z.object({ method: z.string(), amount: positiveMoney, reference: z.string().optional() })) }))
    .mutation(async ({ input, ctx }) => {
      return quoteService.convertToSale(input.id, input.cashSessionId, ctx.user.id, input.payments, requireAccountId(ctx));
    }),
});

export const exportRouter = t.router({
  inventory: adminOrSupervisor
    .input(z.object({ format: z.enum(['csv', 'xlsx']).optional() }).optional())
    .mutation(async ({ input, ctx }) => {
      return { path: await exportService.exportInventory(input?.format, requireAccountId(ctx)) };
    }),

  sales: adminOrSupervisor
    .input(z.object({ dateFrom: z.string().optional(), dateTo: z.string().optional(), branchId: z.number().optional(), format: z.enum(['csv', 'xlsx']).optional() }).optional())
    .mutation(async ({ input, ctx }) => {
      return { path: await exportService.exportSales(input?.dateFrom, input?.dateTo, input?.branchId, input?.format, requireAccountId(ctx)) };
    }),

  payroll: adminOnly
    .input(z.object({ userId: z.number(), periodStart: z.string(), periodEnd: z.string(), format: z.enum(['csv', 'xlsx']).optional() }))
    .mutation(async ({ input, ctx }) => {
      return { path: await exportService.exportPayroll(input.userId, input.periodStart, input.periodEnd, input?.format, requireAccountId(ctx)) };
    }),

  audit: adminOnly
    .input(z.object({ startDate: z.string().optional(), endDate: z.string().optional(), format: z.enum(['csv', 'xlsx']).optional() }).optional())
    .mutation(async ({ input, ctx }) => {
      return { path: await exportService.exportAudit(input?.startDate, input?.endDate, input?.format, requireAccountId(ctx)) };
    }),

  dailyAudit: adminOnly
    .input(z.object({ startDate: z.string().optional(), endDate: z.string().optional(), format: z.enum(['csv', 'xlsx']).optional() }).optional())
    .mutation(async ({ input, ctx }) => {
      return { path: await exportService.exportDailyAudit(input?.startDate, input?.endDate, input?.format, requireAccountId(ctx)) };
    }),

  cashSessions: adminOrSupervisor
    .input(z.object({ startDate: z.string().optional(), endDate: z.string().optional(), format: z.enum(['csv', 'xlsx']).optional() }).optional())
    .mutation(async ({ input, ctx }) => {
      return { path: await exportService.exportCashSessions(input?.startDate, input?.endDate, input?.format, requireAccountId(ctx)) };
    }),

  noRotation: adminOrSupervisor
    .input(z.object({ format: z.enum(['csv', 'xlsx']).optional() }).optional())
    .mutation(async ({ input, ctx }) => {
      return { path: await exportService.exportNoRotation(input?.format, requireAccountId(ctx)) };
    }),
});

export const auditRouter = t.router({
  list: adminOrSupervisor
    .input(z.object({ limit: z.number().optional(), startDate: z.string().optional(), endDate: z.string().optional(), userId: z.number().optional(), action: z.string().optional(), entity: z.string().optional() }).optional())
    .query(async ({ input, ctx }) => {
      return auditService.getAuditLogs({ ...input, accountId: requireAccountId(ctx) });
    }),

  // Logs diarios agregados por usuario, con filtro por rango de fechas.
  daily: adminOrSupervisor
    .input(z.object({ limit: z.number().optional(), startDate: z.string().optional(), endDate: z.string().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const accountId = requireAccountId(ctx);
      await auditService.ensureDailyLogs(accountId, 7);
      return auditService.getDailyLogs({ ...input, accountId });
    }),

  // Genera/actualiza el log diario de hoy (cierre manual del día).
  saveToday: adminOnly
    .mutation(async ({ ctx }) => {
      return auditService.saveTodayLog(requireAccountId(ctx));
    }),
});

export const branchRouter = t.router({
  list: authenticatedProcedure.query(async ({ ctx }) => {
    return branchService.list(requireAccountId(ctx));
  }),

  listAll: authenticatedProcedure.query(async ({ ctx }) => {
    return branchService.listAll(requireAccountId(ctx));
  }),

  create: adminOnly
    .input(z.object({ data: z.object({ name: z.string(), code: z.string(), address: z.string().optional(), phone: z.string().optional() }) }))
    .mutation(async ({ input, ctx }) => {
      return branchService.create({ ...input.data, accountId: requireAccountId(ctx) });
    }),

  update: adminOnly
    .input(z.object({ id: z.number(), data: z.object({ name: z.string().optional(), code: z.string().optional(), address: z.string().optional(), phone: z.string().optional(), isActive: z.boolean().optional() }) }))
    .mutation(async ({ input, ctx }) => {
      return branchService.update(input.id, input.data, requireAccountId(ctx));
    }),

  delete: adminOnly
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await branchService.delete(input.id, requireAccountId(ctx));
      return { success: true };
    }),
});

export const labelRouter = t.router({
  generate: authenticatedProcedure
    .input(z.object({ productIds: z.array(z.number()), copiesPerProduct: z.number().optional() }).optional())
    .mutation(async ({ input, ctx }) => {
      return { path: await labelService.generateLabels(input?.productIds ?? [], input?.copiesPerProduct, requireAccountId(ctx)) };
    }),
});

export const payrollRouter = t.router({
  getPayroll: adminOnly
    .input(z.object({ period: z.enum(['daily', 'weekly', 'monthly']), periodStart: z.string(), periodEnd: z.string() }))
    .query(async ({ input, ctx }) => {
      return payrollService.getPayroll(input.period, input.periodStart, input.periodEnd, requireAccountId(ctx));
    }),
});

export const backupRouter = t.router({
  list: adminOnly.query(async () => {
    return backupService.listBackups();
  }),

  create: adminOnly.mutation(async () => {
    return backupService.createBackup();
  }),

  restore: adminOnly
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      return backupService.restoreBackup(input.id);
    }),

  delete: adminOnly
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      return backupService.deleteBackup(input.id);
    }),

  dbInfo: adminOnly.query(async () => {
    return backupService.getDatabaseInfo();
  }),
});

export const migrationRouter = t.router({
  detect: adminOnly.query(async () => {
    return migrationService.detectV2();
  }),

  importV2: adminOnly.mutation(async () => {
    return migrationService.migrateV2();
  }),
});

export const licenseRouter = t.router({
  getStatus: authenticatedProcedure.query(async () => {
    return licenseService.getLicenseStatus();
  }),

  getFingerprint: authenticatedProcedure.query(async () => {
    return licenseService.generateFingerprint();
  }),

  activate: adminOnly
    .input(z.object({ activationKey: z.string() }))
    .mutation(async ({ input }) => {
      return licenseService.activateLicense(input.activationKey);
    }),
});

export const appRouter = t.router({
  auth: authRouter,
  health: healthRouter,
  inventory: inventoryRouter,
  cash: cashRouter,
  customers: customerRouter,
  sales: salesRouter,
  users: usersRouter,
  config: configRouter,
  purchase: purchaseRouter,
  quotes: quoteRouter,
  export: exportRouter,
  audit: auditRouter,
  branches: branchRouter,
  labels: labelRouter,
  payroll: payrollRouter,

  backup: backupRouter,
  migration: migrationRouter,
  license: licenseRouter,
});

export type AppRouter = typeof appRouter;
