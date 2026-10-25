/**
 * Convierte lo que el usuario escribió en «Logo (URL o ruta)» en una dirección que la interfaz puede
 * mostrar. Devuelve null si no se entiende (queda la inicial del negocio).
 *
 *  - https://…            se usa tal cual (hace falta internet; con http no se muestra por seguridad)
 *  - C:\Users\…\logo.png  ruta de Windows: se convierte a file:///C:/Users/…/logo.png
 *  - \\servidor\carpeta\… ruta de red
 *  - file:///…            se usa tal cual
 *  - data:image/…         imagen incrustada
 */
export function resolveLogoSource(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim().replace(/^["']|["']$/g, '');
  if (!value) return null;

  if (/^https:\/\//i.test(value)) return value;
  if (/^file:\/\//i.test(value)) return value;
  if (/^data:image\//i.test(value)) return value;

  const isDrivePath = /^[a-zA-Z]:[\\/]/.test(value);
  const isNetworkPath = value.startsWith('\\\\');
  if (isDrivePath || isNetworkPath) {
    const segments = value.split('\\').join('/').split('/');
    const encoded = segments.map((segment, index) => (index === 0 && /^[a-zA-Z]:$/.test(segment) ? segment : encodeURIComponent(segment)));
    return 'file:///' + encoded.join('/');
  }

  return null;
}
