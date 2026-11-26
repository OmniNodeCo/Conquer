// Campaign serialisation. Worlds are procedural, so only the seed plus the
// mutable runtime state needs to be stored.

import { createGame } from './state.js';
import { restoreBuildings } from './buildings.js';

export const SAVE_VERSION = 3;
const KEY = 'conquer.save.v1';

export function serialize(state) {
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    seed: state.seed,
    difficulty: state.difficulty,
    playerNationId: state.playerNationId,
    time: state.time,
    day: state.day,
    speed: state.speed,
    gameOver: state.gameOver,
    stats: state.stats,
    log: state.log.slice(0, 40),
    provinces: state.provinces.map((p) => ({
      n: p.nationId,
      t: Number(p.troops.toFixed(2)),
      b: { ...p.buildings },
      ...(p.sites.length && { sites: p.sites.map(site => ({ ...site })) }),
      musterAt: p.musterAt,
      ...(p.fronts.size && { fronts: [...p.fronts].map(([id, f]) => ({ id, tiles: [...f.tiles], troops: f.troops })) }),
      pop: Number(p.population.toFixed(2)),
      val: Number(p.value.toFixed(2)),
    })),
    nations: state.nations.map((n) => ({
      gold: Number(n.gold.toFixed(1)),
      manpower: Number(n.manpower.toFixed(1)),
      wars: n.wars.slice(),
      allies: n.allies.slice(),
      truces: { ...n.truces },
      relations: { ...n.relations },
      nukes: n.nukes,
      buildingNuke: n.buildingNuke,
      nukeProgress: n.nukeProgress,
      alive: n.alive,
      exhaustionUntil: n.exhaustionUntil || 0,
      stats: n.stats,
    })),
    expeditions: state.expeditions.map((e) => ({ ...e })),
    effects: [],
  };
}

export function deserialize(data) {
  if (!data || ![1, 2, SAVE_VERSION].includes(data.version)) {
    throw new Error('Unsupported save format');
  }
  const state = createGame({
    seed: data.seed,
    playerNationId: data.playerNationId,
    difficulty: data.difficulty,
  });
  state.time = data.time || 0;
  state.day = data.day || 1;
  state.speed = data.speed || 1;
  state.paused = true;
  state.stats = { ...state.stats, ...(data.stats || {}) };
  state.gameOver = data.gameOver || null;

  data.provinces.forEach((saved, i) => {
    const prov = state.provinces[i];
    if (!prov) return;
    prov.nationId = saved.n;
    prov.troops = saved.t;
    prov.musterAt = Number.isFinite(saved.musterAt) ? saved.musterAt : 0;
    const occupied = new Set();
    for (const { id, tiles, troops } of saved.fronts || []) {
      if (!Number.isInteger(id) || !state.nations[id] || id === prov.nationId || prov.fronts.has(id) || !Array.isArray(tiles)) continue;
      const valid = tiles.filter(i => Number.isInteger(i) && state.world.provinceAt[i] === prov.id && !occupied.has(i));
      if (!valid.length) continue;
      for (const i of valid) occupied.add(i);
      prov.fronts.set(id, { tiles: new Set(valid), troops: Number.isFinite(troops) ? Math.max(0, troops) : 0 });
    }
    restoreBuildings(state.world, prov, saved.b || {}, saved.sites);
    prov.population = saved.pop ?? prov.population;
    prov.value = saved.val ?? prov.value;
  });

  data.nations.forEach((saved, i) => {
    const nation = state.nations[i];
    if (!nation) return;
    nation.gold = saved.gold;
    nation.manpower = saved.manpower;
    nation.wars = saved.wars || [];
    nation.allies = saved.allies || [];
    nation.truces = saved.truces || {};
    nation.relations = saved.relations || nation.relations;
    nation.nukes = saved.nukes || 0;
    nation.buildingNuke = !!saved.buildingNuke;
    nation.nukeProgress = saved.nukeProgress || 0;
    nation.alive = saved.alive !== false;
    nation.exhaustionUntil = saved.exhaustionUntil || 0;
    nation.stats = { ...nation.stats, ...(saved.stats || {}) };
  });

  state.expeditions = (data.expeditions || []).map((e) => ({ ...e }));
  state.log = data.log || [];
  state.player = state.nations[state.playerNationId];
  state.paused = true;
  state.started = true;
  return state;
}

export function saveLocal(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(serialize(state)));
    return true;
  } catch (err) {
    return false;
  }
}

export function loadLocal() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return deserialize(JSON.parse(raw));
  } catch (err) {
    return null;
  }
}

export function hasLocalSave() {
  try {
    return !!localStorage.getItem(KEY);
  } catch (err) {
    return false;
  }
}

export function saveMeta() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return { savedAt: data.savedAt, day: data.day, seed: data.seed };
  } catch (err) {
    return null;
  }
}

export function clearLocal() {
  try {
    localStorage.removeItem(KEY);
  } catch (err) {
    /* ignore */
  }
}

export async function saveToFile(state) {
  if (window.desktop?.saveGame) {
    return window.desktop.saveGame(JSON.stringify(serialize(state)));
  }
  return saveLocal(state);
}
