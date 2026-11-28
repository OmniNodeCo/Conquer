// Province totals drive the economy. Sites remember *where* each of those levels lives.
import { tileOwner } from './fronts.js';
import { SITE_PARCELS } from './site-shapes.js';

export const BUILDINGS = {
  city: {
    key: 'city',
    name: 'City',
    icon: 'city',
    cost: 60,
    max: 3,
    blurb: '+40% income, +25% manpower per level',
  },
  fort: {
    key: 'fort',
    name: 'Castle',
    icon: 'fort',
    cost: 50,
    max: 3,
    blurb: '+28% defence per level',
  },
  aa: {
    key: 'aa',
    name: 'AA Battery',
    icon: 'aa',
    cost: 120,
    max: 2,
    blurb: 'Shoots down incoming warheads (35% +25% per level)',
  },
  port: {
    key: 'port',
    name: 'Port',
    icon: 'port',
    cost: 70,
    max: 1,
    blurb: 'Enables naval invasions out of this province',
    requiresCoastal: true,
  },
  factory: {
    key: 'factory',
    name: 'Factory',
    icon: 'factory',
    cost: 80,
    max: 2,
    blurb: '+20% recruit discount and +15% income per level',
  },
  silo: {
    key: 'silo',
    name: 'Missile Silo',
    icon: 'silo',
    cost: 300,
    max: 1,
    blurb: 'Allows building nuclear weapons',
  },
};

export function initBuildings(prov) {
  prov.buildings = Object.fromEntries(Object.keys(BUILDINGS).map(key => [key, 0]));
  prov.sites = [];
  prov.buildRevision = 0;
}

export function siteAt(prov, cell) {
  return prov.sites?.find(site => site.cell === cell);
}

// The anchor must be dry land that we administer AND actually hold. Even a
// friendly foothold abroad is not a construction permit. A pier can overhang
// water, but no part of a new symbol can spill onto someone else's land.
export function homePlot(world, nationId, prov, cell) {
  return nationId != null && prov?.nationId === nationId && Number.isInteger(cell) &&
    world.provinceAt[cell] === prov.id && tileOwner(prov, cell) === nationId;
}

function fitsBorder(world, nationId, cell, key) {
  const w = world.gridW, x = cell % w;
  for (const [dx, dy] of SITE_PARCELS[key]) {
    const i = cell + dx + dy*w;
    if (x+dx < 0 || x+dx >= w || i < 0 || i >= world.land.length) return false;
    if (world.land[i] && !homePlot(world, nationId, world.provinces[world.provinceAt[i]], i)) return false;
  }
  return true;
}

// Inspector/AI orders have no cursor. Prefer upgrading an existing site, or a
// clear spot near the village; coastal orders prefer the water's edge. No RNG:
// migrating the same old campaign twice must yield the same landmarks.
function autoCell(world, prov, key, legacy = false) {
  const eligible = i => legacy || homePlot(world, prov.nationId, prov, i);
  const fits = i => legacy || fitsBorder(world, prov.nationId, i, key);
  const existing = prov.sites.find(s => s.key === key && eligible(s.cell) && fits(s.cell));
  if (existing) return existing.cell;
  const w = world.gridW;
  const distance = (a, b) => Math.max(Math.abs(a % w - b % w), Math.abs(Math.floor(a / w) - Math.floor(b / w)));
  let best = null, bestScore = Infinity;
  for (const i of prov.cells) {
    if (!eligible(i) || siteAt(prov, i)) continue;
    const fromVillage = distance(i, prov.seatCell);
    let clearance = fromVillage;
    for (const site of prov.sites) clearance = Math.min(clearance, distance(i, site.cell));
    const inland = key === 'port' && world.land[i-1] && world.land[i+1] && world.land[i-w] && world.land[i+w];
    const score = (inland ? w * 10 : 0) + Math.max(0, 6 - clearance) * 20 + fromVillage;
    if (score < bestScore && fits(i)) { best = i; bestScore = score; }
  }
  return best;
}

export function buildingCost(prov, key) {
  return Math.round(BUILDINGS[key].cost * (1 + prov.buildings[key] * 0.65));
}

export function canBuild(state, nationId, prov, key, aim = null) {
  if (!Object.hasOwn(BUILDINGS, key)) return { ok: false, reason: 'Unknown building' };
  const def = BUILDINGS[key];
  if (!state.nations[nationId]?.alive || state.gameOver) return { ok: false, reason: 'Campaign ended' };
  if (!prov || state.world.provinces[prov.id] !== prov || prov.nationId !== nationId) return { ok: false, reason: 'Build inside your own province' };
  const level = prov.buildings[key];
  if (level >= def.max) return { ok: false, reason: 'Maximum province level reached' };
  if (def.requiresCoastal && !prov.coastal) return { ok: false, reason: 'Requires a coastal province' };
  const cost = buildingCost(prov, key);
  if (state.nations[nationId].gold < cost) return { ok: false, reason: 'Not enough gold' };
  const cell = aim ?? autoCell(state.world, prov, key);
  if (cell === null) return { ok: false, reason: 'No free ground here' };
  if (!Number.isInteger(cell) || state.world.provinceAt[cell] !== prov.id) return { ok: false, reason: 'Choose land in this province' };
  if (!homePlot(state.world, nationId, prov, cell)) return { ok: false, reason: 'Reclaim this ground before building here' };
  if (!fitsBorder(state.world, nationId, cell, key)) return { ok: false, reason: 'Too close to foreign land — move the site inside your border' };
  const site = siteAt(prov, cell);
  if (site && site.key !== key) return { ok: false, reason: `Tile in use: ${BUILDINGS[site.key].name}. Choose another tile.` };
  return { ok: true, cell, cost, level };
}

export function addBuildingLevels(prov, key, cell, levels = 1) {
  let site = siteAt(prov, cell);
  if (!site) { site = { key, cell, level: 0 }; prov.sites.push(site); }
  site.level += levels;
  prov.buildings[key] += levels;
  prov.buildRevision++;
  return site;
}

export function removeBuildingLevel(prov, key) {
  if (!prov.buildings[key]) return;
  prov.buildings[key]--;
  prov.buildRevision++;
  const i = prov.sites.findLastIndex(site => site.key === key);
  if (i >= 0 && --prov.sites[i].level === 0) prov.sites.splice(i, 1);
}

export function restoreBuildings(world, prov, counts = {}, sites = []) {
  initBuildings(prov);
  const levels = key => Math.min(BUILDINGS[key].max, Math.max(0, Number.isInteger(counts[key]) ? counts[key] : 0));
  // Keep valid anchors even on land that has since been occupied. Unknown keys,
  // collisions, out-of-province cells and surplus levels cannot create buildings.
  for (const site of Array.isArray(sites) ? sites : []) {
    if (!site || !Object.hasOwn(BUILDINGS, site.key) || !Number.isInteger(site.level)) continue;
    if (!Number.isInteger(site.cell) || world.provinceAt[site.cell] !== prov.id || siteAt(prov, site.cell)) continue;
    const n = Math.min(levels(site.key) - prov.buildings[site.key], site.level);
    if (n > 0) addBuildingLevels(prov, site.key, site.cell, n);
  }
  // v1/v2 only stored totals. Supply stable anchors without charging or logging.
  for (const key of Object.keys(BUILDINGS)) {
    const missing = levels(key) - prov.buildings[key];
    if (!missing) continue;
    const cell = autoCell(world, prov, key) ?? autoCell(world, prov, key, true);
    if (cell !== null) addBuildingLevels(prov, key, cell, missing);
  }
}
