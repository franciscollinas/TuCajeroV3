import { createHash, createPublicKey, timingSafeEqual, verify as verifySignature } from 'crypto';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import si from 'systeminformation';
import { eq } from 'drizzle-orm';
import { getDatabase, schema } from '../db';
import { nowISO } from '../utils/date';
import { AppError, ErrorCode } from '../utils/errors';
import { getAppDataDir, getDatabasePath, isPackagedApp } from '../utils/paths';
import { resolveLicensePublicKey } from './license-keys';
import { decodeActivationCode, looksLikeActivationCode } from './license-code';

// Clave pública Ed25519 para verificar licencias. En el binario se usa la clave
// embebida (license-keys.ts); se puede sobreescribir con LICENSE_PUBLIC_KEY
// (base64 SPKI o PEM) para tests. El KeyGen firma con la clave privada
// correspondiente, que nunca se distribuye ni se incrusta en la app.
const LICENSE_PUBLIC_KEY = (() => {
  const value = resolveLicensePublicKey();
  if (!value) return null;
  try {
    if (value.includes('-----BEGIN')) return createPublicKey(value);
    return createPublicKey({ key: Buffer.from(value, 'base64'), format: 'der', type: 'spki' });
  } catch {
    return null;
  }
})();

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

  // Acepta la clave corta del KeyGen (TC1-XXXXX-…) o, para licencias ya emitidas,
  // el JSON completo { fingerprint, expiryDate, signature }.
  async activateLicense(licenseKey: string): Promise<LicenseValidation> {
    const input = licenseKey.trim();
    const isCode = looksLikeActivationCode(input);

    let parsed: LicenseData | null = null;
    let decoded: ReturnType<typeof decodeActivationCode> = null;
    if (isCode) {
      decoded = decodeActivationCode(input);
      if (!decoded) {
        throw new AppError(
          ErrorCode.VALIDATION,
          'La clave está incompleta o tiene errores. Cópiela de nuevo completa, desde TC1- hasta el final.',
        );
      }
    } else {
      try {
        parsed = JSON.parse(input) as LicenseData;
        if (!parsed.fingerprint || !parsed.expiryDate || !parsed.signature) {
          throw new Error('Formato inválido');
        }
      } catch {
        throw new AppError(
          ErrorCode.VALIDATION,
          'Formato de licencia inválido. Pegue la clave completa (empieza por TC1-) o el JSON completo generado por el KeyGen.',
        );
      }
    }

    const hw = await this.generateFingerprint();

    // La clave corta no trae la huella: se asume la de este equipo, de modo que
    // solo valida si fue firmada para él.
    const licenseData: LicenseData = decoded ? { fingerprint: hw.fingerprint, ...decoded } : (parsed as LicenseData);
    const storedValue = decoded ? JSON.stringify(licenseData) : licenseKey;

    const validation = this.validateLicense(licenseData, hw.fingerprint);
    if (!validation.valid) {
      const reason =
        decoded && validation.reason?.includes('firma')
          ? 'La clave no es válida para este equipo. Compruebe que la huella (fingerprint) enviada sea la de esta computadora y que la clave esté completa.'
          : (validation.reason ?? 'Licencia inválida.');
      throw new AppError(ErrorCode.VALIDATION, reason);
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
        .set({ value: storedValue, updatedAt: nowISO() })
        .where(eq(schema.configs.key, 'license_data'));
    } else {
      await db
        .insert(schema.configs)
        .values({ key: 'license_data', value: storedValue, updatedAt: nowISO() });
    }

    return validation;
  }

  validateLicense(license: LicenseData, currentFingerprint: string): LicenseValidation {
    if (!LICENSE_PUBLIC_KEY) {
      return { valid: false, reason: 'No hay una clave pública de licencia configurada (LICENSE_PUBLIC_KEY).' };
    }

    if (!this.safeStringCompare(license.fingerprint, currentFingerprint)) {
      return { valid: false, reason: 'El fingerprint no coincide con este equipo.' };
    }

    let validSignature = false;
    try {
      const signature = Buffer.from(license.signature || '', 'base64');
      const message = Buffer.from(`${license.fingerprint}|${license.expiryDate}`, 'utf8');
      validSignature = signature.length > 0 && verifySignature(null, message, LICENSE_PUBLIC_KEY, signature);
    } catch {
      validSignature = false;
    }

    if (!validSignature) {
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

  // Marca de la prueba fuera de la base de datos: borrar la fila de la base ya no reinicia la prueba.
  private trialMarkerPath(): string {
    const base = isPackagedApp() ? getAppDataDir() : path.dirname(getDatabasePath());
    return path.join(base, 'tucajero-trial.dat');
  }

  private readTrialMarker(): { firstRunAt?: string; lastSeenAt?: string } {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.trialMarkerPath(), 'utf8')) as { firstRunAt?: string; lastSeenAt?: string };
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private writeTrialMarker(marker: { firstRunAt: string; lastSeenAt: string }): void {
    try {
      fs.mkdirSync(path.dirname(this.trialMarkerPath()), { recursive: true });
      fs.writeFileSync(this.trialMarkerPath(), JSON.stringify(marker), 'utf8');
    } catch {
      // Si no se puede escribir, la prueba sigue contándose con la base de datos.
    }
  }

  private async readConfigValue(key: string): Promise<string | null> {
    const rows = await getDatabase().select().from(schema.configs).where(eq(schema.configs.key, key)).limit(1);
    return rows[0]?.value ?? null;
  }

  private async writeConfigValue(key: string, value: string): Promise<void> {
    const db = getDatabase();
    const existing = await db.select({ id: schema.configs.id }).from(schema.configs).where(eq(schema.configs.key, key)).limit(1);
    if (existing[0]) {
      await db.update(schema.configs).set({ value, updatedAt: nowISO() }).where(eq(schema.configs.key, key));
    } else {
      await db.insert(schema.configs).values({ key, value, updatedAt: nowISO() });
    }
  }

  private async getTrialState(): Promise<LicenseTrialState> {
    const marker = this.readTrialMarker();
    const dbFirstRun = await this.readConfigValue('first_run_at');
    const dbLastSeen = await this.readConfigValue('trial_last_seen_at');

    // El primer uso es la fecha más antigua entre la base y la marca externa.
    const firstRunCandidates = [dbFirstRun, marker.firstRunAt].filter((v): v is string => typeof v === 'string' && v.length > 0);
    const hasInvalidDate = firstRunCandidates.some((v) => Number.isNaN(new Date(v).getTime()));
    const validFirstRuns = firstRunCandidates.filter((v) => !Number.isNaN(new Date(v).getTime())).sort();
    const firstRunDate = hasInvalidDate ? firstRunCandidates.find((v) => Number.isNaN(new Date(v).getTime())) as string : (validFirstRuns[0] ?? nowISO());

    // La última fecha vista impide alargar la prueba atrasando el reloj del equipo.
    const lastSeenMs = Math.max(
      ...[dbLastSeen, marker.lastSeenAt].map((v) => (v ? new Date(v).getTime() : 0)).filter((n) => Number.isFinite(n)),
      0,
    );
    const effectiveNow = Math.max(Date.now(), lastSeenMs);

    if (!hasInvalidDate) {
      if (dbFirstRun !== firstRunDate) await this.writeConfigValue('first_run_at', firstRunDate);
      // Se guarda como máximo una vez por minuto.
      if (effectiveNow - lastSeenMs > 60 * 1000 || marker.firstRunAt !== firstRunDate) {
        const seen = new Date(effectiveNow).toISOString();
        await this.writeConfigValue('trial_last_seen_at', seen);
        this.writeTrialMarker({ firstRunAt: firstRunDate, lastSeenAt: seen });
      }
    }

    const firstRun = new Date(firstRunDate);
    const elapsed = effectiveNow - firstRun.getTime();
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
