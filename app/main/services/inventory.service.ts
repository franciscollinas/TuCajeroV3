import { eq, and, or, like, gt, gte, inArray, desc, asc, sum, sql } from 'drizzle-orm';

import { getDatabase, schema } from '../db';
import { ErrorCode, AppError } from '../utils/errors';
import { nowISO } from '../utils/date';
import { AuditService } from './audit.service';
import type {
  Product,
  ProductDetail,
  ProductInput,
  Category,
  StockMovement,
  StockMovementType,
  StockAlerts,
  ExpiryAlerts,
  StockAdjustmentResult,
  BulkImportRow,
  BulkImportResult,
} from '../../renderer/src/shared/types/inventory.types';

const auditService = new AuditService();
const COVERAGE_DAYS = 30;
const STOCK_MANAGER_ROLES = ['ADMIN', 'SUPERVISOR'];

function mapProduct(row: {
  id: number;
  code: string;
  barcode: string | null;
  name: string;
  description: string | null;
  categoryId: number | null;
  categoryName: string;
  categoryColor: string | null;
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
  salesLast30Days?: number;
}): Product {
  return {
    id: row.id,
    code: row.code,
    barcode: row.barcode,
    name: row.name,
    description: row.description,
    categoryId: row.categoryId,
    category: {
      id: row.categoryId || 0,
      name: row.categoryName,
      color: row.categoryColor,
      createdAt: '',
      updatedAt: '',
    } as Category,
    price: row.price,
    cost: row.cost,
    stock: row.stock,
    minStock: row.minStock,
    criticalStock: row.criticalStock,
    taxRate: row.taxRate,
    suggestedPurchaseQty: row.suggestedPurchaseQty,
    expiryDate: row.expiryDate,
    location: row.location,
    unitType: row.unitType,
    conversionFactor: row.conversionFactor,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    stockMovements: [],
    salesLast30Days: row.salesLast30Days,
  };
}

function mapStockMovement(row: {
  id: number;
  productId: number;
  type: string;
  quantity: number;
  previousStock: number;
  newStock: number;
  reason: string | null;
  userId: number;
  createdAt: string;
}): StockMovement {
  const allowedTypes: readonly StockMovementType[] = ['entrada', 'salida', 'ajuste', 'venta'];
  const type = allowedTypes.includes(row.type as StockMovementType)
    ? (row.type as StockMovementType)
    : 'ajuste';

  return {
    id: row.id,
    productId: row.productId,
    type,
    quantity: row.quantity,
    previousStock: row.previousStock,
    newStock: row.newStock,
    reason: row.reason,
    userId: row.userId,
    createdAt: row.createdAt,
  };
}

function parseImportNumber(value: string | number | undefined, fallback = 0): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === 'string') {
    const normalized = value
      .trim()
      .replace(/\$/g, '')
      .replace(/\s/g, '')
      .replace(/\./g, '')
      .replace(/,/g, '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function parseImportDate(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const date = new Date(trimmed);
    if (Number.isFinite(date.getTime())) {
      return trimmed;
    }
  }
  const ddMmYyyyMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddMmYyyyMatch) {
    const [, day, month, year] = ddMmYyyyMatch;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    if (Number.isFinite(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  }
  const date = new Date(trimmed);
  if (Number.isFinite(date.getTime())) {
    return date.toISOString().split('T')[0];
  }
  return null;
}

function normalizeBarcode(barcode: string | null | undefined): string | null {
  if (!barcode || typeof barcode !== 'string') {
    return null;
  }
  const clean = barcode.trim();
  // Only reject barcodes that look like Excel scientific notation (e.g., 5.02E+12)
  if (/^\d+\.?\d*[eE][+-]?\d+$/.test(clean)) {
    return null;
  }
  if (!clean) {
    return null;
  }
  return clean;
}

function buildLikePattern(query: string): string {
  const escaped = query.replace(/%/g, '\\%').replace(/_/g, '\\_');
  return `%${escaped}%`;
}

export class InventoryService {
  private async requireStockManager(userId: number): Promise<void> {
    const db = getDatabase();
    const [user] = await db
      .select({ role: schema.users.role, active: schema.users.active })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (!user || !user.active || !STOCK_MANAGER_ROLES.includes(user.role)) {
      throw new AppError(ErrorCode.FORBIDDEN, 'No tienes permisos para gestionar inventario.');
    }
  }

  async getCategories(accountId: number | null): Promise<Category[]> {
    const db = getDatabase();
    const rows = await db
      .select()
      .from(schema.categories)
      .where(accountId ? eq(schema.categories.accountId, accountId) : undefined)
      .orderBy(asc(schema.categories.name));

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async getAllProducts(options?: {
    page?: number;
    pageSize?: number;
    search?: string;
    categoryId?: number;
    orderBySales?: boolean;
  }, accountId?: number | null): Promise<Product[]> {
    const db = getDatabase();
    const { page, pageSize, search, categoryId, orderBySales } = options || {};

    const conditions = [eq(schema.products.isActive, true)];
    if (accountId) {
      conditions.push(eq(schema.products.accountId, accountId));
    }
    if (search) {
      const pattern = buildLikePattern(search);
      conditions.push(
        or(
          like(schema.products.name, pattern),
          like(schema.products.code, pattern),
          like(schema.products.barcode, pattern),
        )!,
      );
    }
    if (categoryId) {
      conditions.push(eq(schema.products.categoryId, categoryId));
    }

    const baseFilter = and(...conditions);

    let rows: unknown[];

    if (orderBySales && !search && !categoryId) {
      const thirtyDaysAgo = new Date(Date.now() - COVERAGE_DAYS * 24 * 60 * 60 * 1000).toISOString();

      const salesRanking = await db
        .select({
          productId: schema.saleItems.productId,
          totalQty: sum(schema.saleItems.quantity).mapWith(Number),
        })
        .from(schema.saleItems)
        .innerJoin(schema.sales, eq(schema.saleItems.saleId, schema.sales.id))
          .where(
            and(
              eq(schema.sales.status, 'COMPLETED'),
              gte(schema.sales.createdAt, thirtyDaysAgo),
              ...(accountId ? [eq(schema.sales.accountId, accountId)] : []),
            ),
          )
          .groupBy(schema.saleItems.productId)
          .orderBy(desc(sum(schema.saleItems.quantity)))
          .limit(300);

      const topIds = salesRanking.map((r) => r.productId);

      const allProducts = await db
        .select({
          id: schema.products.id,
          code: schema.products.code,
          barcode: schema.products.barcode,
          name: schema.products.name,
          description: schema.products.description,
          categoryId: schema.products.categoryId,
          categoryName: schema.categories.name,
          categoryColor: schema.categories.color,
          price: schema.products.price,
          cost: schema.products.cost,
          stock: schema.products.stock,
          minStock: schema.products.minStock,
          criticalStock: schema.products.criticalStock,
          taxRate: schema.products.taxRate,
          suggestedPurchaseQty: schema.products.suggestedPurchaseQty,
          expiryDate: schema.products.expiryDate,
          location: schema.products.location,
          unitType: schema.products.unitType,
          conversionFactor: schema.products.conversionFactor,
          isActive: schema.products.isActive,
          createdAt: schema.products.createdAt,
          updatedAt: schema.products.updatedAt,
        })
        .from(schema.products)
        .innerJoin(schema.categories, eq(schema.products.categoryId, schema.categories.id))
        .where(and(eq(schema.products.isActive, true), ...(accountId ? [eq(schema.products.accountId, accountId)] : []), ...(topIds.length ? [inArray(schema.products.id, topIds)] : [])))
        .orderBy(asc(schema.products.name));

      const topProducts = topIds
        .map((id) => allProducts.find((p) => p.id === id))
        .filter((p): p is (typeof allProducts)[0] => !!p);

      const others = topIds.length
        ? allProducts.filter((p) => !topIds.includes(p.id))
        : allProducts;

      rows = [...topProducts, ...others];

      if (page && pageSize) {
        rows = rows.slice((page - 1) * pageSize, page * pageSize);
      } else if (pageSize) {
        rows = rows.slice(0, pageSize);
      }
    } else {
      rows = await db
        .select({
          id: schema.products.id,
          code: schema.products.code,
          barcode: schema.products.barcode,
          name: schema.products.name,
          description: schema.products.description,
          categoryId: schema.products.categoryId,
          categoryName: schema.categories.name,
          categoryColor: schema.categories.color,
          price: schema.products.price,
          cost: schema.products.cost,
          stock: schema.products.stock,
          minStock: schema.products.minStock,
          criticalStock: schema.products.criticalStock,
          taxRate: schema.products.taxRate,
          suggestedPurchaseQty: schema.products.suggestedPurchaseQty,
          expiryDate: schema.products.expiryDate,
          location: schema.products.location,
          unitType: schema.products.unitType,
          conversionFactor: schema.products.conversionFactor,
          isActive: schema.products.isActive,
          createdAt: schema.products.createdAt,
          updatedAt: schema.products.updatedAt,
        })
        .from(schema.products)
        .innerJoin(schema.categories, eq(schema.products.categoryId, schema.categories.id))
        .where(baseFilter)
        .orderBy(asc(schema.products.name))
        .limit(pageSize ?? 99999)
        .offset(page && pageSize ? (page - 1) * pageSize : 0);
    }

    const thirtyDaysAgo = new Date(Date.now() - COVERAGE_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const salesAgg = await db
      .select({
        productId: schema.saleItems.productId,
        totalQty: sum(schema.saleItems.quantity).mapWith(Number),
      })
      .from(schema.saleItems)
      .innerJoin(schema.sales, eq(schema.saleItems.saleId, schema.sales.id))
      .where(
        and(
          eq(schema.sales.status, 'COMPLETED'),
          gte(schema.sales.createdAt, thirtyDaysAgo),
          ...(accountId ? [eq(schema.sales.accountId, accountId)] : []),
        ),
      )
      .groupBy(schema.saleItems.productId);

    const salesMap = new Map<number, number>();
    salesAgg.forEach((item) => {
      salesMap.set(item.productId, item.totalQty || 0);
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (rows as any[]).map((row) =>
      mapProduct({ ...row, salesLast30Days: salesMap.get(row.id) || 0 }),
    );
  }

  async getProductById(id: number, accountId?: number | null): Promise<ProductDetail> {
    const db = getDatabase();

    const [product] = await db
      .select({
        id: schema.products.id,
        code: schema.products.code,
        barcode: schema.products.barcode,
        name: schema.products.name,
        description: schema.products.description,
        categoryId: schema.products.categoryId,
        categoryName: schema.categories.name,
        categoryColor: schema.categories.color,
        price: schema.products.price,
        cost: schema.products.cost,
        stock: schema.products.stock,
        minStock: schema.products.minStock,
        criticalStock: schema.products.criticalStock,
        taxRate: schema.products.taxRate,
        suggestedPurchaseQty: schema.products.suggestedPurchaseQty,
        expiryDate: schema.products.expiryDate,
        location: schema.products.location,
        unitType: schema.products.unitType,
        conversionFactor: schema.products.conversionFactor,
        isActive: schema.products.isActive,
        createdAt: schema.products.createdAt,
        updatedAt: schema.products.updatedAt,
      })
      .from(schema.products)
      .innerJoin(schema.categories, eq(schema.products.categoryId, schema.categories.id))
      .where(and(eq(schema.products.id, id), ...(accountId ? [eq(schema.products.accountId, accountId)] : [])))
      .limit(1);

    if (!product) {
      throw new AppError(ErrorCode.PRODUCT_NOT_FOUND, 'Producto no encontrado.');
    }

    const movements = await db
      .select()
      .from(schema.stockMovements)
      .where(eq(schema.stockMovements.productId, id))
      .orderBy(desc(schema.stockMovements.createdAt))
      .limit(10);

    const result = mapProduct(product);
    result.stockMovements = movements.map(mapStockMovement);
    return result as ProductDetail;
  }

  async getProductByBarcode(barcode: string, accountId?: number | null): Promise<Product | null> {
    const db = getDatabase();

    const [product] = await db
      .select({
        id: schema.products.id,
        code: schema.products.code,
        barcode: schema.products.barcode,
        name: schema.products.name,
        description: schema.products.description,
        categoryId: schema.products.categoryId,
        categoryName: schema.categories.name,
        categoryColor: schema.categories.color,
        price: schema.products.price,
        cost: schema.products.cost,
        stock: schema.products.stock,
        minStock: schema.products.minStock,
        criticalStock: schema.products.criticalStock,
        taxRate: schema.products.taxRate,
        suggestedPurchaseQty: schema.products.suggestedPurchaseQty,
        expiryDate: schema.products.expiryDate,
        location: schema.products.location,
        unitType: schema.products.unitType,
        conversionFactor: schema.products.conversionFactor,
        isActive: schema.products.isActive,
        createdAt: schema.products.createdAt,
        updatedAt: schema.products.updatedAt,
      })
      .from(schema.products)
      .innerJoin(schema.categories, eq(schema.products.categoryId, schema.categories.id))
      .where(and(eq(schema.products.barcode, barcode), ...(accountId ? [eq(schema.products.accountId, accountId)] : [])))
      .limit(1);

    return product ? mapProduct(product) : null;
  }

  async createProduct(data: ProductInput, accountId?: number | null): Promise<Product> {
    const db = getDatabase();

    const existing = await db
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(
        and(
          ...(accountId ? [eq(schema.products.accountId, accountId)] : []),
          or(
            eq(schema.products.code, data.code),
            ...(data.barcode ? [eq(schema.products.barcode, data.barcode)] : []),
          ),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      throw new AppError(
        ErrorCode.DUPLICATE_CODE,
        'Ya existe un producto con ese código o barcode.',
      );
    }

    const categoryId = await this.resolveCategory(data);
    const now = nowISO();

    const [product] = await db
      .insert(schema.products)
      .values({
        accountId: accountId ?? null,
        code: data.code,
        barcode: data.barcode ?? null,
        name: data.name,
        description: data.description ?? null,
        categoryId,
        price: data.price,
        cost: data.cost,
        stock: data.stock,
        minStock: data.minStock ?? 5,
        criticalStock: data.criticalStock ?? 2,
        taxRate: data.taxRate ?? 0.19,
        suggestedPurchaseQty: data.suggestedPurchaseQty ?? null,
        expiryDate: data.expiryDate ?? null,
        location: data.location ?? null,
        unitType: data.unitType ?? 'UNIT',
        conversionFactor: data.conversionFactor ?? 1,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (data.stock > 0) {
      await db.insert(schema.stockMovements).values({
        productId: product.id,
        type: 'entrada',
        quantity: data.stock,
        previousStock: 0,
        newStock: data.stock,
        reason: 'Stock inicial',
        userId: data.userId,
        createdAt: now,
      });
    }

    await auditService.log({
      userId: data.userId,
      action: 'product:created',
      entity: 'Product',
      entityId: product.id,
      payload: { code: product.code, name: product.name, stock: product.stock },
    });

    const fullProduct = await this.getProductById(product.id, accountId);
    return fullProduct;
  }

  async updateProduct(id: number, data: Partial<ProductInput>, accountId?: number | null): Promise<Product> {
    const db = getDatabase();

    const categoryId = data.categoryId || data.categoryName
      ? await this.resolveCategory(data, accountId)
      : undefined;

    const { stock: _, ...safeData } = data;
    void _;

    const now = nowISO();

    await db
      .update(schema.products)
      .set({
        code: safeData.code,
        barcode: safeData.barcode ?? undefined,
        name: safeData.name,
        description: safeData.description ?? undefined,
        categoryId,
        price: safeData.price,
        cost: safeData.cost,
        minStock: safeData.minStock,
        criticalStock: safeData.criticalStock,
        taxRate: safeData.taxRate,
        suggestedPurchaseQty: safeData.suggestedPurchaseQty ?? undefined,
        expiryDate: safeData.expiryDate ?? undefined,
        location: safeData.location ?? undefined,
        unitType: safeData.unitType,
        conversionFactor: safeData.conversionFactor,
        updatedAt: now,
      })
      .where(and(eq(schema.products.id, id), ...(accountId ? [eq(schema.products.accountId, accountId)] : [])));

    const fullProduct = await this.getProductById(id, accountId);
    return fullProduct;
  }

  async deleteProduct(id: number, accountId?: number | null): Promise<Product> {
    const db = getDatabase();

    const now = nowISO();
    await db
      .update(schema.products)
      .set({ isActive: false, updatedAt: now })
      .where(and(eq(schema.products.id, id), ...(accountId ? [eq(schema.products.accountId, accountId)] : [])));

    return this.getProductById(id, accountId);
  }

  async adjustStock(
    productId: number,
    quantity: number,
    reason: string,
    userId: number,
    accountId?: number | null,
  ): Promise<StockAdjustmentResult> {
    await this.requireStockManager(userId);
    const db = getDatabase();
    const now = nowISO();

    const [product] = await db
      .select({ id: schema.products.id, stock: schema.products.stock })
      .from(schema.products)
      .where(and(eq(schema.products.id, productId), ...(accountId ? [eq(schema.products.accountId, accountId)] : [])))
      .limit(1);

    if (!product) {
      throw new AppError(ErrorCode.PRODUCT_NOT_FOUND, 'Producto no encontrado.');
    }

    const newStock = product.stock + quantity;

    if (newStock < 0) {
      throw new AppError(ErrorCode.INSUFFICIENT_STOCK, 'El stock no puede quedar negativo.');
    }

    await db.transaction((tx) => {
      tx.update(schema.products)
        .set({ stock: newStock, updatedAt: now })
        .where(eq(schema.products.id, productId))
        .run();

       tx.insert(schema.stockMovements)
        .values({
          accountId: accountId ?? null,
          productId,
          type: quantity >= 0 ? 'entrada' : 'salida',
          quantity: Math.abs(quantity),
          previousStock: product.stock,
          newStock,
          reason,
          userId,
          createdAt: now,
        })
        .run();
    });

    await auditService.log({
      userId,
      action: 'product:stock-adjusted',
      entity: 'Product',
      entityId: productId,
      payload: {
        quantity,
        reason,
        previousStock: product.stock,
        newStock,
      },
    });

    return { previousStock: product.stock, newStock };
  }

  async registerStockMovement(data: {
    productId: number;
    type: string;
    quantity: number;
    previousStock: number;
    newStock: number;
    reason?: string;
    userId: number;
  }): Promise<StockMovement> {
    const db = getDatabase();
    const now = nowISO();

    const [movement] = await db
      .insert(schema.stockMovements)
      .values({
        productId: data.productId,
        type: data.type,
        quantity: data.quantity,
        previousStock: data.previousStock,
        newStock: data.newStock,
        reason: data.reason ?? null,
        userId: data.userId,
        createdAt: now,
      })
      .returning();

    return mapStockMovement(movement);
  }

  async getStockAlerts(_branchId?: number, accountId?: number | null): Promise<StockAlerts> {
    const db = getDatabase();

    const rows = await db
      .select({
        id: schema.products.id,
        code: schema.products.code,
        barcode: schema.products.barcode,
        name: schema.products.name,
        description: schema.products.description,
        categoryId: schema.products.categoryId,
        categoryName: schema.categories.name,
        categoryColor: schema.categories.color,
        price: schema.products.price,
        cost: schema.products.cost,
        stock: schema.products.stock,
        minStock: schema.products.minStock,
        criticalStock: schema.products.criticalStock,
        taxRate: schema.products.taxRate,
        suggestedPurchaseQty: schema.products.suggestedPurchaseQty,
        expiryDate: schema.products.expiryDate,
        location: schema.products.location,
        unitType: schema.products.unitType,
        conversionFactor: schema.products.conversionFactor,
        isActive: schema.products.isActive,
        createdAt: schema.products.createdAt,
        updatedAt: schema.products.updatedAt,
      })
      .from(schema.products)
      .innerJoin(schema.categories, eq(schema.products.categoryId, schema.categories.id))
      .where(and(eq(schema.products.isActive, true), ...(accountId ? [eq(schema.products.accountId, accountId)] : [])));

    const mapped = rows.map((r) => mapProduct(r));

    return {
      critical: mapped.filter((p) => p.stock <= p.criticalStock),
      warning: mapped.filter(
        (p) => p.stock > p.criticalStock && p.stock <= p.minStock,
      ),
      ok: mapped.filter((p) => p.stock > p.minStock),
      expired: mapped.filter(
        (p) => p.expiryDate && new Date(p.expiryDate) < new Date(),
      ),
      expiringSoon: mapped.filter((p) => {
        if (!p.expiryDate) return false;
        const today = new Date();
        const next30Days = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
        const expiry = new Date(p.expiryDate);
        return expiry >= today && expiry <= next30Days;
      }),
    };
  }

  async getExpiryAlerts(_branchId?: number, accountId?: number | null): Promise<ExpiryAlerts> {
    const db = getDatabase();

    const rows = await db
      .select({
        id: schema.products.id,
        code: schema.products.code,
        barcode: schema.products.barcode,
        name: schema.products.name,
        description: schema.products.description,
        categoryId: schema.products.categoryId,
        categoryName: schema.categories.name,
        categoryColor: schema.categories.color,
        price: schema.products.price,
        cost: schema.products.cost,
        stock: schema.products.stock,
        minStock: schema.products.minStock,
        criticalStock: schema.products.criticalStock,
        taxRate: schema.products.taxRate,
        suggestedPurchaseQty: schema.products.suggestedPurchaseQty,
        expiryDate: schema.products.expiryDate,
        location: schema.products.location,
        unitType: schema.products.unitType,
        conversionFactor: schema.products.conversionFactor,
        isActive: schema.products.isActive,
        createdAt: schema.products.createdAt,
        updatedAt: schema.products.updatedAt,
      })
      .from(schema.products)
      .innerJoin(schema.categories, eq(schema.products.categoryId, schema.categories.id))
      .where(and(eq(schema.products.isActive, true), sql`${schema.products.expiryDate} IS NOT NULL`, ...(accountId ? [eq(schema.products.accountId, accountId)] : [])));

    const mapped = rows.map((r) => mapProduct(r));
    const now = new Date();
    const next30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    return {
      expired: mapped.filter((p) => p.expiryDate && new Date(p.expiryDate) < now),
      expiringSoon: mapped.filter((p) => {
        if (!p.expiryDate) return false;
        const expiry = new Date(p.expiryDate);
        return expiry >= now && expiry <= next30Days;
      }),
      ok: mapped.filter((p) => {
        if (!p.expiryDate) return false;
        return new Date(p.expiryDate) > next30Days;
      }),
    };
  }

  async bulkImportProducts(products: BulkImportRow[], userId: number, branchId?: number, accountId?: number | null): Promise<BulkImportResult> {
    await this.requireStockManager(userId);

    const results: BulkImportResult = { success: 0, created: 0, updated: 0, errors: [] };
    const db = getDatabase();
    const now = nowISO();

    for (const item of products) {
      try {
        await db.transaction((tx) => {
          let category = tx
            .select()
            .from(schema.categories)
            .where(eq(schema.categories.name, item.category))
            .get();

if (!category) {
               tx.insert(schema.categories)
                  .values({ name: item.category, accountId: accountId ?? null, createdAt: now, updatedAt: now })
                 .run();
               category = tx
                 .select()
                 .from(schema.categories)
                 .where(eq(schema.categories.name, item.category))
                 .get();
             }

          const existing = tx
            .select({ id: schema.products.id, stock: schema.products.stock })
            .from(schema.products)
            .where(eq(schema.products.code, item.code))
            .get();

          const csvStock = Math.trunc(parseImportNumber(item.stock));

          if (existing) {
            tx.update(schema.products)
              .set({
                barcode: normalizeBarcode(item.barcode),
                name: item.name,
                description: item.description || null,
                categoryId: category!.id,
                price: parseImportNumber(item.price),
                cost: parseImportNumber(item.cost),
                minStock: Math.trunc(parseImportNumber(item.minStock, 5)),
                criticalStock: Math.trunc(parseImportNumber(item.criticalStock, 2)),
                expiryDate: parseImportDate(item.expiryDate),
                location: item.location || null,
                updatedAt: now,
              })
              .where(eq(schema.products.id, existing.id))
              .run();

            if (csvStock !== existing.stock) {
              const delta = csvStock - existing.stock;
              tx.update(schema.products)
                .set({ stock: csvStock, updatedAt: now })
                .where(eq(schema.products.id, existing.id))
                .run();

              tx.insert(schema.stockMovements)
                .values({
                  accountId: accountId ?? null,
                  productId: existing.id,
                  type: delta >= 0 ? 'entrada' : 'salida',
                  quantity: Math.abs(delta),
                  previousStock: existing.stock,
                  newStock: csvStock,
                  reason: `Ajuste por importación: ${item.code}`,
                  userId,
                  branchId,
                  createdAt: now,
                })
                .run();
            }

            results.updated = (results.updated ?? 0) + 1;
          } else {
tx.insert(schema.products)
               .values({
                  accountId: accountId ?? null,
                  code: item.code,
                barcode: normalizeBarcode(item.barcode) ?? null,
                name: item.name,
                description: item.description || null,
                categoryId: category!.id,
                price: parseImportNumber(item.price),
                cost: parseImportNumber(item.cost),
                stock: csvStock,
                minStock: Math.trunc(parseImportNumber(item.minStock, 5)),
                criticalStock: Math.trunc(parseImportNumber(item.criticalStock, 2)),
                taxRate: 0,
                expiryDate: parseImportDate(item.expiryDate),
                location: item.location || null,
                isActive: true,
                createdAt: now,
                updatedAt: now,
              })
              .run();

            const created = tx
              .select({ id: schema.products.id, stock: schema.products.stock })
              .from(schema.products)
              .where(eq(schema.products.code, item.code))
              .get();

if (created && csvStock > 0) {
               tx.insert(schema.stockMovements)
                 .values({
                    accountId: accountId ?? null,
                    productId: created.id,
                   type: 'entrada',
                   quantity: csvStock,
                   previousStock: 0,
                   newStock: csvStock,
                   reason: 'Stock inicial por importación',
                   userId,
                   branchId,
                   createdAt: now,
                 })
                 .run();
             }

            results.created = (results.created ?? 0) + 1;
          }

          results.success += 1;
        });
      } catch (error) {
        results.errors.push({
          row: item,
          error: error instanceof Error ? error.message : 'Error desconocido',
        });
      }
    }

    try {
      await auditService.log({
        userId,
        action: 'product:bulk-imported',
        entity: 'Product',
        payload: {
          success: results.success,
          created: results.created,
          updated: results.updated,
          errors: results.errors.length,
        },
      });
    } catch {
      // Ignore audit errors
    }

    return results;
  }

  private async resolveCategory(input: {
    categoryId?: number;
    categoryName?: string;
  }, accountId?: number | null): Promise<number> {
    const db = getDatabase();

    if (input.categoryId) {
      const [existingCat] = await db
        .select({ id: schema.categories.id })
        .from(schema.categories)
        .where(eq(schema.categories.id, input.categoryId))
        .limit(1);

      if (!existingCat) {
        const [firstCategory] = await db
          .select({ id: schema.categories.id })
          .from(schema.categories)
          .where(accountId ? eq(schema.categories.accountId, accountId) : undefined)
          .limit(1);

        if (firstCategory) return firstCategory.id;
        throw new AppError(
          ErrorCode.VALIDATION,
          'No hay categorías disponibles. Crea una categoría primero.',
        );
      }
      return input.categoryId;
    }

    if (!input.categoryName) {
      throw new AppError(ErrorCode.VALIDATION, 'La categoría es obligatoria.');
    }

    const [existing] = await db
      .select({ id: schema.categories.id })
      .from(schema.categories)
      .where(and(eq(schema.categories.name, input.categoryName), ...(accountId ? [eq(schema.categories.accountId, accountId)] : [])))
      .limit(1);

    if (existing) {
      return existing.id;
    }

    const now = nowISO();
    const [created] = await db
      .insert(schema.categories)
      .values({ name: input.categoryName, accountId: accountId ?? null, createdAt: now, updatedAt: now })
      .returning();

    return created.id;
  }

  async getNoRotationProducts(days: number = 90, accountId?: number | null): Promise<Array<{
    id: number;
    code: string;
    name: string;
    stock: number;
    price: number;
    cost: number;
    lastSaleDate: string | null;
    daysWithoutSale: number;
  }>> {
    const db = getDatabase();
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const soldProductIds = db
      .select({ productId: schema.saleItems.productId })
      .from(schema.saleItems)
      .innerJoin(schema.sales, eq(schema.saleItems.saleId, schema.sales.id))
      .where(
        and(
          eq(schema.sales.status, 'COMPLETED'),
          gte(schema.sales.createdAt, cutoff),
          ...(accountId ? [eq(schema.sales.accountId, accountId)] : []),
        ),
      )
      .as('sold');

    const rows = await db
      .select({
        id: schema.products.id,
        code: schema.products.code,
        name: schema.products.name,
        stock: schema.products.stock,
        price: schema.products.price,
        cost: schema.products.cost,
      })
      .from(schema.products)
      .leftJoin(soldProductIds, eq(schema.products.id, soldProductIds.productId))
      .where(
        and(
          eq(schema.products.isActive, true),
          gt(schema.products.stock, 0),
          sql`${soldProductIds.productId} IS NULL`,
        ),
      )
      .orderBy(asc(schema.products.name));

    const lastSaleDates = await Promise.all(
      rows.map(async (row) => {
        const [lastSale] = await db
          .select({ createdAt: schema.sales.createdAt })
          .from(schema.saleItems)
          .innerJoin(schema.sales, eq(schema.saleItems.saleId, schema.sales.id))
          .where(
            and(
              eq(schema.saleItems.productId, row.id),
              eq(schema.sales.status, 'COMPLETED'),
            ),
          )
          .orderBy(desc(schema.sales.createdAt))
          .limit(1);

        return lastSale?.createdAt ?? null;
      }),
    );

    return rows.map((row, i) => ({
      ...row,
      stock: Number(row.stock),
      price: Number(row.price),
      cost: Number(row.cost),
      lastSaleDate: lastSaleDates[i],
      daysWithoutSale: lastSaleDates[i]
        ? Math.floor((Date.now() - new Date(lastSaleDates[i]).getTime()) / (1000 * 60 * 60 * 24))
        : (() => {
            const createdAt = new Date(('createdAt' in row ? (row as { createdAt: string }).createdAt : null) ?? Date.now());
            return Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
          })(),
    }));
  }
}
