// Canvas map renderer: ocean, terrain relief, political fills, borders,
// army markers, effects and labels. Works in the browser and in headless
// node-canvas for offline previews.

import { PixelAtlas, stamp } from './map-art.js';
import { siteOrigin } from './site-shapes.js';
import { TERRAIN, PIXEL, cellCenter } from './worldgen.js';
import { clamp } from './geom.js';
import { withAlpha } from './color.js';
import { heldCell, nationSeat } from './fronts.js';

const defaultSurface = (w, h) => {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  throw new Error('No surface factory available');
};

export function terrainColor(key) {
  return (TERRAIN[key] || TERRAIN.plains).color;
}

export class MapView {
  constructor(canvas, { surface = defaultSurface, dpr = 1 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.surface = surface;
    this.dpr = dpr;
    this.camera = { x: 0, y: 0, zoom: 0.7 };
    this.width = canvas.width / dpr;
    this.height = canvas.height / dpr;
    this.world = null;
    this.pixelScale = PIXEL;
    this.politicalKey = null;
    this.atlas = null;
    this.time = 0;
    this.hovered = null;
    this.selected = null;
  }

  resize(cssWidth, cssHeight, dpr = this.dpr) {
    this.dpr = dpr;
    this.width = cssWidth;
    this.height = cssHeight;
    this.canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
    this.canvas.height = Math.max(1, Math.floor(cssHeight * dpr));
    if (this.canvas.style) {
      this.canvas.style.width = `${cssWidth}px`;
      this.canvas.style.height = `${cssHeight}px`;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setWorld(world) {
    this.world = world;
    this.locator = null;
    this.plotCursor = null;
    this.attackTarget = this.attackSource = null;
    this.politicalKey = null;
    this.atlas = new PixelAtlas(world, this.surface);
    this.fitWorld();
  }

  fitWorld(margin = 0.96) {
    if (!this.world) return;
    const zoom = Math.min(this.width / this.world.width, this.height / this.world.height) * margin;
    this.camera.zoom = zoom;
    this.camera.x = this.world.width / 2;
    this.camera.y = this.world.height / 2;
  }

  worldToScreen(x, y) {
    return [
      (x - this.camera.x) * this.camera.zoom + this.width / 2,
      (y - this.camera.y) * this.camera.zoom + this.height / 2,
    ];
  }

  screenToWorld(sx, sy) {
    return [
      (sx - this.width / 2) / this.camera.zoom + this.camera.x,
      (sy - this.height / 2) / this.camera.zoom + this.camera.y,
    ];
  }

  panBy(dx, dy) {
    this.camera.x -= dx / this.camera.zoom;
    this.camera.y -= dy / this.camera.zoom;
    this.clampCamera();
  }

  zoomAt(sx, sy, factor) {
    const before = this.screenToWorld(sx, sy);
    const minZoom = Math.min(this.width / this.world.width, this.height / this.world.height) * 0.75;
    this.camera.zoom = clamp(this.camera.zoom * factor, Math.max(0.18, minZoom), 3.2);
    const after = this.screenToWorld(sx, sy);
    this.camera.x += before[0] - after[0];
    this.camera.y += before[1] - after[1];
    this.clampCamera();
  }

  clampCamera() {
    if (!this.world) return;
    // Keep the centre on the map, but allow coastal parcels to reach the middle
    // of the viewport instead of getting trapped behind the HUD at the edges.
    this.camera.x = clamp(this.camera.x, 0, this.world.width);
    this.camera.y = clamp(this.camera.y, 0, this.world.height);
  }

  focusProvince(prov, zoom = null, cell = prov?.seatCell) {
    if (!prov) return;
    if (zoom) this.camera.zoom = clamp(zoom, 0.3, 3.2);
    [this.camera.x, this.camera.y] = cellCenter(this.world, cell);
    this.clampCamera();
  }

  locate(prov, cell) {
    this.focusProvince(prov, Math.max(1.6, this.camera.zoom), cell);
    this.locator = { cell, provinceId: prov.id, until: performance.now() / 1000 + 3 };
  }

  drawLocator(time) {
    const pin = this.locator;
    if (!pin || pin.provinceId !== this.selected || time >= pin.until) return;
    const [sx, sy] = this.worldToScreen(...cellCenter(this.world, pin.cell));
    const x = Math.round(sx), y = Math.round(sy);
    const r = Math.ceil(this.world.pixel * 3 * this.camera.zoom) + Math.ceil(Math.max(0, pin.until - time - 2) * 9);
    // Four atlas corners briefly bracket the destination, even while paused.
    for (const dx of [-1, 1]) for (const dy of [-1, 1]) {
      const bx = x + dx * r, by = y + dy * r;
      this.ctx.fillStyle = '#283339';
      this.ctx.fillRect(bx - (dx > 0 ? 6 : 1), by-1, 9, 4);
      this.ctx.fillRect(bx-1, by - (dy > 0 ? 6 : 1), 4, 9);
      this.ctx.fillStyle = '#ffdc8a';
      this.ctx.fillRect(bx - (dx > 0 ? 5 : 0), by, 7, 2);
      this.ctx.fillRect(bx, by - (dy > 0 ? 5 : 0), 2, 7);
    }
  }

  // -------------------------------------------------------------------- draw
  draw(state, { time = 0, showLabels = true, showTroops = true, selectedId = null, hoveredId = null } = {}) {
    const ctx = this.ctx;
    const world = this.world;
    this.time = time;
    if (!world) return;

    const cam = this.camera;
    const zoom = cam.zoom;
    const view = {
      minX: cam.x - this.width / (2 * zoom),
      maxX: cam.x + this.width / (2 * zoom),
      minY: cam.y - this.height / (2 * zoom),
      maxY: cam.y + this.height / (2 * zoom),
    };
    const playerId = state.playerNationId;
    this.selected = selectedId;
    this.hovered = hoveredId;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#081725';
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.save();
    ctx.translate(this.width / 2, this.height / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-cam.x, -cam.y);

    // ---- pixel layer: the whole political map, blocky by construction
    const layer = this.politicalLayer(state, selectedId, hoveredId);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(layer, 0, 0, world.width, world.height);
    this.atlas.drawTide(ctx, state.time);
    this.atlas.drawReplacements(ctx, state, zoom);

    // ---- crisp interaction layer on top of the blocks
    this.drawAttackPreview(state, zoom);
    this.drawExpeditions(state);
    for (const fx of state.effects) if (fx.type === 'battle' && fx.fromCell != null) {
      this.drawColumn(fx.fromCell, fx.toCell, fx.t / fx.ttl, state.nations[fx.nationId].color);
    }
    if (this.plotCursor && state.started) this.drawPlotCursor();
    ctx.restore();

    // ---------------------------------------------------- screen-space layer
    this.drawOverlay(state, zoom, view, { showLabels, showTroops, playerId });
    this.drawEffects(state, zoom);
    this.drawLocator(time);
  }

  politicalLayer(state, selectedId = null, hoveredId = null) {
    const key = `${state.landRevision ?? 'preview'}|${selectedId}|${hoveredId}`;
    if (key !== this.politicalKey) {
      this.politicalCanvas = this.atlas.paint(selectedId, hoveredId);
      this.politicalKey = key;
    }
    return this.politicalCanvas;
  }

  drawPlotCursor() {
    const { cell, key, valid } = this.plotCursor, u = this.world.pixel / 2;
    const [cx, cy] = cellCenter(this.world, cell), ctx = this.ctx;
    ctx.save();
    if (valid) {
      const [x, y] = siteOrigin(cell, key, this.world.gridW), img = this.atlas.siteSymbols[key];
      ctx.globalAlpha = .65;
      ctx.drawImage(img, x*u, y*u, img.width*u, img.height*u);
    } else {
      // A red cross rather than a ghost building on land we cannot build on.
      ctx.fillStyle = '#ff9980';
      for (let i = -2; i <= 2; i++) {
        ctx.fillRect(cx+i*u, cy+i*u, u, u); ctx.fillRect(cx-i*u, cy+i*u, u, u);
      }
    }
    ctx.restore();
  }

  drawColumn(from, to, progress, color) {
    const [x, y] = cellCenter(this.world, from), [tx, ty] = cellCenter(this.world, to);
    const u = this.world.pixel / 2, ctx = this.ctx;
    for (let n = 0; n < 3; n++) {
      const t = clamp(progress * 1.15 - n*.075, 0, 1), step = Math.floor(progress*10 + n) % 2;
      const sx = Math.round((x + (tx-x)*t)/u)*u + (n-1)*2*u;
      const sy = Math.round((y + (ty-y)*t)/u)*u + (n%2)*2*u;
      ctx.fillStyle = '#263742'; ctx.fillRect(sx-u, sy-4*u, 3*u, u);
      ctx.fillStyle = '#f0c69e'; ctx.fillRect(sx, sy-3*u, 2*u, u);
      ctx.fillStyle = '#30424a'; ctx.fillRect(sx-u, sy-2*u, 3*u, 2*u);
      ctx.fillStyle = color; ctx.fillRect(sx, sy-2*u, 2*u, 2*u);
      ctx.fillStyle = '#263742'; ctx.fillRect(sx+(step-1)*u, sy, 2*u, u);
    }
  }

  drawExpeditions(state) {
    const ctx = this.ctx, unit = this.world.pixel / 2;
    for (const exp of state.expeditions) {
      if (exp.kind === 'march') {
        this.drawColumn(exp.fromCell, exp.aim, (state.time - exp.startTime) / (exp.arriveTime - exp.startTime), state.nations[exp.nationId].color);
        continue;
      }
      const [x, y] = state.provinces[exp.fromId].centroid;
      const [tx, ty] = state.provinces[exp.toId].centroid;
      const t = clamp((state.time - exp.startTime) / (exp.arriveTime - exp.startTime), 0, 1);
      const pos = f => [Math.round((x + (tx-x)*f) / unit)*unit,
        Math.round((y + (ty-y)*f - Math.sin(Math.PI*f)*14) / unit)*unit];
      ctx.fillStyle = '#a6cfc4';
      for (let j = 1; j <= 3; j++) if (t > j * .025) ctx.fillRect(...pos(t-j*.025), unit*2, unit);
      const [sx, sy] = pos(t);
      stamp(ctx, 'sail', sx-unit*3, sy-unit*4, unit);
    }
  }

  drawAttackPreview(state, zoom) {
    const ctx = this.ctx;
    const target = this.attackTarget;
    const source = this.attackSource;
    if (!target || !source) return;

    const [sx, sy] = source.centroid;
    const [tx, ty] = target.centroid;
    const naval = source.navalRoute;

    // Arrow drawn on a coarse grid so it reads as hand-placed pixel blocks.
    const unit = this.world.pixel * 2;
    const snap = (v) => Math.round(v / unit) * unit;
    const ax = snap(sx);
    const ay = snap(sy);
    const bx = snap(tx);
    const by = snap(ty);
    const midX = snap(naval ? bx : ax);
    const pts = naval
      ? [
          [ax, ay],
          [ax, snap(ay + (by - ay) * 0.35)],
          [midX, snap(ay + (by - ay) * 0.65)],
          [bx, by],
        ]
      : [
          [ax, ay],
          [midX, ay],
          [midX, by],
          [bx, by],
        ];

    const stroke = 'rgba(255, 214, 120, 0.9)';
    ctx.save();
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'butt';
    ctx.strokeStyle = stroke;
    ctx.lineWidth = this.world.pixel;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();

    // Marching blocks travelling along the arrow.
    const segments = [];
    let total = 0;
    for (let i = 1; i < pts.length; i += 1) {
      const len = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      segments.push({ from: pts[i - 1], to: pts[i], len, start: total });
      total += len;
    }
    if (total > 1) {
      const block = this.world.pixel;
      ctx.fillStyle = '#fff2c4';
      for (let k = 0; k < 4; k += 1) {
        const d = ((this.time * total * 0.35 + k * (total / 4)) % total + total) % total;
        const seg = segments.find((s2) => d >= s2.start && d <= s2.start + s2.len) || segments[segments.length - 1];
        const t = seg.len > 0 ? (d - seg.start) / seg.len : 0;
        const px2 = seg.from[0] + (seg.to[0] - seg.from[0]) * t;
        const py2 = seg.from[1] + (seg.to[1] - seg.from[1]) * t;
        ctx.fillRect(Math.round(px2 / block)*block, Math.round(py2 / block)*block, block, block);
      }
    }

    // A three-step pennon at the endpoint, on the same grid as the parcels.
    const u = this.world.pixel;
    ctx.fillStyle = '#fff2c4';
    ctx.fillRect(bx, by - 3*u, u, 4*u);
    ctx.fillRect(bx+u, by - 3*u, 2*u, u);
    ctx.fillRect(bx+u, by - 2*u, u, u);
    ctx.restore();
  }

  drawOverlay(state, zoom, view, { showLabels = true, showTroops = true, playerId = 0 } = {}) {
    const ctx = this.ctx;
    const occupied = [];
    const fits = (x, y, w, h, pad = 3) => {
      if (x < -w || x > this.width || y < -h || y > this.height) return false;
      for (const r of occupied) {
        if (x < r.x + r.w + pad && x + w + pad > r.x && y < r.y + r.h + pad && y + h + pad > r.y) {
          return false;
        }
      }
      return true;
    };
    const claim = (x, y, w, h) => occupied.push({ x, y, w, h });

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Don't cover a placed landmark with a troop counter or a name plate.
    for (const mark of this.atlas.siteMarks) {
      if (mark.x + mark.size < view.minX || mark.x > view.maxX || mark.y + mark.size < view.minY || mark.y > view.maxY) continue;
      const [sx, sy] = this.worldToScreen(mark.x, mark.y);
      claim(sx, sy, mark.size * zoom, mark.size * zoom);
    }

    // 1. Nation name plates at their capitals (top priority).
    if (showLabels) {
      const order = [...state.nations]
        .filter((n) => n.alive)
        .sort((a, b) => {
          if (a.id === playerId) return -1;
          if (b.id === playerId) return 1;
          const ca = state.provinces.filter((p) => p.nationId === a.id).length;
          const cb = state.provinces.filter((p) => p.nationId === b.id).length;
          return cb - ca;
        });
      for (const nation of order) {
        const seat = nationSeat(this.world, nation);
        if (!seat) continue;
        if (seat.bbox.maxX < view.minX || seat.bbox.minX > view.maxX || seat.bbox.maxY < view.minY || seat.bbox.minY > view.maxY) {
          continue;
        }
        const [sx, sy] = this.worldToScreen(seat.centroid[0], seat.centroid[1]);
        const label = nation.name.toUpperCase();
        const isPlayer = nation.id === playerId;
        ctx.font = `700 ${isPlayer ? 13 : 11.5}px "Pixelify Sans", "Inter", system-ui, sans-serif`;
        const textW = ctx.measureText(label).width;
        const plateW = textW + 20;
        const plateH = 19;
        const px = sx - plateW / 2;
        let py = sy - 16 * zoom - plateH;
        if (!fits(px, py, plateW, plateH)) py -= plateH + 4;
        if (!fits(px, py, plateW, plateH)) continue;
        claim(px, py, plateW, plateH);

        roundRect(ctx, px, py, plateW, plateH, 0);
        ctx.fillStyle = 'rgba(6, 11, 16, 0.82)';
        ctx.fill();
        ctx.strokeStyle = isPlayer ? 'rgba(255, 226, 140, 0.95)' : withAlpha(nation.color, 0.8);
        ctx.lineWidth = isPlayer ? 1.4 : 1;
        ctx.stroke();
        ctx.fillStyle = nation.color;
        ctx.fillRect(px + 1.5, py + 1.5, 4, plateH - 3);
        ctx.fillStyle = '#f7f2e6';
        ctx.fillText(label, sx + 3, py + plateH / 2 + 0.5);

      }
    }

    // 2. Garrison pills.
    if (showTroops && zoom > 0.95) {
      for (const prov of this.world.provinces) {
        if (prov.bbox.maxX < view.minX || prov.bbox.minX > view.maxX || prov.bbox.maxY < view.minY || prov.bbox.minY > view.maxY) {
          continue;
        }
        const [sx, sy] = this.worldToScreen(prov.centroid[0], prov.centroid[1]);
        const nation = prov.nationId === null ? null : state.nations[prov.nationId];
        const label = formatTroops(prov.troops);
        const w = Math.max(28, label.length * 6.2 + 11);
        const h = 15;
        const bx = sx - w / 2;
        const by = sy + 8;
        if (!fits(bx, by, w, h, 2)) continue;
        claim(bx, by, w, h);
        roundRect(ctx, bx, by, w, h, 0);
        ctx.fillStyle = 'rgba(6, 10, 15, 0.8)';
        ctx.fill();
        ctx.strokeStyle = nation ? withAlpha(nation.color, 0.85) : 'rgba(150, 160, 170, 0.45)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = '#eaf1f7';
        ctx.font = '13px "VT323", "Pixelify Sans", monospace';
        ctx.fillText(label, sx, by + h / 2 + 0.5);
      }
    }

    // 3. Province names when zoomed in.
    if (showLabels && zoom >= 1.05) {
      const sorted = [...this.world.provinces].sort((a, b) => b.area - a.area);
      for (const prov of sorted) {
        if (prov.bbox.maxX < view.minX || prov.bbox.minX > view.maxX || prov.bbox.maxY < view.minY || prov.bbox.minY > view.maxY) {
          continue;
        }
        if (prov.id === this.selected || prov.id === this.hovered) continue;
        const screenW = (prov.bbox.maxX - prov.bbox.minX) * zoom;
        if (screenW < 62) continue;
        const [sx, sy] = this.worldToScreen(prov.centroid[0], prov.centroid[1]);
        const size = clamp(screenW * 0.08, 8.5, 11.5);
        ctx.font = `600 ${size}px "Pixelify Sans", "Inter", system-ui, sans-serif`;
        const w = ctx.measureText(prov.name.toUpperCase()).width;
        const bx = sx - w / 2;
        const by = sy - 12;
        if (!fits(bx, by, w, size + 3, 2)) continue;
        claim(bx, by, w, size + 3);
        const nation = prov.nationId === null ? null : state.nations[prov.nationId];
        ctx.fillStyle = nation ? 'rgba(252, 249, 240, 0.92)' : 'rgba(213, 219, 225, 0.6)';
        // Hard offset shadow, no blur: the text stays pixel-crisp.
        ctx.fillStyle = 'rgba(3, 7, 11, 0.85)';
        ctx.fillText(prov.name.toUpperCase(), sx + 1.5, by + size / 2 + 2.5);
        ctx.fillStyle = nation ? 'rgba(252, 249, 240, 0.95)' : 'rgba(213, 219, 225, 0.6)';
        ctx.fillText(prov.name.toUpperCase(), sx, by + size / 2 + 1);
      }
    }
    ctx.restore();
  }

  drawEffects(state, zoom) {
    const ctx = this.ctx;
    for (const fx of state.effects) {
      const p = fx.t / (fx.ttl || 2);
      const [sx, sy] = this.worldToScreen(fx.x, fx.y);
      if (fx.type === 'battle' && fx.tiles) {
        // Light catches only the newly taken ground. The ownership beneath this
        // brief glint is permanent and visible even with all effects disabled.
        ctx.save();
        ctx.globalAlpha = (fx.minor ? 0.22 : 0.67) * (1 - p);
        ctx.fillStyle = '#fff0ac';
        const { gridW, pixel } = this.world;
        for (const i of fx.tiles) {
          const [x, y] = this.worldToScreen(i % gridW * pixel, Math.floor(i / gridW) * pixel);
          ctx.fillRect(x, y, pixel * zoom, pixel * zoom);
        }
        ctx.restore();
      } else if (fx.type === 'build' || fx.type === 'nuke' || fx.type === 'battle') {
        const unit = this.world.pixel, radius = Math.floor(2 + p * (fx.type === 'nuke' ? 25 : 4));
        ctx.save();
        ctx.globalAlpha = 1 - p;
        ctx.fillStyle = fx.type === 'nuke' ? '#ffbf72' : '#b6dfd3';
        for (let dx = -radius; dx <= radius; dx++) for (const sign of [-1, 1]) {
          const [x, y] = this.worldToScreen((Math.round(fx.x/unit)+dx)*unit,
            (Math.round(fx.y/unit) + sign*(radius-Math.abs(dx)))*unit);
          ctx.fillRect(x, y, unit*zoom, unit*zoom);
        }
        ctx.restore();
      } else if (fx.type === 'text') {
        ctx.save();
        ctx.globalAlpha = p < 0.15 ? p / 0.15 : 1 - Math.max(0, (p - 0.55) / 0.45);
        ctx.font = '700 15px "Pixelify Sans", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = fx.color || '#fff';
        ctx.shadowColor = 'rgba(0,0,0,0.85)';
        ctx.shadowOffsetX = 1;
        ctx.shadowOffsetY = 2;
        ctx.fillText(fx.text, sx, sy - 24 - p * (fx.rise || 30));
        ctx.restore();
      } else if (fx.type === 'notification') {
        // Rendered by the HUD instead.
      }
    }
  }

  drawMinimap(minimapCanvas, state, { width, height } = {}) {
    const world = this.world;
    if (!world || !minimapCanvas) return;
    const ctx = minimapCanvas.getContext('2d');
    const w = width ?? minimapCanvas.width / this.dpr;
    const h = height ?? minimapCanvas.height / this.dpr;
    if (minimapCanvas.width !== w * this.dpr) {
      minimapCanvas.width = w * this.dpr;
      minimapCanvas.height = h * this.dpr;
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const sx = w / world.width;
    const sy = h / world.height;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.atlas.tiles, 0, 0, w, h);

    // Camera rectangle.
    const cw = (this.width / this.camera.zoom) * sx;
    const ch = (this.height / this.camera.zoom) * sy;
    const cx = (this.camera.x - this.width / (2 * this.camera.zoom)) * sx;
    const cy = (this.camera.y - this.height / (2 * this.camera.zoom)) * sy;
    ctx.strokeStyle = 'rgba(255, 231, 160, 0.9)';
    ctx.lineWidth = 1.4;
    ctx.strokeRect(cx, cy, cw, ch);

    const home = nationSeat(world, state.nations[state.playerNationId]);
    const cell = home && heldCell(home, state.playerNationId);
    if (cell != null) {
      const [wx, wy] = cellCenter(world, cell), x = Math.round(wx*sx), y = Math.round(wy*sy);
      ctx.fillStyle = '#18222a';
      ctx.fillRect(x-1, y-7, 3, 9); ctx.fillRect(x+1, y-7, 6, 5);
      ctx.fillStyle = '#ffdc8a';
      ctx.fillRect(x, y-6, 1, 7); ctx.fillRect(x+1, y-6, 5, 3);
    }
  }
}

/**
 * Label plates are deliberately square: the map is pixel art, so every panel on
 * it gets hard corners. The radius argument is kept for call-site compatibility.
 */
export function roundRect(ctx, x, y, w, h, r = 0) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  if (radius <= 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

export function formatTroops(troops) {
  const men = Math.round(troops * 1000);
  if (men >= 1_000_000) return `${(men / 1_000_000).toFixed(2)}M`;
  if (men >= 1_000) return `${(men / 1000).toFixed(men >= 100_000 ? 0 : 1)}k`;
  return `${men}`;
}
