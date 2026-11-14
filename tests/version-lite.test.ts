import { readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { describe, expect, it } from 'vitest';

const SRC = resolve('app/renderer/src');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
const files = walk(SRC).filter((f) => /\.(tsx?|css)$/.test(f) && !f.endsWith('lite.css'));
const read = (f: string): string => readFileSync(f, 'utf8');
const offenders = (re: RegExp): string[] => files.filter((f) => re.test(read(f))).map((f) => f.replace(SRC, ''));

// Versión LITE: pensada para equipos viejos (todo-en-uno de 2010, 4 GB). Ningún efecto visual debe volver a entrar.
describe('versión lite: sin efectos visuales', () => {
  it('no define animaciones', () => {
    expect(offenders(/@keyframes/)).toEqual([]);
    expect(offenders(/\banimation(Delay|Duration)?\s*:/)).toEqual([]);
    expect(offenders(/\banimate-\w+/)).toEqual([]);
  });

  it('no usa degradados', () => {
    expect(offenders(/gradient\s*\(/)).toEqual([]);
    expect(offenders(/bg-gradient-/)).toEqual([]);
  });

  it('no usa desenfoques, resplandores ni mezclas', () => {
    expect(offenders(/backdrop-blur|backdrop-filter|backdropFilter/)).toEqual([]);
    expect(offenders(/blur\s*\(|drop-shadow|mix-blend-mode/)).toEqual([]);
  });

  it('no usa tipografías descargadas (se usa la del sistema)', () => {
    expect(offenders(/@fontsource/)).toEqual([]);
    const css = read(join(SRC, 'styles/index.css'));
    expect(css).toMatch(/--font-body:\s*'Segoe UI'/);
  });

  it('las gráficas no se animan', () => {
    for (const f of files.filter((x) => x.endsWith('.tsx'))) {
      for (const m of read(f).matchAll(/<(Pie|Bar|Line|Area)\s[^>]*>?/g)) {
        expect(m[0], `${f}: ${m[0].slice(0, 40)}`).toContain('isAnimationActive={false}');
      }
    }
  });

  it('la hoja lite se carga al final y neutraliza lo escrito en línea', () => {
    const main = read(join(SRC, 'main.tsx'));
    expect(main.indexOf("./styles/lite.css")).toBeGreaterThan(main.indexOf("./styles/index.css"));
    const lite = readFileSync(join(SRC, 'styles/lite.css'), 'utf8');
    for (const prop of ['animation', 'transition', 'box-shadow', 'filter', 'backdrop-filter']) {
      expect(lite).toMatch(new RegExp(`${prop}:\\s*none\\s*!important`));
    }
  });

  it('no hay relojes que repinten cada segundo', () => {
    expect(offenders(/setInterval\([^)]*,\s*1000\)/)).toEqual([]);
  });
});
