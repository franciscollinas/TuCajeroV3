import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import PDFDocument from 'pdfkit';
import { getDatabase, schema } from '../db';
import { eq, and } from 'drizzle-orm';

const LABELS_DIR = join(process.cwd(), 'exports', 'labels');

interface LabelProduct {
  id: number;
  name: string;
  code: string;
  barcode: string | null;
  price: number;
}

export class LabelService {
  private ensureDir(): string {
    if (!existsSync(LABELS_DIR)) {
      mkdirSync(LABELS_DIR, { recursive: true });
    }
    return LABELS_DIR;
  }

  async generateLabels(productIds: number[], copiesPerProduct = 1, accountId: number): Promise<string> {
    const db = getDatabase();
    const dir = this.ensureDir();

    const products: LabelProduct[] = [];
    for (const id of productIds) {
      const [product] = await db
        .select({
          id: schema.products.id,
          name: schema.products.name,
          code: schema.products.code,
          barcode: schema.products.barcode,
          price: schema.products.price,
        })
        .from(schema.products)
        .where(and(eq(schema.products.id, id), eq(schema.products.accountId, accountId)))
        .limit(1);

      if (product) products.push(product);
    }

    const fileName = `etiquetas_${Date.now()}.pdf`;
    const filePath = join(dir, fileName);

    const doc = new PDFDocument({
      size: [612, 792],
      margin: 20,
      info: { Title: 'Etiquetas de productos' },
    });

    const buffers: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
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

      // Label size: ~2.83 x 1.18 inches (72mm x 30mm) at 72 DPI
      const labelW = 204;
      const labelH = 85;
      const cols = 2;
      const rows = 8;

      let current = 0;
      for (const product of products) {
        for (let copy = 0; copy < copiesPerProduct; copy++) {
          const pos = current % (cols * rows);

          if (pos === 0 && current > 0) {
            doc.addPage();
          }

          const col = pos % cols;
          const row = Math.floor(pos / cols);
          const x = 20 + col * (labelW + 8);
          const y = 20 + row * (labelH + 6);

          doc.rect(x, y, labelW, labelH).stroke('#cccccc');

          doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000');
          const name = product.name.length > 28 ? product.name.slice(0, 27) + '…' : product.name;
          doc.text(name, x + 6, y + 4, { width: labelW - 40, height: 20 });

          doc.fontSize(14).font('Helvetica-Bold').fillColor('#000000');
          doc.text(`$${Number(product.price).toLocaleString('es-CO')}`, x + 6, y + 24, { width: labelW - 12 });

          doc.fontSize(7).font('Helvetica').fillColor('#666666');
          doc.text(`Cód: ${product.code}`, x + 6, y + 50, { width: labelW - 12 });

          if (product.barcode) {
            doc.fontSize(7).font('Helvetica').fillColor('#666666');
            doc.text(product.barcode, x + 6, y + 62, { width: labelW - 12 });

            const bars = product.barcode.replace(/\D/g, '');
            if (bars.length > 0) {
              const barX = x + labelW - 80;
              const barY = y + 4;
              const barH = 44;
              let bx = barX;
              for (let i = 0; i < Math.min(bars.length, 30); i++) {
                const width = parseInt(bars[i]) % 3 === 0 ? 2 : 1;
                if (parseInt(bars[i]) % 2 === 0) {
                  doc.rect(bx, barY, width, barH).fill('#000000');
                }
                bx += width + 1;
              }
            }
          }

          current++;
        }
      }

      doc.end();
    });
    return filePath;
  }
}
