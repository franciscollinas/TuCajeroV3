// Clave de activación corta que el KeyGen entrega al cliente: TC1-XXXXX-XXXXX-…
//
// Base32 Crockford (sin I, L, O, U), insensible a mayúsculas, a guiones y a
// espacios. Lleva solo la fecha de vencimiento (4 bytes, segundos UTC) y la
// firma Ed25519 (64 bytes). La huella NO viaja en la clave: la app la recalcula
// de su propio equipo, de modo que una clave solo valida en el equipo para el
// que se firmó. Debe coincidir con KeyGen/license.js.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PREFIX = 'TC1';
const PAYLOAD_BYTES = 68;
const CODE_CHARS = Math.ceil((PAYLOAD_BYTES * 8) / 5);

export interface DecodedActivationCode {
  expiryDate: string;
  /** Firma Ed25519 en base64. */
  signature: string;
}

// Mayúsculas, sin separadores y con los caracteres ambiguos resueltos (O→0, I/L→1).
function normalize(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

// ¿El texto parece contener una clave (aunque esté incompleta)? Un JSON nunca se
// trata como clave.
export function looksLikeActivationCode(input: string): boolean {
  return !input.trim().startsWith('{') && normalize(input).includes(PREFIX);
}

export function encodeActivationCode({ expiryDate, signature }: DecodedActivationCode): string {
  const seconds = Math.floor(new Date(expiryDate).getTime() / 1000);
  const sig = Buffer.from(signature, 'base64');
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 0xffffffff || sig.length !== 64) {
    throw new Error('No se puede codificar la licencia como clave.');
  }
  const payload = Buffer.alloc(PAYLOAD_BYTES);
  payload.writeUInt32BE(seconds, 0);
  sig.copy(payload, 4);

  let bits = 0;
  let acc = 0;
  let out = '';
  for (const byte of payload) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(acc << (5 - bits)) & 31];
  return [PREFIX, ...(out.match(/.{1,5}/g) ?? [])].join('-');
}

function decodeBody(body: string): DecodedActivationCode | null {
  if (body.length !== CODE_CHARS) return null;
  const bytes: number[] = [];
  let bits = 0;
  let acc = 0;
  for (const ch of body) {
    const value = ALPHABET.indexOf(ch);
    if (value === -1) return null;
    acc = (acc << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bytes.push((acc >>> (bits - 8)) & 255);
      bits -= 8;
    }
    acc &= (1 << bits) - 1;
  }
  if (bytes.length !== PAYLOAD_BYTES) return null;

  const payload = Buffer.from(bytes);
  return {
    expiryDate: new Date(payload.readUInt32BE(0) * 1000).toISOString(),
    signature: payload.subarray(4).toString('base64'),
  };
}

/**
 * Busca una clave dentro del texto (puede venir con el resto de un mensaje de
 * WhatsApp). Devuelve los datos o null si no hay una clave completa y bien formada.
 */
export function decodeActivationCode(input: string): DecodedActivationCode | null {
  const text = normalize(input);
  for (let from = text.indexOf(PREFIX); from !== -1; from = text.indexOf(PREFIX, from + 1)) {
    const decoded = decodeBody(text.slice(from + PREFIX.length, from + PREFIX.length + CODE_CHARS));
    if (decoded) return decoded;
  }
  return null;
}
