import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const config = readFileSync(resolve('electron-builder.yml'), 'utf8');
const field = (name: string): string => {
  const match = new RegExp(`^\\s*${name}:\\s*(.+?)\\s*$`, 'm').exec(config);
  return match ? match[1].replace(/^['"]|['"]$/g, '') : '';
};

// V2 y V3 se instalaban con la misma identidad (appId com.tucajero.pos, nombre «TuCajero»): el instalador de
// V3 tomaba a V2 por una versión anterior de la misma aplicación y la desinstalaba. Con identidad propia,
// V3 se instala aparte y V2 sigue ahí por si hace falta volver.
describe('el instalador de V3 no reemplaza a TuCajero V2', () => {
  it('tiene su propio appId, distinto del de V2', () => {
    expect(field('appId')).toBe('com.tucajero.pos.v3');
    expect(field('appId')).not.toBe('com.tucajero.pos');
  });

  it('se instala en su propia carpeta y con su propio acceso directo', () => {
    expect(field('productName')).toBe('TuCajero V3');
    expect(field('shortcutName')).toBe('TuCajero V3');
    expect(field('productName')).not.toBe('TuCajero');
  });

  it('el archivo que se descarga sigue llamándose igual (TuCajero-Setup-<versión>.exe), sin espacios', () => {
    const artifact = field('artifactName');
    expect(artifact).toBe('TuCajero-Setup-${version}.${ext}');
    expect(artifact).not.toContain(' ');
    expect(artifact).not.toContain('${productName}');
  });

  it('desinstalar V3 no borra sus datos', () => {
    expect(field('deleteAppDataOnUninstall')).toBe('false');
  });
});
