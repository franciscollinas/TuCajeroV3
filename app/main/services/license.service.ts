import { createHmac, createHash, timingSafeEqual } from 'crypto';
import si from 'systeminformation';
import { eq } from 'drizzle-orm';
import { getDatabase, schema } from '../db';
import { nowISO } from '../utils/date';
import { AppError, ErrorCode } from '../utils/errors';

const LICENSE_SECRET: string = process.env.LICENSE_SECRET ?? (() => { throw new Error('LICENSE_SECRET environment variable is required.'); })();

export interface HardwareFingerprint {
  cpuInfo: string;
  diskSerial: string;
  macAddress: string;
  hostname: string;
  fingerprint: string;
}

export interface LicenseData {
  fingerprint: string;
  expiryDate: string;
  signature: string;
}

export interface LicenseValidation {
  valid: boolean;
  reason?: string;
  expiryDate?: string;
  daysRemaining?: number;
}

export class LicenseService {
  private async getCPUInfo(): Promise<string> {
    const cpu = await si.cpu();
    return `${cpu.manufacturer}|${cpu.brand}|${cpu.cores}`;
  }

  private async getDiskSerial(): Promise<string> {
    const disks = await si.diskLayout();
    return disks.length > 0 ? disks[0].serialNum : '';
  }

  private async getMACAddress(): Promise<string> {
    const interfaces = await si.networkInterfaces();
    const active = interfaces.find(
      (iface) => iface.operstate === 'up' && iface.mac !== '00:00:00:00:00:00' && !iface.internal,
    );
    return active?.mac ?? interfaces[0]?.mac ?? '';
  }

  private getHostname(): string {
    return process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? 'unknown';
  }

  async generateFingerprint(): Promise<HardwareFingerprint> {
    const [cpuInfo, diskSerial, macAddress] = await Promise.all([
      this.getCPUInfo(),
      this.getDiskSerial(),
      this.getMACAddress(),
    ]);
    const hostname = this.getHostname();
    const raw = `${cpuInfo}|${diskSerial}|${macAddress}|${hostname}`;
    const fingerprint = createHash('sha256').update(raw).digest('hex');
    return { cpuInfo, diskSerial, macAddress, hostname, fingerprint };
  }

  async getStoredLicense(): Promise<LicenseData | null> {
    const db = getDatabase();
    const rows = await db
      .select()
      .from(schema.configs)
      .where(eq(schema.configs.key, 'license_data'))
      .limit(1);
    if (!rows[0]) return null;
    try {
      return JSON.parse(rows[0].value) as LicenseData;
    } catch {
      return null;
    }
  }

  async activateLicense(licenseKey: string): Promise<LicenseValidation> {
    let licenseData: LicenseData;
    try {
      licenseData = JSON.parse(licenseKey) as LicenseData;
      if (!licenseData.fingerprint || !licenseData.expiryDate || !licenseData.signature) {
        throw new Error('Formato inválido');
      }
    } catch {
      throw new AppError(ErrorCode.VALIDATION, 'Formato de licencia inválido. Copie el JSON completo generado por keygen.');
    }

    const hw = await this.generateFingerprint();

    const validation = this.validateLicense(licenseData, hw.fingerprint);
    if (!validation.valid) {
      throw new AppError(ErrorCode.VALIDATION, validation.reason ?? 'Licencia inválida.');
    }

    const db = getDatabase();
    const existing = await db
      .select()
      .from(schema.configs)
      .where(eq(schema.configs.key, 'license_data'))
      .limit(1);

    if (existing[0]) {
      await db
        .update(schema.configs)
        .set({ value: licenseKey, updatedAt: nowISO() })
        .where(eq(schema.configs.key, 'license_data'));
    } else {
      await db
        .insert(schema.configs)
        .values({ key: 'license_data', value: licenseKey, updatedAt: nowISO() });
    }

    return validation;
  }

  validateLicense(license: LicenseData, currentFingerprint: string): LicenseValidation {
    if (!this.safeStringCompare(license.fingerprint, currentFingerprint)) {
      return { valid: false, reason: 'El fingerprint no coincide con este equipo.' };
    }

    const expectedSignature = createHmac('sha256', LICENSE_SECRET)
      .update(`${license.fingerprint}|${license.expiryDate}`)
      .digest('hex');

    if (!this.safeStringCompare(license.signature, expectedSignature)) {
      return { valid: false, reason: 'La firma de la licencia no es válida.' };
    }

    const expiryDate = new Date(license.expiryDate);
    if (Number.isNaN(expiryDate.getTime())) {
      return { valid: false, reason: 'La fecha de expiración no es válida.' };
    }

    const now = new Date();
    const daysRemaining = Math.floor((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (now > expiryDate) {
      return { valid: false, reason: `Licencia expiró el ${expiryDate.toLocaleDateString('es-CO')}.`, expiryDate: license.expiryDate, daysRemaining };
    }

    return { valid: true, expiryDate: license.expiryDate, daysRemaining };
  }

  private safeStringCompare(a: string, b: string): boolean {
    const bufA = Buffer.from(a || '', 'utf8');
    const bufB = Buffer.from(b || '', 'utf8');
    if (bufA.length !== bufB.length) {
      const maxLen = Math.max(bufA.length, bufB.length);
      for (let i = 0; i < maxLen; i++) {
        /* constant-time comparison intentionally removed; lengths differ -> not equal */
      }
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  }

  async getLicenseStatus(): Promise<{ status: 'valid' | 'invalid' | 'none'; license: LicenseData | null; validation: LicenseValidation | null }> {
    const stored = await this.getStoredLicense();
    if (!stored) {
      return { status: 'none', license: null, validation: null };
    }
    const hw = await this.generateFingerprint();
    const validation = this.validateLicense(stored, hw.fingerprint);
    return {
      status: validation.valid ? 'valid' : 'invalid',
      license: stored,
      validation,
    };
  }
}
