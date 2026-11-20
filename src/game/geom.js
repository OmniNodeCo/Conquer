// Geometry helpers: marching-squares contour extraction, ring simplification,
// smoothing, areas, centroids and hit testing. No external dependencies.

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

// ---------------------------------------------------------------------------
// Marching squares over a binary mask (Uint8Array, row major, w*h).
// Returns closed rings in grid coordinates. Points sit on cell edges so that
// neighbouring cells produce exactly matching vertices (needed for stitching).
// ---------------------------------------------------------------------------

const EDGE_TOP = 0;
const EDGE_RIGHT = 1;
const EDGE_BOTTOM = 2;
const EDGE_LEFT = 3;

function edgePoint(x, y, edge) {
  if (edge === EDGE_TOP) return [x + 0.5, y];
  if (edge === EDGE_RIGHT) return [x + 1, y + 0.5];
  if (edge === EDGE_BOTTOM) return [x + 0.5, y + 1];
  return [x, y + 0.5];
}

// case -> list of [fromEdge, toEdge]
const CASES = [
  [], // 0
  [[EDGE_LEFT, EDGE_TOP]], // 1  a
  [[EDGE_TOP, EDGE_RIGHT]], // 2  b
  [[EDGE_LEFT, EDGE_RIGHT]], // 3  ab
  [[EDGE_RIGHT, EDGE_BOTTOM]], // 4  c
  [[EDGE_LEFT, EDGE_BOTTOM], [EDGE_TOP, EDGE_RIGHT]], // 5 ambiguous
  [[EDGE_TOP, EDGE_BOTTOM]], // 6  bc
  [[EDGE_LEFT, EDGE_BOTTOM]], // 7  abc
  [[EDGE_BOTTOM, EDGE_LEFT]], // 8  d
  [[EDGE_TOP, EDGE_BOTTOM]], // 9  ad
  [[EDGE_TOP, EDGE_LEFT], [EDGE_BOTTOM, EDGE_RIGHT]], // 10 ambiguous
  [[EDGE_RIGHT, EDGE_BOTTOM]], // 11 abd
  [[EDGE_RIGHT, EDGE_LEFT]], // 12 cd
  [[EDGE_TOP, EDGE_RIGHT]], // 13 acd
  [[EDGE_LEFT, EDGE_TOP]], // 14 bcd
  [], // 15
];

const keyOf = (p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;

export function marchingSquares(mask, w, h) {
  const segments = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const a = mask[y * w + x] ? 1 : 0;
      const b = mask[y * w + x + 1] ? 2 : 0;
      const c = mask[(y + 1) * w + (x + 1)] ? 4 : 0;
      const d = mask[(y + 1) * w + x] ? 8 : 0;
      const code = a | b | c | d;
      if (code === 0 || code === 15) continue;
      const list = CASES[code];
      if (!list.length) continue;
      for (const [from, to] of list) {
        segments.push([edgePoint(x, y, from), edgePoint(x, y, to)]);
      }
    }
  }

  // Stitch segments into rings by matching endpoints.
  const byPoint = new Map();
  segments.forEach((seg, i) => {
    for (const p of seg) {
      const k = keyOf(p);
      if (!byPoint.has(k)) byPoint.set(k, []);
      byPoint.get(k).push(i);
    }
  });

  const used = new Uint8Array(segments.length);
  const rings = [];
  for (let i = 0; i < segments.length; i += 1) {
    if (used[i]) continue;
    const ring = [];
    let current = segments[i];
    let currentIndex = i;
    used[i] = 1;
    ring.push(current[0]);
    let guard = 0;
    while (guard < segments.length * 4) {
      guard += 1;
      const tail = current[1];
      ring.push(tail);
      const k = keyOf(tail);
      const candidates = byPoint.get(k) || [];
      let nextIndex = -1;
      for (const cand of candidates) {
        if (!used[cand]) {
          nextIndex = cand;
          break;
        }
      }
      if (nextIndex === -1) break;
      used[nextIndex] = 1;
      current = segments[nextIndex];
      currentIndex = nextIndex;
      if (keyOf(current[0]) !== k) {
        // Traverse the segment backwards.
        current = [current[1], current[0]];
      }
      if (keyOf(current[1]) === keyOf(ring[0]) && ring.length > 2) {
        break;
      }
    }
    if (ring.length > 3) rings.push(ring);
  }

  return rings;
}

// ---------------------------------------------------------------------------
// Ring utilities
// ---------------------------------------------------------------------------

export function ringPerimeter(ring) {
  let p = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    p += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return p;
}

export function ringArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

export function ringCentroid(ring) {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const cross = p[0] * q[1] - q[0] * p[1];
    a += cross;
    cx += (p[0] + q[0]) * cross;
    cy += (p[1] + q[1]) * cross;
  }
  if (Math.abs(a) < 1e-6) {
    let sx = 0;
    let sy = 0;
    for (const p of ring) {
      sx += p[0];
      sy += p[1];
    }
    return [sx / ring.length, sy / ring.length];
  }
  a *= 0.5;
  return [cx / (6 * a), cy / (6 * a)];
}

export function ringBBox(ring) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// Ramer–Douglas–Peucker for closed rings.
export function simplifyRing(ring, tolerance) {
  if (ring.length < 4) return ring.slice();
  const pts = ring.slice();
  // Split ring at the point farthest from the first point to make RDP stable.
  let far = 0;
  let farD = -1;
  for (let i = 1; i < pts.length; i += 1) {
    const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2;
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const partA = pts.slice(0, far + 1);
  const partB = pts.slice(far).concat([pts[0]]);

  const rdp = (arr) => {
    if (arr.length < 3) return arr.slice();
    const first = arr[0];
    const last = arr[arr.length - 1];
    let maxD = -1;
    let idx = -1;
    const dx = last[0] - first[0];
    const dy = last[1] - first[1];
    const len = Math.hypot(dx, dy) || 1e-9;
    for (let i = 1; i < arr.length - 1; i += 1) {
      const p = arr[i];
      const d = Math.abs(dy * p[0] - dx * p[1] + last[0] * first[1] - last[1] * first[0]) / len;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD <= tolerance || idx === -1) return [first, last];
    const left = rdp(arr.slice(0, idx + 1));
    const right = rdp(arr.slice(idx));
    return left.slice(0, -1).concat(right);
  };

  const outA = rdp(partA);
  const outB = rdp(partB);
  const out = outA.concat(outB.slice(1, -1));
  return out.length >= 3 ? out : ring.slice();
}

// Chaikin corner cutting, keeps rings smooth.
export function smoothRing(ring, iterations = 2) {
  let pts = ring;
  for (let it = 0; it < iterations; it += 1) {
    const next = [];
    for (let i = 0; i < pts.length; i += 1) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      next.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25]);
      next.push([p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75]);
    }
    pts = next;
  }
  return pts;
}

// Chaikin smoothing for open polylines (endpoints preserved).
export function smoothPolyline(points, iterations = 2) {
  let pts = points;
  for (let it = 0; it < iterations; it += 1) {
    if (pts.length < 3) return pts;
    const next = [pts[0]];
    for (let i = 0; i < pts.length - 1; i += 1) {
      const p = pts[i];
      const q = pts[i + 1];
      next.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25]);
      next.push([p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75]);
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }
  return pts;
}

// Push a ring's vertices outward (closes hairline gaps
// between neighbouring provinces created by smoothing).
export function expandRing(ring, amount) {
  const [cx, cy] = ringCentroid(ring);
  return ring.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return [x + (dx / len) * amount, y + (dy / len) * amount];
  });
}

// Scanline polygon fill into a Uint8Array owner map (values 0 = empty).
export function rasterizeRing(ring, ids, w, h) {
  const { minY, maxY } = ringBBox(ring);
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(h - 1, Math.ceil(maxY));
  const xs = [];
  for (let y = y0; y <= y1; y += 1) {
    xs.length = 0;
    const sy = y + 0.5;
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      if (a[1] > sy !== b[1] > sy) {
        xs.push(a[0] + ((sy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k] - 0.5));
      const xb = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = xa; x <= xb; x += 1) ids[y * w + x] = 1;
    }
  }
}

export function resampleRing(ring, spacing) {
  const out = [];
  const per = ringPerimeter(ring);
  const count = Math.max(8, Math.round(per / spacing));
  let acc = 0;
  let target = 0;
  for (let i = 0; i < ring.length && out.length < count; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (acc + seg >= target && out.length < count) {
      const t = (target - acc) / (seg || 1);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      target += spacing;
    }
    acc += seg;
  }
  return out;
}
