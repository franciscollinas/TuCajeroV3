import { createHmac, createHash, timingSafeEqual } from 'crypto';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import si from 'systeminformation';
import { eq } from 'drizzle-orm';
import { getDatabase, schema } from '../db';
import { nowISO } from '../utils/date';
import { AppError, ErrorCode } from '../utils/errors';

// Secreto de firma de licencias. Se inyecta vía entorno (LICENSE_SECRET); sin él
// las licencias no se validan (fail closed), por lo que no es posible
// falsificarlas usando un secreto conocido incrustado en el binario.
const LICENSE_SECRET: string | undefined = process.env.LICENSE_SECRET;

const TRIAL_MS = 24 * 60 * 60 * 1000;

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

export interface LicenseTrialState {
  firstRunDate: string | null;
  trialRemainingHours: number;
  trialRemainingMinutes: number;
  trialRemainingSeconds: number;
  trialActive: boolean;
  trialBlocked: boolean;
}

export interface LicenseStatus {
  status: 'valid' | 'invalid' | 'none';
  license: LicenseData | null;
  validation: LicenseValidation | null;
  trial: LicenseTrialState;
}

export class LicenseService {
  private static legacyImportTried = false;

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
    if (!LICENSE_SECRET) {
      return { valid: false, reason: 'No hay un secreto de licencia configurado (LICENSE_SECRET).' };
    }

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
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  }

  private async getTrialState(): Promise<LicenseTrialState> {
    const db = getDatabase();
    const rows = await db
      .select()
      .from(schema.configs)
      .where(eq(schema.configs.key, 'first_run_at'))
      .limit(1);

    let firstRunDate: string;
    if (rows[0]) {
      firstRunDate = rows[0].value;
    } else {
      firstRunDate = nowISO();
      await db
        .insert(schema.configs)
        .values({ key: 'first_run_at', value: firstRunDate, updatedAt: nowISO() });
    }

    const firstRun = new Date(firstRunDate);
    const elapsed = Date.now() - firstRun.getTime();
    const expired = Number.isNaN(firstRun.getTime()) || elapsed >= TRIAL_MS;

    if (expired) {
      return {
        firstRunDate,
        trialRemainingHours: 0,
        trialRemainingMinutes: 0,
        trialRemainingSeconds: 0,
        trialActive: false,
        trialBlocked: true,
      };
    }

    const remaining = TRIAL_MS - elapsed;
    return {
      firstRunDate,
      trialRemainingHours: Math.floor(remaining / (1000 * 60 * 60)),
      trialRemainingMinutes: Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60)),
      trialRemainingSeconds: Math.floor((remaining % (1000 * 60)) / 1000),
      trialActive: true,
      trialBlocked: false,
    };
  }

  private getLegacyLicensePaths(): string[] {
    // `app` solo existe dentro del runtime de Electron; en tests/run-as-node
    // (ELECTRON_RUN_AS_NODE) el módulo 'electron' no expone la API de la app.
    const appData = typeof app?.getPath === 'function' ? app.getPath('appData') : '';
    if (!appData) return [];
    return [path.join(appData, 'tucajero', 'license.dat'), path.join(appData, 'TuCajero', 'license.dat')];
  }

  private async importLegacyLicenseIfPresent(): Promise<void> {
    if (LicenseService.legacyImportTried) return;
    LicenseService.legacyImportTried = true;

    if (await this.getStoredLicense()) return;

    for (const filePath of this.getLegacyLicensePaths()) {
      let raw: string;
      try {
        raw = fs.readFileSync(filePath, 'utf8');
      } catch {
        continue;
      }

      let license: LicenseData;
      try {
        license = JSON.parse(raw) as LicenseData;
      } catch {
        continue;
      }

      if (!license.fingerprint || !license.expiryDate || !license.signature) continue;

      const hw = await this.generateFingerprint();
      if (!this.validateLicense(license, hw.fingerprint).valid) continue;

      const db = getDatabase();
      await db
        .insert(schema.configs)
        .values({ key: 'license_data', value: JSON.stringify(license), updatedAt: nowISO() });
      return;
    }
  }

  async getLicenseStatus(): Promise<LicenseStatus> {
    await this.importLegacyLicenseIfPresent();

    const stored = await this.getStoredLicense();
    let status: 'valid' | 'invalid' | 'none';
    let license: LicenseData | null = null;
    let validation: LicenseValidation | null = null;

    if (stored) {
      license = stored;
      const hw = await this.generateFingerprint();
      validation = this.validateLicense(stored, hw.fingerprint);
      status = validation.valid ? 'valid' : 'invalid';
    } else {
      status = 'none';
    }

    const trial = await this.getTrialState();
    const valid = status === 'valid';
    return {
      status,
      license,
      validation,
      trial: {
        ...trial,
        trialActive: !valid && trial.trialActive,
        trialBlocked: !valid && trial.trialBlocked,
      },
    };
  }
}
