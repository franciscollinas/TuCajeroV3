import { writeFileSync } from 'fs';
import net from 'net';
import { eq } from 'drizzle-orm';
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
const WINDOWS_PRINTER_REGEX = /^(\\\\[\w.-]+\\[\w.-]+|[\w.-]+)$/;

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

export class PrinterService {
  async getConfig(): Promise<PrinterConfig> {
    const db = getDatabase();
    const rows = await db
      .select()
      .from(schema.configs)
      .where(eq(schema.configs.key, 'printer_config'))
      .limit(1);

    if (!rows[0]) return DEFAULT_PRINTER;
    try {
      return JSON.parse(rows[0].value) as PrinterConfig;
    } catch {
      return DEFAULT_PRINTER;
    }
  }

  async setConfig(config: PrinterConfig): Promise<PrinterConfig> {
    validateConnectionString(config.type, config.connectionString);

    const db = getDatabase();
    const value = JSON.stringify(config);
    const existing = await db
      .select()
      .from(schema.configs)
      .where(eq(schema.configs.key, 'printer_config'))
      .limit(1);

    if (existing[0]) {
      await db
        .update(schema.configs)
        .set({ value, updatedAt: nowISO() })
        .where(eq(schema.configs.key, 'printer_config'));
    } else {
      await db
        .insert(schema.configs)
        .values({ key: 'printer_config', value, updatedAt: nowISO() });
    }

    return config;
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
        writeFileSync(config.connectionString, data);
      } else if (process.platform === 'win32') {
        writeFileSync('LPT1', data);
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
}
