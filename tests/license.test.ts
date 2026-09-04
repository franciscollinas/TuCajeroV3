import { createHmac } from 'crypto';
import { describe, expect, it, vi } from 'vitest';

const TEST_SECRET = 'test-license-secret-0123456789';

function sign(fingerprint: string, expiryDate: string, secret: string): string {
  return createHmac('sha256', secret).update(`${fingerprint}|${expiryDate}`).digest('hex');
}

function makeLicense(fingerprint: string, expiryDate: string, secret: string) {
  return { fingerprint, expiryDate, signature: sign(fingerprint, expiryDate, secret) };
}

// LICENSE_SECRET se lee al importar el módulo; recargamos el módulo con el
// entorno deseado para cada caso.
async function loadService(secret?: string): Promise<typeof import('../app/main/services/license.service')> {
  if (secret === undefined) {
    delete process.env.LICENSE_SECRET;
  } else {
    process.env.LICENSE_SECRET = secret;
  }
  vi.resetModules();
  return import('../app/main/services/license.service');
}

describe('LicenseService (fail closed sin secreto)', () => {
  it('rechaza toda licencia si LICENSE_SECRET no está configurado', async () => {
    const { LicenseService } = await loadService();
    const service = new LicenseService();
    const license = makeLicense('a'.repeat(64), '2030-12-31T23:59:59.000Z', 'cualquier-secreto');
    const result = service.validateLicense(license, 'a'.repeat(64));
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('LICENSE_SECRET');
  });
});

describe('LicenseService (con secreto configurado)', () => {
  it('acepta una licencia firmada con el secreto configurado', async () => {
    const { LicenseService } = await loadService(TEST_SECRET);
    const service = new LicenseService();
    const fingerprint = 'a'.repeat(64);
    const license = makeLicense(fingerprint, '2030-12-31T23:59:59.000Z', TEST_SECRET);
    const result = service.validateLicense(license, fingerprint);
    expect(result.valid).toBe(true);
  });

  it('rechaza una licencia firmada con otro secreto', async () => {
    const { LicenseService } = await loadService(TEST_SECRET);
    const service = new LicenseService();
    const fingerprint = 'a'.repeat(64);
    const license = makeLicense(fingerprint, '2030-12-31T23:59:59.000Z', 'otro-secreto');
    const result = service.validateLicense(license, fingerprint);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('La firma de la licencia no es válida.');
  });

  it('rechaza una licencia emitida para otro equipo', async () => {
    const { LicenseService } = await loadService(TEST_SECRET);
    const service = new LicenseService();
    const fingerprint = 'a'.repeat(64);
    const license = makeLicense(fingerprint, '2030-12-31T23:59:59.000Z', TEST_SECRET);
    const result = service.validateLicense(license, 'b'.repeat(64));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('El fingerprint no coincide con este equipo.');
  });

  it('rechaza licencias vencidas', async () => {
    const { LicenseService } = await loadService(TEST_SECRET);
    const service = new LicenseService();
    const fingerprint = 'a'.repeat(64);
    const license = makeLicense(fingerprint, '2020-01-01T00:00:00.000Z', TEST_SECRET);
    const result = service.validateLicense(license, fingerprint);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('expiró');
  });
});
