import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import PDFDocument from 'pdfkit';
import { getDatabase, schema } from '../db';
import { eq } from 'drizzle-orm';
import { ConfigService } from './config.service';
import { AppError, ErrorCode } from '../utils/errors';

const INVOICES_DIR = join(process.cwd(), 'invoices');

export class InvoiceService {
  private configService = new ConfigService();

  private ensureDir(): void {
    if (!existsSync(INVOICES_DIR)) {
      mkdirSync(INVOICES_DIR, { recursive: true });
    }
  }

  async generateInvoice(saleId: number): Promise<{ path: string; fileName: string }> {
    const db = getDatabase();
    const config = await this.configService.getBusinessConfig(1);

    const sale = await db
      .select()
      .from(schema.sales)
      .where(eq(schema.sales.id, saleId))
      .limit(1);

    if (!sale[0]) throw new AppError(ErrorCode.NOT_FOUND, 'Venta no encontrada');

    const items = await db
      .select()
      .from(schema.saleItems)
      .where(eq(schema.saleItems.saleId, saleId));

    const payments = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.saleId, saleId));

    const user = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, sale[0].userId))
      .limit(1);

    this.ensureDir();
    const fileName = `factura_${sale[0].saleNumber.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
    const filePath = join(INVOICES_DIR, fileName);

    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: `Factura #${sale[0].saleNumber}`,
        Author: config.businessName,
        Subject: 'Factura de venta',
      },
    });

    const buffers: Buffer[] = [];
    await new Promise<void>(async (resolve, reject) => {
      doc.on('data', (chunk: Buffer) => buffers.push(chunk));
      doc.on('end', () => {
        try {
          writeFileSync(filePath, Buffer.concat(buffers));
          resolve();
        } catch (err) {
          reject(err);
        }
      });
      doc.on('error', reject);

      // Colors
      const brandColor = '#465fff';
      const gray900 = '#101828';
      const gray700 = '#344054';
      const gray500 = '#667085';
      const gray200 = '#e4e7ec';

    // Header
    doc.fontSize(24).font('Helvetica-Bold').fillColor(brandColor).text(config.businessName, 50, 50);
    doc.fontSize(10).font('Helvetica').fillColor(gray500)
      .text(`NIT: ${config.nit}`, 50, 80)
      .text(config.address || '', 50, 95)
      .text(`Tel: ${config.phone}`, 50, 110)
      .text(`Email: ${config.email}`, 50, 125);

    // Invoice number
    doc.fontSize(16).font('Helvetica-Bold').fillColor(gray900)
      .text(`FACTURA #${sale[0].saleNumber}`, 400, 50, { align: 'right' });
    doc.fontSize(10).font('Helvetica').fillColor(gray500)
      .text(`Fecha: ${new Date(sale[0].createdAt).toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
        400, 75, { align: 'right' })
      .text(`Vendedor: ${user[0]?.fullName || `#${sale[0].userId}`}`, 400, 90, { align: 'right' });

    // Divider
    doc.moveTo(50, 155).lineTo(545, 155).strokeColor(gray200).stroke();

    // Customer info
    if (sale[0].customerId) {
      const customer = await db
        .select()
        .from(schema.customers)
        .where(eq(schema.customers.id, sale[0].customerId!))
        .limit(1);
      if (customer[0]) {
        doc.fontSize(11).font('Helvetica-Bold').fillColor(gray700).text('Cliente:', 50, 170);
        doc.fontSize(10).font('Helvetica').fillColor(gray900)
          .text(customer[0].name, 50, 185)
          .text(customer[0].phone || '', 50, 200);
      }
    }

    // Table header
    const tableTop = 230;
    doc.fontSize(9).font('Helvetica-Bold').fillColor(gray500);
    doc.text('Producto', 50, tableTop);
    doc.text('Cant.', 350, tableTop, { width: 40, align: 'center' });
    doc.text('Precio', 390, tableTop, { width: 60, align: 'right' });
    doc.text('Total', 490, tableTop, { width: 55, align: 'right' });

    doc.moveTo(50, tableTop + 15).lineTo(545, tableTop + 15).strokeColor(gray200).stroke();

    // Table rows
    let y = tableTop + 25;
    doc.fontSize(10).font('Helvetica').fillColor(gray900);
    for (const item of items) {
      const product = await db
        .select()
        .from(schema.products)
        .where(eq(schema.products.id, item.productId))
        .limit(1);

      if (y > 700) {
        doc.addPage();
        y = 50;
      }

      doc.text(product[0]?.name || `Producto #${item.productId}`, 50, y, { width: 290 });
      doc.text(String(item.quantity), 350, y, { width: 40, align: 'center' });
      doc.text(`$${Number(item.unitPrice).toLocaleString('es-CO')}`, 390, y, { width: 60, align: 'right' });
      doc.text(`$${Number(item.total).toLocaleString('es-CO')}`, 490, y, { width: 55, align: 'right' });
      y += 20;
    }

    // Totals
    y += 10;
    doc.moveTo(350, y).lineTo(545, y).strokeColor(gray200).stroke();
    y += 10;

    const totals = [
      { label: 'Subtotal', value: sale[0].subtotal },
      { label: 'IVA', value: sale[0].tax },
    ];
    if (sale[0].discount > 0) totals.push({ label: 'Descuento', value: -sale[0].discount });
    if (sale[0].deliveryFee > 0) totals.push({ label: 'Delivery', value: sale[0].deliveryFee });

    for (const t of totals) {
      doc.fontSize(10).font(t.label === 'Subtotal' ? 'Helvetica' : 'Helvetica').fillColor(gray700)
        .text(t.label, 350, y, { width: 140, align: 'left' });
      const val = t.value < 0 ? `-$${Math.abs(t.value).toLocaleString('es-CO')}` : `$${Number(t.value).toLocaleString('es-CO')}`;
      doc.text(val, 490, y, { width: 55, align: 'right' });
      y += 18;
    }

    doc.moveTo(350, y).lineTo(545, y).strokeColor(brandColor).stroke();
    y += 8;
    doc.fontSize(14).font('Helvetica-Bold').fillColor(brandColor)
      .text('TOTAL', 350, y, { width: 140, align: 'left' });
    doc.text(`$${Number(sale[0].total).toLocaleString('es-CO')}`, 490, y, { width: 55, align: 'right' });

    // Payment methods
    y += 30;
    doc.fontSize(10).font('Helvetica-Bold').fillColor(gray700).text('Métodos de pago:', 50, y);
    y += 16;
    doc.fontSize(9).font('Helvetica').fillColor(gray500);
    const methodLabels: Record<string, string> = {
      efectivo: 'Efectivo', nequi: 'Nequi', daviplata: 'Daviplata',
      tarjeta: 'Tarjeta', transferencia: 'Transferencia', credito: 'Crédito',
    };
    for (const p of payments) {
      doc.text(`${methodLabels[p.method] || p.method}: $${Number(p.amount).toLocaleString('es-CO')}`, 50, y);
      y += 14;
    }

    // Footer
    doc.fontSize(8).fillColor(gray500).text(
      'Esta factura se asimila en todos sus efectos legales a una factura de venta electrónica.',
      50, 780, { align: 'center' }
    );

    doc.end();
    });

    return { path: filePath, fileName };
  }
}
