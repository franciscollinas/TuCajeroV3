// Clave pública Ed25519 (SPKI, base64) embebida en el binario para verificar
// licencias. El KeyGen firma con la clave privada correspondiente
// (LICENSE_PRIVATE_KEY en KeyGen/.env, que nunca se distribuye).
export const EMBEDDED_LICENSE_PUBLIC_KEY =
  'MCowBQYDK2VwAyEAMVyMnjNbmwuizJD8/NzfvnZ33jwBQS7G1RhtjcHkLLc=';

// En producción se usa la clave embebida; se puede sobreescribir con
// process.env.LICENSE_PUBLIC_KEY (base64 SPKI o PEM) para tests.
export function resolveLicensePublicKey(): string | undefined {
  return process.env.LICENSE_PUBLIC_KEY ?? EMBEDDED_LICENSE_PUBLIC_KEY;
}