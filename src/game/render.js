// Canvas map renderer: ocean, terrain relief, political fills, borders,
// army markers, effects and labels. Works in the browser and in headless
// node-canvas for offline previews.

import { TERRAIN } from './worldgen.js';
import { clamp } from './geom.js';
import { mix, darken, lighten, withAlpha } from './color.js';

const TAU = Math.PI * 2;

// The political map is rasterised into a world-anchored buffer where one block
// covers PIXEL world units, then scaled up with smoothing disabled. Territory,
// coastlines, borders and takeovers therefore read as pixel art at every zoom.
const PIXEL = 4;

// How long the blocky takeover sweep takes to paint a captured province.
const TAKEOVER_TIME = 0.9;

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
    this.borderSegments = [];
    this.borderSegmentKey = '';
    this.baseCanvas = null;
    this.reliefCanvas = null;
    this.minimapBase = null;
    this.borderDirty = true;
    this.pixelScale = PIXEL;
    this.politicalCanvas = null;
    this.politicalKey = null;
    this.lastOwnerKey = '';
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
    this.lastOwnerKey = '';
    this.lastDrawnOwnerKey = '';
    this.borderSegmentKey = '';
    this.buildBase();
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
    const halfW = this.width / (2 * this.camera.zoom);
    const halfH = this.height / (2 * this.camera.zoom);
    const pad = 80;
    this.camera.x = clamp(this.camera.x, Math.min(halfW, this.world.width / 2) - pad, Math.max(this.world.width - halfW, this.world.width / 2) + pad);
    this.camera.y = clamp(this.camera.y, Math.min(halfH, this.world.height / 2) - pad, Math.max(this.world.height - halfH, this.world.height / 2) + pad);
  }

  focusProvince(prov, zoom = null) {
    if (!prov) return;
    if (zoom) this.camera.zoom = clamp(zoom, 0.3, 3.2);
    this.camera.x = prov.centroid[0];
    this.camera.y = prov.centroid[1];
    this.clampCamera();
  }

  // --------------------------------------------------------------- prerender
  buildBase() {
    const world = this.world;
    const W = world.width;
    const H = world.height;
    const base = this.surface(W, H);
    const bctx = base.getContext('2d');

    // Ocean: depth bands from the distance-to-land field.
    const ocean = this.surface(world.gridW, world.gridH);
    const octx = ocean.getContext('2d');
    const img = octx.createImageData(world.gridW, world.gridH);
    const data = img.data;
    const deep = { r: 7, g: 20, b: 33 };
    const shallow = { r: 24, g: 68, b: 88 };
    const shelf = { r: 40, g: 96, b: 114 };
    for (let i = 0; i < world.distance.length; i += 1) {
      const d = world.distance[i];
      const o = i * 4;
      if (world.land[i]) {
        data[o + 3] = 0;
        continue;
      }
      let t = clamp(d / 34, 0, 1);
      t = Math.pow(t, 0.62);
      // Hard depth bands: the sea reads as stepped pixel strata, not a gradient.
      t = Math.round(t * 5) / 5;
      let r = shallow.r + (deep.r - shallow.r) * t;
      let g = shallow.g + (deep.g - shallow.g) * t;
      let b = shallow.b + (deep.b - shallow.b) * t;
      if (d < 5) {
        const s = 1 - d / 5;
        r += (shelf.r - r) * s * 0.75;
        g += (shelf.g - g) * s * 0.75;
        b += (shelf.b - b) * s * 0.75;
      }
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
    octx.putImageData(img, 0, 0);

    bctx.imageSmoothingEnabled = true;
    bctx.drawImage(ocean, 0, 0, W, H);

    // Graticule.
    bctx.save();
    bctx.strokeStyle = 'rgba(150, 205, 235, 0.055)';
    bctx.lineWidth = 1.2;
    for (let x = 120; x < W; x += 120) {
      bctx.beginPath();
      bctx.moveTo(x, 0);
      bctx.lineTo(x, H);
      bctx.stroke();
    }
    for (let y = 120; y < H; y += 120) {
      bctx.beginPath();
      bctx.moveTo(0, y);
      bctx.lineTo(W, y);
      bctx.stroke();
    }
    bctx.restore();

    // Land shadow.
    const landPath = new Path2DLike();
    for (const ring of world.coastRings) landPath.ring(ring);
    bctx.save();
    bctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
    bctx.shadowBlur = 26;
    bctx.fillStyle = '#22302a';
    landPath.fill(bctx);
    bctx.restore();

    // Land base colour (visible in the seams between province polygons).
    bctx.save();
    bctx.fillStyle = '#243329';
    landPath.fill(bctx);
    bctx.restore();

    // Beach ring.
    bctx.save();
    bctx.lineJoin = 'round';
    bctx.strokeStyle = 'rgba(214, 196, 148, 0.30)';
    bctx.lineWidth = 7;
    landPath.stroke(bctx);
    bctx.strokeStyle = 'rgba(231, 217, 175, 0.55)';
    bctx.lineWidth = 2.2;
    landPath.stroke(bctx);
    bctx.restore();

    this.baseCanvas = base;

    // Relief shading (multiplied over the political map at draw time).
    const relief = this.surface(world.gridW, world.gridH);
    const rctx = relief.getContext('2d');
    const rimg = rctx.createImageData(world.gridW, world.gridH);
    const rd = rimg.data;
    const gw = world.gridW;
    const gh = world.gridH;
    for (let y = 0; y < gh; y += 1) {
      for (let x = 0; x < gw; x += 1) {
        const i = y * gw + x;
        const o = i * 4;
        if (!world.land[i]) {
          rd[o + 3] = 0;
          continue;
        }
        const xm = x > 0 ? i - 1 : i;
        const xp = x < gw - 1 ? i + 1 : i;
        const ym = y > 0 ? i - gw : i;
        const yp = y < gh - 1 ? i + gw : i;
        const dx = world.elevation[xp] - world.elevation[xm];
        const dy = world.elevation[yp] - world.elevation[ym];
        const shade = Math.round(clamp(0.5 - dx * 7 - dy * 4, 0, 1) * 3) / 3;
        const v = Math.round(142 + shade * 178);
        rd[o] = v;
        rd[o + 1] = v;
        rd[o + 2] = v;
        rd[o + 3] = world.land[i] ? 105 : 0;
      }
    }
    rctx.putImageData(rimg, 0, 0);
    this.reliefCanvas = relief;
  }

  // ------------------------------------------------------------ border cache
  factionOf(prov) {
    return prov.nationId === null ? `t${prov.tribeId}` : `n${prov.nationId}`;
  }

  ownerKeyOf(state) {
    let key = '';
    for (const p of state.provinces) key += `${p.nationId},`;
    return key;
  }

  updateBorderSegments(state) {
    const key = this.ownerKeyOf(state);
    if (key === this.borderSegmentKey) return;
    this.borderSegmentKey = key;
    const world = this.world;
    this.borderSegments = (world.borderChains || []).filter((chain) => {
      const ownerA = world.provinces[chain.a];
      const ownerB = world.provinces[chain.b];
      return this.factionOf(ownerA) !== this.factionOf(ownerB);
    });
  }

  // -------------------------------------------------------------------- draw
  draw(state, { time = 0, showLabels = true, showTroops = true, selectedId = null, hoveredId = null } = {}) {
    const ctx = this.ctx;
    const world = this.world;
    this.time = time;
    if (!world) return;

    this.updateBorderSegments(state);

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
    ctx.imageSmoothingEnabled = true;

    // ---- crisp interaction layer on top of the blocks
    this.drawAttackPreview(state, zoom);
    this.drawExpeditions(state, zoom);
    ctx.restore();

    // ---------------------------------------------------- screen-space layer
    this.drawOverlay(state, zoom, view, { showLabels, showTroops, playerId });
    this.drawEffects(state, zoom);
  }

  // -------------------------------------------------------------- pixel layer
  // The political map lives in its own low-resolution, world-anchored buffer:
  // one block = PIXEL world units. It is scaled up with smoothing disabled, so
  // blocks behave like pixel art — chunky at every zoom level — and it is only
  // rebuilt when ownership changes or a takeover sweep is playing.
  provinceFill(state, prov) {
    const nation = prov.nationId === null ? null : state.nations[prov.nationId];
    const tribe =
      prov.tribeId !== null && prov.tribeId !== undefined ? this.world.tribes[prov.tribeId] : null;
    const baseColor = nation ? nation.color : tribe ? tribe.color : '#4a5560';
    const terrain = TERRAIN[prov.terrain] || TERRAIN.plains;
    let fill = mix(baseColor, terrain.color, nation ? 0.16 : 0.3);
    if (!nation) fill = mix(fill, '#33404b', 0.12);
    return fill;
  }

  /** 0..1 progress of the blocky takeover sweep, or 1 when nothing is happening. */
  takeoverProgress(state, prov) {
    if (prov.captureTime === undefined || prov.captureTime === null) return 1;
    const age = state.time - prov.captureTime;
    if (!(age >= 0) || age > TAKEOVER_TIME) return 1;
    return age / TAKEOVER_TIME;
  }

  politicalLayer(state, selectedId = null, hoveredId = null) {
    const world = this.world;
    const P = this.pixelScale;
    const w = Math.ceil(world.width / P);
    const h = Math.ceil(world.height / P);

    let canvas = this.politicalCanvas;
    if (!canvas || canvas.width !== w || canvas.height !== h) {
      canvas = this.surface(w, h);
      this.politicalCanvas = canvas;
      this.politicalKey = null;
    }

    const ownerKey = `${this.ownerKeyOf(state)}|${selectedId}|${hoveredId}`;
    const sweeping = state.provinces.some((p) => this.takeoverProgress(state, p) < 1);
    if (ownerKey === this.politicalKey && !sweeping) return canvas;
    this.politicalKey = ownerKey;

    const pctx = canvas.getContext('2d');
    pctx.setTransform(1, 0, 0, 1, 0, 0);
    pctx.fillStyle = '#081725';
    pctx.fillRect(0, 0, w, h);

    pctx.save();
    pctx.scale(1 / P, 1 / P);

    // Terrain base, sampled down to blocks.
    pctx.imageSmoothingEnabled = true;
    pctx.drawImage(this.baseCanvas, 0, 0, world.width, world.height);
    pctx.imageSmoothingEnabled = false;

    // Political fills, with a blocky wipe for provinces taken moments ago.
    for (const prov of world.provinces) {
      const box = prov.bbox;
      let fill = this.provinceFill(state, prov);
      if (prov.id === selectedId) fill = lighten(fill, 0.18);
      else if (prov.id === hoveredId) fill = lighten(fill, 0.1);
      const progress = this.takeoverProgress(state, prov);

      if (progress >= 1) {
        pctx.fillStyle = fill;
        this.fillProvinceShape(pctx, prov);
        continue;
      }

      // The old flag stays legible under the blocky sweep of the new one.
      const prevNation = prov.prevOwnerId == null ? null : state.nations[prov.prevOwnerId];
      const prevTribe =
        prov.tribeId !== null && prov.tribeId !== undefined ? world.tribes[prov.tribeId] : null;
      const terrainColor = (TERRAIN[prov.terrain] || TERRAIN.plains).color;
      pctx.fillStyle = prevNation
        ? mix(prevNation.color, terrainColor, 0.16)
        : prevTribe
        ? mix(prevTribe.color, terrainColor, 0.3)
        : '#4a5560';
      this.fillProvinceShape(pctx, prov);

      const sweep = clamp(box.minX + (box.maxX - box.minX) * progress, box.minX - 2, box.maxX + 2);
      pctx.save();
      pctx.beginPath();
      pctx.rect(box.minX - 2, box.minY - 2, sweep - box.minX + 2, box.maxY - box.minY + 4);
      pctx.clip();
      pctx.fillStyle = fill;
      this.fillProvinceShape(pctx, prov);
      // Bright leading edge of the advance.
      pctx.globalAlpha = 0.8;
      pctx.fillStyle = '#fff4d0';
      pctx.fillRect(sweep - P, box.minY - 2, P, box.maxY - box.minY + 4);
      pctx.restore();
    }

    // Relief texture, overlaid on the flat political colours.
    pctx.save();
    pctx.globalCompositeOperation = 'overlay';
    pctx.globalAlpha = 0.3;
    pctx.drawImage(this.reliefCanvas, 0, 0, world.width, world.height);
    pctx.restore();

    // Province seams and national borders: measured in blocks, not pixels.
    pctx.lineJoin = 'round';
    pctx.lineCap = 'round';
    pctx.beginPath();
    for (const prov of world.provinces) {
      for (const ring of prov.parts) {
        pctx.moveTo(ring[0][0], ring[0][1]);
        for (let i = 1; i < ring.length; i += 1) pctx.lineTo(ring[i][0], ring[i][1]);
        pctx.closePath();
      }
    }
    pctx.strokeStyle = 'rgba(9, 14, 19, 0.40)';
    pctx.lineWidth = P;
    pctx.stroke();

    if (this.borderSegments.length) {
      const trace = () => {
        pctx.beginPath();
        for (const chain of this.borderSegments) {
          const pts = chain.points;
          if (!pts.length) continue;
          pctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i += 1) pctx.lineTo(pts[i][0], pts[i][1]);
        }
      };
      trace();
      pctx.strokeStyle = 'rgba(4, 7, 10, 0.85)';
      pctx.lineWidth = P * 2;
      pctx.stroke();
      trace();
      pctx.strokeStyle = 'rgba(252, 245, 226, 0.95)';
      pctx.lineWidth = P;
      pctx.stroke();
    }

    // Selected / hovered provinces get a hard block outline, no glow.
    const outline = (prov, color, width) => {
      pctx.beginPath();
      for (const ring of prov.parts) {
        pctx.moveTo(ring[0][0], ring[0][1]);
        for (let i = 1; i < ring.length; i += 1) pctx.lineTo(ring[i][0], ring[i][1]);
        pctx.closePath();
      }
      pctx.strokeStyle = color;
      pctx.lineWidth = width;
      pctx.stroke();
    };
    if (hoveredId !== null && hoveredId !== undefined && hoveredId !== selectedId && world.provinces[hoveredId]) {
      outline(world.provinces[hoveredId], 'rgba(255, 255, 255, 0.75)', P);
    }
    if (selectedId !== null && selectedId !== undefined && world.provinces[selectedId]) {
      outline(world.provinces[selectedId], '#ffe27a', P * 1.5);
    }

    pctx.restore();
    return canvas;
  }

  fillProvinceShape(ctx, prov) {
    ctx.beginPath();
    for (const ring of prov.parts) {
      ctx.moveTo(ring[0][0], ring[0][1]);
      for (let i = 1; i < ring.length; i += 1) ctx.lineTo(ring[i][0], ring[i][1]);
      ctx.closePath();
    }
    ctx.fill();
  }

  drawExpeditions(state, zoom) {
    const ctx = this.ctx;
    const world = this.world;
    for (const exp of state.expeditions) {
      const from = world.provinces[exp.fromId];
      const to = world.provinces[exp.toId];
      const t = clamp((state.time - exp.startTime) / Math.max(0.01, exp.arriveTime - exp.startTime), 0, 1);
      const sx = from.centroid[0];
      const sy = from.centroid[1];
      const tx = to.centroid[0];
      const ty = to.centroid[1];
      const mx = (sx + tx) / 2;
      const my = (sy + ty) / 2 - Math.hypot(tx - sx, ty - sy) * 0.28;
      const px = (1 - t) * (1 - t) * sx + 2 * (1 - t) * t * mx + t * t * tx;
      const py = (1 - t) * (1 - t) * sy + 2 * (1 - t) * t * my + t * t * ty;
      const nation = state.nations[exp.nationId];
      ctx.save();
      ctx.setLineDash([7 / zoom, 7 / zoom]);
      ctx.strokeStyle = withAlpha(nation.color, 0.5);
      ctx.lineWidth = 1.6 / zoom;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(mx, my, tx, ty);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#eaf2f8';
      ctx.beginPath();
      ctx.arc(px, py, 5 / zoom, 0, TAU);
      ctx.fill();
      ctx.fillStyle = nation.color;
      ctx.beginPath();
      ctx.arc(px, py, 3 / zoom, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  drawExpeditions(state, zoom) {
    const ctx = this.ctx;
    const world = this.world;
    for (const exp of state.expeditions) {
      const from = world.provinces[exp.fromId];
      const to = world.provinces[exp.toId];
      const t = clamp((state.time - exp.startTime) / Math.max(0.01, exp.arriveTime - exp.startTime), 0, 1);
      const sx = from.centroid[0];
      const sy = from.centroid[1];
      const tx = to.centroid[0];
      const ty = to.centroid[1];
      const mx = (sx + tx) / 2;
      const my = (sy + ty) / 2 - Math.hypot(tx - sx, ty - sy) * 0.28;
      const px = (1 - t) * (1 - t) * sx + 2 * (1 - t) * t * mx + t * t * tx;
      const py = (1 - t) * (1 - t) * sy + 2 * (1 - t) * t * my + t * t * ty;
      const nation = state.nations[exp.nationId];
      ctx.save();
      ctx.setLineDash([7 / zoom, 7 / zoom]);
      ctx.strokeStyle = withAlpha(nation.color, 0.5);
      ctx.lineWidth = 1.6 / zoom;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(mx, my, tx, ty);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#eaf2f8';
      ctx.beginPath();
      ctx.arc(px, py, 5 / zoom, 0, TAU);
      ctx.fill();
      ctx.fillStyle = nation.color;
      ctx.beginPath();
      ctx.arc(px, py, 3 / zoom, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  drawSelection(selectedId, hoveredId, zoom) {
    const ctx = this.ctx;
    const world = this.world;
    const selected = selectedId !== null && selectedId !== undefined ? world.provinces[selectedId] : null;
    if (selected) {
      ctx.save();
      ctx.beginPath();
      for (const ring of selected.parts) {
        ctx.moveTo(ring[0][0], ring[0][1]);
        for (let i = 1; i < ring.length; i += 1) ctx.lineTo(ring[i][0], ring[i][1]);
        ctx.closePath();
      }
      ctx.lineWidth = 3.5 / zoom;
      ctx.strokeStyle = 'rgba(255, 225, 130, 0.95)';
      ctx.shadowColor = 'rgba(255, 200, 80, 0.9)';
      ctx.shadowBlur = 16 / zoom;
      ctx.stroke();
      ctx.restore();
    }

    const hovered = hoveredId !== null && hoveredId !== undefined && hoveredId !== selectedId ? world.provinces[hoveredId] : null;
    if (hovered) {
      ctx.save();
      ctx.beginPath();
      for (const ring of hovered.parts) {
        ctx.moveTo(ring[0][0], ring[0][1]);
        for (let i = 1; i < ring.length; i += 1) ctx.lineTo(ring[i][0], ring[i][1]);
        ctx.closePath();
      }
      ctx.lineWidth = 2.5 / zoom;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.stroke();
      ctx.restore();
    }
  }

  drawExpeditions(state, zoom) {
    const ctx = this.ctx;
    const world = this.world;
    for (const exp of state.expeditions) {
      const from = world.provinces[exp.fromId];
      const to = world.provinces[exp.toId];
      const t = clamp((state.time - exp.startTime) / Math.max(0.01, exp.arriveTime - exp.startTime), 0, 1);
      const sx = from.centroid[0];
      const sy = from.centroid[1];
      const tx = to.centroid[0];
      const ty = to.centroid[1];
      const mx = (sx + tx) / 2;
      const my = (sy + ty) / 2 - Math.hypot(tx - sx, ty - sy) * 0.28;
      const px = (1 - t) * (1 - t) * sx + 2 * (1 - t) * t * mx + t * t * tx;
      const py = (1 - t) * (1 - t) * sy + 2 * (1 - t) * t * my + t * t * ty;
      const nation = state.nations[exp.nationId];
      ctx.save();
      ctx.setLineDash([7 / zoom, 7 / zoom]);
      ctx.strokeStyle = withAlpha(nation.color, 0.5);
      ctx.lineWidth = 1.6 / zoom;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(mx, my, tx, ty);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#eaf2f8';
      ctx.beginPath();
      ctx.arc(px, py, 5 / zoom, 0, TAU);
      ctx.fill();
      ctx.fillStyle = nation.color;
      ctx.beginPath();
      ctx.arc(px, py, 3 / zoom, 0, TAU);
      ctx.fill();
      ctx.restore();
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
    const unit = 10 / zoom;
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
    ctx.lineWidth = 4 / zoom;
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
      const block = 7 / zoom;
      ctx.fillStyle = '#fff2c4';
      for (let k = 0; k < 4; k += 1) {
        const d = ((this.time * total * 0.35 + k * (total / 4)) % total + total) % total;
        const seg = segments.find((s2) => d >= s2.start && d <= s2.start + s2.len) || segments[segments.length - 1];
        const t = seg.len > 0 ? (d - seg.start) / seg.len : 0;
        const px2 = seg.from[0] + (seg.to[0] - seg.from[0]) * t;
        const py2 = seg.from[1] + (seg.to[1] - seg.from[1]) * t;
        ctx.fillRect(px2 - block / 2, py2 - block / 2, block, block);
      }
    }

    // Square-headed arrow tip.
    const last = pts[pts.length - 2];
    const angle = Math.atan2(by - last[1], bx - last[0]);
    const head = 13 / zoom;
    ctx.translate(bx, by);
    ctx.rotate(angle);
    ctx.fillStyle = stroke;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-head, head * 0.72);
    ctx.lineTo(-head * 0.55, 0);
    ctx.lineTo(-head, -head * 0.72);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  nationSeat(state, nation) {
    const world = this.world;
    if (!nation || !nation.alive) return null;
    const cap = world.provinces[nation.capitalId];
    if (cap && cap.nationId === nation.id) return cap;
    let best = null;
    for (const prov of world.provinces) {
      if (prov.nationId !== nation.id) continue;
      if (!best || prov.area > best.area) best = prov;
    }
    return best;
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
        const seat = this.nationSeat(state, nation);
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
        const py = sy - 56;
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
        // Star for the capital.
        drawStar(ctx, sx, sy - 22, isPlayer ? 9.5 : 8, nation.color, 'rgba(6,10,14,0.95)');
        claim(sx - 11, sy - 33, 22, 22);
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
        if (prov.buildings && prov.buildings.silo > 0) {
          ctx.fillStyle = '#ffcf5c';
          ctx.font = '11px system-ui';
          ctx.fillText('☢', sx + w / 2 + 8, by + h / 2);
        }
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
      if (fx.type === 'battle') {
        const minor = fx.minor === true;
        const r = (minor ? 5 + p * 16 : 8 + p * 34);
        ctx.save();
        ctx.globalAlpha = (1 - p) * (minor ? 0.45 : 1);
        ctx.strokeStyle = fx.win ? '#ffe066' : '#ff6b6b';
        ctx.lineWidth = (minor ? 1.2 : 3 * (1 - p) + 0.6);
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, TAU);
        ctx.stroke();
        if (!minor) {
          ctx.beginPath();
          ctx.arc(sx, sy, r * 0.55, 0, TAU);
          ctx.stroke();
        }
        ctx.restore();
      } else if (fx.type === 'nuke') {
        ctx.save();
        const r = 10 + p * 170;
        ctx.globalAlpha = Math.max(0, 1 - p);
        const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
        grad.addColorStop(0, 'rgba(255, 244, 196, 0.95)');
        grad.addColorStop(0.35, 'rgba(255, 150, 60, 0.55)');
        grad.addColorStop(1, 'rgba(120, 40, 10, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, TAU);
        ctx.fill();
        ctx.restore();
      } else if (fx.type === 'build') {
        ctx.save();
        ctx.globalAlpha = 1 - p;
        ctx.strokeStyle = '#8fd6ff';
        ctx.lineWidth = 2;
        const r = 6 + p * 22;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, TAU);
        ctx.stroke();
        ctx.restore();
      } else if (fx.type === 'text') {
        ctx.save();
        ctx.globalAlpha = p < 0.15 ? p / 0.15 : 1 - Math.max(0, (p - 0.55) / 0.45);
        ctx.font = '700 15px "Inter", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = fx.color || '#fff';
        ctx.shadowColor = 'rgba(0,0,0,0.85)';
        ctx.shadowBlur = 6;
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
    const w = width || minimapCanvas.width;
    const h = height || minimapCanvas.height;
    if (minimapCanvas.width !== w * this.dpr) {
      minimapCanvas.width = w * this.dpr;
      minimapCanvas.height = h * this.dpr;
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const sx = w / world.width;
    const sy = h / world.height;
    ctx.fillStyle = '#0a1c2a';
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.scale(sx, sy);
    for (const prov of world.provinces) {
      const nation = prov.nationId === null ? null : state.nations[prov.nationId];
      const tribe = prov.tribeId !== null && prov.tribeId !== undefined ? world.tribes[prov.tribeId] : null;
      ctx.beginPath();
      for (const ring of prov.parts) {
        ctx.moveTo(ring[0][0], ring[0][1]);
        for (let i = 1; i < ring.length; i += 1) ctx.lineTo(ring[i][0], ring[i][1]);
        ctx.closePath();
      }
      ctx.fillStyle = nation ? nation.color : tribe ? darken(tribe.color, 0.1) : '#3b4653';
      ctx.fill();
    }
    ctx.restore();

    // Camera rectangle.
    const cw = (this.width / this.camera.zoom) * sx;
    const ch = (this.height / this.camera.zoom) * sy;
    const cx = (this.camera.x - this.width / (2 * this.camera.zoom)) * sx;
    const cy = (this.camera.y - this.height / (2 * this.camera.zoom)) * sy;
    ctx.strokeStyle = 'rgba(255, 231, 160, 0.9)';
    ctx.lineWidth = 1.4;
    ctx.strokeRect(cx, cy, cw, ch);
  }
}

// Minimal Path2D-compatible helper (node-canvas Path2D support varies).
class Path2DLike {
  constructor() {
    this.rings = [];
  }

  ring(ring) {
    this.rings.push(ring);
  }

  path(ctx) {
    ctx.beginPath();
    for (const ring of this.rings) {
      if (!ring.length) continue;
      ctx.moveTo(ring[0][0], ring[0][1]);
      for (let i = 1; i < ring.length; i += 1) ctx.lineTo(ring[i][0], ring[i][1]);
      ctx.closePath();
    }
  }

  fill(ctx) {
    this.path(ctx);
    ctx.fill();
  }

  stroke(ctx) {
    this.path(ctx);
    ctx.stroke();
  }
}

export function fillRingsInto(rings, buffer, w, h, scale, value) {
  for (const ring of rings) {
    const n = ring.length;
    if (n < 3) continue;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i += 1) {
      const y = ring[i][1];
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const y0 = Math.max(0, Math.floor(minY * scale));
    const y1 = Math.min(h - 1, Math.ceil(maxY * scale));
    const xs = [];
    for (let py = y0; py <= y1; py += 1) {
      const sy = (py + 0.5) / scale;
      xs.length = 0;
      for (let i = 0; i < n; i += 1) {
        const a = ring[i];
        const b = ring[(i + 1) % n];
        if (a[1] > sy !== b[1] > sy) {
          xs.push(a[0] + ((sy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xs[k] * scale - 0.5));
        const xb = Math.min(w - 1, Math.floor(xs[k + 1] * scale - 0.5));
        for (let x = xa; x <= xb; x += 1) buffer[py * w + x] = value;
      }
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

export function drawStar(ctx, cx, cy, r, fill, stroke) {
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const rad = i % 2 === 0 ? r : r * 0.45;
    const x = cx + Math.cos(angle) * rad;
    const y = cy + Math.sin(angle) * rad;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }
  ctx.restore();
}

export function formatTroops(troops) {
  const men = Math.round(troops * 1000);
  if (men >= 1_000_000) return `${(men / 1_000_000).toFixed(2)}M`;
  if (men >= 1_000) return `${(men / 1000).toFixed(men >= 100_000 ? 0 : 1)}k`;
  return `${men}`;
}
