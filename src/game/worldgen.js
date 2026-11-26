// Procedural world generation for Conquer: Rule the Globe.
//
// Pipeline: noise elevation -> land mask -> province seeds (farthest point
// sampling + Lloyd relaxation) -> pixel Voronoi -> contour extraction and
// smoothing -> terrain, population, adjacency, naval lanes -> nations.

import { makeRng } from './rng.js';
import { fbm2, ridgedFbm2, warpedFbm2 } from './noise.js';
import {
  marchingSquares,
  simplifyRing,
  smoothRing,
  smoothPolyline,
  ringArea,
  ringBBox,
  ringCentroid,
  expandRing,
  pointInRing,
  dist,
  clamp,
} from './geom.js';

export const GRID_W = 480;
export const GRID_H = 270;
export const PIXEL = 4; // world units per grid pixel
export const WORLD_W = GRID_W * PIXEL;
export const WORLD_H = GRID_H * PIXEL;

export const TERRAIN = {
  plains: { key: 'plains', label: 'Plains', color: '#8fa568', defense: 0.0, fertility: 1.0 },
  forest: { key: 'forest', label: 'Forest', color: '#55774c', defense: 0.22, fertility: 0.92 },
  jungle: { key: 'jungle', label: 'Jungle', color: '#3d6b48', defense: 0.3, fertility: 0.78 },
  desert: { key: 'desert', label: 'Desert', color: '#b99a63', defense: 0.12, fertility: 0.38 },
  steppe: { key: 'steppe', label: 'Steppe', color: '#97a06b', defense: 0.05, fertility: 0.66 },
  tundra: { key: 'tundra', label: 'Tundra', color: '#93a6a9', defense: 0.16, fertility: 0.28 },
  mountain: { key: 'mountain', label: 'Highlands', color: '#8d8375', defense: 0.55, fertility: 0.34 },
  island: { key: 'island', label: 'Island', color: '#7f9a6e', defense: 0.1, fertility: 0.8 },
};

const NATION_COLORS = [
  '#d24b41', '#3f7dce', '#dd9f2f', '#3f9c67', '#9a5cc0', '#dd7736',
  '#2aa8a3', '#c24a83', '#87923a', '#5566d8', '#c8a83c', '#37957f',
  '#b25238', '#7d61bb', '#45903f', '#bc3f57', '#2f86ac', '#ad6d2b',
  '#6684b2', '#a247ac', '#2c7355', '#b8638f', '#8a8a39', '#486499',
  '#c9604f', '#5b9a53',
];

const TRIBE_COLORS = [
  '#6d7683', '#7a6a5c', '#5f7078', '#6f6a55', '#5e6b64', '#706a72',
];

const NAME_START = [
  'Ael', 'Bry', 'Cal', 'Dor', 'Eld', 'Fen', 'Gal', 'Hal', 'Ith', 'Jor',
  'Kel', 'Lor', 'Mar', 'Nar', 'Ost', 'Pel', 'Quen', 'Rav', 'Sel', 'Tor',
  'Ulv', 'Val', 'Wes', 'Xan', 'Yar', 'Zel', 'Amber', 'Bram', 'Cor', 'Dun',
  'Eber', 'Fal', 'Grim', 'Holl', 'Ir', 'Kar', 'Lyd', 'Mor', 'Nor', 'Orl',
  'Pyr', 'Rhos', 'Sar', 'Thal', 'Umb', 'Ves', 'Wyn', 'Zar', 'Ash', 'Bel',
];

const NAME_END = [
  'ia', 'ovia', 'esh', 'ara', 'mark', 'hold', 'burg', 'ton', 'vale', 'gard',
  'stan', 'land', 'mere', 'wyn', 'dor', 'stad', 'rika', 'ona', 'ule', 'oth',
  'ad', 'ell', 'ish', 'orn', 'ae', 'ath', 'ium', 'egor', 'und', 'ay',
];

const PROVINCE_END = [
  'field', 'brook', 'haven', 'reach', 'crest', 'fall', 'moor', 'gate', 'watch',
  'wick', 'stead', 'cove', 'ridge', 'vale', 'bay', 'port', 'bridge', 'hollow',
  'march', 'spire', 'den', 'scar', 'ness', 'holm', 'ford', 'bury',
];

const TRIBE_WORDS = [
  'Ashborn', 'Redclaw', 'Stormkin', 'Dunharrow', 'Ironvale', 'Sunwalkers',
  'Frostmere', 'Thornwood', 'Saltfang', 'Grimhold', 'Emberwake', 'Wildreach',
  'Stoneborn', 'Nightrun', 'Wyrmrest', 'Dustwalkers', 'Deepfen', 'Ravenmoor',
  'Hollowmen', 'Brackenwild', 'Cinderfall', 'Greywater',
];

const CONTINENT_NAMES = [
  'Avalon', 'Kethara', 'Norvind', 'Sundara', 'Eldoria', 'Zephyria',
  'Tarkhan', 'Ilvaris', 'Morrowind', 'Vashtar', 'Orenthal', 'Caldera',
];

const GOVERNMENTS = [
  'Republic', 'Kingdom', 'Federation', 'Union', 'Empire', 'Dominion',
  'Commonwealth', 'Confederacy', 'League', 'Directorate',
];

function pickUniqueColor(rng, used, pool) {
  for (const c of pool) {
    if (!used.has(c)) {
      used.add(c);
      return c;
    }
  }
  let hue = 0;
  for (let i = 0; i < 60; i += 1) {
    hue = (hue + 137.5) % 360;
    const candidate = `hsl(${hue.toFixed(0)}, 58%, 52%)`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  return `hsl(${Math.floor(rng() * 360)}, 55%, 50%)`;
}

function makeName(rng, startPool, endPool, used) {
  for (let i = 0; i < 300; i += 1) {
    const name = rng.pick(startPool) + rng.pick(endPool);
    if (!used.has(name) && name.length > 3) {
      used.add(name);
      return name;
    }
  }
  const fallback = `${rng.pick(startPool)}${rng.pick(endPool)}${used.size}`;
  used.add(fallback);
  return fallback;
}

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const idx = clamp(Math.floor(sorted.length * q), 0, sorted.length - 1);
  return sorted[idx];
}

export function generateWorld(seed = 12345, options = {}) {
  const rng = makeRng(seed);
  const targetProvinces = options.provinces ?? 164;
  const nationCount = options.nations ?? 26;

  // ---------------------------------------------------------------- elevation
  const elev = new Float32Array(GRID_W * GRID_H);
  const moisture = new Float32Array(GRID_W * GRID_H);
  const temperature = new Float32Array(GRID_W * GRID_H);

  for (let y = 0; y < GRID_H; y += 1) {
    for (let x = 0; x < GRID_W; x += 1) {
      const nx = x / GRID_W;
      const ny = y / GRID_H;
      const i = y * GRID_W + x;

      const continent = warpedFbm2(nx * 3.2, ny * 3.2, { seed, warp: 3.4, octaves: 5 });
      const detail = ridgedFbm2(nx * 8.5, ny * 8.5, { seed: seed + 17, octaves: 4 });
      const shelf = fbm2(nx * 2.1 + 4.2, ny * 2.1 - 1.7, { seed: seed + 51, octaves: 4 });

      const lat = Math.abs(ny * 2 - 1);
      const polar = 1 - Math.pow(lat, 3.4) * 0.8;

      let h = continent * 0.82 + shelf * 0.24 + detail * 0.2 - 0.03;
      h *= polar;
      h += 0.045 * Math.cos(nx * Math.PI * 2 + seed * 0.37);

      elev[i] = h;

      const m = fbm2(nx * 4.6 - 3.1, ny * 4.6 + 6.4, { seed: seed + 211, octaves: 4 });
      moisture[i] = clamp(0.52 + m * 0.7 + (1 - lat) * 0.1, 0, 1);
      temperature[i] = clamp((1 - lat) * 1.05 - h * 0.35 + 0.02, 0, 1);
    }
  }

  // Threshold that yields roughly 31% land.
  const sortedElev = Array.from(elev).sort((a, b) => a - b);
  const seaLevel = quantile(sortedElev, 1 - 0.315);
  const land = new Uint8Array(GRID_W * GRID_H);
  for (let i = 0; i < land.length; i += 1) land[i] = elev[i] > seaLevel ? 1 : 0;

  // Keep an ocean frame so coastlines never clip the map edge.
  const FRAME = 6;
  for (let y = 0; y < GRID_H; y += 1) {
    for (let x = 0; x < GRID_W; x += 1) {
      if (x < FRAME || y < FRAME || x >= GRID_W - FRAME || y >= GRID_H - FRAME) {
        land[y * GRID_W + x] = 0;
      }
    }
  }

  // Remove specks and record landmass components.
  const comp = new Int16Array(GRID_W * GRID_H).fill(-1);
  const components = [];
  const stack = [];
  for (let i = 0; i < land.length; i += 1) {
    if (!land[i] || comp[i] !== -1) continue;
    const id = components.length;
    stack.length = 0;
    stack.push(i);
    comp[i] = id;
    const pixels = [];
    while (stack.length) {
      const p = stack.pop();
      pixels.push(p);
      const px = p % GRID_W;
      const py = (p / GRID_W) | 0;
      if (px > 0 && land[p - 1] && comp[p - 1] === -1) { comp[p - 1] = id; stack.push(p - 1); }
      if (px < GRID_W - 1 && land[p + 1] && comp[p + 1] === -1) { comp[p + 1] = id; stack.push(p + 1); }
      if (py > 0 && land[p - GRID_W] && comp[p - GRID_W] === -1) { comp[p - GRID_W] = id; stack.push(p - GRID_W); }
      if (py < GRID_H - 1 && land[p + GRID_W] && comp[p + GRID_W] === -1) { comp[p + GRID_W] = id; stack.push(p + GRID_W); }
    }
    components.push({ id, pixels });
  }
  for (const c of components) {
    if (c.pixels.length < 55) {
      for (const p of c.pixels) {
        land[p] = 0;
        comp[p] = -1;
      }
    }
  }
  components.sort((a, b) => b.pixels.length - a.pixels.length);

  // Continent names for the biggest landmasses.
  const continentNameById = new Map();
  const usedContinentNames = new Set();
  components.forEach((c) => {
    if (c.pixels.length < 1400) return;
    continentNameById.set(c.id, makeName(rng, CONTINENT_NAMES, ['', ''], usedContinentNames));
  });
  const continentNameOf = (componentId) =>
    continentNameById.get(componentId) || 'Outlands';

  // -------------------------------------------------------------- province seeds
  const landPixels = [];
  for (let i = 0; i < land.length; i += 1) if (land[i]) landPixels.push(i);
  const decode = (p) => ({ x: p % GRID_W, y: Math.floor(p / GRID_W) });

  const seeds = [];
  const seedPixels = new Set();
  const first = decode(rng.pick(landPixels));
  seeds.push(first);
  seedPixels.add(first.y * GRID_W + first.x);

  while (seeds.length < targetProvinces) {
    let best = null;
    let bestD = -1;
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const cand = decode(rng.pick(landPixels));
      if (seedPixels.has(cand.y * GRID_W + cand.x)) continue;
      let nearest = Infinity;
      for (const s of seeds) {
        const d = (s.x - cand.x) ** 2 + (s.y - cand.y) ** 2;
        if (d < nearest) nearest = d;
      }
      if (nearest > bestD) {
        bestD = nearest;
        best = cand;
      }
    }
    if (!best) break;
    seeds.push(best);
    seedPixels.add(best.y * GRID_W + best.x);
  }

  // Lloyd relaxation + Voronoi assignment.
  const owner = new Int16Array(GRID_W * GRID_H).fill(-1);
  const assign = () => {
    owner.fill(-1);
    for (const p of landPixels) {
      const px = p % GRID_W;
      const py = (p / GRID_W) | 0;
      let best = -1;
      let bestD = Infinity;
      for (let s = 0; s < seeds.length; s += 1) {
        const d = (seeds[s].x - px) ** 2 + (seeds[s].y - py) ** 2;
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      owner[p] = best;
    }
  };

  for (let pass = 0; pass < 3; pass += 1) {
    assign();
    const sums = seeds.map(() => ({ x: 0, y: 0, n: 0 }));
    for (const p of landPixels) {
      const o = owner[p];
      if (o < 0) continue;
      sums[o].x += p % GRID_W;
      sums[o].y += (p / GRID_W) | 0;
      sums[o].n += 1;
    }
    for (let s = 0; s < seeds.length; s += 1) {
      if (sums[s].n > 0) seeds[s] = { x: sums[s].x / sums[s].n, y: sums[s].y / sums[s].n };
    }
  }
  assign();

  // ------------------------------------------------------- province geometry
  const pixelsBySeed = seeds.map(() => []);
  for (const p of landPixels) {
    const o = owner[p];
    if (o >= 0) pixelsBySeed[o].push(p);
  }

  const provinces = [];
  const usedProvinceNames = new Set();
  for (let s = 0; s < seeds.length; s += 1) {
    const pixels = pixelsBySeed[s];
    if (pixels.length < 20) continue;

    let minX = GRID_W;
    let minY = GRID_H;
    let maxX = 0;
    let maxY = 0;
    for (const p of pixels) {
      const px = p % GRID_W;
      const py = (p / GRID_W) | 0;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    minX = Math.max(0, minX - 2);
    minY = Math.max(0, minY - 2);
    maxX = Math.min(GRID_W - 1, maxX + 2);
    maxY = Math.min(GRID_H - 1, maxY + 2);
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const mask = new Uint8Array(bw * bh);
    for (const p of pixels) {
      const px = p % GRID_W;
      const py = (p / GRID_W) | 0;
      mask[(py - minY) * bw + (px - minX)] = 1;
    }

    const rings = marchingSquares(mask, bw, bh)
      .map((r) => r.map(([x, y]) => [x + minX, y + minY]))
      .filter((r) => r.length > 3 && Math.abs(ringArea(r)) > 4)
      .sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)));
    if (!rings.length) continue;

    const parts = [];
    for (const raw of rings.slice(0, 2)) {
      let ring = simplifyRing(raw, 0.55);
      ring = smoothRing(ring, 2);
      ring = expandRing(ring, 0.12);
      parts.push(ring.map(([x, y]) => [x * PIXEL, y * PIXEL]));
    }

    const main = parts[0];
    const bbox = ringBBox(main);
    const centroid = ringCentroid(main);
    const cx = clamp(Math.round(centroid[0] / PIXEL), 0, GRID_W - 1);
    const cy = clamp(Math.round(centroid[1] / PIXEL), 0, GRID_H - 1);
    const gi = cy * GRID_W + cx;

    provinces.push({
      id: provinces.length,
      seedIndex: s,
      name: makeName(rng, NAME_START, PROVINCE_END, usedProvinceNames),
      parts,
      ring: main,
      bbox,
      centroid,
      area: pixels.length * PIXEL * PIXEL,
      areaPx: pixels.length,
      cells: pixels, // indices in provinceAt; the same parcels are drawn, fought over and hit-tested.
      elevation: elev[gi],
      moisture: moisture[gi],
      temperature: temperature[gi],
      terrain: 'plains',
      continent: continentNameOf(comp[gi]),
      region: comp[gi],
      population: 0,
      value: 0,
      coastal: false,
      neighbours: [],
      seaLanes: [],
      nationId: null,
      tribe: null,
      tribeId: null,
    });
  }

  // Re-index and build the pixel -> province lookup.
  const provinceAt = new Int16Array(GRID_W * GRID_H).fill(-1);
  const provBySeed = new Map();
  provinces.forEach((p, idx) => {
    p.id = idx;
    provBySeed.set(p.seedIndex, idx);
  });
  for (const px of landPixels) {
    const o = owner[px];
    provinceAt[px] = provBySeed.has(o) ? provBySeed.get(o) : -1;
  }

  const adjacency = provinces.map(() => new Set());
  for (let y = 1; y < GRID_H - 1; y += 1) {
    for (let x = 1; x < GRID_W - 1; x += 1) {
      const p = y * GRID_W + x;
      const a = provinceAt[p];
      if (a < 0) continue;
      const right = provinceAt[p + 1];
      if (right >= 0 && right !== a) { adjacency[a].add(right); adjacency[right].add(a); }
      const down = provinceAt[p + GRID_W];
      if (down >= 0 && down !== a) { adjacency[a].add(down); adjacency[down].add(a); }
      const dr = provinceAt[p + GRID_W + 1];
      if (dr >= 0 && dr !== a) { adjacency[a].add(dr); adjacency[dr].add(a); }
      const dl = provinceAt[p + GRID_W - 1];
      if (dl >= 0 && dl !== a) { adjacency[a].add(dl); adjacency[dl].add(a); }
      if (!land[p - 1] || !land[p + 1] || !land[p - GRID_W] || !land[p + GRID_W]) {
        provinces[a].coastal = true;
      }
    }
  }
  provinces.forEach((p, i) => {
    p.neighbours = Array.from(adjacency[i]);
  });

  // --------------------------------------------------------- terrain + value
  const areaMedian = quantile(
    provinces.map((p) => p.areaPx).sort((a, b) => a - b),
    0.5
  );
  const elevSorted = provinces.map((p) => p.elevation).sort((a, b) => a - b);
  const moistSorted = provinces.map((p) => p.moisture).sort((a, b) => a - b);
  const mountainCut = quantile(elevSorted, 0.87);
  const desertCut = quantile(moistSorted, 0.24);
  const forestCut = quantile(moistSorted, 0.52);

  for (const prov of provinces) {
    const isIsland = prov.neighbours.length === 0 || prov.areaPx < areaMedian * 0.28;
    let key;
    if (isIsland) key = prov.temperature < 0.22 ? 'tundra' : 'island';
    else if (prov.elevation >= mountainCut && prov.temperature > 0.15) key = 'mountain';
    else if (prov.temperature < 0.2) key = 'tundra';
    else if (prov.moisture < desertCut && prov.temperature > 0.45) key = 'desert';
    else if (prov.temperature > 0.74 && prov.moisture > 0.6) key = 'jungle';
    else if (prov.moisture > forestCut) key = 'forest';
    else if (prov.moisture < desertCut + 0.1) key = 'steppe';
    else key = 'plains';

    prov.terrain = key;
    const terrain = TERRAIN[key];
    const fertility =
      terrain.fertility * (0.5 + 1.0 * clamp(prov.moisture, 0, 1)) * (0.55 + 0.85 * prov.temperature);
    prov.population = Math.max(
      0.1,
      (prov.areaPx / 250) * fertility * 8.6 * (0.78 + rng() * 0.44)
    );
    prov.value = clamp(prov.population * 0.52 + prov.areaPx / 520 + 0.5, 0.9, 15);
    prov.population = Number(prov.population.toFixed(2));
    prov.value = Number(prov.value.toFixed(2));
  }

  // Naval lanes between nearby coastal provinces.
  for (const a of provinces) {
    if (!a.coastal) continue;
    a.seaLanes = provinces
      .filter((b) => b !== a && b.coastal && !a.neighbours.includes(b.id))
      .map((b) => ({ id: b.id, d: dist(a.centroid[0], a.centroid[1], b.centroid[0], b.centroid[1]) }))
      .filter((c) => c.d < 470)
      .sort((p, q) => p.d - q.d)
      .slice(0, 6)
      .map((c) => c.id);
  }

  // ------------------------------------------------------------ nation setup
  const byRegion = new Map();
  for (const prov of provinces) {
    if (!byRegion.has(prov.region)) byRegion.set(prov.region, []);
    byRegion.get(prov.region).push(prov);
  }
  const regions = Array.from(byRegion.entries())
    .map(([regionId, provs]) => ({
      regionId,
      provs,
      area: provs.reduce((acc, p) => acc + p.areaPx, 0),
      name: provinceNameOfRegion(provs),
    }))
    .sort((a, b) => b.area - a.area);

  // Allocate capitals per landmass so no continent is left empty.
  const quotas = new Map();
  let remaining = nationCount;
  for (const r of regions) {
    if (r.area < 900 || remaining <= 0) {
      quotas.set(r.regionId, 0);
      continue;
    }
    quotas.set(r.regionId, 1);
    remaining -= 1;
  }
  const totalArea = regions.reduce((acc, r) => acc + r.area, 0) || 1;
  while (remaining > 0) {
    let bestRegion = null;
    let bestScore = -1;
    for (const r of regions) {
      if (r.area < 900) continue;
      const share = r.area / totalArea;
      const want = share * nationCount;
      const have = quotas.get(r.regionId);
      const score = want - have;
      if (score > bestScore) {
        bestScore = score;
        bestRegion = r;
      }
    }
    if (!bestRegion) break;
    quotas.set(bestRegion.regionId, quotas.get(bestRegion.regionId) + 1);
    remaining -= 1;
  }

  const capitalIds = [];
  const taken = new Set();
  for (const r of regions) {
    const quota = quotas.get(r.regionId) || 0;
    for (let k = 0; k < quota; k += 1) {
      let best = null;
      let bestScore = -1;
      for (const prov of r.provs) {
        if (taken.has(prov.id)) continue;
        let nearest = Infinity;
        for (const capId of capitalIds) {
          const cap = provinces[capId];
          const d = dist(prov.centroid[0], prov.centroid[1], cap.centroid[0], cap.centroid[1]);
          if (d < nearest) nearest = d;
        }
        if (!capitalIds.length) nearest = 2000;
        // Prefer valuable, well-spaced provinces; slight randomness for variety.
        const score = nearest * (0.6 + prov.value / 30) * (0.9 + rng() * 0.2);
        if (score > bestScore) {
          bestScore = score;
          best = prov;
        }
      }
      if (!best) break;
      capitalIds.push(best.id);
      taken.add(best.id);
    }
  }

  const usedNationNames = new Set();
  const usedColors = new Set();
  const nations = capitalIds.map((capId, i) => {
    const name = makeName(rng, NAME_START, NAME_END, usedNationNames);
    const color = pickUniqueColor(rng, usedColors, NATION_COLORS);
    const government = rng.pick(GOVERNMENTS);
    const capital = provinces[capId];
    return {
      id: i,
      name,
      fullName: `${government} of ${name}`,
      adjective: `${name}n`,
      government,
      color,
      capitalId: capId,
      continent: capital.continent,
      gold: 140,
      manpower: 40,
      personality: rng.pick(['aggressive', 'balanced', 'defensive', 'opportunist']),
      aggression: rng.range(0.35, 1),
      relations: {},
      wars: [],
      allies: [],
      truces: {},
      isPlayer: false,
      alive: true,
      stats: { battlesWon: 0, battlesLost: 0, provincesTaken: 0, troopsLost: 0 },
    };
  });

  nations.forEach((n) => {
    provinces[n.capitalId].nationId = n.id;
  });

  // Each nation grabs 2-5 neighbouring provinces.
  const claimBudget = nations.map(() => rng.int(2, 5));
  for (let round = 0; round < 8; round += 1) {
    for (const nation of nations) {
      if (claimBudget[nation.id] <= 0) continue;
      let best = null;
      let bestScore = -1;
      for (const prov of provinces) {
        if (prov.nationId !== nation.id) continue;
        for (const nb of prov.neighbours) {
          const target = provinces[nb];
          if (target.nationId !== null) continue;
          const score = target.value * (0.7 + rng() * 0.6);
          if (score > bestScore) {
            bestScore = score;
            best = target;
          }
        }
      }
      if (best) {
        best.nationId = nation.id;
        claimBudget[nation.id] -= 1;
      }
    }
  }

  // Neutral land: connected tribal territories with muted colours.
  const tribes = [];
  const usedTribeNames = new Set();
  const usedTribeColors = new Set();
  const neutralSeen = new Set();
  for (const prov of provinces) {
    if (prov.nationId !== null || neutralSeen.has(prov.id)) continue;
    const cluster = [];
    const queue = [prov.id];
    neutralSeen.add(prov.id);
    while (queue.length) {
      const id = queue.pop();
      cluster.push(id);
      for (const nb of provinces[id].neighbours) {
        if (neutralSeen.has(nb) || provinces[nb].nationId !== null) continue;
        neutralSeen.add(nb);
        queue.push(nb);
      }
    }
    const tribe = {
      id: tribes.length,
      name: `${rng.pick(TRIBE_WORDS)} ${rng.pick(['Tribe', 'Clans', 'Pact', 'Reach'])}`,
      color: pickUniqueColor(rng, usedTribeColors, TRIBE_COLORS),
      provinceIds: cluster,
    };
    tribes.push(tribe);
    for (const id of cluster) {
      provinces[id].tribe = tribe.name;
      provinces[id].tribeId = tribe.id;
    }
  }

  // ------------------------------------------------------------ ocean depth
  const distance = new Uint8Array(GRID_W * GRID_H);
  let queue = [];
  for (let i = 0; i < land.length; i += 1) {
    if (land[i]) {
      distance[i] = 255;
      queue.push(i);
    }
  }
  let level = 1;
  while (queue.length && level < 250) {
    const next = [];
    for (const p of queue) {
      const px = p % GRID_W;
      const py = (p / GRID_W) | 0;
      if (px > 0 && distance[p - 1] === 0) { distance[p - 1] = level; next.push(p - 1); }
      if (px < GRID_W - 1 && distance[p + 1] === 0) { distance[p + 1] = level; next.push(p + 1); }
      if (py > 0 && distance[p - GRID_W] === 0) { distance[p - GRID_W] = level; next.push(p - GRID_W); }
      if (py < GRID_H - 1 && distance[p + GRID_W] === 0) { distance[p + GRID_W] = level; next.push(p + GRID_W); }
    }
    queue = next;
    level += 1;
  }

  // Coastline rings for a crisp shore stroke.
  const coastRings = marchingSquares(land, GRID_W, GRID_H)
    .map((r) => smoothRing(simplifyRing(r, 0.45), 1))
    .filter((r) => r.length > 8)
    .map((r) => r.map(([x, y]) => [x * PIXEL, y * PIXEL]));

  // Continent summary for the map + UI.
  const continents = [];
  const continentIndex = new Map();
  for (const prov of provinces) {
    if (!continentIndex.has(prov.region)) {
      continentIndex.set(prov.region, continents.length);
      continents.push({
        id: continents.length,
        region: prov.region,
        name: prov.continent,
        provinceIds: [],
        center: [0, 0],
      });
    }
    const c = continents[continentIndex.get(prov.region)];
    c.provinceIds.push(prov.id);
  }
  for (const c of continents) {
    let sx = 0;
    let sy = 0;
    for (const id of c.provinceIds) {
      sx += provinces[id].centroid[0];
      sy += provinces[id].centroid[1];
    }
    c.center = [sx / c.provinceIds.length, sy / c.provinceIds.length];
  }

  const avgProvincePixels =
    provinces.reduce((acc, p) => acc + p.areaPx, 0) / Math.max(1, provinces.length);

  const borderChains = traceBorderChains(provinceAt);
  annotateBorderEdges(provinces);

  return {
    seed,
    gridW: GRID_W,
    gridH: GRID_H,
    pixel: PIXEL,
    width: WORLD_W,
    height: WORLD_H,
    land,
    distance,
    owner,
    provinceAt,
    seaLevel,
    elevation: elev,
    moisture,
    temperature,
    provinces,
    nations,
    tribes,
    coastRings,
    continents,
    avgProvincePixels,
    landCellCount: provinces.reduce((sum, p) => sum + p.areaPx, 0),
    borderChains,
  };
}

// For every province, record the outline segments that face another province.
// The renderer uses these to draw crisp national borders at any zoom level.
// Trace the exact province-partition boundaries into smooth polylines. Each
// chain remembers the two provinces it separates so the renderer can show only
// the chains where the owners differ (i.e. national borders).
function traceBorderChains(provinceAt) {
  const pairPixels = new Map();
  const addPixel = (a, b, p) => {
    const key = a < b ? a * 4096 + b : b * 4096 + a;
    let set = pairPixels.get(key);
    if (!set) {
      set = { a: Math.min(a, b), b: Math.max(a, b), pixels: new Set() };
      pairPixels.set(key, set);
    }
    set.pixels.add(p);
  };

  for (let y = 0; y < GRID_H; y += 1) {
    for (let x = 0; x < GRID_W; x += 1) {
      const p = y * GRID_W + x;
      const a = provinceAt[p];
      if (a < 0) continue;
      if (x < GRID_W - 1) {
        const b = provinceAt[p + 1];
        if (b >= 0 && b !== a) addPixel(a, b, p);
      }
      if (y < GRID_H - 1) {
        const b = provinceAt[p + GRID_W];
        if (b >= 0 && b !== a) addPixel(a, b, p);
      }
    }
  }

  const offsets = [-1, 1, -GRID_W, GRID_W, -GRID_W - 1, -GRID_W + 1, GRID_W - 1, GRID_W + 1];
  const chains = [];
  for (const pair of pairPixels.values()) {
    const alive = pair.pixels;
    const visited = new Set();
    const neighboursOf = (p) => {
      const out = [];
      for (const off of offsets) {
        const q = p + off;
        if (alive.has(q)) out.push(q);
      }
      return out;
    };
    const walk = (start) => {
      const chain = [];
      let cur = start;
      while (cur !== undefined && !visited.has(cur)) {
        visited.add(cur);
        chain.push(cur);
        const cands = neighboursOf(cur).filter((q) => !visited.has(q));
        if (!cands.length) break;
        cur = cands[0];
      }
      return chain;
    };

    const starts = [];
    for (const p of alive) {
      if (neighboursOf(p).length === 1) starts.push(p);
    }
    for (const start of starts) {
      if (visited.has(start)) continue;
      const chain = walk(start);
      if (chain.length >= 3) chains.push({ a: pair.a, b: pair.b, chain });
    }
    for (const p of alive) {
      if (visited.has(p)) continue;
      const chain = walk(p);
      if (chain.length >= 3) chains.push({ a: pair.a, b: pair.b, chain });
    }
  }

  return chains.map(({ a, b, chain }) => {
    let pts = chain.map((p) => [
      ((p % GRID_W) + 0.5) * PIXEL,
      (((p / GRID_W) | 0) + 0.5) * PIXEL,
    ]);
    pts = simplifyPolyline(pts, 0.35);
    pts = smoothPolyline(pts, 2);
    return { a, b, points: pts };
  });
}

function simplifyPolyline(pts, tolerance) {
  if (pts.length < 3) return pts;
  const keep = [pts[0]];
  let anchor = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const p = pts[i];
    const a = pts[anchor];
    const dx = p[0] - a[0];
    const dy = p[1] - a[1];
    const len = Math.hypot(dx, dy) || 1e-9;
    let far = 0;
    for (let j = anchor + 1; j < i; j += 1) {
      const q = pts[j];
      const d = Math.abs(dy * q[0] - dx * q[1] + p[0] * a[1] - p[1] * a[0]) / len;
      if (d > far) far = d;
    }
    if (far > tolerance) {
      keep.push(pts[i - 1]);
      anchor = i - 1;
    }
  }
  keep.push(pts[pts.length - 1]);
  return keep;
}

function annotateBorderEdges(provinces) {
  // Sample points of every province outline for fast proximity queries.
  const outlines = provinces.map((p) => {
    const pts = [];
    for (const ring of p.parts) {
      for (let i = 0; i < ring.length; i += 2) pts.push(ring[i]);
    }
    return pts;
  });

  for (const prov of provinces) {
    const edges = [];
    const [cx, cy] = prov.centroid;
    const neighbours = prov.neighbours.slice();
    for (const ring of prov.parts) {
      const n = ring.length;
      for (let i = 0; i < n; i += 1) {
        const a = ring[i];
        const b = ring[(i + 1) % n];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const len = Math.hypot(dx, dy);
        if (len < 0.01) continue;
        let nx = -dy / len;
        let ny = dx / len;
        const mx = (a[0] + b[0]) / 2;
        const my = (a[1] + b[1]) / 2;
        if ((mx - cx) * nx + (my - cy) * ny < 0) {
          nx = -nx;
          ny = -ny;
        }

        // The shared border with a neighbour sits almost exactly under this
        // edge: pick the neighbour whose outline comes closest and ignore the
        // edge when nothing is near (i.e. it faces the sea).
        let found = -1;
        let best = 36; // 6 world units
        for (const nb of neighbours) {
          const pts = outlines[nb];
          for (let k = 0; k < pts.length; k += 1) {
            const ddx = pts[k][0] - mx;
            const ddy = pts[k][1] - my;
            const d2 = ddx * ddx + ddy * ddy;
            if (d2 < best) {
              best = d2;
              found = nb;
            }
          }
        }
        edges.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1], nb: found });
      }
    }
    prov.borderEdges = edges;
  }
}

function provinceNameOfRegion(provs) {
  const counts = new Map();
  for (const p of provs) counts.set(p.continent, (counts.get(p.continent) || 0) + 1);
  let best = 'Outlands';
  let bestCount = 0;
  for (const [name, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      best = name;
    }
  }
  return best;
}

export function provinceContains(province, x, y) {
  if (
    x < province.bbox.minX ||
    x > province.bbox.maxX ||
    y < province.bbox.minY ||
    y > province.bbox.maxY
  ) {
    return false;
  }
  for (const ring of province.parts) {
    if (pointInRing(x, y, ring)) return true;
  }
  return false;
}

export function cellAt(world, x, y) {
  const cx = Math.floor(x / world.pixel), cy = Math.floor(y / world.pixel);
  if (cx < 0 || cx >= world.gridW || cy < 0 || cy >= world.gridH) return -1;
  return cy * world.gridW + cx;
}

export function findProvinceAt(world, x, y) {
  return world.provinces[world.provinceAt[cellAt(world, x, y)]] ?? null;
}
