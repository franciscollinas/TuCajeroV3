import { execSync } from 'child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { describe, expect, it } from 'vitest';

const icon = resolve('build/icon.ico');

// El icono del .exe y del instalador sale de build/icon.ico. Esa carpeta estaba en .gitignore, así que
// la publicación de GitHub no lo tenía y el instalador salía con el logo de Electron. Esto lo vigila.
describe('icono de la aplicación', () => {
  it('existe en build/icon.ico', () => {
    expect(existsSync(icon)).toBe(true);
  });

  it('es un .ico válido con la imagen de 256 px que exige el instalador', () => {
    const bytes = readFileSync(icon);
    expect(bytes.readUInt16LE(0)).toBe(0); // reservado
    expect(bytes.readUInt16LE(2)).toBe(1); // tipo: icono
    const count = bytes.readUInt16LE(4);
    expect(count).toBeGreaterThan(0);
    const sizes = Array.from({ length: count }, (_, i) => bytes[6 + i * 16] || 256);
    expect(sizes).toContain(256);
  });

  it('trae todos los tamaños y los pequeños son imágenes clásicas (las que entienden todas las herramientas)', () => {
    const bytes = readFileSync(icon);
    const count = bytes.readUInt16LE(4);
    const pngSignature = '89504e47';
    for (let i = 0; i < count; i++) {
      const entry = 6 + i * 16;
      const size = bytes[entry] || 256;
      const offset = bytes.readUInt32LE(entry + 12);
      const isPng = bytes.subarray(offset, offset + 4).toString('hex') === pngSignature;
      expect(isPng).toBe(size === 256);
    }
    const sizes = Array.from({ length: count }, (_, i) => bytes[6 + i * 16] || 256);
    expect(sizes).toEqual(expect.arrayContaining([16, 24, 32, 48, 64, 128, 256]));
  });

  it('el icono de la interfaz y el del instalador son el mismo archivo, y el logo oficial está guardado', () => {
    expect(readFileSync(resolve('app/renderer/public/icon.ico')).equals(readFileSync(icon))).toBe(true);
    const logo = readFileSync(resolve('branding/logo-oficial.png'));
    expect(logo.subarray(1, 4).toString()).toBe('PNG');
    expect(logo.readUInt32BE(16)).toBeGreaterThanOrEqual(512);
  });

  it('está en el repositorio (no ignorado por git)', () => {
    if (!existsSync(resolve('.git'))) return; // copia sin historial: nada que comprobar
    expect(() => execSync('git ls-files --error-unmatch build/icon.ico', { stdio: 'pipe' })).not.toThrow();
  });

  // La app instalada abre la interfaz como archivo local (file://): una imagen con ruta que empieza por "/"
  // apunta a la raíz del disco y sale rota. Las imágenes deben calcularse con LOGO_URL (document.baseURI).
  it('ninguna imagen de la interfaz usa una ruta absoluta (se rompería en la app instalada)', () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(name)) files.push(full);
      }
    };
    walk(resolve('app/renderer/src'));
    // <img src="/x.png">, <img src={'/x.png'}> o `src: '/x.png'`
    const absoluteImage = /(?:<img[^>]*\ssrc=|\bsrc:\s*)[{\s]*["'`]\/[a-zA-Z]/;
    const offenders = files.filter((file) => absoluteImage.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
