// Generates PWA icons (192x192 and 512x512 PNG) using only Node built-ins
import zlib from "zlib";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "../public");

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++)
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcBuf = Buffer.concat([typeBytes, data]);
  const crcVal = Buffer.alloc(4);
  crcVal.writeUInt32BE(crc32(crcBuf));
  return Buffer.concat([len, typeBytes, data, crcVal]);
}

function encodePNG(rgba, size) {
  // Build raw scanlines (filter byte 0 = None per row)
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0; // filter None
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      row[1 + x * 4] = rgba[i];
      row[1 + x * 4 + 1] = rgba[i + 1];
      row[1 + x * 4 + 2] = rgba[i + 2];
      row[1 + x * 4 + 3] = rgba[i + 3];
    }
    rows.push(row);
  }
  const raw = Buffer.concat(rows);
  const compressed = zlib.deflateSync(raw, { level: 9 });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function drawIcon(size) {
  const rgba = new Uint8Array(size * size * 4);
  const S = size;

  function setPixel(x, y, r, g, b, a = 255) {
    if (x < 0 || x >= S || y < 0 || y >= S) return;
    const i = (y * S + x) * 4;
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a;
  }

  // Anti-aliased circle fill helper
  function fillCircleAA(cx, cy, radius, r, g, b) {
    for (let y = Math.floor(cy - radius - 1); y <= Math.ceil(cy + radius + 1); y++) {
      for (let x = Math.floor(cx - radius - 1); x <= Math.ceil(cx + radius + 1); x++) {
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        const alpha = Math.max(0, Math.min(1, radius + 0.5 - dist));
        if (alpha > 0) {
          const idx = (y * S + x) * 4;
          if (x >= 0 && x < S && y >= 0 && y < S) {
            rgba[idx] = r; rgba[idx+1] = g; rgba[idx+2] = b;
            rgba[idx+3] = Math.round(alpha * 255);
          }
        }
      }
    }
  }

  // Draw line with thickness (anti-aliased)
  function drawLine(x0, y0, x1, y1, thick, r, g, b) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(len * 2);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px = x0 + dx * t;
      const py = y0 + dy * t;
      fillCircleAA(px, py, thick / 2, r, g, b);
    }
  }

  // Fill polygon (scanline)
  function fillPolygon(pts, r, g, b) {
    const minY = Math.floor(Math.min(...pts.map(p => p[1])));
    const maxY = Math.ceil(Math.max(...pts.map(p => p[1])));
    for (let y = minY; y <= maxY; y++) {
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[(i + 1) % pts.length];
        if ((ay <= y && by > y) || (by <= y && ay > y)) {
          xs.push(ax + (y - ay) / (by - ay) * (bx - ax));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k < xs.length - 1; k += 2) {
        for (let x = Math.floor(xs[k]); x <= Math.ceil(xs[k + 1]); x++) {
          setPixel(x, y, r, g, b);
        }
      }
    }
  }

  const sc = S / 512;

  // Background: rounded square, dark navy
  const bg = [15, 30, 60];
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++)
      setPixel(x, y, bg[0], bg[1], bg[2]);

  // Rounded corners (radius ~80px at 512)
  const cr = 80 * sc;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = Math.max(0, Math.max(cr - x, x - (S - 1 - cr)));
      const dy = Math.max(0, Math.max(cr - y, y - (S - 1 - cr)));
      if (dx * dx + dy * dy > cr * cr) {
        const i = (y * S + x) * 4;
        rgba[i + 3] = 0; // transparent corner
      }
    }
  }

  // Mast: vertical line
  const mastX = 0.42 * S;
  const mastTop = 0.12 * S;
  const mastBot = 0.82 * S;
  drawLine(mastX, mastTop, mastX, mastBot, 10 * sc, 255, 255, 255);

  // Main sail (triangle): mast top → mast bottom → right
  const sailPts = [
    [mastX, mastTop],
    [mastX, mastBot * 0.78],
    [0.80 * S, mastBot * 0.78],
  ];
  fillPolygon(sailPts, 255, 255, 255);

  // Jib (smaller triangle): mast top → mast mid → left
  const jibPts = [
    [mastX, mastTop + 0.06 * S],
    [mastX, mastBot * 0.55],
    [0.20 * S, mastBot * 0.72],
  ];
  fillPolygon(jibPts, 200, 225, 255);

  // Hull
  const hullPts = [
    [0.22 * S, mastBot],
    [0.78 * S, mastBot],
    [0.68 * S, mastBot + 0.08 * S],
    [0.32 * S, mastBot + 0.08 * S],
  ];
  fillPolygon(hullPts, 255, 255, 255);

  // Water line (two wavy lines)
  const wy = mastBot + 0.14 * S;
  for (let x = 0.05 * S; x < 0.95 * S; x++) {
    const waveY = wy + Math.sin(x / (S * 0.06)) * 4 * sc;
    fillCircleAA(x, waveY, 3 * sc, 100, 160, 255);
  }
  const wy2 = wy + 0.05 * S;
  for (let x = 0.1 * S; x < 0.9 * S; x++) {
    const waveY = wy2 + Math.sin(x / (S * 0.05) + 1) * 4 * sc;
    fillCircleAA(x, waveY, 3 * sc, 100, 160, 255);
  }

  return Buffer.from(rgba);
}

for (const size of [192, 512]) {
  const pixels = drawIcon(size);
  const png = encodePNG(pixels, size);
  const out = path.join(OUT, `icon-${size}.png`);
  fs.writeFileSync(out, png);
  console.log(`Written ${out}`);
}
