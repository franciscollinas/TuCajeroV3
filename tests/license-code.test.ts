import { generateKeyPairSync, sign } from 'crypto';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { decodeActivationCode, encodeActivationCode, looksLikeActivationCode } from '../app/main/services/license-code';

// Vector fijo compartido con KeyGen/test/license.test.js: si alguno de los dos
// lados cambia el formato, ambas suites fallan.
const VECTOR = {
  expiryDate: '2026-10-10T03:59:59.000Z',
  signature: 'AwoRGB8mLTQ7QklQV15lbHN6gYiPlp2kq7K5wMfO1dzj6vH4/wYNFBsiKTA3PkVMU1phaG92fYSLkpmgp661vA==',
  code:
    'TC1-DB4VG-FR318-8HG7S-65MT3-PGJ9A-1BNWS-BCEDX-8324F-JTET9-AXJQ7-0CFKP-NVKHY-NWFRZ-W30T5-0V48M-K0DSY-8N656-PK1D1-QQCZC-4HE99-K857N-TTVR',
};

describe('clave de activación (formato)', () => {
  it('codifica y decodifica el vector compartido', () => {
    expect(encodeActivationCode(VECTOR)).toBe(VECTOR.code);
    expect(decodeActivationCode(VECTOR.code)).toEqual({ expiryDate: VECTOR.expiryDate, signature: VECTOR.signature });
  });

  it('tolera minúsculas, espacios, saltos de línea y O/I/L mal tecleadas', () => {
    const expected = { expiryDate: VECTOR.expiryDate, signature: VECTOR.signature };
    expect(decodeActivationCode(VECTOR.code.toLowerCase())).toEqual(expected);
    expect(decodeActivationCode(VECTOR.code.replace(/-/g, ' '))).toEqual(expected);
    expect(decodeActivationCode(VECTOR.code.replace(/-/g, '\n'))).toEqual(expected);
    expect(decodeActivationCode('  ' + VECTOR.code + '  ')).toEqual(expected);
    expect(decodeActivationCode(VECTOR.code.replace(/0/g, 'O').replace(/1/g, 'l'))).toEqual(expected);
  });

  it('encuentra la clave dentro de un mensaje completo', () => {
    const expected = { expiryDate: VECTOR.expiryDate, signature: VECTOR.signature };
    const message = `Hola Ana 👋
Tu clave de TuCajero:

${VECTOR.code}

Pégala en Licencia → Activar. ¡Gracias!`;
    expect(decodeActivationCode(message)).toEqual(expected);
    expect(looksLikeActivationCode(message)).toBe(true);
  });

  it('rechaza claves incompletas, con caracteres inválidos o de otro tipo', () => {
    expect(decodeActivationCode(VECTOR.code.slice(0, -5))).toBeNull();
    expect(decodeActivationCode(VECTOR.code.replace('DB4VG', 'DB4V#'))).toBeNull();
    expect(decodeActivationCode(VECTOR.code.replace('DB4VG', 'DB4VU'))).toBeNull();
    expect(decodeActivationCode('{"fingerprint":"x"}')).toBeNull();
    expect(decodeActivationCode('')).toBeNull();
  });

  it('distingue una clave de un JSON', () => {
    expect(looksLikeActivationCode(VECTOR.code)).toBe(true);
    expect(looksLikeActivationCode(' tc1-abc ')).toBe(true);
    expect(looksLikeActivationCode('{"fingerprint":"a"}')).toBe(false);
  });
});

const NOW = '2026-01-01T00:00:00.000Z';
const dir = join(tmpdir(), `tucajero-code-${Date.now()}`);
process.env.DATABASE_URL = join(dir, 'test.db');

const keys = generateKeyPairSync('ed25519');
const FP = 'ab12'.repeat(16);

let nativeDbAvailable = true;
try {
  new Database(':memory:').close();
} catch {
  nativeDbAvailable = false;
}
const serviceDescribe = nativeDbAvailable ? describe : describe.skip;

function signedCode(fingerprint: string, expiryDate: string, key = keys.privateKey): string {
  const signature = sign(null, Buffer.from(`${fingerprint}|${expiryDate}`, 'utf8'), key).toString('base64');
  return encodeActivationCode({ expiryDate, signature });
}

serviceDescribe('activación con clave corta', () => {
  let service: InstanceType<typeof import('../app/main/services/license.service').LicenseService>;
  let closeDb: () => void;

  beforeAll(async () => {
    mkdirSync(dir, { recursive: true });
    const sqlite = new Database(process.env.DATABASE_URL as string);
    migrate(drizzle(sqlite), { migrationsFolder: resolve('database/migrations') });
    sqlite.exec(`INSERT INTO "Account" (name, nit, email, createdAt, updatedAt) VALUES ('T', '1', 't@t.com', '${NOW}', '${NOW}')`);
    sqlite.close();

    process.env.LICENSE_PUBLIC_KEY = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    vi.resetModules();
    const { LicenseService } = await import('../app/main/services/license.service');
    service = new LicenseService();
    vi.spyOn(service, 'generateFingerprint').mockResolvedValue({
      cpuInfo: '', diskSerial: '', macAddress: '', hostname: '', fingerprint: FP,
    });
    closeDb = (await import('../app/main/db')).closeDatabase;
  });

  afterAll(() => {
    closeDb?.();
    rmSync(dir, { recursive: true, force: true });
  });

  const future = () => new Date(Date.now() + 90 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, '.000Z');

  it('activa con una clave firmada para este equipo y guarda la licencia en JSON', async () => {
    const expiry = future();
    const result = await service.activateLicense(signedCode(FP, expiry));
    expect(result.valid).toBe(true);
    expect(result.daysRemaining).toBeGreaterThanOrEqual(89);

    const stored = await service.getStoredLicense();
    expect(stored).toEqual({ fingerprint: FP, expiryDate: expiry, signature: expect.any(String) });
  });

  it('acepta la clave pegada con saltos de línea y en minúsculas', async () => {
    const code = signedCode(FP, future());
    const wrapped = code.toLowerCase().replace(/-(?=.{20}-)/g, '\n');
    expect((await service.activateLicense(wrapped)).valid).toBe(true);
  });

  it('rechaza con mensaje claro una clave firmada para otro equipo', async () => {
    await expect(service.activateLicense(signedCode('cd34'.repeat(16), future()))).rejects.toThrow(/no es válida para este equipo/);
  });

  it('rechaza una clave firmada con otra clave privada', async () => {
    const other = generateKeyPairSync('ed25519').privateKey;
    await expect(service.activateLicense(signedCode(FP, future(), other))).rejects.toThrow(/no es válida para este equipo/);
  });

  it('rechaza una clave vencida', async () => {
    const past = new Date(Date.now() - 5 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, '.000Z');
    await expect(service.activateLicense(signedCode(FP, past))).rejects.toThrow(/expiró/);
  });

  it('rechaza una clave incompleta', async () => {
    const code = signedCode(FP, future());
    await expect(service.activateLicense(code.slice(0, 60))).rejects.toThrow(/incompleta|errores/);
  });

  it('sigue aceptando el JSON de las licencias ya emitidas', async () => {
    const expiry = future();
    const signature = sign(null, Buffer.from(`${FP}|${expiry}`, 'utf8'), keys.privateKey).toString('base64');
    const result = await service.activateLicense(JSON.stringify({ fingerprint: FP, expiryDate: expiry, signature }));
    expect(result.valid).toBe(true);
  });

  it('rechaza texto que no es clave ni JSON', async () => {
    await expect(service.activateLicense('hola')).rejects.toThrow(/Formato de licencia inválido/);
  });
});
