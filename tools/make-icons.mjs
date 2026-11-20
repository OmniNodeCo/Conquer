// Generates the application icon set (PNG, ICO, ICNS).
// If a pixel-art source exists at assets/icon-pixel-src.png it is snapped to a
// block grid and used for every size; otherwise the built-in procedural globe
// is drawn instead.
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';

const PIXEL_SOURCE = 'assets/icon-pixel-src.png';
const BLOCKS = 96; // the source is snapped to a 96x96 block canvas

let pixelBase = null;
if (existsSync(PIXEL_SOURCE)) {
  const img = await loadImage(readFileSync(PIXEL_SOURCE));
  const low = createCanvas(BLOCKS, BLOCKS);
  const lctx = low.getContext('2d');
  lctx.imageSmoothingEnabled = true;
  lctx.imageSmoothingQuality = 'high';
  lctx.drawImage(img, 0, 0, BLOCKS, BLOCKS);

  pixelBase = createCanvas(1024, 1024);
  const bctx = pixelBase.getContext('2d');
  bctx.imageSmoothingEnabled = false;
  bctx.drawImage(low, 0, 0, 1024, 1024);
}

const GOLD = '#e9c46a';
const GOLD_BRIGHT = '#f8dfa0';
const GOLD_DIM = '#b08d3f';

function drawIcon(size) {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  if (pixelBase) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(pixelBase, 0, 0, size, size);
    return c;
  }
  const s = size / 1024; // design space is 1024px
  ctx.scale(s, s);

  // Rounded square plate.
  const r = 180;
  const g = ctx.createLinearGradient(0, 0, 1024, 1024);
  g.addColorStop(0, '#12283a');
  g.addColorStop(0.55, '#081722');
  g.addColorStop(1, '#040b12');
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(1024 - r, 0);
  ctx.quadraticCurveTo(1024, 0, 1024, r);
  ctx.lineTo(1024, 1024 - r);
  ctx.quadraticCurveTo(1024, 1024, 1024 - r, 1024);
  ctx.lineTo(r, 1024);
  ctx.quadraticCurveTo(0, 1024, 0, 1024 - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();

  // Inner gold frame.
  ctx.strokeStyle = 'rgba(233,196,106,0.55)';
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.roundRect(46, 46, 932, 932, 150);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(233,196,106,0.16)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.roundRect(78, 78, 868, 868, 128);
  ctx.stroke();

  // Globe.
  const cx = 512;
  const cy = 512;
  const R = 330;

  ctx.save();
  const halo = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.5);
  halo.addColorStop(0, 'rgba(233,196,106,0.18)');
  halo.addColorStop(1, 'rgba(233,196,106,0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Ocean disc.
  const ocean = ctx.createRadialGradient(cx - 90, cy - 110, 40, cx, cy, R);
  ocean.addColorStop(0, 'rgba(69,132,160,0.55)');
  ocean.addColorStop(1, 'rgba(13,44,60,0.55)');
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = ocean;
  ctx.fill();

  // Continents: abstract land shapes in gold.
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = 'rgba(233,196,106,0.88)';
  const blobs = [
    [cx - 118, cy - 122, 168, 108, -0.35, 7],
    [cx + 20, cy - 20, 92, 158, 0.18, 11],
    [cx + 168, cy - 96, 112, 76, 0.3, 5],
    [cx + 118, cy + 158, 132, 96, -0.15, 13],
    [cx - 156, cy + 132, 92, 74, 0.5, 17],
    [cx - 216, cy + 10, 66, 52, -0.6, 23],
  ];
  for (const [bx, by, bw, bh, rot, seed] of blobs) {
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(rot);
    ctx.beginPath();
    const steps = 22;
    for (let i = 0; i <= steps; i += 1) {
      const a = (i / steps) * Math.PI * 2;
      const wobble =
        1 +
        0.18 * Math.sin(a * 3 + seed) +
        0.12 * Math.sin(a * 5 - seed * 1.7) +
        0.07 * Math.sin(a * 8 + seed * 0.6);
      const px = Math.cos(a) * bw * wobble;
      const py = Math.sin(a) * bh * wobble;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  // Latitude / longitude grid.
  ctx.strokeStyle = 'rgba(255,240,205,0.5)';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,240,205,0.32)';
  ctx.lineWidth = 5;
  for (const k of [0.35, 0.72]) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, R, R * k, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx, cy, R * k, R, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(cx, cy, R, R, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Compass star at the top right.
  ctx.save();
  ctx.translate(cx + 250, cy - 268);
  ctx.fillStyle = GOLD_BRIGHT;
  ctx.beginPath();
  for (let i = 0; i < 8; i += 1) {
    const a = (Math.PI / 4) * i - Math.PI / 2;
    const rad = i % 2 === 0 ? 64 : 20;
    const px = Math.cos(a) * rad;
    const py = Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Slight top highlight.
  const shine = ctx.createLinearGradient(0, 0, 0, 1024);
  shine.addColorStop(0, 'rgba(255,255,255,0.1)');
  shine.addColorStop(0.4, 'rgba(255,255,255,0)');
  ctx.fillStyle = shine;
  ctx.beginPath();
  ctx.roundRect(46, 46, 932, 932, 140);
  ctx.fill();

  return c;
}

function png(size) {
  return drawIcon(size).toBuffer('image/png');
}

mkdirSync('build/icons', { recursive: true });

// Master + flat PNGs.
writeFileSync('build/icon.png', png(512));
writeFileSync('build/icon-1024.png', png(1024));
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
for (const size of sizes) {
  writeFileSync(`build/icons/${size}x${size}.png`, png(size));
}

// ---------------------------------------------------------------- Windows ICO
function buildIco(entries) {
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  const dirSize = 16 * count;
  let offset = 6 + dirSize;
  const dirs = [];
  for (const { size, data } of entries) {
    const dir = Buffer.alloc(16);
    dir.writeUInt8(size >= 256 ? 0 : size, 0);
    dir.writeUInt8(size >= 256 ? 0 : size, 1);
    dir.writeUInt8(0, 2);
    dir.writeUInt8(0, 3);
    dir.writeUInt16LE(1, 4);
    dir.writeUInt16LE(32, 6);
    dir.writeUInt32LE(data.length, 8);
    dir.writeUInt32LE(offset, 12);
    offset += data.length;
    dirs.push(dir);
  }
  return Buffer.concat([header, ...dirs, ...entries.map((e) => e.data)]);
}

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
writeFileSync('build/icon.ico', buildIco(icoSizes.map((size) => ({ size, data: png(size) }))));

// ---------------------------------------------------------------- macOS ICNS
function buildIcns(entries) {
  const chunks = entries.map(({ type, data }) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, 4, 'ascii');
    head.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([head, data]);
  });
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([header, body]);
}

const icns = buildIcns([
  { type: 'icp4', data: png(16) },
  { type: 'icp5', data: png(32) },
  { type: 'icp6', data: png(64) },
  { type: 'ic07', data: png(128) },
  { type: 'ic08', data: png(256) },
  { type: 'ic09', data: png(512) },
  { type: 'ic10', data: png(1024) },
]);
writeFileSync('build/icon.icns', icns);

// A 512px icon for the title screen / about panels.
writeFileSync('assets/icon.png', png(512));

console.log('icons written: build/icon.png, build/icon.ico, build/icon.icns, build/icons/*');
