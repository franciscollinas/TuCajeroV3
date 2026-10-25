import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { resolveLogoSource } from '../app/renderer/src/shared/utils/logo-source';

describe('logo del negocio: qué se escribe y qué se muestra', () => {
  it('una dirección https se usa tal cual', () => {
    expect(resolveLogoSource('https://mantis-box.vercel.app/assets/logo-mantis-box.png')).toBe('https://mantis-box.vercel.app/assets/logo-mantis-box.png');
  });

  it('una ruta de Windows se convierte en una dirección de archivo local', () => {
    expect(resolveLogoSource('C:\\Users\\Mantis Box\\Imágenes\\logo.png')).toBe('file:///C:/Users/Mantis%20Box/Im%C3%A1genes/logo.png');
    expect(resolveLogoSource('D:/logos/mi logo.png')).toBe('file:///D:/logos/mi%20logo.png');
  });

  it('los caracteres que romperían la dirección (# % ?) quedan protegidos', () => {
    expect(resolveLogoSource('C:\\logos\\caja #1 (100%).png')).toBe('file:///C:/logos/caja%20%231%20(100%25).png');
  });

  it('una ruta de red también funciona', () => {
    expect(resolveLogoSource('\\\\servidor\\logos\\negocio.png')).toBe('file://///servidor/logos/negocio.png');
  });

  it('acepta file:// e imágenes incrustadas, y quita comillas y espacios de copiar y pegar', () => {
    expect(resolveLogoSource('file:///C:/logos/a.png')).toBe('file:///C:/logos/a.png');
    expect(resolveLogoSource('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(resolveLogoSource('  "C:\\logos\\a.png"  ')).toBe('file:///C:/logos/a.png');
  });

  it('lo que no se entiende da nada (se ve la inicial del negocio), incluidos http inseguro y rutas relativas', () => {
    for (const value of ['', '   ', null, undefined, 'ruta/al/logo.png', 'http://sitio.com/logo.png', 'javascript:alert(1)', 'logo.png']) {
      expect(resolveLogoSource(value as string)).toBeNull();
    }
  });
});

// La política de contenido está escrita en dos sitios (la página y el proceso principal) y se aplican las
// dos a la vez: si una no deja cargar el logo, no se ve. Tienen que decir lo mismo sobre las imágenes.
describe('política de contenido de las imágenes', () => {
  const imgSrc = (text: string): string => {
    const match = /img-src([^;"]*)/.exec(text);
    return match ? match[1].trim() : '';
  };
  const page = readFileSync(resolve('app/renderer/index.html'), 'utf8');
  const main = readFileSync(resolve('app/main/main.ts'), 'utf8');

  it('la página y el proceso principal permiten lo mismo', () => {
    expect(imgSrc(page)).not.toBe('');
    expect(imgSrc(main)).toBe(imgSrc(page));
  });

  it('permite el logo desde internet (https) y desde el equipo (file), pero no http inseguro', () => {
    const allowed = imgSrc(page).split(' ');
    expect(allowed).toEqual(expect.arrayContaining(["'self'", 'data:', 'file:', 'https:']));
    expect(allowed).not.toContain('http:');
    expect(allowed).not.toContain('*');
  });
});
