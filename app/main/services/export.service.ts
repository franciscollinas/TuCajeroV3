import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { getDatabase, schema } from '../db';
import { eq, and, gte, lte, desc } from 'drizzle-orm';
import ExcelJS from 'exceljs';

const EXPORTS_DIR = join(process.cwd(), 'exports');

export class ExportService {
  private ensureDir(sub: string): string {
    const dir = join(EXPORTS_DIR, sub);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }

  async exportInventory(format: 'csv' | 'xlsx' = 'csv', accountId?: number | null): Promise<string> {
    const db = getDatabase();
    const dir = this.ensureDir(format);
    const ts = new Date().toISOString().slice(0, 10);
    const fileName = `inventario_${ts}.${format}`;
    const filePath = join(dir, fileName);

    const products = await db
      .select({
        id: schema.products.id,
        code: schema.products.code,
        barcode: schema.products.barcode,
        name: schema.products.name,
        categoryName: schema.categories.name,
        price: schema.products.price,
        cost: schema.products.cost,
        stock: schema.products.stock,
        minStock: schema.products.minStock,
        criticalStock: schema.products.criticalStock,
        taxRate: schema.products.taxRate,
        unitType: schema.products.unitType,
        isActive: schema.products.isActive,
        location: schema.products.location,
        expiryDate: schema.products.expiryDate,
      })
      .from(schema.products)
      .leftJoin(schema.categories, eq(schema.products.categoryId, schema.categories.id))
      .where(accountId ? eq(schema.products.accountId, accountId) : undefined)
      .orderBy(schema.products.name);

    const rows = products.map((p) => ({
      Código: p.code,
      'Código Barras': p.barcode ?? '',
      Nombre: p.name,
      Categoría: p.categoryName ?? '',
      Precio: p.price,
      Costo: p.cost,
      Stock: p.stock,
      'Stock Mínimo': p.minStock,
      'Stock Crítico': p.criticalStock,
      'IVA %': (p.taxRate * 100).toFixed(0),
      Unidad: p.unitType,
      Activo: p.isActive ? 'Sí' : 'No',
      Ubicación: p.location ?? '',
      Vencimiento: p.expiryDate ?? '',
    }));

    if (format === 'xlsx') {
      await this.writeXlsx(rows, filePath, 'Inventario');
    } else {
      this.writeCsv(rows, filePath);
    }
    return filePath;
  }

  async exportSales(dateFrom?: string, dateTo?: string, branchId?: number, format: 'csv' | 'xlsx' = 'csv', accountId?: number | null): Promise<string> {
    const db = getDatabase();
    const dir = this.ensureDir(format);
    const ts = new Date().toISOString().slice(0, 10);
    const fileName = `ventas_${ts}.${format}`;
    const filePath = join(dir, fileName);

    const conditions = [eq(schema.sales.status, 'COMPLETED')];
    if (dateFrom) conditions.push(gte(schema.sales.createdAt, dateFrom));
    if (dateTo) conditions.push(lte(schema.sales.createdAt, dateTo + 'T23:59:59'));
    if (branchId) conditions.push(eq(schema.sales.branchId, branchId));
    if (accountId) conditions.push(eq(schema.sales.accountId, accountId));

    const sales = await db
      .select()
      .from(schema.sales)
      .where(and(...conditions))
      .orderBy(desc(schema.sales.createdAt));

    const rowsData = await Promise.all(
      sales.map(async (s) => {
        const [user] = await db
          .select({ fullName: schema.users.fullName })
          .from(schema.users)
          .where(eq(schema.users.id, s.userId))
          .limit(1);
        let customerName = '';
        if (s.customerId) {
          const [c] = await db
            .select({ name: schema.customers.name })
            .from(schema.customers)
            .where(eq(schema.customers.id, s.customerId))
            .limit(1);
          if (c) customerName = c.name;
        }
        const payments = await db
          .select()
          .from(schema.payments)
          .where(eq(schema.payments.saleId, s.id));
        const methods = payments.map((p) => `${p.method}: $${p.amount.toLocaleString('es-CO')}`).join(' | ');
        return {
          'N° Factura': s.saleNumber,
          Fecha: new Date(s.createdAt).toLocaleString('es-CO'),
          Vendedor: user?.fullName ?? '',
          Cliente: customerName,
          Subtotal: s.subtotal,
          IVA: s.tax,
          Descuento: s.discount,
          Delivery: s.deliveryFee,
          Total: s.total,
          'Método Pago': methods,
          Estado: s.status,
        };
      }),
    );

    if (format === 'xlsx') {
      await this.writeXlsx(rowsData, filePath, 'Ventas');
    } else {
      this.writeCsv(rowsData, filePath);
    }
    return filePath;
  }

  async exportPayroll(userId: number, periodStart: string, periodEnd: string, format: 'csv' | 'xlsx' = 'csv', accountId?: number | null): Promise<string> {
    const dir = this.ensureDir(format);
    const fileName = `nomina_${periodStart}_${periodEnd}.${format}`;
    const filePath = join(dir, fileName);

    const { PayrollService } = await import('./payroll.service');
    const payrollService = new PayrollService();
    // Infer period from date range duration
    const startMs = new Date(periodStart).getTime();
    const endMs = new Date(periodEnd).getTime();
    const daysDiff = (endMs - startMs) / (1000 * 60 * 60 * 24);
    const inferredPeriod = daysDiff <= 1 ? 'daily' : daysDiff <= 8 ? 'weekly' : 'monthly';
    const result = await payrollService.getPayroll(inferredPeriod, periodStart, periodEnd, accountId);

    const rows = result.users.map((u) => ({
      Empleado: u.fullName,
      Usuario: u.username,
      'Tarifa Hora': u.hourlyRate,
      Días: u.totalDays,
      Horas: u.totalWorkedHours.toFixed(2),
      'Pago Total': u.totalPayAmount.toFixed(2),
      Ventas: u.totalSalesAmount.toFixed(2),
    }));

    const totals = {
      Empleado: 'TOTALES',
      Usuario: '',
      'Tarifa Hora': '',
      Días: result.users.reduce((s, u) => s + u.totalDays, 0),
      Horas: result.grandTotalHours.toFixed(2),
      'Pago Total': result.grandTotalPay.toFixed(2),
      Ventas: result.grandTotalSales.toFixed(2),
    };

    if (format === 'xlsx') {
      await this.writeXlsx(rows, filePath, 'Nómina', totals);
    } else {
      const header = Object.keys(rows[0] || {}).join(';');
      const csvRows = rows.map((r) => Object.values(r).join(';'));
      const footer = Object.values(totals).join(';');
      writeFileSync(filePath, '\uFEFF' + header + '\n' + csvRows.join('\n') + '\n' + footer, 'utf-8');
    }
    return filePath;
  }

  async exportAudit(startDate?: string, endDate?: string, format: 'csv' | 'xlsx' = 'csv', accountId?: number | null): Promise<string> {
    const { AuditService } = await import('./audit.service');
    const auditService = new AuditService();
    const logs = await auditService.getAuditLogs({ startDate, endDate, limit: 5000, accountId });

    const rows = logs.map((l) => ({
      ID: l.id,
      Fecha: l.date ? new Date(l.date).toLocaleString('es-CO') : '',
      Usuario: l.user ?? '',
      Acción: l.action,
      Entidad: l.entity,
      Detalle: l.details ?? '',
    }));

    const dir = this.ensureDir(format);
    const ts = new Date().toISOString().slice(0, 10);
    const fileName = `auditoria_${ts}.${format}`;
    const filePath = join(dir, fileName);

    if (format === 'xlsx') {
      await this.writeXlsx(rows, filePath, 'Auditoría');
    } else {
      this.writeCsv(rows, filePath);
    }
    return filePath;
  }

  async exportCashSessions(startDate?: string, endDate?: string, format: 'csv' | 'xlsx' = 'csv', accountId?: number | null): Promise<string> {
    const db = getDatabase();
    const dir = this.ensureDir(format);
    const ts = new Date().toISOString().slice(0, 10);
    const fileName = `cierres_caja_${ts}.${format}`;
    const filePath = join(dir, fileName);

    const conditions: ReturnType<typeof gte>[] = [];
    if (startDate) conditions.push(gte(schema.cashSessions.closedAt, startDate));
    if (endDate) conditions.push(lte(schema.cashSessions.closedAt, endDate + 'T23:59:59'));

    const query = db
      .select({
        id: schema.cashSessions.id,
        userId: schema.cashSessions.userId,
        openedAt: schema.cashSessions.openedAt,
        closedAt: schema.cashSessions.closedAt,
        status: schema.cashSessions.status,
        initialCash: schema.cashSessions.initialCash,
        expectedCash: schema.cashSessions.expectedCash,
        finalCash: schema.cashSessions.finalCash,
        difference: schema.cashSessions.difference,
      })
      .from(schema.cashSessions);

    if (accountId) {
      query.innerJoin(schema.users, eq(schema.cashSessions.userId, schema.users.id));
      conditions.push(eq(schema.users.accountId, accountId));
    }

    const sessions = await query
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.cashSessions.closedAt))
      .limit(2000);

    const rowsData = await Promise.all(
      sessions.map(async (s) => {
        const [user] = await db
          .select({ fullName: schema.users.fullName })
          .from(schema.users)
          .where(eq(schema.users.id, s.userId))
          .limit(1);
        const sales = await db
          .select({ total: schema.sales.total })
          .from(schema.sales)
          .where(and(eq(schema.sales.cashSessionId, s.id), eq(schema.sales.status, 'COMPLETED')));
        const totalSales = sales.reduce((sum, sale) => sum + Number(sale.total), 0);
        return {
          '#': s.id,
          Cajero: user?.fullName ?? '',
          Apertura: s.openedAt ? new Date(s.openedAt).toLocaleString('es-CO') : '',
          Cierre: s.closedAt ? new Date(s.closedAt).toLocaleString('es-CO') : '',
          Estado: s.status,
          'Efectivo Inicial': s.initialCash,
          'Efectivo Esperado': s.expectedCash ?? 0,
          'Efectivo Final': s.finalCash ?? 0,
          Diferencia: s.difference ?? 0,
          'Total Ventas': totalSales,
        };
      }),
    );

    if (format === 'xlsx') {
      await this.writeXlsx(rowsData, filePath, 'Cierres de Caja');
    } else {
      this.writeCsv(rowsData, filePath);
    }
    return filePath;
  }

  async exportNoRotation(format: 'csv' | 'xlsx' = 'csv', accountId?: number | null): Promise<string> {
    const db = getDatabase();
    const dir = this.ensureDir(format);
    const ts = new Date().toISOString().slice(0, 10);
    const fileName = `sin_rotacion_${ts}.${format}`;
    const filePath = join(dir, fileName);

    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const minSaleDate = ninetyDaysAgo.toISOString();

    const products = await db
      .select({
        id: schema.products.id,
        code: schema.products.code,
        name: schema.products.name,
        stock: schema.products.stock,
        cost: schema.products.cost,
        price: schema.products.price,
        categoryName: schema.categories.name,
      })
      .from(schema.products)
      .leftJoin(schema.categories, eq(schema.products.categoryId, schema.categories.id))
      .where(and(eq(schema.products.isActive, true), ...(accountId ? [eq(schema.products.accountId, accountId)] : [])));

    const soldInPeriod = await db
      .selectDistinct({ productId: schema.saleItems.productId })
      .from(schema.saleItems)
      .innerJoin(schema.sales, eq(schema.saleItems.saleId, schema.sales.id))
      .where(and(gte(schema.sales.createdAt, minSaleDate), ...(accountId ? [eq(schema.sales.accountId, accountId)] : [])));

    const soldIds = new Set(soldInPeriod.map((s) => s.productId));
    const noRotation = products
      .filter((p) => p.stock > 0 && !soldIds.has(p.id))
      .map((p) => ({
        Código: p.code,
        Nombre: p.name,
        Categoría: p.categoryName ?? '',
        Stock: p.stock,
        'Costo Unit.': Number(p.cost),
        Precio: Number(p.price),
        'Costo Total': Number(p.stock) * Number(p.cost),
      }))
      .sort((a, b) => Number(b['Costo Total']) - Number(a['Costo Total']));

    if (format === 'xlsx') {
      await this.writeXlsx(noRotation, filePath, 'Sin Rotación');
    } else {
      this.writeCsv(noRotation, filePath);
    }
    return filePath;
  }

  private async writeXlsx(rows: Record<string, unknown>[], filePath: string, sheetName: string, footerRow?: Record<string, unknown>): Promise<void> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(sheetName);
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];

    sheet.columns = headers.map((key) => ({
      header: key,
      key,
      width: Math.max(14, key.length + 2),
    }));

    rows.forEach((row) => sheet.addRow(row));
    if (footerRow) {
      const footer = sheet.addRow(footerRow);
      footer.eachCell((cell) => { cell.font = { bold: true }; });
    }

    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF465FFF' } };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    await workbook.xlsx.writeFile(filePath);
  }

  private writeCsv(rows: Record<string, unknown>[], filePath: string): void {
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    const escape = (val: unknown): string => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      return /[",;\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const lines = [headers.join(';'), ...rows.map((r) => headers.map((h) => escape(r[h])).join(';'))];
    writeFileSync(filePath, '\uFEFF' + lines.join('\n') + '\n', 'utf-8');
  }
}
