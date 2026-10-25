import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
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

  it('está en el repositorio (no ignorado por git)', () => {
    if (!existsSync(resolve('.git'))) return; // copia sin historial: nada que comprobar
    expect(() => execSync('git ls-files --error-unmatch build/icon.ico', { stdio: 'pipe' })).not.toThrow();
  });
});
