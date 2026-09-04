import { unlinkSync, writeFileSync } from 'fs';
import net from 'net';
import { execSync } from 'child_process';
import { and, eq } from 'drizzle-orm';
import { getDatabase, schema } from '../db';
import { nowISO } from '../utils/date';

export interface PrinterConfig {
  type: 'USB' | 'TCP' | 'Windows';
  paperWidth: number;
  characterSet: string;
  connectionString: string;
}

const DEFAULT_PRINTER: PrinterConfig = {
  type: 'USB',
  paperWidth: 80,
  characterSet: 'PC850',
  connectionString: '',
};

const TCP_REGEX = /^[\w.-]+:\d{1,5}$/;
const USB_PATH_REGEX = /^(LPT\d+|COM\d+|\\\\[\w.-]+\\[\w\s.-]+|\.\/printers\/[\w.-]+)$/i;
const WINDOWS_PRINTER_REGEX = /^(\\\\[\w.-]+\\[\w.-]+|[\w][\w\s.()-]*)$/;

function validateConnectionString(type: 'USB' | 'TCP' | 'Windows', connectionString: string): void {
  if (!connectionString || connectionString.length > 260) {
    throw new Error('Cadena de conexión de impresora inválida.');
  }
  if (connectionString.includes('..') || connectionString.includes('\0')) {
    throw new Error('Cadena de conexión contiene caracteres no permitidos.');
  }
  switch (type) {
    case 'TCP':
      if (!TCP_REGEX.test(connectionString)) {
        throw new Error('Formato TCP inválido. Use host:puerto (ej. 192.168.1.100:9100).');
      }
      break;
    case 'USB':
      if (!USB_PATH_REGEX.test(connectionString)) {
        throw new Error('Ruta USB inválida.');
      }
      break;
    case 'Windows':
      if (!WINDOWS_PRINTER_REGEX.test(connectionString)) {
        throw new Error('Ruta de impresora Windows inválida.');
      }
      break;
  }
}

/** Genera datos ESC/POS para un recibo de venta */
function buildReceiptBuffer(
  sale: {
    saleNumber: string;
    total: number;
    subtotal: number;
    tax: number;
    discount: number;
    deliveryFee: number;
    change: number;
    createdAt: string;
    items: Array<{ productName?: string; product?: { name: string }; quantity: number; unitPrice: number; total: number; discount: number }>;
    payments: Array<{ method: string; amount: number }>;
    customer?: { name: string } | null;
    user?: { fullName: string } | null;
  },
  businessConfig: {
    businessName?: string;
    address?: string;
    phone?: string;
    nit?: string;
  },
  paperWidth: number
): Buffer {
  const cols = paperWidth >= 80 ? 42 : 30;
  const div = '-'.repeat(cols);

  const center = Buffer.from([0x1b, 0x61, 0x01]);
  const left   = Buffer.from([0x1b, 0x61, 0x00]);
  const boldOn = Buffer.from([0x1b, 0x45, 0x01]);
  const boldOff= Buffer.from([0x1b, 0x45, 0x00]);
  const init   = Buffer.from([0x1b, 0x40]);
  const cut    = Buffer.from([0x1d, 0x56, 0x00]);

  function line(text: string): Buffer { return Buffer.from(text + '\n'); }
  function padLine(leftTxt: string, rightTxt: string, width: number): string {
    const gap = width - leftTxt.length - rightTxt.length;
    return leftTxt + ' '.repeat(Math.max(1, gap)) + rightTxt;
  }
  function formatAmount(n: number): string {
    return `$${n.toLocaleString('es-CO', { minimumFractionDigits: 0 })}`;
  }

  const METHOD_LABELS: Record<string, string> = {
    efectivo: 'Efectivo', nequi: 'Nequi', daviplata: 'Daviplata',
    tarjeta: 'Tarjeta', transferencia: 'Transferencia', credito: 'Crédito',
  };

  const parts: Buffer[] = [
    init,
    center,
    boldOn,
    line(businessConfig.businessName || 'TuCajero'),
    boldOff,
  ];

  if (businessConfig.address) parts.push(line(businessConfig.address));
  if (businessConfig.phone)   parts.push(line(`Tel: ${businessConfig.phone}`));
  if (businessConfig.nit)     parts.push(line(`NIT: ${businessConfig.nit}`));
  parts.push(line(''));
  parts.push(left);
  parts.push(line(div));

  const dateStr = new Date(sale.createdAt).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
  parts.push(line(padLine('Factura:', sale.saleNumber, cols)));
  parts.push(line(padLine('Fecha:', dateStr, cols)));
  if (sale.customer?.name) parts.push(line(padLine('Cliente:', sale.customer.name.slice(0, cols - 10), cols)));
  if (sale.user?.fullName)  parts.push(line(padLine('Cajero:', sale.user.fullName.slice(0, cols - 10), cols)));
  parts.push(line(div));

  // Items
  for (const item of sale.items) {
    const name = (item.productName ?? item.product?.name ?? 'Producto').slice(0, cols - 2);
    parts.push(boldOn);
    parts.push(line(name));
    parts.push(boldOff);
    const qtyPrice = `  ${item.quantity} x ${formatAmount(item.unitPrice)}`;
    const itemTotal = formatAmount(item.total);
    parts.push(line(padLine(qtyPrice, itemTotal, cols)));
    if (item.discount > 0) {
      parts.push(line(padLine('  Descuento:', `-${formatAmount(item.discount)}`, cols)));
    }
  }
  parts.push(line(div));

  if (sale.discount > 0) parts.push(line(padLine('Descuento global:', `-${formatAmount(sale.discount)}`, cols)));
  if (sale.deliveryFee > 0) parts.push(line(padLine('Domicilio:', formatAmount(sale.deliveryFee), cols)));
  if (sale.tax > 0) parts.push(line(padLine('IVA:', formatAmount(sale.tax), cols)));

  parts.push(boldOn);
  parts.push(line(padLine('TOTAL:', formatAmount(sale.total), cols)));
  parts.push(boldOff);
  parts.push(line(div));

  // Payments
  for (const p of sale.payments) {
    const label = METHOD_LABELS[p.method] || p.method;
    parts.push(line(padLine(label + ':', formatAmount(p.amount), cols)));
  }
  if (sale.change > 0) parts.push(line(padLine('Cambio:', formatAmount(sale.change), cols)));

  parts.push(line(div));
  parts.push(center);
  parts.push(line('\xa1Gracias por su compra!'));
  parts.push(line(''));
  parts.push(line(''));
  parts.push(cut);

  return Buffer.concat(parts);
}

export class PrinterService {
  async getConfig(accountId: number): Promise<PrinterConfig> {
    const db = getDatabase();
    const rows = await db
      .select()
      .from(schema.configs)
      .where(and(eq(schema.configs.key, 'printer_config'), eq(schema.configs.accountId, accountId)))
      .limit(1);

    if (!rows[0]) return DEFAULT_PRINTER;
    try {
      return JSON.parse(rows[0].value) as PrinterConfig;
    } catch {
      return DEFAULT_PRINTER;
    }
  }

  async setConfig(config: PrinterConfig, accountId: number): Promise<PrinterConfig> {
    validateConnectionString(config.type, config.connectionString);

    const db = getDatabase();
    const value = JSON.stringify(config);
    const existing = await db
      .select()
      .from(schema.configs)
      .where(and(eq(schema.configs.key, 'printer_config'), eq(schema.configs.accountId, accountId)))
      .limit(1);

    if (existing[0]) {
      await db
        .update(schema.configs)
        .set({ value, updatedAt: nowISO() })
        .where(and(eq(schema.configs.key, 'printer_config'), eq(schema.configs.accountId, accountId)));
    } else {
      await db
        .insert(schema.configs)
        .values({ accountId, key: 'printer_config', value, updatedAt: nowISO() });
    }

    return config;
  }

  /** Lista las impresoras instaladas en Windows */
  async listWindowsPrinters(): Promise<string[]> {
    if (process.platform !== 'win32') return [];
    try {
      const output = execSync('wmic printer get name /format:list', {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true,
      });
      const printers = output
        .split(/\r?\n/)
        .map((l) => l.replace(/^Name=/, '').trim())
        .filter((l) => l.length > 0);
      return printers;
    } catch {
      try {
        // Fallback: PowerShell
        const ps = execSync(
          'powershell -NoProfile -Command "Get-Printer | Select-Object -ExpandProperty Name"',
          { encoding: 'utf8', timeout: 8000, windowsHide: true }
        );
        return ps.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
      } catch {
        return [];
      }
    }
  }

  /** Imprime un recibo de venta según la configuración guardada */
  async printReceipt(
    sale: Parameters<typeof buildReceiptBuffer>[0],
    businessConfig: Parameters<typeof buildReceiptBuffer>[1],
    accountId: number,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const config = await this.getConfig(accountId);
      const data = buildReceiptBuffer(sale, businessConfig, config.paperWidth);

      if (config.type === 'USB' && config.connectionString) {
        validateConnectionString('USB', config.connectionString);
        writeFileSync(config.connectionString, data);
      } else if (config.type === 'TCP' && config.connectionString) {
        validateConnectionString('TCP', config.connectionString);
        await this.printTcp(config.connectionString, data);
      } else if (config.type === 'Windows' && config.connectionString) {
        validateConnectionString('Windows', config.connectionString);
        await this.printWindows(config.connectionString, data);
      } else {
        return { success: false, message: 'No hay impresora configurada.' };
      }

      return { success: true, message: 'Recibo enviado a la impresora.' };
    } catch (err) {
      return {
        success: false,
        message: `Error al imprimir: ${err instanceof Error ? err.message : 'Error desconocido'}`,
      };
    }
  }

  async testPrint(config: PrinterConfig): Promise<{ success: boolean; message: string }> {
    try {
      if (config.connectionString) {
        validateConnectionString(config.type, config.connectionString);
      }

      const escInit = Buffer.from([0x1b, 0x40]);
      const escCenter = Buffer.from([0x1b, 0x61, 0x01]);
      const escBoldOn = Buffer.from([0x1b, 0x45, 0x01]);
      const escBoldOff = Buffer.from([0x1b, 0x45, 0x00]);
      const escLeft = Buffer.from([0x1b, 0x61, 0x00]);
      const escCut = Buffer.from([0x1d, 0x56, 0x00]);

      const parts = [
        escInit,
        escCenter,
        escBoldOn,
        Buffer.from('TEST DE IMPRESION\n'),
        escBoldOff,
        escLeft,
        Buffer.from('\n'),
        Buffer.from(`Tipo: ${config.type}\n`),
        Buffer.from(`Papel: ${config.paperWidth}mm\n`),
        Buffer.from(`Charset: ${config.characterSet}\n`),
        Buffer.from('\n'),
        escCut,
      ];
      const data = Buffer.concat(parts);

      if (config.type === 'USB' && config.connectionString) {
        writeFileSync(config.connectionString, data);
      } else if (config.type === 'TCP' && config.connectionString) {
        await this.printTcp(config.connectionString, data);
      } else if (config.type === 'Windows' && config.connectionString) {
        await this.printWindows(config.connectionString, data);
      } else {
        return { success: false, message: 'No hay impresora configurada.' };
      }

      return { success: true, message: 'Impresión de prueba enviada correctamente.' };
    } catch (err) {
      return { success: false, message: `Error: ${err instanceof Error ? err.message : 'No se pudo enviar a la impresora'}` };
    }
  }

  private printTcp(host: string, data: Buffer): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const [hostname, portStr] = host.split(':');
      const port = parseInt(portStr || '9100', 10);

      const socket = net.createConnection({ host: hostname, port }, () => {
        socket.write(data, () => {
          socket.end();
          resolve();
        });
      });

      socket.setTimeout(5000);
      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error('Timeout de conexión TCP'));
      });
      socket.on('error', (err: Error) => reject(err));
    });
  }

  /** Imprime en una impresora Windows por nombre usando archivo temporal y copy /b */
  private printWindows(printerName: string, data: Buffer): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        if (printerName.startsWith('\\\\')) {
          writeFileSync(printerName, data);
          resolve();
          return;
        }
        const tmpFile = `${process.env.TEMP || 'C:\\Windows\\Temp'}\\tucajero_receipt_${Date.now()}.bin`;
        writeFileSync(tmpFile, data);
        execSync(
          `copy /b "${tmpFile}" "\\\\%COMPUTERNAME%\\${printerName}"`,
          { windowsHide: true, timeout: 10000, shell: 'cmd.exe' }
        );
        try { unlinkSync(tmpFile); } catch { /* ignore */ }
        resolve();
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Error al imprimir en Windows'));
      }
    });
  }
}
