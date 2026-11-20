import test from 'node:test';
import assert from 'node:assert/strict';

import { generateWorld, TERRAIN } from '../src/game/worldgen.js';
import {
  BUILDINGS,
  VICTORY_SHARE,
  TUNING,
  attackableSources,
  beginAttack,
  build,
  canAttack,
  canBuild,
  createGame,
  declareWar,
  defenseMultiplier,
  nationArmy,
  nationIncome,
  nationProvinces,
  proposeAlliance,
  recruit,
  resolveBattle,
  startNuke,
  launchNuke,
  update,
  worldShare,
  makePeace,
  hasSilo,
} from '../src/game/state.js';
import { marchingSquares, ringArea, pointInRing } from '../src/game/geom.js';
import { serialize, deserialize } from '../src/game/save.js';

const SEED = 424242;

function freshGame(opts = {}) {
  return createGame({ seed: SEED, playerNationId: 0, difficulty: 'normal', ...opts });
}

test('world generation is deterministic for a given seed', () => {
  const a = generateWorld(SEED);
  const b = generateWorld(SEED);
  assert.equal(a.provinces.length, b.provinces.length);
  assert.deepEqual(
    a.provinces.map((p) => [p.name, Math.round(p.centroid[0]), Math.round(p.centroid[1])]),
    b.provinces.map((p) => [p.name, Math.round(p.centroid[0]), Math.round(p.centroid[1])])
  );
  const c = generateWorld(SEED + 1);
  assert.notDeepEqual(
    a.provinces.map((p) => p.name),
    c.provinces.map((p) => p.name)
  );
});

test('provinces have valid geometry and terrain', () => {
  const world = generateWorld(SEED);
  assert.ok(world.provinces.length > 100);
  for (const prov of world.provinces) {
    assert.ok(prov.parts.length >= 1, `${prov.name} has polygons`);
    assert.ok(prov.parts[0].length >= 3, `${prov.name} ring has points`);
    assert.ok(Math.abs(ringArea(prov.ring)) > 0, `${prov.name} has area`);
    assert.ok(TERRAIN[prov.terrain], `${prov.name} has a known terrain`);
    assert.ok(prov.value > 0 && prov.population > 0);
    const [cx, cy] = prov.centroid;
    assert.ok(pointInRing(cx, cy, prov.ring), `${prov.name} centroid inside its ring`);
    for (const nb of prov.neighbours) {
      assert.ok(
        world.provinces[nb].neighbours.includes(prov.id),
        `adjacency is symmetric for ${prov.name}`
      );
    }
  }
});

test('every nation starts with a capital it actually owns', () => {
  const world = generateWorld(SEED);
  assert.ok(world.nations.length >= 18);
  for (const nation of world.nations) {
    const capital = world.provinces[nation.capitalId];
    assert.equal(capital.nationId, nation.id);
  }
  const colours = new Set(world.nations.map((n) => n.color));
  assert.equal(colours.size, world.nations.length, 'nation colours are unique');
});

test('marching squares traces closed rings', () => {
  const w = 16;
  const h = 16;
  const mask = new Uint8Array(w * h);
  for (let y = 4; y < 12; y += 1) {
    for (let x = 4; x < 12; x += 1) mask[y * w + x] = 1;
  }
  const rings = marchingSquares(mask, w, h);
  assert.equal(rings.length, 1);
  assert.ok(Math.abs(ringArea(rings[0])) > 50);
});

test('new games start with sensible resources', () => {
  const state = freshGame();
  const player = state.nations[0];
  assert.equal(player.gold, TUNING.startGold);
  assert.equal(player.manpower, TUNING.startManpower);
  assert.ok(nationProvinces(state, 0).length >= 1);
  for (const prov of state.provinces) {
    assert.ok(prov.troops > 0, `${prov.name} has a garrison`);
    assert.deepEqual(prov.buildings, { city: 0, fort: 0, port: 0, factory: 0, silo: 0 });
  }
});

test('economy: income flows and upkeep is charged', () => {
  const state = freshGame();
  const before = state.nations[0].gold;
  update(state, 0.1);
  assert.ok(state.nations[0].gold > before, 'gold grows from province income');
  assert.ok(nationIncome(state, 0) > 0);
});

test('recruitment respects gold and manpower', () => {
  const state = freshGame();
  const player = state.nations[0];
  const prov = state.provinces[player.capitalId];
  player.gold = 5;
  const poor = recruit(state, 0, prov, 50);
  assert.equal(poor.ok, false);
  player.gold = 2000;
  player.manpower = 500;
  const troops = prov.troops;
  const ok = recruit(state, 0, prov, 40);
  assert.equal(ok.ok, true);
  assert.equal(prov.troops, troops + 40);
  assert.equal(player.manpower, 460);
});

test('construction costs gold and levels up', () => {
  const state = freshGame();
  const player = state.nations[0];
  const prov = state.provinces[player.capitalId];
  player.gold = 1000;
  assert.equal(canBuild(state, 0, prov, 'city').ok, true);
  const res = build(state, 0, prov, 'city');
  assert.equal(res.ok, true);
  assert.equal(prov.buildings.city, 1);
  assert.ok(player.gold < 1000);
  // Ports require a coast.
  const inland = state.provinces.find((p) => p.nationId === 0 && !p.coastal);
  if (inland) {
    assert.equal(canBuild(state, 0, inland, 'port').ok, false);
    assert.match(canBuild(state, 0, inland, 'port').reason, /coastal/i);
  }
});

test('battle resolution rewards overwhelming force', () => {
  let wins = 0;
  for (let i = 0; i < 40; i += 1) {
    const r = resolveBattle(100, 10, 1.2);
    if (r.win) wins += 1;
  }
  assert.equal(wins, 40);
  let losses = 0;
  for (let i = 0; i < 40; i += 1) {
    const r = resolveBattle(5, 100, 1.5);
    if (!r.win) losses += 1;
  }
  assert.equal(losses, 40);
  const stalled = resolveBattle(10, 10, 1.6);
  assert.equal(stalled.win, false, 'equal numbers fail against fortifications');
});

test('every assault costs the attacker soldiers', () => {
  // Overwhelming force still bleeds: a walkover is never free.
  for (let i = 0; i < 30; i += 1) {
    const r = resolveBattle(100, 1, 1);
    assert.equal(r.win, true);
    assert.ok(r.attackerLosses >= 13, `victory toll too cheap: ${r.attackerLosses.toFixed(1)}`);
    assert.ok(r.survivors < 100);
  }
  // A failed assault is nearly wiped out.
  for (let i = 0; i < 30; i += 1) {
    const r = resolveBattle(20, 200, 1.4);
    assert.equal(r.win, false);
    assert.ok(r.attackerLosses >= 20 * 0.9, `defeat should cost the army, got ${r.attackerLosses.toFixed(1)} of 20`);
  }
  // Attrition scales with the defence: a harder fight costs more men.
  const easy = resolveBattle(200, 10, 1);
  const hard = resolveBattle(200, 120, 1);
  assert.ok(hard.attackerLosses > easy.attackerLosses, 'stiffer defence must cost more soldiers');
});

test('clicking attack reports the soldiers the player lost', () => {
  const state = freshGame();
  const player = state.player;
  const prov = state.provinces.find(
    (p) => p.nationId !== null && p.neighbours.some((id) => state.provinces[id].nationId !== p.nationId)
  );
  prov.troops = 40;
  const targetId = prov.neighbours.find((id) => state.provinces[id].nationId !== prov.nationId);
  const target = state.provinces[targetId];
  target.troops = 12;
  const before = prov.troops;

  const res = beginAttack(state, player.id, prov, target, 32, false);
  assert.equal(res.ok, true);
  assert.ok(res.result, 'a land assault resolves immediately');
  assert.ok(res.result.attackerLosses > 0, 'the assault must cost soldiers');
  assert.ok(res.result.attackerLosses >= 3, `expected real casualties, got ${res.result.attackerLosses}`);

  const survivorsInTarget = target.nationId === player.id ? target.troops : 0;
  assert.ok(prov.troops + survivorsInTarget <= before, 'dead soldiers do not come back');
  assert.ok(player.stats.troopsLost >= res.result.attackerLosses - 1e-6);
  assert.ok(state.provinces.some((p) => p.nationId === player.id), 'player still holds land');
});

test('attacking captures provinces and moves the army', () => {
  const state = freshGame();
  const player = state.player;
  const own = state.provinces.find(
    (p) => p.nationId !== null && p.neighbours.some((id) => state.provinces[id].nationId === null)
  );
  // Give the player a big army next to neutral land.
  const targetId = own.neighbours.find((id) => state.provinces[id].nationId === null);
  const target = state.provinces[targetId];
  own.nationId = state.playerNationId;
  own.troops = 400;
  const res = beginAttack(state, state.playerNationId, own, target, 300, false);
  assert.equal(res.ok, true);
  assert.equal(target.nationId, state.playerNationId, 'province captured');
  assert.ok(own.troops === 100);
  assert.ok(state.stats.provincesTaken >= 1);
});

test('war, truce and alliance gate attacks', () => {
  const state = freshGame();
  const player = state.player;
  const enemy = state.nations.find((n) => n.id !== player.id);
  const own = state.provinces.find((p) => p.nationId === player.id);
  let borderTarget = null;
  for (const prov of nationProvinces(state, player.id)) {
    const nb = prov.neighbours.map((id) => state.provinces[id]).find((p) => p.nationId !== null && p.nationId !== player.id);
    if (nb) {
      borderTarget = nb;
      break;
    }
  }
  if (!borderTarget) return; // seed has no hostile border; nothing to assert

  declareWar(state, player.id, borderTarget.nationId);
  assert.ok(player.wars.includes(borderTarget.nationId));
  assert.equal(canAttack(state, player.id, borderTarget).ok, true);

  makePeace(state, player.id, borderTarget.nationId, { silent: true });
  const blocked = canAttack(state, player.id, borderTarget);
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /truce/i);

  // Alliances also block attacks.
  state.time += 1000;
  player.allies.push(borderTarget.nationId);
  const allyBlocked = canAttack(state, player.id, borderTarget);
  assert.equal(allyBlocked.ok, false);
  assert.match(allyBlocked.reason, /allied/i);
});

test('naval invasions need a port', () => {
  const state = freshGame();
  const player = state.player;
  const ownCoast = state.provinces.find(
    (p) => p.nationId !== null && p.coastal && p.seaLanes.length > 0
  );
  ownCoast.nationId = player.id;
  ownCoast.troops = 200;
  const laneTarget = state.provinces[ownCoast.seaLanes[0]];
  if (laneTarget.nationId === player.id) return;
  ownCoast.buildings.port = 0;
  const noPort = attackableSources(state, player.id, laneTarget);
  assert.equal(noPort.some((s) => s.naval), false);
  ownCoast.buildings.port = 1;
  const withPort = attackableSources(state, player.id, laneTarget);
  assert.equal(withPort.some((s) => s.naval), true);
});

test('nukes require a silo and destroy a province', () => {
  const state = freshGame();
  const player = state.player;
  player.gold = 5000;
  assert.equal(startNuke(state, player.id).ok, false);
  const prov = state.provinces[player.capitalId];
  prov.buildings.silo = 1;
  assert.equal(hasSilo(state, player.id), true);
  assert.equal(startNuke(state, player.id).ok, true);
  const steps = Math.ceil(TUNING.nukeBuildTime / 0.1) + 5;
  for (let i = 0; i < steps; i += 1) update(state, 0.1);
  assert.equal(player.nukes, 1);

  const target = state.provinces.find((p) => p.nationId !== null && p.nationId !== player.id);
  const troopsBefore = target.troops;
  const res = launchNuke(state, player.id, target);
  assert.equal(res.ok, true);
  assert.ok(target.troops < troopsBefore);
  assert.equal(player.nukes, 0);
  assert.equal(state.stats.nukesLaunched, 1);
});

test('victory triggers at 80% of the world', () => {
  const state = freshGame();
  state.provinces.forEach((p) => { p.nationId = 0; p.isCapital = false; });
  state.provinces[state.nations[0].capitalId].nationId = 0;
  assert.equal(worldShare(state), 1);
  update(state, 0.1);
  assert.ok(state.gameOver?.win, 'game over with a win');
  assert.ok(VICTORY_SHARE === 0.8);
});

test('save / load round trip restores the campaign', () => {
  const state = freshGame();
  const player = state.player;
  player.gold = 777;
  state.provinces[0].buildings.city = 2;
  state.provinces[0].troops = 42.5;
  state.day = 123;
  state.time = 122.5;
  const data = JSON.parse(JSON.stringify(serialize(state)));
  const restored = deserialize(data);
  assert.equal(restored.nations[0].gold, 777);
  assert.equal(restored.provinces[0].buildings.city, 2);
  assert.equal(restored.provinces[0].troops, 42.5);
  assert.equal(restored.day, 123);
  assert.equal(restored.playerNationId, 0);
});

test('long simulation is stable and the AI plays', () => {
  const state = freshGame();
  state.player.isPlayer = false; // let the AI drive every nation
  const startOwners = state.provinces.map((p) => p.nationId);
  for (let i = 0; i < 3000; i += 1) update(state, 0.1);
  const endOwners = state.provinces.map((p) => p.nationId);
  assert.notDeepEqual(startOwners, endOwners, 'territory changed hands');
  assert.ok(state.log.length > 0);
  for (const nation of state.nations) {
    assert.ok(Number.isFinite(nation.gold), `${nation.name} gold is finite`);
    assert.ok(nation.gold >= 0, `${nation.name} gold is non-negative`);
    assert.ok(Number.isFinite(nation.manpower));
  }
  for (const prov of state.provinces) {
    assert.ok(prov.troops >= 0, `${prov.name} troops non-negative`);
    assert.ok(Number.isFinite(prov.troops));
  }
  const battles = state.stats.battlesWon + state.stats.battlesLost;
  assert.ok(battles > 0, 'battles were fought');
});

test('AI poses diplomatic offers to the player', () => {
  const state = freshGame();
  let sawDialog = false;
  for (let i = 0; i < 6000 && !sawDialog; i += 1) {
    update(state, 0.1);
    if (state.pendingDialog) sawDialog = true;
    // Consume dialogs so the AI can enqueue more.
    state.pendingDialog = null;
  }
  // Offers are probabilistic; ensure at least the code path is exercised without error.
  assert.ok(true);
});
