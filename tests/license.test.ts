import { generateKeyPairSync, sign } from 'crypto';
import { describe, expect, it, vi } from 'vitest';

const testKeyPair = generateKeyPairSync('ed25519');
const TEST_PUBLIC_KEY = testKeyPair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const otherKeyPair = generateKeyPairSync('ed25519');

function signLicense(fingerprint: string, expiryDate: string, key = testKeyPair.privateKey): string {
  return sign(null, Buffer.from(`${fingerprint}|${expiryDate}`, 'utf8'), key).toString('base64');
}

function makeLicense(fingerprint: string, expiryDate: string, key = testKeyPair.privateKey) {
  return { fingerprint, expiryDate, signature: signLicense(fingerprint, expiryDate, key) };
}

// LICENSE_PUBLIC_KEY se lee al importar el módulo; recargamos el módulo con el
// entorno deseado para cada caso. Un valor vacío fuerza el estado "sin clave".
async function loadService(publicKey?: string): Promise<typeof import('../app/main/services/license.service')> {
  if (publicKey === undefined) {
    delete process.env.LICENSE_PUBLIC_KEY;
  } else {
    process.env.LICENSE_PUBLIC_KEY = publicKey;
  }
  vi.resetModules();
  return import('../app/main/services/license.service');
}

describe('LicenseService (fail closed sin clave pública)', () => {
  it('rechaza toda licencia si no hay una clave pública configurada', async () => {
    const { LicenseService } = await loadService('');
    const service = new LicenseService();
    const license = makeLicense('a'.repeat(64), '2030-12-31T23:59:59.000Z');
    const result = service.validateLicense(license, 'a'.repeat(64));
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('LICENSE_PUBLIC_KEY');
  });
});

describe('LicenseService (con clave pública configurada)', () => {
  it('acepta una licencia firmada con la clave privada correspondiente', async () => {
    const { LicenseService } = await loadService(TEST_PUBLIC_KEY);
    const service = new LicenseService();
    const fingerprint = 'a'.repeat(64);
    const license = makeLicense(fingerprint, '2030-12-31T23:59:59.000Z');
    const result = service.validateLicense(license, fingerprint);
    expect(result.valid).toBe(true);
  });

  it('rechaza una licencia firmada con otra clave', async () => {
    const { LicenseService } = await loadService(TEST_PUBLIC_KEY);
    const service = new LicenseService();
    const fingerprint = 'a'.repeat(64);
    const license = makeLicense(fingerprint, '2030-12-31T23:59:59.000Z', otherKeyPair.privateKey);
    const result = service.validateLicense(license, fingerprint);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('La firma de la licencia no es válida.');
  });

  it('rechaza una licencia emitida para otro equipo', async () => {
    const { LicenseService } = await loadService(TEST_PUBLIC_KEY);
    const service = new LicenseService();
    const fingerprint = 'a'.repeat(64);
    const license = makeLicense(fingerprint, '2030-12-31T23:59:59.000Z');
    const result = service.validateLicense(license, 'b'.repeat(64));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('El fingerprint no coincide con este equipo.');
  });

  it('rechaza licencias vencidas', async () => {
    const { LicenseService } = await loadService(TEST_PUBLIC_KEY);
    const service = new LicenseService();
    const fingerprint = 'a'.repeat(64);
    const license = makeLicense(fingerprint, '2020-01-01T00:00:00.000Z');
    const result = service.validateLicense(license, fingerprint);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('expiró');
  });
});