// Genera los iconos de la app a partir del logo oficial:
//
//   node scripts/make-icons.cjs
//
// Lee branding/logo-oficial.png (PNG con fondo transparente) y escribe:
//   - app/renderer/public/isotipo.png   logo de la interfaz (menú lateral, «Acerca de»)
//   - app/renderer/public/icon.ico       icono de la pestaña/ventana de la interfaz
//   - build/icon.ico                     icono del .exe, el instalador, los accesos directos y la ventana
//
// Recorta los márgenes transparentes y lo centra en un cuadrado: así el logo se ve más grande en los
// tamaños pequeños (16, 24 y 32 px). Usa pngjs (ya viene con node-thermal-printer) y no necesita nada más.
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'branding', 'logo-oficial.png');
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const UI_SIZE = 512;
const PADDING = 0.04; // margen alrededor del logo, como fracción del lado

function loadPng(file) {
  return PNG.sync.read(fs.readFileSync(file));
}

/** Recorta al rectángulo con contenido (alfa > 8) y lo centra en un lienzo cuadrado transparente. */
function cropToSquare(img) {
  let minX = img.width, minY = img.height, maxX = -1, maxY = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error('El logo no tiene píxeles visibles (¿es todo transparente?).');
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const side = Math.ceil(Math.max(w, h) * (1 + PADDING * 2));
  const out = new PNG({ width: side, height: side });
  const offX = Math.floor((side - w) / 2);
  const offY = Math.floor((side - h) / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((minY + y) * img.width + (minX + x)) * 4;
      const d = ((offY + y) * side + (offX + x)) * 4;
      out.data[d] = img.data[s];
      out.data[d + 1] = img.data[s + 1];
      out.data[d + 2] = img.data[s + 2];
      out.data[d + 3] = img.data[s + 3];
    }
  }
  return out;
}

/** Reduce con promedio por área, ponderando por la opacidad (evita bordes con halo oscuro o claro). */
function resize(img, size) {
  const out = new PNG({ width: size, height: size });
  const scale = img.width / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const x0 = x * scale, x1 = (x + 1) * scale, y0 = y * scale, y1 = (y + 1) * scale;
      let r = 0, g = 0, b = 0, a = 0, weight = 0;
      for (let sy = Math.floor(y0); sy < Math.min(img.height, Math.ceil(y1)); sy++) {
        const wy = Math.min(sy + 1, y1) - Math.max(sy, y0);
        for (let sx = Math.floor(x0); sx < Math.min(img.width, Math.ceil(x1)); sx++) {
          const w = wy * (Math.min(sx + 1, x1) - Math.max(sx, x0));
          const i = (sy * img.width + sx) * 4;
          const alpha = img.data[i + 3] / 255;
          r += img.data[i] * alpha * w;
          g += img.data[i + 1] * alpha * w;
          b += img.data[i + 2] * alpha * w;
          a += alpha * w;
          weight += w;
        }
      }
      const o = (y * size + x) * 4;
      if (a > 0) {
        out.data[o] = Math.round(r / a);
        out.data[o + 1] = Math.round(g / a);
        out.data[o + 2] = Math.round(b / a);
      }
      out.data[o + 3] = Math.round((a / weight) * 255);
    }
  }
  return out;
}

/** Imagen clásica de icono (DIB 32 bits BGRA, de abajo hacia arriba, más máscara AND): la entienden todas las herramientas. */
function toDib(img) {
  const size = img.width;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // alto doble: píxeles + máscara
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = ((size - 1 - y) * size + x) * 4;
      const d = (y * size + x) * 4;
      pixels[d] = img.data[s + 2];
      pixels[d + 1] = img.data[s + 1];
      pixels[d + 2] = img.data[s];
      pixels[d + 3] = img.data[s + 3];
    }
  }
  const maskRow = Math.ceil(size / 32) * 4;
  return Buffer.concat([header, pixels, Buffer.alloc(maskRow * size)]);
}

/** Arma un .ico: imagen DIB por debajo de 256 px y PNG en 256 px (es lo habitual en Windows). */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4); // planos
    e.writeUInt16LE(32, 6); // bits por píxel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((p) => p.data)]);
}

const logo = cropToSquare(loadPng(source));
const encode = (img) => PNG.sync.write(img, { colorType: 6 });

fs.writeFileSync(path.join(root, 'app/renderer/public/isotipo.png'), encode(resize(logo, UI_SIZE)));

const ico = buildIco(ICO_SIZES.map((size) => {
  const img = resize(logo, size);
  return { size, data: size >= 256 ? encode(img) : toDib(img) };
}));
fs.writeFileSync(path.join(root, 'app/renderer/public/icon.ico'), ico);
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
fs.writeFileSync(path.join(root, 'build/icon.ico'), ico);

console.log(`Logo recortado a ${logo.width}x${logo.height}. Iconos escritos: isotipo.png (${UI_SIZE}px) e icon.ico (${ICO_SIZES.join(', ')} px).`);
