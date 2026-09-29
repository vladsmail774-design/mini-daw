import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="124" y1="104" x2="916" y2="940" gradientUnits="userSpaceOnUse">
      <stop stop-color="#192331"/>
      <stop offset="0.52" stop-color="#070b10"/>
      <stop offset="1" stop-color="#020403"/>
    </linearGradient>
    <radialGradient id="glow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(698 304) rotate(126) scale(620)">
      <stop stop-color="#4ADE80" stop-opacity="0.6"/>
      <stop offset="0.45" stop-color="#22D3EE" stop-opacity="0.18"/>
      <stop offset="1" stop-color="#020403" stop-opacity="0"/>
    </radialGradient>
    <filter id="softGlow" x="-35%" y="-35%" width="170%" height="170%">
      <feGaussianBlur stdDeviation="20" result="blur"/>
      <feColorMatrix in="blur" values="0 0 0 0 0.29 0 0 0 0 0.87 0 0 0 0 0.50 0 0 0 0.85 0"/>
      <feMerge>
        <feMergeNode/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <rect x="64" y="64" width="896" height="896" rx="228" fill="url(#bg)"/>
  <rect x="64" y="64" width="896" height="896" rx="228" fill="url(#glow)"/>
  <rect x="86" y="86" width="852" height="852" rx="206" fill="none" stroke="#FFFFFF" stroke-opacity="0.08" stroke-width="18"/>
  <rect x="106" y="106" width="812" height="812" rx="186" fill="none" stroke="#4ADE80" stroke-opacity="0.23" stroke-width="10"/>
  <g opacity="0.34">
    <rect x="254" y="246" width="56" height="532" rx="28" fill="#C7D2FE" opacity="0.24"/>
    <rect x="484" y="200" width="56" height="578" rx="28" fill="#C7D2FE" opacity="0.18"/>
    <rect x="714" y="294" width="56" height="484" rx="28" fill="#C7D2FE" opacity="0.22"/>
    <circle cx="282" cy="386" r="54" fill="#4ADE80"/>
    <circle cx="512" cy="578" r="54" fill="#22D3EE"/>
    <circle cx="742" cy="456" r="54" fill="#4ADE80"/>
  </g>
  <path d="M176 620C232 620 244 408 306 408C374 408 390 676 454 676C526 676 532 334 602 334C670 334 688 586 750 586C806 586 822 444 872 444" fill="none" stroke="#4ADE80" stroke-width="54" stroke-linecap="round" stroke-linejoin="round" filter="url(#softGlow)"/>
  <path d="M176 620C232 620 244 408 306 408C374 408 390 676 454 676C526 676 532 334 602 334C670 334 688 586 750 586C806 586 822 444 872 444" fill="none" stroke="#D1FAE5" stroke-opacity="0.92" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="306" cy="408" r="26" fill="#ECFDF5"/>
  <circle cx="602" cy="334" r="26" fill="#ECFDF5"/>
  <circle cx="750" cy="586" r="26" fill="#ECFDF5"/>
</svg>`;

const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = sizes.map((size) => ({ size, data: makePng(size) }));

writeText("build/icon.svg", svg);
writeText("public/favicon.svg", svg);
writeText("src/assets/app-icon.svg", svg);
writeBinary("build/icon.png", pngs.at(-1).data);
writeBinary("build/icon.ico", makeIco(pngs));

function writeText(path, content) {
  const fullPath = join(root, path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, "utf8");
}

function writeBinary(path, content) {
  const fullPath = join(root, path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
}

function makePng(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const set = (x, y, color) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const offset = (y * size + x) * 4;
    blendPixel(pixels, offset, color);
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const ux = (x + 0.5) / size;
      const uy = (y + 0.5) / size;
      if (!insideRoundRect(ux, uy, 0.07, 0.22)) continue;
      const edge = insideRoundRect(ux, uy, 0.095, 0.195) ? 0 : 1;
      const glow = Math.max(0, 1 - dist(ux, uy, 0.68, 0.28) / 0.72);
      const r = lerp(8, 25, (1 - uy) * 0.65) + glow * 28;
      const g = lerp(11, 33, (1 - uy) * 0.75) + glow * 78;
      const b = lerp(15, 45, (1 - ux) * 0.45) + glow * 42;
      set(x, y, [r + edge * 18, g + edge * 56, b + edge * 28, 255]);
    }
  }

  const strips = [
    [0.275, 0.25, 0.76, [199, 210, 254, 52], [74, 222, 128, 220], 0.38],
    [0.5, 0.2, 0.76, [199, 210, 254, 38], [34, 211, 238, 210], 0.57],
    [0.725, 0.29, 0.76, [199, 210, 254, 48], [74, 222, 128, 220], 0.45],
  ];

  for (const [x, y1, y2, fill, knob, knobY] of strips) {
    drawRoundRect(set, size, x * size - size * 0.028, y1 * size, size * 0.056, (y2 - y1) * size, size * 0.028, fill);
    drawCircle(set, size, x * size, knobY * size, size * 0.052, knob);
    drawCircle(set, size, x * size, knobY * size, size * 0.025, [236, 253, 245, 230]);
  }

  const points = [
    [0.172, 0.606],
    [0.238, 0.604],
    [0.299, 0.398],
    [0.372, 0.546],
    [0.443, 0.66],
    [0.523, 0.48],
    [0.588, 0.326],
    [0.674, 0.45],
    [0.735, 0.572],
    [0.808, 0.506],
    [0.852, 0.434],
  ];

  drawPolyline(set, size, points, size * 0.09, [74, 222, 128, 42]);
  drawPolyline(set, size, points, size * 0.055, [74, 222, 128, 245]);
  drawPolyline(set, size, points, size * 0.016, [236, 253, 245, 236]);
  for (const [x, y] of [points[2], points[6], points[8]]) {
    drawCircle(set, size, x * size, y * size, size * 0.026, [236, 253, 245, 245]);
  }

  return encodePng(size, size, pixels);
}

function insideRoundRect(x, y, margin, radius) {
  const left = margin;
  const top = margin;
  const right = 1 - margin;
  const bottom = 1 - margin;
  const cx = clamp(x, left + radius, right - radius);
  const cy = clamp(y, top + radius, bottom - radius);
  return dist(x, y, cx, cy) <= radius;
}

function drawRoundRect(set, size, x, y, w, h, r, color) {
  const minX = Math.floor(x - 1);
  const maxX = Math.ceil(x + w + 1);
  const minY = Math.floor(y - 1);
  const maxY = Math.ceil(y + h + 1);
  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const cx = clamp(px + 0.5, x + r, x + w - r);
      const cy = clamp(py + 0.5, y + r, y + h - r);
      if (dist(px + 0.5, py + 0.5, cx, cy) <= r) set(px, py, color);
    }
  }
}

function drawCircle(set, size, cx, cy, radius, color) {
  const minX = Math.floor(cx - radius - 1);
  const maxX = Math.ceil(cx + radius + 1);
  const minY = Math.floor(cy - radius - 1);
  const maxY = Math.ceil(cy + radius + 1);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const d = dist(x + 0.5, y + 0.5, cx, cy);
      if (d <= radius) set(x, y, color);
    }
  }
}

function drawPolyline(set, size, points, thickness, color) {
  const scaled = points.map(([x, y]) => [x * size, y * size]);
  const radius = thickness / 2;
  for (let i = 0; i < scaled.length - 1; i++) {
    const [x1, y1] = scaled[i];
    const [x2, y2] = scaled[i + 1];
    const minX = Math.floor(Math.min(x1, x2) - radius - 1);
    const maxX = Math.ceil(Math.max(x1, x2) + radius + 1);
    const minY = Math.floor(Math.min(y1, y2) - radius - 1);
    const maxY = Math.ceil(Math.max(y1, y2) + radius + 1);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (distanceToSegment(x + 0.5, y + 0.5, x1, y1, x2, y2) <= radius) {
          set(x, y, color);
        }
      }
    }
    drawCircle(set, size, x1, y1, radius, color);
    drawCircle(set, size, x2, y2, radius, color);
  }
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", Buffer.concat([u32(width), u32(height), Buffer.from([8, 6, 0, 0, 0])])),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  return Buffer.concat([u32(data.length), typeBuffer, data, u32(crc32(Buffer.concat([typeBuffer, data])))]);
}

function makeIco(entries) {
  let offset = 6 + entries.length * 16;
  const header = Buffer.alloc(offset);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  entries.forEach(({ size, data }, index) => {
    const entryOffset = 6 + index * 16;
    header[entryOffset] = size >= 256 ? 0 : size;
    header[entryOffset + 1] = size >= 256 ? 0 : size;
    header[entryOffset + 2] = 0;
    header[entryOffset + 3] = 0;
    header.writeUInt16LE(1, entryOffset + 4);
    header.writeUInt16LE(32, entryOffset + 6);
    header.writeUInt32LE(data.length, entryOffset + 8);
    header.writeUInt32LE(offset, entryOffset + 12);
    offset += data.length;
  });

  return Buffer.concat([header, ...entries.map((entry) => entry.data)]);
}

function blendPixel(buffer, offset, [r, g, b, a]) {
  const srcAlpha = clamp(a / 255, 0, 1);
  const dstAlpha = buffer[offset + 3] / 255;
  const outAlpha = srcAlpha + dstAlpha * (1 - srcAlpha);
  if (outAlpha <= 0) return;
  buffer[offset] = Math.round((r * srcAlpha + buffer[offset] * dstAlpha * (1 - srcAlpha)) / outAlpha);
  buffer[offset + 1] = Math.round((g * srcAlpha + buffer[offset + 1] * dstAlpha * (1 - srcAlpha)) / outAlpha);
  buffer[offset + 2] = Math.round((b * srcAlpha + buffer[offset + 2] * dstAlpha * (1 - srcAlpha)) / outAlpha);
  buffer[offset + 3] = Math.round(outAlpha * 255);
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const lengthSq = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  if (lengthSq === 0) return dist(px, py, x1, y1);
  const t = clamp(((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / lengthSq, 0, 1);
  return dist(px, py, x1 + t * (x2 - x1), y1 + t * (y2 - y1));
}

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0);
  return buffer;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function dist(x1, y1, x2, y2) {
  return Math.hypot(x1 - x2, y1 - y2);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
