import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { createGame, beginAttack, quickAttack, update, nationArmy, worldShare, checkVictory,
  nationManpowerRegen, garrisonTarget, makePeace, TUNING } from '../src/game/state.js';
import { heldTiles, tileOwner } from '../src/game/fronts.js';
import { findProvinceAt } from '../src/game/worldgen.js';
import { serialize, deserialize } from '../src/game/save.js';
import { MapView } from '../src/game/render.js';

const close = (a, b) => assert.ok(Math.abs(a-b) < 1e-8, `${a} should equal ${b}`);
function field() {
  const s = createGame({ seed: 424242 });
  for (const n of s.nations) n.ai.nextDecision = Infinity;
  const a = s.provinces.find(p => p.nationId === 0 && p.neighbours.some(i => s.provinces[i].nationId !== 0));
  const b = s.provinces[a.neighbours.find(i => s.provinces[i].nationId !== 0)];
  b.nationId = 1;
  return { s, a, b };
}
function push(s, a, b, send = 5) {
  const attack = beginAttack(s, a.nationId, a, b, send, false);
  assert.ok(attack.ok, attack.reason);
  return attack.result;
}

test('a costly push and a breakthrough both take connected, persistent land and account for every soldier', () => {
  const { s, a, b } = field();
  const w = s.world.gridW;
  a.troops = 100;
  b.troops = 300;
  const initialShare = worldShare(s), army = nationArmy(s, 0);
  const costly = push(s, a, b);
  assert.equal(costly.win, false);
  assert.ok(costly.gained > 0 && costly.gained < b.areaPx / 4);
  assert.equal(b.nationId, 1);
  close(nationArmy(s, 0), army - costly.attackerLosses);
  close(worldShare(s) - initialShare, costly.gained / s.world.landCellCount);
  const front = b.fronts.get(0);
  const first = [...front.tiles];
  assert.ok(first.some(i => [-1,1,-w,w,-w-1,-w+1,w-1,w+1].some(d => s.world.provinceAt[i+d] === a.id)), 'enters at shared edge');
  const connected = new Set([first[0]]);
  for (const i of connected) for (const d of [1,-1,w,-w]) if (front.tiles.has(i+d)) connected.add(i+d);
  assert.equal(connected.size, first.length);
  b.troops = 2;
  const next = push(s, a, b, 20);
  assert.ok(next.win && next.gained > costly.gained);
  assert.equal(s.stats.provincesTaken, 0);
  assert.ok(first.every(i => tileOwner(b, i) === 0));
  assert.equal(next.held, next.gained + costly.gained);
  for (const i of front.tiles) assert.equal(s.world.provinceAt[i], b.id);
});

test('replacements arrive after rest, cost manpower, stop at local strength, and never trim recruits', () => {
  const { s, a, b } = field();
  a.troops = garrisonTarget(a);
  push(s, a, b);
  const after = a.troops;
  s.paused = true; update(s, .5); assert.equal(s.time, 0);
  s.paused = false;
  for (let i = 0; i < TUNING.musterDelay * 2; i++) update(s, .5);
  close(a.troops, after);
  const reserve = s.player.manpower = 5;
  const regen = nationManpowerRegen(s, 0);
  update(s, .5);
  assert.ok(a.troops > after);
  close(reserve + regen * .5 - s.player.manpower, a.troops - after);
  close(s.player.replacementRate, (a.troops - after) * 2);
  const text = s.effects.filter(f => f.type === 'text').length;
  for (let i = 0; i < 130; i++) update(s, .5);
  close(a.troops, garrisonTarget(a));
  assert.ok(s.effects.filter(f => f.type === 'text').length <= text, 'no replacement popups');
  a.troops += 80;
  const surplus = a.troops; update(s, .5); close(a.troops, surplus);
  a.troops = 0; s.player.manpower = 0;
  update(s, .1);
  assert.ok(a.troops <= regen * .1 + 1e-8 && s.player.manpower >= 0);
});

test('an occupied home tile can be retaken, but not through a truce; invalid orders cost nothing', () => {
  const { s, a, b } = field();
  const first = push(s, a, b);
  const aim = [...b.fronts.get(0).tiles][0];
  assert.equal(tileOwner(b, aim), 0);
  makePeace(s, 0, 1, { silent: true });
  const idle = b.troops;
  assert.equal(quickAttack(s, 1, b, .25, aim).ok, false);
  assert.equal(b.troops, idle);
  assert.equal(beginAttack(s, 1, a, b, 4, false).ok, false);
  assert.equal(heldTiles(b, 0), first.gained);
  s.time = 151;
  const repel = quickAttack(s, 1, b, .25, aim);
  assert.ok(repel.ok && repel.result.gained > 0);
  assert.equal(heldTiles(b, 0), first.gained - repel.result.gained);
  assert.equal(tileOwner(b, aim), 1);
});

test('rival footholds keep their land and troops when the last defender tile changes hands', () => {
  const { s } = field();
  const p = s.provinces.find(p => p.neighbours.length >= 3);
  const [a, b] = p.neighbours.map(i => s.provinces[i]);
  p.nationId = null; a.nationId = 0; b.nationId = 1;
  a.troops = b.troops = 300; p.troops = 1;
  push(s, b, p, 12);
  const other = [...p.fronts.get(1).tiles], guards = p.fronts.get(1).troops;
  for (let i = 0; p.nationId === null && i < p.areaPx; i++) push(s, a, p, 2);
  assert.equal(p.nationId, 0);
  assert.deepEqual([...p.fronts.get(1).tiles], other);
  assert.equal(p.fronts.get(1).troops, guards);
  assert.equal(heldTiles(p, 0) + heldTiles(p, 1), p.areaPx);
  assert.equal(p.fronts.has(0), false, 'winning field army is no longer counted separately');
});

test('a fleet pays on departure, takes coastal ground only upon arrival and honours a new ceasefire', () => {
  const { s } = field();
  const a = s.provinces.find(p => p.coastal && p.seaLanes.length);
  const b = s.provinces[a.seaLanes[0]];
  a.nationId = 0; b.nationId = 1; a.troops = 100; a.buildings.port = 1;
  const gold = s.player.gold, army = nationArmy(s, 0);
  const sail = () => beginAttack(s, 0, a, b, 15, true);
  const first = sail(); assert.ok(first.ok);
  assert.equal(s.player.gold, gold - TUNING.navalCost);
  close(nationArmy(s, 0), army);
  assert.equal(heldTiles(b, 0), 0);
  s.time += first.travel; update(s, .01);
  const taken = heldTiles(b, 0);
  assert.ok(taken > 0 && taken < b.areaPx);
  const w = s.world.gridW;
  assert.ok([...b.fronts.get(0).tiles].some(i => [-1,1,w,-w].some(d => !s.world.land[i+d])));
  const second = sail(); assert.ok(second.ok);
  makePeace(s, 0, 1, { silent: true });
  s.time += second.travel; update(s, .01);
  assert.equal(heldTiles(b, 0), taken);
  assert.ok(!s.player.wars.includes(1));
});

test('partial land counts toward the 80% win even before the province falls', () => {
  const { s } = field();
  const [a,b] = s.provinces;
  a.nationId = 0; b.nationId = 1;
  s.provinces = [a,b]; s.world.landCellCount = a.areaPx + b.areaPx;
  const needed = Math.ceil(.8 * s.world.landCellCount) - a.areaPx;
  assert.ok(needed > 0 && needed < b.areaPx);
  b.fronts.set(0, { tiles: new Set(b.cells.slice(0, needed-1)), troops: 12 });
  checkVictory(s); assert.equal(s.gameOver, null);
  b.fronts.get(0).tiles.add(b.cells[needed-1]);
  checkVictory(s); assert.ok(s.gameOver.win);
  assert.equal(b.nationId, 1);
});

test('campaign saves preserve exact parcels, field armies and muster time; v1 saves start with no fronts', () => {
  const { s, a, b } = field(); push(s, a, b);
  const data = JSON.parse(JSON.stringify(serialize(s)));
  const loaded = deserialize(data);
  assert.deepEqual(loaded.provinces[b.id].fronts, b.fronts);
  assert.equal(loaded.provinces[a.id].musterAt, a.musterAt);
  close(worldShare(loaded), worldShare(s));
  data.version = 1;
  for (const p of data.provinces) { delete p.fronts; delete p.musterAt; }
  const old = deserialize(data);
  assert.equal(old.provinces[b.id].nationId, b.nationId);
  assert.equal(old.provinces[b.id].fronts.size, 0);
  assert.equal(old.provinces[a.id].musterAt, 0);
});

test('the parcel raster changes on a partial push and matches hit-testing at different zooms', () => {
  const { s, a, b } = field();
  const view = new MapView(createCanvas(800, 500), { surface: createCanvas });
  view.setWorld(s.world);
  view.politicalLayer(s);
  const before = view.atlas.pixels.slice();
  push(s, a, b);
  view.politicalLayer(s); // no completed capture and no change in selection
  const tiles = b.fronts.get(0).tiles;
  assert.ok([...tiles].some(i => view.atlas.pixels[i] !== before[i]));
  for (const i of tiles) assert.equal(view.atlas.owners[i], 0);
  const key = view.politicalKey, i = [...tiles][0], { gridW, pixel } = s.world;
  const xy = [(i % gridW + .5)*pixel, (Math.floor(i/gridW)+.5)*pixel];
  for (const zoom of [.65, 1.5, 3]) {
    view.focusProvince(b, zoom);
    const hit = view.screenToWorld(...view.worldToScreen(...xy));
    assert.equal(findProvinceAt(s.world, ...hit), b);
    view.draw(s, { showLabels: false, showTroops: false });
    assert.equal(view.politicalKey, key, 'pan and zoom do not reroll the terrain');
  }
  assert.equal(findProvinceAt(s.world, -1, 0), null);
});
