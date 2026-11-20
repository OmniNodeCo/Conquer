// Core simulation for Conquer: Rule the Globe.
// Real-time grand strategy: economy, recruitment, battles, naval invasions,
// diplomacy, nukes and victory conditions.

import { makeRng } from './rng.js';
import { generateWorld, TERRAIN } from './worldgen.js';
import { dist, clamp } from './geom.js';
import { runAiTurn } from './ai.js';

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
    name: 'Fort',
    icon: 'fort',
    cost: 50,
    max: 3,
    blurb: '+28% defence per level',
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

export const DIFFICULTY = {
  easy: { key: 'easy', label: 'Recruit', aiIncome: 0.8, aiAggro: 0.65, startGold: 180, aiBonusArmy: 0 },
  normal: { key: 'normal', label: 'Commander', aiIncome: 1, aiAggro: 1, startGold: 0, aiBonusArmy: 0 },
  hard: { key: 'hard', label: 'Warlord', aiIncome: 1.3, aiAggro: 1.4, startGold: -60, aiBonusArmy: 6 },
};

export const VICTORY_SHARE = 0.8;

export const TUNING = {
  startGold: 230,
  startManpower: 90,
  startTroopsBase: 14,
  startTroopsPerValue: 2.1,
  neutralTroopsBase: 8,
  neutralTroopsPerValue: 2.5,
  neutralRegen: 0.55,
  incomePerValue: 0.078,
  upkeepPerTroop: 0.011,
  manpowerPerMillion: 0.042,
  recruitGold: 2.4,
  recruitManpower: 1,
  navalCost: 30,
  nukeCost: 340,
  nukeBuildTime: 95,
  maxNavalDistance: 520,
  attackGrace: 95,
};

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function provinceLabel(province, world) {
  if (!province) return '—';
  if (province.nationId !== null && province.nationId !== undefined) {
    return world.nations[province.nationId].name;
  }
  return province.tribe || 'Free Territory';
}

export function createGame({
  seed = 20261120,
  playerNationId = 0,
  difficulty = 'normal',
  worldOptions = {},
  world: providedWorld = null,
} = {}) {
  const world = providedWorld || generateWorld(seed, worldOptions);
  const diff = DIFFICULTY[difficulty] || DIFFICULTY.normal;

  const state = {
    seed,
    world,
    difficulty: diff.key,
    diff,
    playerNationId,
    nations: world.nations,
    provinces: world.provinces,
    time: 0,
    day: 1,
    speed: 1,
    paused: false,
    started: false,
    selectedProvinceId: null,
    selectedSourceId: null,
    hoverProvinceId: null,
    mode: 'idle',
    expeditions: [],
    effects: [],
    log: [],
    pendingDialog: null,
    gameOver: null,
    stats: {
      battlesWon: 0,
      battlesLost: 0,
      provincesTaken: 0,
      provincesLost: 0,
      troopsLost: 0,
      nukesLaunched: 0,
      goldEarned: 0,
    },
    cooldowns: { recruit: 0 },
    aiTimer: 0,
    nukeTimer: 0,
    autosaveAt: 0,
    rng: makeRng((seed ^ 0x9e3779b9) >>> 0),
    version: 1,
  };

  // Runtime province state.
  for (const prov of world.provinces) {
    const isCapitol = world.nations.some((n) => n.capitalId === prov.id);
    prov.buildings = { city: 0, fort: 0, port: 0, factory: 0, silo: 0 };
    prov.isCapital = isCapitol;
    prov.nukeTarget = false;
    prov.captureTime = 0;
    if (prov.nationId === null) {
      prov.troops = TUNING.neutralTroopsBase + prov.value * TUNING.neutralTroopsPerValue;
    } else {
      prov.troops = TUNING.startTroopsBase + prov.value * TUNING.startTroopsPerValue;
    }
  }

  for (const nation of state.nations) {
    nation.gold = TUNING.startGold + diff.startGold;
    nation.manpower = TUNING.startManpower;
    nation.relations = {};
    nation.wars = [];
    nation.allies = [];
    nation.truces = {};
    nation.nukes = 0;
    nation.nukeProgress = 0;
    nation.buildingNuke = false;
    nation.isPlayer = nation.id === playerNationId;
    nation.alive = true;
    nation.incomeSmoothed = 0;
    nation.ai = {
      nextDecision: 1.5 + Math.random() * 3,
      target: null,
      focus: null,
      lastWar: -100,
      recruitBias: 0.5 + Math.random() * 0.5,
    };
    nation.rallyPoint = nation.capitalId;
    for (const other of state.nations) {
      if (other.id === nation.id) continue;
      nation.relations[other.id] = Math.round(-8 + Math.random() * 26);
    }
    if (nation.id !== playerNationId) {
      nation.gold += diff.aiBonusArmy * 12;
      nation.manpower += diff.aiBonusArmy * 4;
    }
  }

  // Starting garrisons for AI difficulty.
  if (diff.aiBonusArmy > 0) {
    for (const prov of world.provinces) {
      if (prov.nationId !== null && prov.nationId !== playerNationId) {
        prov.troops += diff.aiBonusArmy;
      }
    }
  }

  state.player = state.nations[playerNationId];
  pushLog(state, `${state.player.fullName} rises. The world is watching.`, 'system');
  return state;
}

// ---------------------------------------------------------------------------
// Derived values
// ---------------------------------------------------------------------------

export function nationProvinces(state, nationId) {
  return state.provinces.filter((p) => p.nationId === nationId);
}

export function provinceIncome(prov, state) {
  if (prov.nationId === null) return 0;
  const city = prov.buildings.city || 0;
  const factory = prov.buildings.factory || 0;
  const port = prov.buildings.port || 0;
  const nation = state.nations[prov.nationId];
  const exhausted = nation && nation.exhaustionUntil > state.time ? 0.65 : 1;
  return prov.value * TUNING.incomePerValue * (1 + 0.4 * city + 0.18 * port + 0.15 * factory) * exhausted;
}

export function nationIncome(state, nationId) {
  let total = 0;
  for (const prov of state.provinces) {
    if (prov.nationId === nationId) total += provinceIncome(prov, state);
  }
  return total;
}

export function nationUpkeep(state, nationId) {
  let troops = 0;
  for (const prov of state.provinces) {
    if (prov.nationId === nationId) troops += prov.troops;
  }
  for (const exp of state.expeditions) {
    if (exp.nationId === nationId) troops += exp.troops;
  }
  return troops * TUNING.upkeepPerTroop;
}

export function nationArmy(state, nationId) {
  let troops = 0;
  for (const prov of state.provinces) {
    if (prov.nationId === nationId) troops += prov.troops;
  }
  for (const exp of state.expeditions) {
    if (exp.nationId === nationId) troops += exp.troops;
  }
  return troops;
}

export function nationPopulation(state, nationId) {
  let pop = 0;
  for (const prov of state.provinces) {
    if (prov.nationId === nationId) pop += prov.population;
  }
  return pop;
}

export function nationManpowerRegen(state, nationId) {
  let pop = 0;
  let cityBonus = 0;
  for (const prov of state.provinces) {
    if (prov.nationId === nationId) {
      pop += prov.population;
      cityBonus += (prov.buildings.city || 0) * 0.12;
    }
  }
  return pop * TUNING.manpowerPerMillion * (1 + cityBonus);
}

export function nationPower(state, nationId) {
  const army = nationArmy(state, nationId);
  const income = nationIncome(state, nationId);
  const count = nationProvinces(state, nationId).length;
  return army * 1.2 + income * 12 + count * 9;
}

export function defenseMultiplier(prov) {
  const terrain = TERRAIN[prov.terrain] || TERRAIN.plains;
  return (
    1 +
    terrain.defense +
    0.28 * (prov.buildings.fort || 0) +
    (prov.isCapital ? 0.18 : 0) +
    (prov.buildings.port ? 0.08 : 0)
  );
}

export function worldShare(state) {
  const owned = state.provinces.filter((p) => p.nationId === state.playerNationId).length;
  return owned / state.provinces.length;
}

export function nationShare(state, nationId) {
  return state.provinces.filter((p) => p.nationId === nationId).length / state.provinces.length;
}

export function isAtWar(a, b) {
  return a.wars.includes(b.id);
}

export function relationWith(nation, otherId) {
  return nation.relations[otherId] ?? 0;
}

export function relationLabel(value) {
  if (value <= -60) return 'Hostile';
  if (value <= -25) return 'Cold';
  if (value < 25) return 'Neutral';
  if (value < 60) return 'Friendly';
  return 'Allied';
}

// ---------------------------------------------------------------------------
// Logging & effects
// ---------------------------------------------------------------------------

let logId = 1;

export function pushLog(state, text, type = 'info', provinceId = null) {
  state.log.unshift({ id: logId++, text, type, provinceId, day: state.day });
  if (state.log.length > 90) state.log.length = 90;
}

export function addEffect(state, effect) {
  state.effects.push({ t: 0, ttl: 2.4, ...effect });
  if (state.effects.length > 80) state.effects.shift();
}

export function addFloatingText(state, x, y, text, color = '#fff') {
  addEffect(state, { type: 'text', x, y, text, color, ttl: 2.6, rise: 34 });
}

// ---------------------------------------------------------------------------
// Actions: recruiting and building
// ---------------------------------------------------------------------------

export function recruitCost(prov, count) {
  const factory = prov.buildings.factory || 0;
  return count * TUNING.recruitGold * (1 - 0.1 * factory);
}

export function canRecruit(state, nationId, prov, count) {
  const nation = state.nations[nationId];
  if (!nation || prov.nationId !== nationId) return { ok: false, reason: 'Not your province' };
  if (count <= 0) return { ok: false, reason: 'Nothing to recruit' };
  const gold = recruitCost(prov, count);
  if (nation.gold < gold) return { ok: false, reason: 'Not enough gold' };
  if (nation.manpower < count * TUNING.recruitManpower) {
    return { ok: false, reason: 'Not enough manpower' };
  }
  return { ok: true, gold };
}

export function recruit(state, nationId, prov, count) {
  const check = canRecruit(state, nationId, prov, count);
  if (!check.ok) return check;
  const nation = state.nations[nationId];
  nation.gold -= check.gold;
  nation.manpower -= count * TUNING.recruitManpower;
  prov.troops += count;
  if (nationId === state.playerNationId) {
    addFloatingText(state, prov.centroid[0], prov.centroid[1], `+${Math.round(count * 1000).toLocaleString()}`, '#8ef0a2');
  }
  return { ok: true };
}

export function buildingCost(prov, key) {
  const def = BUILDINGS[key];
  const level = prov.buildings[key] || 0;
  return Math.round(def.cost * (1 + level * 0.65));
}

export function canBuild(state, nationId, prov, key) {
  const def = BUILDINGS[key];
  if (!def) return { ok: false, reason: 'Unknown building' };
  if (prov.nationId !== nationId) return { ok: false, reason: 'Not your province' };
  const level = prov.buildings[key] || 0;
  if (level >= def.max) return { ok: false, reason: 'Maximum level reached' };
  if (def.requiresCoastal && !prov.coastal) return { ok: false, reason: 'Requires a coastal province' };
  const cost = buildingCost(prov, key);
  if (state.nations[nationId].gold < cost) return { ok: false, reason: 'Not enough gold' };
  return { ok: true, cost, level };
}

export function build(state, nationId, prov, key) {
  const check = canBuild(state, nationId, prov, key);
  if (!check.ok) return check;
  state.nations[nationId].gold -= check.cost;
  prov.buildings[key] = (prov.buildings[key] || 0) + 1;
  addEffect(state, {
    type: 'build',
    x: prov.centroid[0],
    y: prov.centroid[1],
    ttl: 1.6,
  });
  pushLog(state, `${BUILDINGS[key].name} built in ${prov.name}.`, 'build', prov.id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Combat
// ---------------------------------------------------------------------------

export function resolveBattle(atkTroops, defTroops, defMult, rng = Math.random) {
  const atkRoll = 0.86 + rng() * 0.28;
  const defRoll = 0.86 + rng() * 0.28;
  const atk = atkTroops * atkRoll;
  const def = Math.max(0.5, defTroops) * defMult * defRoll;

  if (atk > def) {
    // Even a walkover costs lives: the minimum toll is a real share of the army.
    const ratio = def / atk;
    const lossFraction = clamp(0.14 + ratio * 0.72, 0.14, 0.93);
    const losses = atkTroops * lossFraction;
    return {
      win: true,
      survivors: Math.max(0, atkTroops - losses),
      attackerLosses: losses,
      defenderLosses: defTroops,
    };
  }
  const ratio = atk / def;
  const defenderLosses = defTroops * clamp(ratio * 0.6, 0.03, 0.85);
  return {
    win: false,
    survivors: 0,
    attackerLosses: atkTroops * 0.96,
    defenderLosses,
  };
}

export function attackableSources(state, nationId, targetProv) {
  const sources = [];
  for (const prov of state.provinces) {
    if (prov.nationId !== nationId) continue;
    if (prov.troops < 1) continue;
    const land = prov.neighbours.includes(targetProv.id);
    const sea =
      !land &&
      prov.buildings.port > 0 &&
      prov.coastal &&
      targetProv.coastal &&
      prov.seaLanes.includes(targetProv.id);
    if (land) sources.push({ prov, naval: false });
    else if (sea) sources.push({ prov, naval: true });
  }
  return sources;
}

export function canAttack(state, nationId, targetProv) {
  const nation = state.nations[nationId];
  if (!nation) return { ok: false, reason: 'No nation' };
  if (targetProv.nationId === nationId) return { ok: false, reason: 'Already yours' };
  if (targetProv.nationId !== null) {
    const target = state.nations[targetProv.nationId];
    if (nation.allies.includes(target.id)) {
      return { ok: false, reason: 'Allied — break the alliance first' };
    }
    if ((nation.truces[target.id] || 0) > state.time) {
      return { ok: false, reason: 'Truce in effect' };
    }
  }
  const sources = attackableSources(state, nationId, targetProv);
  if (!sources.length) return { ok: false, reason: 'No bordering army or naval route' };
  return { ok: true, sources };
}

export function declareWar(state, nationId, targetId, { silent = false } = {}) {
  const nation = state.nations[nationId];
  const target = state.nations[targetId];
  if (!nation || !target || nation.id === target.id) return false;
  if (nation.wars.includes(targetId)) return false;
  nation.wars.push(targetId);
  if (!target.wars.includes(nationId)) target.wars.push(nationId);
  nation.relations[targetId] = Math.min(nation.relations[targetId] ?? 0, -55);
  target.relations[nationId] = Math.min(target.relations[nationId] ?? 0, -55);
  // Allies may honour the call.
  for (const allyId of target.allies) {
    const ally = state.nations[allyId];
    if (!ally || ally.id === nationId || !ally.alive) continue;
    if (ally.wars.includes(nationId)) continue;
    if (Math.random() < 0.45) {
      ally.wars.push(nationId);
      nation.wars.push(allyId);
      ally.relations[nationId] = Math.min(ally.relations[nationId] ?? 0, -50);
      if (!silent) pushLog(state, `${ally.name} honours its alliance with ${target.name}.`, 'war');
    }
  }
  if (!silent) {
    pushLog(state, `${nation.name} declares war on ${target.name}!`, 'war');
    addEffect(state, {
      type: 'notification',
      text: `${nation.name} → ${target.name}: WAR`,
      color: '#ff6b6b',
    });
  }
  return true;
}

export function makePeace(state, aId, bId, { silent = false } = {}) {
  const a = state.nations[aId];
  const b = state.nations[bId];
  if (!a || !b) return false;
  const hadWar = a.wars.includes(bId) || b.wars.includes(aId);
  a.wars = a.wars.filter((id) => id !== bId);
  b.wars = b.wars.filter((id) => id !== aId);
  a.truces[bId] = state.time + 150;
  b.truces[aId] = state.time + 150;
  a.relations[bId] = Math.max(a.relations[bId] ?? 0, -25);
  b.relations[aId] = Math.max(b.relations[aId] ?? 0, -25);
  if (hadWar && !silent) {
    pushLog(state, `${a.name} and ${b.name} sign a ceasefire.`, 'peace');
  }
  return hadWar;
}

export function beginAttack(state, nationId, sourceProv, targetProv, troops, naval) {
  const nation = state.nations[nationId];
  if (!nation) return { ok: false, reason: 'No nation' };
  const available = Math.max(0, sourceProv.troops - 0.001);
  const send = clamp(troops, 0, available);
  if (send < 0.5) return { ok: false, reason: 'Not enough troops' };
  if (nation.gold < (naval ? TUNING.navalCost : 0)) {
    return { ok: false, reason: 'Not enough gold for the fleet' };
  }

  if (targetProv.nationId !== null && !nation.wars.includes(targetProv.nationId)) {
    declareWar(state, nationId, targetProv.nationId);
  }

  sourceProv.troops -= send;
  if (naval) nation.gold -= TUNING.navalCost;

  if (naval) {
    const travel = clamp(
      dist(sourceProv.centroid[0], sourceProv.centroid[1], targetProv.centroid[0], targetProv.centroid[1]) / 150,
      4,
      18
    );
    state.expeditions.push({
      id: Math.random().toString(36).slice(2),
      nationId,
      fromId: sourceProv.id,
      toId: targetProv.id,
      troops: send,
      startTime: state.time,
      arriveTime: state.time + travel,
    });
    pushLog(
      state,
      `${Math.round(send * 1000).toLocaleString()} troops sail from ${sourceProv.name} to invade ${targetProv.name}.`,
      'naval',
      targetProv.id
    );
    return { ok: true, naval: true, travel };
  }

  const result = resolveAttackNow(state, {
    nationId,
    sourceProv,
    targetProv,
    troops: send,
    naval: false,
  });
  return { ok: true, naval: false, result, sent: send };
}

export function resolveAttackNow(state, { nationId, sourceProv, targetProv, troops, naval }) {
  const attacker = state.nations[nationId];
  const defenderId = targetProv.nationId;
  const defender = defenderId !== null ? state.nations[defenderId] : null;
  const defMult = defenseMultiplier(targetProv) * (naval ? 0.92 : 1);
  const result = resolveBattle(troops, targetProv.troops, defMult, state.rng);

  targetProv.troops = Math.max(0, targetProv.troops - result.defenderLosses);
  attacker.stats.troopsLost += result.attackerLosses;
  state.stats.troopsLost += result.attackerLosses;
  if (defender) defender.stats.troopsLost += result.defenderLosses;

  const playerInvolved = nationId === state.playerNationId || defenderId === state.playerNationId;
  addEffect(state, {
    type: 'battle',
    x: targetProv.centroid[0],
    y: targetProv.centroid[1],
    win: result.win,
    minor: !playerInvolved,
    ttl: 1.9,
  });

  if (result.win) {
    attacker.stats.battlesWon += 1;
    state.stats.battlesWon += 1;
    if (defender) defender.stats.battlesLost += 1;
    captureProvince(state, targetProv, nationId, result.survivors);
    const isPlayerBattle = nationId === state.playerNationId || defenderId === state.playerNationId;
    if (isPlayerBattle) {
      addFloatingText(
        state,
        targetProv.centroid[0],
        targetProv.centroid[1] + 10,
        `-${Math.round(result.attackerLosses * 1000).toLocaleString()}`,
        '#ff8f8f'
      );
      addFloatingText(
        state,
        targetProv.centroid[0],
        targetProv.centroid[1] - 18,
        'VICTORY',
        nationId === state.playerNationId ? '#ffe27a' : '#ff8f8f'
      );
    }
    pushLog(
      state,
      `${attacker.name} captures ${targetProv.name}${defender ? ` from ${defender.name}` : ''}.`,
      nationId === state.playerNationId ? 'victory' : defenderId === state.playerNationId ? 'defeat' : 'battle',
      targetProv.id
    );
    if (defenderId !== null) {
      checkElimination(state, defenderId);
    }
  } else {
    attacker.stats.battlesLost += 1;
    state.stats.battlesLost += 1;
    if (defender) defender.stats.battlesWon += 1;
    if (nationId === state.playerNationId || defenderId === state.playerNationId) {
      addFloatingText(
        state,
        targetProv.centroid[0],
        targetProv.centroid[1] + 10,
        `-${Math.round(result.attackerLosses * 1000).toLocaleString()}`,
        '#ff8f8f'
      );
    }
    // Survivors straggle home.
    const home = state.provinces[sourceProv.id];
    if (home && home.nationId === nationId) home.troops += result.survivors;
    pushLog(
      state,
      `${attacker.name}'s assault on ${targetProv.name} is repulsed.`,
      nationId === state.playerNationId ? 'defeat' : defenderId === state.playerNationId ? 'victory' : 'battle',
      targetProv.id
    );
  }

  checkVictory(state);
  return result;
}

export function captureProvince(state, prov, nationId, survivors = 0) {
  const previous = prov.nationId;
  prov.nationId = nationId;
  prov.troops = Math.max(0, survivors);
  prov.captureTime = state.time;
  // Remember the colours to paint over so the renderer can sweep the new flag in.
  prov.prevOwnerId = previous;
  // Ports survive but silos are scuttled; keep it simple: silos destroyed.
  prov.buildings.silo = 0;
  if (previous !== null) {
    state.nations[previous].provincesLost = (state.nations[previous].provincesLost || 0) + 1;
  }
  state.nations[nationId].stats.provincesTaken += 1;
  if (nationId === state.playerNationId) state.stats.provincesTaken += 1;
  if (previous === state.playerNationId) state.stats.provincesLost += 1;
  // Alliance guarantee: attacking an ally is impossible, but capturing a
  // province can flip a war's momentum — nothing else to do here.
  if (state.selectedSourceId !== null && state.provinces[state.selectedSourceId].nationId !== nationId) {
    state.selectedSourceId = null;
  }
}

export function checkElimination(state, nationId) {
  const nation = state.nations[nationId];
  if (!nation || !nation.alive) return;
  const owned = nationProvinces(state, nationId).length;
  if (owned > 0) return;
  nation.alive = false;
  nation.wars = [];
  pushLog(state, `${nation.fullName} has been wiped from the map.`, 'elimination');
  if (nationId === state.playerNationId) {
    state.gameOver = { win: false, reason: 'Your nation was conquered.' };
    state.paused = true;
  }
  for (const n of state.nations) {
    n.wars = n.wars.filter((id) => id !== nationId);
    n.allies = n.allies.filter((id) => id !== nationId);
  }
}

export function checkVictory(state) {
  if (state.gameOver) return;
  const share = worldShare(state);
  if (share >= VICTORY_SHARE) {
    state.gameOver = { win: true, reason: `You control ${(share * 100).toFixed(0)}% of the globe.` };
    state.paused = true;
    pushLog(state, 'The world is yours. Victory!', 'victory');
  }
}

// ---------------------------------------------------------------------------
// Nukes
// ---------------------------------------------------------------------------

export function hasSilo(state, nationId) {
  return state.provinces.some((p) => p.nationId === nationId && p.buildings.silo > 0);
}

export function startNuke(state, nationId) {
  const nation = state.nations[nationId];
  if (!hasSilo(state, nationId)) return { ok: false, reason: 'Build a missile silo first' };
  if (nation.buildingNuke) return { ok: false, reason: 'A warhead is already in production' };
  if (nation.nukes > 0) return { ok: false, reason: 'You already have a warhead ready' };
  if (nation.gold < TUNING.nukeCost) return { ok: false, reason: 'Not enough gold' };
  nation.gold -= TUNING.nukeCost;
  nation.buildingNuke = true;
  nation.nukeProgress = 0;
  pushLog(state, `${nation.name} begins enriching weapons-grade material.`, 'nuke');
  return { ok: true };
}

export function launchNuke(state, nationId, targetProv) {
  const nation = state.nations[nationId];
  if (!nation || nation.nukes <= 0) return { ok: false, reason: 'No warheads available' };
  if (targetProv.nationId === nationId) return { ok: false, reason: 'That is your own land' };
  nation.nukes -= 1;
  state.stats.nukesLaunched += nationId === state.playerNationId ? 1 : 0;

  const defenderId = targetProv.nationId;
  if (defenderId !== null) {
    if (!nation.wars.includes(defenderId)) declareWar(state, nationId, defenderId, { silent: true });
    const defender = state.nations[defenderId];
    defender.relations[nationId] = -100;
    if (defender.capitalId === targetProv.id) defender.exhaustionUntil = state.time + 120;
    else defender.exhaustionUntil = Math.max(defender.exhaustionUntil || 0, state.time + 45);
    for (const prov of state.provinces) {
      if (prov.nationId === defenderId) prov.troops *= 0.9;
    }
  }
  targetProv.troops *= 0.12;
  targetProv.population = Math.max(0.2, targetProv.population * 0.72);
  targetProv.value = Math.max(0.6, targetProv.value * 0.7);
  if (targetProv.buildings.city > 0) targetProv.buildings.city -= 1;
  if (targetProv.buildings.fort > 0) targetProv.buildings.fort -= 1;
  if (targetProv.buildings.factory > 0) targetProv.buildings.factory -= 1;

  for (const other of state.nations) {
    if (other.id === nationId) continue;
    other.relations[nationId] = Math.max(-100, (other.relations[nationId] ?? 0) - 45);
  }

  addEffect(state, {
    type: 'nuke',
    x: targetProv.centroid[0],
    y: targetProv.centroid[1],
    ttl: 3.4,
  });
  pushLog(
    state,
    `${nation.name} launches a nuclear strike on ${targetProv.name}!`,
    'nuke',
    targetProv.id
  );
  checkVictory(state);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Diplomacy helpers exposed to UI
// ---------------------------------------------------------------------------

export function allianceChance(state, nationId, targetId) {
  const a = state.nations[nationId];
  const b = state.nations[targetId];
  const relation = b.relations[nationId] ?? 0;
  const sharedEnemies = a.wars.filter((id) => b.wars.includes(id)).length;
  let chance = clamp((relation - 20) / 110, 0, 0.85) + sharedEnemies * 0.12;
  chance += (nationPower(state, nationId) - nationPower(state, targetId)) / (nationPower(state, targetId) + 1) * 0.12;
  return clamp(chance, 0.02, 0.92);
}

export function peaceChance(state, nationId, targetId) {
  const mine = nationPower(state, nationId);
  const theirs = nationPower(state, targetId);
  let chance = 0.5 + (mine / (theirs + 1) - 1) * 0.16;
  if (state.nations[targetId].alive === false) chance = 1;
  return clamp(chance, 0.05, 0.95);
}

export function proposeAlliance(state, nationId, targetId) {
  const chance = allianceChance(state, nationId, targetId);
  const target = state.nations[targetId];
  if (Math.random() < chance) {
    state.nations[nationId].allies.push(targetId);
    target.allies.push(nationId);
    state.nations[nationId].relations[targetId] = 100;
    target.relations[nationId] = 100;
    makePeace(state, nationId, targetId, { silent: true });
    pushLog(state, `${target.name} accepts your alliance.`, 'diplomacy');
    return { ok: true, accepted: true };
  }
  target.relations[nationId] = clamp((target.relations[nationId] ?? 0) - 4, -100, 100);
  pushLog(state, `${target.name} rejects your alliance offer.`, 'diplomacy');
  return { ok: true, accepted: false };
}

export function proposePeace(state, nationId, targetId) {
  const chance = peaceChance(state, nationId, targetId);
  const target = state.nations[targetId];
  if (Math.random() < chance) {
    makePeace(state, nationId, targetId);
    return { ok: true, accepted: true };
  }
  pushLog(state, `${target.name} refuses to lay down arms.`, 'diplomacy');
  return { ok: true, accepted: false };
}

export function giftGold(state, nationId, targetId, amount = 100) {
  const nation = state.nations[nationId];
  const target = state.nations[targetId];
  if (nation.gold < amount) return { ok: false, reason: 'Not enough gold' };
  nation.gold -= amount;
  target.gold += amount;
  target.relations[nationId] = clamp((target.relations[nationId] ?? 0) + 16, -100, 100);
  pushLog(state, `You send ${amount} gold to ${target.name}. Relations improve.`, 'diplomacy');
  return { ok: true };
}

export function breakAlliance(state, nationId, targetId) {
  const a = state.nations[nationId];
  const b = state.nations[targetId];
  a.allies = a.allies.filter((id) => id !== targetId);
  b.allies = b.allies.filter((id) => id !== nationId);
  b.relations[nationId] = clamp((b.relations[nationId] ?? 0) - 55, -100, 100);
  pushLog(state, `You dissolve the alliance with ${b.name}. They will remember this.`, 'diplomacy');
}

// ---------------------------------------------------------------------------
// Main simulation step
// ---------------------------------------------------------------------------

export function update(state, dtRaw) {
  if (state.gameOver) return;
  const dt = Math.min(dtRaw, 0.5);
  state.time += dt;
  state.day = 1 + Math.floor(state.time);

  const aiControlled = (nation) => !nation.isPlayer;

  // Economy.
  for (const nation of state.nations) {
    if (!nation.alive) continue;
    const mult = aiControlled(nation) ? state.diff.aiIncome : 1;
    const income = nationIncome(state, nation.id) * mult;
    const upkeep = nationUpkeep(state, nation.id);
    const net = income - upkeep;
    nation.gold = Math.max(0, nation.gold + net * dt);
    nation.incomeSmoothed = income - upkeep;
    if (nation.isPlayer) state.stats.goldEarned += Math.max(0, net) * dt;
    const regen = nationManpowerRegen(state, nation.id);
    const cap = 60 + nationPopulation(state, nation.id) * 2.2;
    nation.manpower = Math.min(cap, nation.manpower + regen * dt);
    if (nation.buildingNuke) {
      nation.nukeProgress += dt;
      if (nation.nukeProgress >= TUNING.nukeBuildTime) {
        nation.buildingNuke = false;
        nation.nukeProgress = 0;
        nation.nukes += 1;
        if (nation.isPlayer) {
          pushLog(state, 'Warhead assembled and ready for launch.', 'nuke');
          addEffect(state, { type: 'notification', text: '☢ WARHEAD READY', color: '#ffd166' });
        }
      }
    }
  }

  // Neutral garrisons slowly recover.
  for (const prov of state.provinces) {
    if (prov.nationId === null) {
      const cap = TUNING.neutralTroopsBase + prov.value * TUNING.neutralTroopsPerValue;
      prov.troops = Math.min(cap, prov.troops + TUNING.neutralRegen * dt);
    }
  }

  // Naval expeditions.
  for (let i = state.expeditions.length - 1; i >= 0; i -= 1) {
    const exp = state.expeditions[i];
    if (state.time < exp.arriveTime) continue;
    state.expeditions.splice(i, 1);
    const target = state.provinces[exp.toId];
    const source = state.provinces[exp.fromId];
    const attacker = state.nations[exp.nationId];
    if (!attacker || !attacker.alive) continue;
    if (target.nationId === exp.nationId) {
      // Reinforce our own land.
      target.troops += exp.troops;
      continue;
    }
    if (target.nationId !== null && attacker.allies.includes(target.nationId)) {
      if (source.nationId === exp.nationId) source.troops += exp.troops;
      continue;
    }
    if (target.nationId !== null && !attacker.wars.includes(target.nationId)) {
      declareWar(state, exp.nationId, target.nationId, { silent: true });
    }
    resolveAttackNow(state, {
      nationId: exp.nationId,
      sourceProv: source,
      targetProv: target,
      troops: exp.troops,
      naval: true,
    });
  }

  // Effects lifetime.
  for (let i = state.effects.length - 1; i >= 0; i -= 1) {
    const fx = state.effects[i];
    fx.t += dt;
    if (fx.t >= (fx.ttl || 2)) state.effects.splice(i, 1);
  }

  // AI.
  state.aiTimer += dt;
  if (state.aiTimer >= 0.5) {
    state.aiTimer = 0;
    for (const nation of state.nations) {
      if (nation.isPlayer || !nation.alive) continue;
      nation.ai.nextDecision -= 0.5;
      if (nation.ai.nextDecision > 0) continue;
      nation.ai.nextDecision = 1.4 + Math.random() * 3.2;
      runAiTurn(state, nation);
    }
  }

  checkVictory(state);
}
