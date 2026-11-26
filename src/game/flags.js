// Procedural national flags, rendered once per nation to a data URL.
import { lighten, darken, mix } from './color.js';

const PATTERNS = ['bands-h', 'bands-v', 'triband', 'diagonal', 'canton', 'cross', 'chevron', 'sunburst'];

function emblem(ctx, kind, x, y, r, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, r * 0.22);
  if (kind === 'star') {
    ctx.beginPath();
    for (let i = 0; i < 10; i += 1) {
      const a = (Math.PI / 5) * i - Math.PI / 2;
      const rad = i % 2 === 0 ? r : r * 0.44;
      const px = x + Math.cos(a) * rad;
      const py = y + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'circle') {
    ctx.beginPath();
    ctx.arc(x, y, r * 0.72, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'cross') {
    ctx.beginPath();
    ctx.moveTo(x - r * 0.22, y - r);
    ctx.lineTo(x + r * 0.22, y - r);
    ctx.lineTo(x + r * 0.22, y + r);
    ctx.lineTo(x - r * 0.22, y + r);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - r, y - r * 0.22);
    ctx.lineTo(x + r, y - r * 0.22);
    ctx.lineTo(x + r, y + r * 0.22);
    ctx.lineTo(x - r, y + r * 0.22);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'diamond') {
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'crescent') {
    ctx.beginPath();
    ctx.arc(x, y, r * 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(x + r * 0.42, y - r * 0.1, r * 0.66, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else if (kind === 'chevron') {
    ctx.beginPath();
    ctx.moveTo(x - r, y - r * 0.8);
    ctx.lineTo(x, y + r * 0.4);
    ctx.lineTo(x + r, y - r * 0.8);
    ctx.lineTo(x + r, y - r * 0.2);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y - r * 0.2);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'bars') {
    for (let i = -1; i <= 1; i += 1) ctx.fillRect(x - r, y + i * r * 0.55 - r * 0.13, r * 2, r * 0.26);
  }
  ctx.restore();
}

export function renderFlag(nation, w = 96, h = 64) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const seed = (nation.id * 2654435761) >>> 0;
  const pattern = PATTERNS[seed % PATTERNS.length];
  const base = nation.color;
  const accent = mix(lighten(base, 0.5), darken(base, 0.35), ((seed >> 3) % 5) / 6);
  const third = mix(darken(base, 0.55), accent, 0.35);
  const emblemKinds = ['star', 'circle', 'diamond', 'crescent', 'chevron', 'bars'];
  const emblemKind = emblemKinds[(seed >> 7) % emblemKinds.length];

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  if (pattern === 'bands-h') {
    ctx.fillStyle = accent;
    ctx.fillRect(0, h * 0.5, w, h * 0.5);
    ctx.fillStyle = third;
    ctx.fillRect(0, h * 0.72, w, h * 0.1);
  } else if (pattern === 'bands-v') {
    ctx.fillStyle = accent;
    ctx.fillRect(w * 0.5, 0, w * 0.5, h);
    ctx.fillStyle = third;
    ctx.fillRect(w * 0.78, 0, w * 0.08, h);
  } else if (pattern === 'triband') {
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, w, h * 0.36);
    ctx.fillStyle = third;
    ctx.fillRect(0, h * 0.72, w, h * 0.28);
  } else if (pattern === 'diagonal') {
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(w * 0.72, 0);
    ctx.lineTo(w, 0);
    ctx.lineTo(w * 0.28, h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = third;
    ctx.fillRect(0, h * 0.8, w, h * 0.2);
  } else if (pattern === 'canton') {
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, w * 0.44, h * 0.55);
    ctx.fillStyle = third;
    ctx.fillRect(0, h * 0.86, w, h * 0.14);
  } else if (pattern === 'cross') {
    ctx.fillStyle = accent;
    ctx.fillRect(w * 0.42, 0, w * 0.16, h);
    ctx.fillRect(0, h * 0.41, w, h * 0.18);
  } else if (pattern === 'chevron') {
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(w * 0.5, h * 0.18);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(w * 0.5, h * 0.5);
    ctx.arc(w * 0.5, h * 0.5, h * 0.75, 0, Math.PI * 2);
    ctx.fill();
  }

  if (emblemKind !== 'none') {
    const em = pattern === 'canton' ? [w * 0.22, h * 0.27, h * 0.15] : [w * 0.5, h * 0.5, h * 0.22];
    emblem(ctx, emblemKind, em[0], em[1], em[2], lighten(base, 0.78));
  }

  // Border and subtle shading.
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(255,255,255,0.14)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  return canvas.toDataURL('image/png');
}

const FLAG_CACHE = new Map();

export function flagFor(nation) {
  if (!nation) return '';
  const key = `${nation.id}:${nation.color}`; // IDs repeat on newly rolled worlds.
  if (FLAG_CACHE.has(key)) return FLAG_CACHE.get(key);
  const url = renderFlag(nation);
  FLAG_CACHE.set(key, url);
  return url;
}

export function resetFlagCache() {
  FLAG_CACHE.clear();
}
