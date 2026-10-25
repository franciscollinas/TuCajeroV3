import { isPackagedApp } from '../utils/paths';

// Clave pública Ed25519 (SPKI, base64) embebida en el binario para verificar
// licencias. El KeyGen firma con la clave privada correspondiente
// (LICENSE_PRIVATE_KEY en KeyGen/.env, que nunca se distribuye).
export const EMBEDDED_LICENSE_PUBLIC_KEY =
  'MCowBQYDK2VwAyEAMVyMnjNbmwuizJD8/NzfvnZ33jwBQS7G1RhtjcHkLLc=';

// En la app instalada se usa SIEMPRE la clave embebida: un .env junto al ejecutable (o una
// variable de entorno) no puede cambiar con qué clave se verifican las licencias, porque
// quien lo hiciera podría firmar licencias propias. En desarrollo y pruebas se puede
// sobreescribir con LICENSE_PUBLIC_KEY (base64 SPKI o PEM).
export function resolveLicensePublicKey(packaged: boolean = isPackagedApp()): string | undefined {
  if (packaged) return EMBEDDED_LICENSE_PUBLIC_KEY;
  return process.env.LICENSE_PUBLIC_KEY ?? EMBEDDED_LICENSE_PUBLIC_KEY;
}
