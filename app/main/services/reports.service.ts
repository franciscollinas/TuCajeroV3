import { and, count, desc, eq, gte, lt, sql, sum, type SQL } from 'drizzle-orm';

import { getDatabase, schema } from '../db';
import { AppError, ErrorCode } from '../utils/errors';
import { addDays, toLocalIsoDate } from '../utils/date';
import { roundMoney } from '../utils/money';

// Agregados de reportes calculados en la base de datos. Es la única fuente de
// totales, pagos y rankings: Reportes y Dashboard muestran las mismas cifras.
//
// Reglas comunes:
// - Solo ventas COMPLETED de la cuenta (y sucursal, si se indica).
// - Un rango son días locales inclusivos: [medianoche de start, medianoche
//   de end + 1 día) convertidos a ISO para comparar con createdAt (UTC).
// - Los días se agrupan por fecha LOCAL, no por la fecha UTC del ISO.

const MAX_RANGE_DAYS = 1100;

export interface ReportRange {
  /** Primer día (medianoche local). */
  start: Date;
  /** Último día incluido (medianoche local). */
  end: Date;
}

export interface PeriodTotals {
  /** Ventas completadas. */
  sales: number;
  /** Suma de sale.total (incluye IVA). */
  revenue: number;
  /** Costo de lo vendido: sum(cantidad × costo actual del producto). */
  cost: number;
  /** Ganancia = ingresos − IVA − costo. */
  profit: number;
  /** Ganancia / ingresos, en %, con un decimal. */
  marginPct: number;
  avgTicket: number;
}

export interface DayPoint {
  /** AAAA-MM-DD local. */
  date: string;
  sales: number;
  revenue: number;
}

export interface PaymentMixRow {
  method: string;
  label: string;
  total: number;
}

export interface TopProductRow {
  id: number;
  name: string;
  code: string;
  quantity: number;
  total: number;
}

export interface GeneralReport {
  range: { startDate: string; endDate: string };
  previousRange: { startDate: string; endDate: string };
  current: PeriodTotals;
  previous: PeriodTotals;
  salesByDay: DayPoint[];
  paymentMix: PaymentMixRow[];
  topProducts: TopProductRow[];
  inventoryValue: number;
}

export const PAYMENT_LABELS: Record<string, string> = {
  efectivo: 'Efectivo',
  nequi: 'Nequi',
  daviplata: 'Daviplata',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  credito: 'Crédito',
};

const toDayRange = (range: ReportRange) => ({ startDate: toLocalIsoDate(range.start), endDate: toLocalIsoDate(range.end) });

export class ReportsService {
  /** Periodo inmediatamente anterior, de la misma duración. */
  previousRange(range: ReportRange): ReportRange {
    const days = Math.round((range.end.getTime() - range.start.getTime()) / 86_400_000) + 1;
    return { start: addDays(range.start, -days), end: addDays(range.start, -1) };
  }

  private validate(range: ReportRange): void {
    if (Number.isNaN(range.start.getTime()) || Number.isNaN(range.end.getTime())) {
      throw new AppError(ErrorCode.VALIDATION, 'Rango de fechas inválido.');
    }
    if (range.end < range.start) {
      throw new AppError(ErrorCode.VALIDATION, 'La fecha final no puede ser anterior a la inicial.');
    }
    const days = Math.round((range.end.getTime() - range.start.getTime()) / 86_400_000) + 1;
    if (days > MAX_RANGE_DAYS) {
      throw new AppError(ErrorCode.VALIDATION, `El rango máximo es de ${MAX_RANGE_DAYS} días.`);
    }
  }

  private bounds(range: ReportRange): { from: string; to: string } {
    return { from: range.start.toISOString(), to: addDays(range.end, 1).toISOString() };
  }

  private saleFilter(range: ReportRange, accountId: number, branchId?: number): SQL {
    const { from, to } = this.bounds(range);
    const conditions: SQL[] = [
      gte(schema.sales.createdAt, from),
      lt(schema.sales.createdAt, to),
      eq(schema.sales.status, 'COMPLETED'),
      eq(schema.sales.accountId, accountId),
    ];
    if (branchId) conditions.push(eq(schema.sales.branchId, branchId));
    return and(...conditions) as SQL;
  }

  /**
   * Totales del periodo. Los ingresos se suman sobre las ventas y el costo sobre
   * los ítems en consultas separadas: sumar sale.total sobre la unión con los
   * ítems multiplicaba cada venta por su número de productos.
   */
  async getPeriodTotals(range: ReportRange, accountId: number, branchId?: number): Promise<PeriodTotals> {
    this.validate(range);
    const db = getDatabase();
    const where = this.saleFilter(range, accountId, branchId);

    const [salesAgg] = await db
      .select({
        sales: count(schema.sales.id).mapWith(Number),
        revenue: sum(schema.sales.total).mapWith(Number),
        tax: sum(schema.sales.tax).mapWith(Number),
      })
      .from(schema.sales)
      .where(where);

    const [costAgg] = await db
      .select({ cost: sum(sql`${schema.saleItems.quantity} * ${schema.products.cost}`).mapWith(Number) })
      .from(schema.saleItems)
      .innerJoin(schema.sales, eq(schema.sales.id, schema.saleItems.saleId))
      .innerJoin(schema.products, eq(schema.products.id, schema.saleItems.productId))
      .where(where);

    const sales = salesAgg?.sales ?? 0;
    const revenue = roundMoney(salesAgg?.revenue ?? 0);
    const tax = roundMoney(salesAgg?.tax ?? 0);
    const cost = roundMoney(costAgg?.cost ?? 0);
    const profit = revenue - tax - cost;
    return {
      sales,
      revenue,
      cost,
      profit,
      marginPct: revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0,
      avgTicket: sales > 0 ? roundMoney(revenue / sales) : 0,
    };
  }

  /** Ventas por día local, de menor a mayor fecha y con los días sin ventas en cero. */
  async getSalesByDay(range: ReportRange, accountId: number, branchId?: number): Promise<DayPoint[]> {
    this.validate(range);
    const db = getDatabase();
    // Solo dos columnas por venta; la fecha local se calcula aquí, con la zona
    // horaria del equipo, para no depender de cómo la interprete SQLite.
    const rows = await db
      .select({ createdAt: schema.sales.createdAt, total: schema.sales.total })
      .from(schema.sales)
      .where(this.saleFilter(range, accountId, branchId));

    const byDay = new Map<string, DayPoint>();
    for (let day = new Date(range.start); day <= range.end; day = addDays(day, 1)) {
      const key = toLocalIsoDate(day);
      byDay.set(key, { date: key, sales: 0, revenue: 0 });
    }
    for (const row of rows) {
      const point = byDay.get(toLocalIsoDate(new Date(row.createdAt)));
      if (!point) continue;
      point.sales += 1;
      point.revenue += row.total;
    }
    return Array.from(byDay.values()).map((p) => ({ ...p, revenue: roundMoney(p.revenue) }));
  }

  /**
   * Ingresos por método de pago, descontando el cambio devuelto: el efectivo
   * registrado es lo que entregó el cliente, no lo que quedó en caja.
   */
  async getPaymentMix(range: ReportRange, accountId: number, branchId?: number): Promise<PaymentMixRow[]> {
    this.validate(range);
    const db = getDatabase();
    const where = this.saleFilter(range, accountId, branchId);

    const gross = await db
      .select({ method: schema.payments.method, total: sum(schema.payments.amount).mapWith(Number) })
      .from(schema.payments)
      .innerJoin(schema.sales, eq(schema.sales.id, schema.payments.saleId))
      .where(where)
      .groupBy(schema.payments.method);

    // Cambio entregado: por venta, el menor entre el cambio y lo pagado en efectivo.
    const cashPaid = db
      .select({ saleId: schema.payments.saleId, cash: sum(schema.payments.amount).as('cash') })
      .from(schema.payments)
      .where(eq(schema.payments.method, 'efectivo'))
      .groupBy(schema.payments.saleId)
      .as('cash_paid');
    const [changeAgg] = await db
      .select({ change: sum(sql`MIN(${schema.sales.change}, ${cashPaid.cash})`).mapWith(Number) })
      .from(schema.sales)
      .innerJoin(cashPaid, eq(cashPaid.saleId, schema.sales.id))
      .where(where);
    const change = changeAgg?.change ?? 0;

    return gross
      .map((row) => ({
        method: row.method,
        label: PAYMENT_LABELS[row.method] ?? row.method,
        total: roundMoney(row.method === 'efectivo' ? Math.max(0, row.total - change) : row.total),
      }))
      .sort((a, b) => b.total - a.total);
  }

  /** Productos con más ingresos del periodo (en una sola consulta). */
  async getTopProducts(range: ReportRange, accountId: number, limit = 10, branchId?: number): Promise<TopProductRow[]> {
    this.validate(range);
    const db = getDatabase();
    const rows = await db
      .select({
        id: schema.saleItems.productId,
        name: schema.products.name,
        code: schema.products.code,
        quantity: sum(schema.saleItems.quantity).mapWith(Number),
        total: sum(schema.saleItems.total).mapWith(Number),
      })
      .from(schema.saleItems)
      .innerJoin(schema.sales, eq(schema.sales.id, schema.saleItems.saleId))
      .innerJoin(schema.products, eq(schema.products.id, schema.saleItems.productId))
      .where(this.saleFilter(range, accountId, branchId))
      .groupBy(schema.saleItems.productId)
      .orderBy(desc(sum(schema.saleItems.total)))
      .limit(limit);
    return rows.map((r) => ({ ...r, total: roundMoney(r.total) }));
  }

  /** Valor del inventario activo: sum(stock × costo). */
  async getInventoryValue(accountId: number): Promise<number> {
    const db = getDatabase();
    const [row] = await db
      .select({ value: sum(sql`${schema.products.stock} * ${schema.products.cost}`).mapWith(Number) })
      .from(schema.products)
      .where(and(eq(schema.products.isActive, true), eq(schema.products.accountId, accountId)));
    return roundMoney(row?.value ?? 0);
  }

  /** Todo lo que necesita la pestaña General de Reportes, en una sola llamada. */
  async getGeneralReport(range: ReportRange, accountId: number, branchId?: number): Promise<GeneralReport> {
    this.validate(range);
    const previous = this.previousRange(range);
    const [current, previousTotals, salesByDay, paymentMix, topProducts, inventoryValue] = await Promise.all([
      this.getPeriodTotals(range, accountId, branchId),
      this.getPeriodTotals(previous, accountId, branchId),
      this.getSalesByDay(range, accountId, branchId),
      this.getPaymentMix(range, accountId, branchId),
      this.getTopProducts(range, accountId, 10, branchId),
      this.getInventoryValue(accountId),
    ]);
    return {
      range: toDayRange(range),
      previousRange: toDayRange(previous),
      current,
      previous: previousTotals,
      salesByDay,
      paymentMix,
      topProducts,
      inventoryValue,
    };
  }
}
