import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, canBuild, build, nationArmy, orderTile, update, TUNING } from '../src/game/state.js';
import { serialize, deserialize } from '../src/game/save.js';
import { heldCell } from '../src/game/fronts.js';

function scene() {
  const s = createGame({ seed: 424242 });
  for (const n of s.nations) n.ai.nextDecision = Infinity;
  const p = s.provinces.find(p => p.nationId === 0 && p.neighbours.some(i => s.provinces[i].nationId !== 0));
  const enemy = s.provinces[p.neighbours.find(i => s.provinces[i].nationId !== 0)];
  enemy.nationId = 1;
  s.player.gold = 999;
  return { s, p, enemy };
}
const close = (a,b) => assert.ok(Math.abs(a-b) < .000001, `${a} != ${b}`);

test('home orders commit a fresh quarter on every tap, survive save and arrive exactly once', () => {
  const { s, p, enemy: source } = scene();
  source.nationId = 0; source.troops = 200;
  const oldArmy = nationArmy(s,0), old = p.troops, cell = p.seatCell;
  const first = orderTile(s,0,p,cell), second = orderTile(s,0,p,cell);
  assert.ok(first.march && second.march);
  assert.equal(first.sent, 50); assert.equal(second.sent, 37.5);
  assert.equal(source.troops,112.5); close(p.troops,old); close(nationArmy(s,0), oldArmy);
  assert.equal(source.musterAt, s.time + TUNING.musterDelay);
  const saved = serialize(s), loaded = deserialize(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(loaded.expeditions, s.expeditions);
  loaded.paused = false;
  for (const n of loaded.nations) n.ai.nextDecision = Infinity;
  const q = loaded.provinces[p.id], before = q.troops;
  loaded.time = Math.max(...loaded.expeditions.map(e => e.arriveTime));
  q.musterAt = 100; update(loaded,.01);
  assert.equal(loaded.expeditions.length,0); close(q.troops,before+87.5);
  update(loaded,.01); close(q.troops,before+87.5);
});

test('a home patrol and a project share one dispatch; foreign and occupied parcels get only an assault', () => {
  const { s, p, enemy } = scene();
  for (const i of p.neighbours) if (s.provinces[i].nationId === 0) s.provinces[i].troops = 0;
  const plot = canBuild(s,0,p,'city').cell; p.troops = 80;
  const patrol = orderTile(s,0,p,plot,'city');
  assert.ok(patrol.construction.ok); assert.equal(patrol.source,p); assert.equal(p.troops,60);
  assert.equal(s.expeditions.length,1); assert.equal(s.expeditions[0].aim,plot);
  const treasury = s.player.gold;
  enemy.troops = 1;
  const away = orderTile(s,0,enemy,enemy.seatCell,'city',plot);
  assert.ok(away.result.gained > 0 && away.result.attackerLosses > 0);
  assert.equal(enemy.sites.length,0); assert.equal(s.player.gold,treasury);
  const beachhead = heldCell(enemy,0);
  assert.equal(build(s,0,enemy,'city',beachhead).ok,false, 'a foothold abroad is not a build permit');
  // An occupied click must not snap to the nearby previously built city.
  const invaded = p.cells.find(i => i !== plot);
  p.fronts.set(1, { tiles: new Set([invaded]), troops: 1 });
  const counter = orderTile(s,0,p,invaded,'city',plot);
  assert.ok(counter.result.gained > 0); assert.equal(p.buildings.city,1); assert.equal(s.player.gold,treasury);
});

test('a domestic footprint touching foreign ground cannot be built, even when the anchor is owned', () => {
  const { s,p } = scene();
  const safe = canBuild(s,0,p,'fort').cell;
  assert.ok(Number.isInteger(safe));
  const nb = [-1,1,-s.world.gridW,s.world.gridW].map(d => safe+d).find(i => s.world.provinceAt[i] === p.id);
  assert.ok(nb);
  p.fronts.set(1, { tiles: new Set([nb]), troops: 2 });
  const before = s.player.gold;
  const rejected = build(s,0,p,'fort',safe);
  assert.match(rejected.reason,/inside your border/);
  assert.equal(p.sites.length,0); assert.equal(s.player.gold,before);
  const march = orderTile(s,0,p,safe,'fort');
  assert.ok(march.march && !march.construction.ok && march.sent > 0);
  assert.equal(p.sites.length,0); assert.equal(s.player.gold,before);
});

test('staging a distant advance never teleports a conquest or builds, and protected targets issue no order', () => {
  const { s,p } = scene();
  const far = s.provinces.find(q => q.nationId === null && q.neighbours.every(i => s.provinces[i].nationId !== 0));
  far.nationId = 1;
  const old = nationArmy(s,0), gold = s.player.gold, land = s.landRevision;
  const stage = orderTile(s,0,far,far.seatCell,'fort');
  assert.ok(stage.march && stage.staging && stage.sent > 0);
  const exp = s.expeditions[0];
  assert.equal(exp.toId,stage.destination.id); assert.equal(stage.destination.nationId,0);
  assert.equal(far.nationId,1); assert.equal(s.landRevision,land); assert.equal(s.player.gold,gold);
  assert.equal(s.player.wars.length,0); close(nationArmy(s,0),old);
  s.player.allies.push(1);
  assert.equal(orderTile(s,0,far,far.seatCell).ok,false);
  s.player.allies = []; s.player.truces[1] = 12;
  assert.equal(orderTile(s,0,far,far.seatCell).ok,false);
  assert.equal(orderTile(s,0,p,-1,'city').ok,false);
  assert.equal(orderTile(s,0,p,null,'city').ok,false);
  s.gameOver = { win: true }; assert.equal(orderTile(s,0,p,p.seatCell,'city').ok,false);
  assert.equal(s.expeditions.length,1);
});

test('a march whose destination falls returns to friendly land; legacy fleets remain fleets', () => {
  const { s,p,enemy: source } = scene();
  source.nationId=0; source.troops=100;
  const order = orderTile(s,0,p,p.seatCell);
  const data = serialize(s), legacy = structuredClone(data);
  legacy.version = 3; delete legacy.expeditions[0].kind; delete legacy.expeditions[0].fromCell;
  assert.equal(deserialize(legacy).expeditions[0].kind,'fleet');
  p.nationId=1; const defenders = p.troops;
  s.time=s.expeditions[0].arriveTime; p.musterAt=100; update(s,.01);
  assert.equal(s.player.wars.length,0); assert.equal(p.fronts.size,0); close(p.troops,defenders);
  close(source.troops,100); assert.ok(order.sent>0);
});

test('a neighbouring province under the same flag is safe; a tribal or rival parcel under the same icon is not', () => {
  const { s, p, enemy } = scene(), { gridW, provinceAt } = s.world;
  for (const q of s.provinces) q.nationId = 0;
  const cell = p.cells.find(i => [1, -1, gridW, -gridW].some(d => provinceAt[i+d] === enemy.id));
  assert.ok(Number.isInteger(cell));
  assert.ok(canBuild(s, 0, p, 'city', cell).ok, 'an internal administrative border is not foreign land');
  const before = [s.player.gold, s.landRevision, s.effects.length];
  for (const flag of [null, 1]) {
    enemy.nationId = flag;
    const denied = build(s, 0, p, 'city', cell);
    assert.equal(denied.ok, false); assert.match(denied.reason, /border/);
    assert.deepEqual([s.player.gold, s.landRevision, s.effects.length], before);
  }
});

test('an understrength home garrison cannot build by clicking, and an allied third-party occupant cannot be attacked', () => {
  const { s, p, enemy } = scene();
  const cell = canBuild(s, 0, p, 'city').cell;
  for (const q of s.provinces) if (q.nationId === 0) q.troops = 1;
  const before = [s.player.gold, nationArmy(s, 0), s.landRevision];
  assert.equal(orderTile(s, 0, p, cell, 'city').ok, false);
  assert.equal(s.expeditions.length, 0); assert.equal(p.buildings.city, 0);
  assert.deepEqual([s.player.gold, nationArmy(s, 0), s.landRevision], before);
  p.troops = 40;
  enemy.fronts.set(2, { tiles: new Set([enemy.seatCell]), troops: 5 });
  s.player.allies.push(2);
  assert.match(orderTile(s, 0, enemy, enemy.seatCell, 'city').reason, /ally/);
  s.player.allies = []; s.player.truces[2] = 10;
  assert.match(orderTile(s, 0, enemy, enemy.seatCell).reason, /Truce/);
  assert.equal(p.troops, 40); assert.equal(s.player.wars.length, 0);
  p.troops = 1;
  assert.equal(build(s, 0, p, 'city', cell).ok, true, 'inspector construction remains independent of the field order');
});

test('a restored march needs valid parcels, troops, times and kind; malformed columns never become fleets', () => {
  const { s, p } = scene();
  assert.ok(orderTile(s, 0, p, p.seatCell).march);
  const data = serialize(s), [march] = data.expeditions;
  for (const bad of [{ kind: undefined }, { fromCell: -1 }, { aim: p.cells[0]+s.world.land.length },
    { arriveTime: march.startTime }, { troops: -1 }, { nationId: -1 }, { kind: 'other' }]) {
    data.expeditions.push({ ...march, ...bad });
  }
  assert.deepEqual(deserialize(data).expeditions, [march]);
});
