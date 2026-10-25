import { TRPCError } from '@trpc/server';

import { LicenseService } from './license.service';

/**
 * La licencia (o la prueba gratuita vigente) se exige aquí, en el programa de fondo.
 * Antes solo la pantalla bloqueaba el uso: quien llamara directamente al puente interno
 * podía seguir trabajando con una licencia vencida.
 */

// Lo mínimo para poder iniciar sesión, ver el estado de la licencia y activarla.
const EXEMPT_PREFIXES = ['auth.', 'license.', 'health.'];
const EXEMPT_PATHS = new Set(['branches.list', 'config.getBusiness', 'config.getAll']);

/** Procedimientos que siguen disponibles con licencia vencida o con cambio de contraseña pendiente. */
export function isGateExempt(path: string): boolean {
  return EXEMPT_PATHS.has(path) || EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix));
}

const CACHE_MS = 30 * 1000;
const licenses = new LicenseService();
let cached: { ok: boolean; at: number } | null = null;

export function resetLicenseGuardCache(): void {
  cached = null;
}

export async function assertLicenseActive(): Promise<void> {
  const now = Date.now();
  if (!cached || now - cached.at > CACHE_MS) {
    const status = await licenses.getLicenseStatus();
    cached = { ok: status.status === 'valid' || status.trial.trialActive, at: now };
  }
  if (!cached.ok) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'La licencia venció o no está activada. Actívala en la sección Licencia para seguir trabajando.',
    });
  }
}
