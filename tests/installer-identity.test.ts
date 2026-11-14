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
describe('el instalador de la Lite no reemplaza a TuCajero V2 ni a V3', () => {
  it('tiene su propio appId, distinto del de V2', () => {
    expect(field('appId')).toBe('com.tucajero.pos.lite');
    expect(field('appId')).not.toBe('com.tucajero.pos');
    expect(field('appId')).not.toBe('com.tucajero.pos.v3');
  });

  it('se instala en su propia carpeta y con su propio acceso directo', () => {
    expect(field('productName')).toBe('TuCajero Lite');
    expect(field('shortcutName')).toBe('TuCajero Lite');
    expect(field('productName')).not.toBe('TuCajero');
    expect(field('productName')).not.toBe('TuCajero V3');
  });

  it('el archivo que se descarga se llama TuCajero-Lite-Setup-<versión>.exe, sin espacios', () => {
    const artifact = field('artifactName');
    expect(artifact).toBe('TuCajero-Lite-Setup-${version}.${ext}');
    expect(artifact).not.toContain(' ');
    expect(artifact).not.toContain('${productName}');
  });

  it('guarda sus datos en su propia carpeta y no actualiza con las versiones normales', () => {
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { name: string };
    expect(pkg.name).toBe('tucajero-lite'); // la carpeta de datos de Electron sale del nombre del paquete
    expect(field('channel')).toBe('lite');
  });

  it('desinstalar la Lite no borra sus datos', () => {
    expect(field('deleteAppDataOnUninstall')).toBe('false');
  });
});
