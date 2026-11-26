import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { BUILDINGS, build, canBuild, createGame, captureProvince, launchNuke } from '../src/game/state.js';
import { heldCell, heldTiles, nationSeat, tileOwner } from '../src/game/fronts.js';
import { cellCenter } from '../src/game/worldgen.js';
import { serialize, deserialize } from '../src/game/save.js';
import { MapView } from '../src/game/render.js';
import { stamp } from '../src/game/map-art.js';

function field() {
  const s = createGame({ seed: 424242 });
  const p = s.provinces.filter(p => p.coastal).sort((a,b) => b.areaPx - a.areaPx)[0];
  p.nationId = s.playerNationId;
  s.player.gold = 5000;
  return { s, p };
}

function place(s, p, key, cell) {
  const r = build(s, p.nationId, p, key, cell);
  assert.ok(r.ok, r.reason);
  return r.site;
}

function consistent(world, p) {
  assert.equal(new Set(p.sites.map(s => s.cell)).size, p.sites.length, 'one site per parcel');
  for (const site of p.sites) {
    assert.equal(world.provinceAt[site.cell], p.id);
    assert.ok(Number.isInteger(site.level) && site.level > 0);
  }
  for (const key of Object.keys(BUILDINGS)) {
    assert.equal(p.sites.filter(s => s.key === key).reduce((sum,s) => sum + s.level, 0), p.buildings[key]);
  }
}

test('construction spends once at the aimed parcel; invalid placements cannot move buildings or spend gold', () => {
  const { s, p } = field();
  const [a,b,c] = p.cells;
  const gold = s.player.gold;
  const city = place(s, p, 'city', a);
  assert.deepEqual(city, { key: 'city', cell: a, level: 1 });
  assert.equal(s.player.gold, gold - BUILDINGS.city.cost);
  assert.deepEqual([s.effects.at(-1).x, s.effects.at(-1).y], cellCenter(s.world, a));
  p.fronts.set(1, { tiles: new Set([c]), troops: 1 });
  const before = [s.player.gold, s.landRevision, s.effects.length, s.log.length];
  const foreign = s.provinces.find(q => q.nationId !== s.player.id);
  for (const [target, cell] of [[p, a], [p, c], [p, -1], [p, foreign.cells[0]], [p, 1.5], [foreign, foreign.seatCell]]) {
    assert.equal(build(s, s.player.id, target, 'factory', cell).ok, false);
  }
  assert.deepEqual([s.player.gold, s.landRevision, s.effects.length, s.log.length], before);
  assert.equal(place(s, p, 'city', a), city);
  assert.equal(city.level, 2);
  assert.equal(place(s, p, 'city', b).cell, b);
  assert.equal(p.sites.length, 2);
  assert.equal(build(s, p.nationId, p, 'city', b).ok, false, 'cap is per province, not per tile');
  consistent(s.world, p);
});

test('un-aimed orders choose held sites, upgrade in place and find shoreline space for a port', () => {
  const { s, p } = field();
  const { gridW: w, land } = s.world;
  const port = place(s, p, 'port');
  assert.ok([-1,1,-w,w].some(d => !land[port.cell+d]));
  const city = place(s, p, 'city');
  assert.equal(place(s, p, 'city'), city);
  p.fronts.set(1, { tiles: new Set([city.cell]), troops: 1 });
  const next = place(s, p, 'city');
  assert.notEqual(next.cell, city.cell);
  assert.equal(tileOwner(p, next.cell), p.nationId);
  // The only home parcel now already holds a port. No un-aimed order may
  // bulldoze it, put a building in the rival camp, or charge for a failed build.
  p.fronts.get(1).tiles = new Set(p.cells.filter(i => i !== port.cell));
  assert.equal(canBuild(s, p.nationId, p, 'factory').ok, false);
  const gold = s.player.gold;
  assert.equal(build(s, p.nationId, p, 'factory').ok, false);
  assert.equal(s.player.gold, gold);
  consistent(s.world, p);
});

test('exact sites survive reload, casualties and capture; a lost level removes only its own art', () => {
  const { s, p } = field();
  for (const key of Object.keys(BUILDINGS)) place(s, p, key);
  const city = place(s, p, 'city');
  p.fronts.set(1, { tiles: new Set([city.cell]), troops: 4 });
  const saved = serialize(s);
  const loaded = deserialize(JSON.parse(JSON.stringify(saved)));
  const q = loaded.provinces[p.id];
  assert.deepEqual(q.sites, p.sites, 'even occupied sites keep their original anchors');
  assert.equal(tileOwner(q, city.cell), 1);
  loaded.nations[2].nukes = 2;
  loaded.rng = () => 0;
  assert.equal(launchNuke(loaded, 2, q).intercepted, true);
  assert.deepEqual(q.sites, p.sites, 'an interception does not remove sites');
  loaded.rng = () => .99;
  assert.ok(launchNuke(loaded, 2, q).ok);
  assert.deepEqual(q.sites.find(s => s.key === 'city'), { ...city, level: 1 });
  assert.ok(!q.sites.some(s => s.key === 'fort' || s.key === 'factory'));
  const survivors = q.sites.filter(s => s.key !== 'silo');
  captureProvince(loaded, q, 2);
  assert.deepEqual(q.sites, survivors, 'the silo is scuttled, all other anchors survive');
  consistent(loaded.world, q);
  assert.equal(saved.provinces[p.id].sites.find(s => s.key === 'city').level, 2);
});

test('old count-only saves get stable anchors; bad site data cannot duplicate a building or move one abroad', () => {
  const { s, p } = field();
  for (const key of Object.keys(BUILDINGS)) place(s, p, key);
  place(s, p, 'city');
  const data = serialize(s), saved = data.provinces[p.id];
  delete saved.sites;
  for (const version of [1, 2]) {
    data.version = version;
    const old = deserialize(data).provinces[p.id];
    assert.deepEqual(old.buildings, p.buildings);
    assert.deepEqual(old.sites, deserialize(data).provinces[p.id].sites);
    consistent(s.world, old);
  }
  data.version = 3;
  saved.sites = [null, { key: 'unknown', cell: p.cells[0], level: 1 },
    { key: 'city', cell: p.cells[1], level: 1 }, { key: 'fort', cell: p.cells[1], level: 1 },
    { key: 'silo', cell: -1, level: 1 }, { key: 'aa', cell: p.cells[2], level: 99 }];
  const repaired = deserialize(data).provinces[p.id];
  consistent(s.world, repaired);
  assert.deepEqual(repaired.buildings, p.buildings);
  assert.equal(repaired.sites.find(s => s.key === 'city').cell, p.cells[1]);
});

test('home and foothold navigation use held parcels, including after the capital falls', () => {
  const { s } = field();
  const { player, world } = s, home = s.provinces[player.capitalId];
  assert.equal(nationSeat(world, player), home);
  home.fronts.set(1, { tiles: new Set([home.seatCell]), troops: 1 });
  const held = heldCell(home, player.id);
  assert.equal(tileOwner(home, held), player.id);
  assert.notEqual(held, home.seatCell);
  home.nationId = 1; home.fronts.clear();
  home.fronts.set(player.id, { tiles: new Set([held]), troops: 3 });
  const fallback = nationSeat(world, player);
  assert.equal(fallback.nationId, player.id);
  assert.equal(heldTiles(fallback, player.id), Math.max(...s.provinces.filter(p => p.nationId === player.id).map(p => heldTiles(p, player.id))));
  assert.equal(heldCell(home, player.id), held, 'can still find the foothold in the lost province');
  const view = new MapView(createCanvas(800, 400), { surface: createCanvas });
  view.setWorld(world); view.locate(home, held);
  assert.deepEqual(view.worldToScreen(...cellCenter(world, held)), [400, 200]);
  player.alive = false;
  assert.equal(nationSeat(world, player), null);
});

test('all six purchased symbols are painted at their sites even with labels on, at different zoom and DPI', () => {
  const { s, p } = field();
  for (const key of Object.keys(BUILDINGS)) place(s, p, key);
  s.effects = []; // no construction flash to mistake for a persistent building
  const canvas = createCanvas(800, 500), view = new MapView(canvas, { surface: createCanvas });
  view.setWorld(s.world);
  const signatures = new Set();
  for (const { key, cell } of p.sites) {
    const sprite = createCanvas(11, 11), ctx = sprite.getContext('2d');
    stamp(ctx, key, 0, 0);
    const expected = ctx.getImageData(0, 0, 11, 11).data;
    signatures.add(Buffer.from(expected).toString('base64'));
    const [wx, wy] = cellCenter(s.world, cell), u = s.world.pixel/2;
    for (const [zoom, dpr] of [[1.2, 1], [2.75, 2]]) {
      view.resize(800, 500, dpr);
      view.focusProvince(p, zoom, cell);
      view.draw(s, { showTroops: true, showLabels: true, selectedId: p.id });
      const screen = view.ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0;
      for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) {
        const j = (y*11 + x)*4;
        if (!expected[j+3]) continue;
        const px = wx + (x-5+.5)*u, py = wy + (y-5+.5)*u;
        assert.equal(view.atlas.siteAtPoint(p, px, py)?.cell, cell);
        const [sx, sy] = view.worldToScreen(px, py);
        const i = (Math.floor(sy*dpr)*canvas.width + Math.floor(sx*dpr))*4;
        assert.deepEqual(screen.slice(i,i+4), expected.slice(j,j+4), `${key} at ${zoom}x, pixel ${x},${y}`);
        ink++;
      }
      assert.ok(ink > 25, `${key} must be a visible sprite`);
    }
  }
  assert.equal(signatures.size, 6);
});
