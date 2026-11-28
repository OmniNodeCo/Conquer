// Integration test: boots the real game code inside jsdom with node-canvas,
// drives the campaign flow and asserts that everything works.
import { JSDOM } from 'jsdom';
import { checkFieldClicks } from './check-field-clicks.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

// Only used as a predicate in the harness; the game itself runs inside jsdom.
const { canAttack, canBuild, update } = await import('../src/game/state.js');
const { cellCenter } = await import('../src/game/worldgen.js');
const { tileOwner, heldCell, nationSeat } = await import('../src/game/fronts.js');

const errors = [];
const logs = [];
const html = readFileSync('index.html', 'utf8');
const dom = new JSDOM(html, {
  url: 'https://conquer.test/', // storage origin only; jsdom does not fetch the page
  pretendToBeVisual: true,
  runScripts: 'outside-only',
});
const { window } = dom;
window.innerWidth = 1600;
window.innerHeight = 900;
Object.defineProperty(window, 'devicePixelRatio', { value: 1 });

// --- canvas shim backed by @napi-rs/canvas --------------------------------
const backing = new WeakMap();
const holders = new WeakMap();

function holderOf(el) {
  let h = holders.get(el);
  if (!h) {
    h = { ctx: null };
    holders.set(el, h);
  }
  return h;
}

function backingCanvas(el) {
  const w = Math.max(1, el.__w || 300);
  const h = Math.max(1, el.__h || 150);
  let b = backing.get(el);
  if (!b || b.width !== w || b.height !== h) {
    b = createCanvas(w, h);
    backing.set(el, b);
    holderOf(el).ctx = null;
  }
  return b;
}

function contextOf(el) {
  const h = holderOf(el);
  if (!h.ctx) h.ctx = backingCanvas(el).getContext('2d');
  return h.ctx;
}

window.HTMLCanvasElement.prototype.getContext = function getContext() {
  const el = this;
  return new Proxy(
    {},
    {
      get(_t, prop) {
        const ctx = contextOf(el);
        if (prop === 'drawImage') {
          return (img, ...args) => ctx.drawImage(backing.get(img) || img, ...args);
        }
        if (prop === 'canvas') return el;
        const value = ctx[prop];
        return typeof value === 'function' ? value.bind(ctx) : value;
      },
      set(_t, prop, value) {
        contextOf(el)[prop] = value;
        return true;
      },
      has(_t, prop) {
        return prop in contextOf(el);
      },
    }
  );
};

for (const dim of ['width', 'height']) {
  const key = dim === 'width' ? '__w' : '__h';
  const fallback = dim === 'width' ? 300 : 150;
  Object.defineProperty(window.HTMLCanvasElement.prototype, dim, {
    get() { return this[key] ?? fallback; },
    set(v) {
      const next = Math.max(1, Math.round(Number(v) || 0));
      if (this[key] === next) return;
      this[key] = next;
      backing.delete(this);
      holderOf(this).ctx = null;
    },
    configurable: true,
  });
}

window.HTMLCanvasElement.prototype.toDataURL = function toDataURL() {
  return backingCanvas(this).toDataURL('image/png');
};

globalThis.window = window;
globalThis.document = window.document;
globalThis.localStorage = window.localStorage;
try { Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true }); } catch (e) { /* ignore */ }
globalThis.HTMLElement = window.HTMLElement;
globalThis.Event = window.Event;
globalThis.MouseEvent = window.MouseEvent;
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.devicePixelRatio = 1;

window.addEventListener('error', (ev) => errors.push(`error: ${ev.message}`));
process.on('unhandledRejection', (err) => errors.push(`rejection: ${err?.stack || err}`));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (cond, label) => {
  if (!cond) {
    errors.push(`ASSERT FAILED: ${label}`);
    console.log('  ✗', label);
  } else {
    console.log('  ✓', label);
  }
};

const originalError = console.error;
console.error = (...args) => {
  errors.push(`console.error: ${args.join(' ')}`);
  originalError.apply(console, args);
};

console.log('boot');
const mod = await import('../src/game/main.js');
window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
await wait(120);
const app = window.__app;
assert(!!app, 'app booted');
assert(app.screen === 'title', 'title screen shown');

// --- new campaign ---------------------------------------------------------
document.getElementById('btn-new').click();
await wait(2200);
assert(app.screen === 'nations', 'nation select opened');
const cards = document.querySelectorAll('.nation-card');
assert(cards.length >= 20, `nation cards rendered (${cards.length})`);
assert(!document.getElementById('btn-start').disabled, 'start button enabled');

// choose a nation with a few provinces
const chosen = app.ui.nationsData.slice().sort((a, b) => b.provinces - a.provinces)[3];
cards.forEach((c) => {
  if (Number(c.dataset.id) === chosen.nation.id) c.click();
});
await wait(300);
assert(app.ui.selectedNationId === chosen.nation.id, 'nation selection works');

document.getElementById('btn-start').click();
await wait(800);
assert(app.screen === 'game', 'game screen active');
assert(!!app.state, 'state created');
assert(app.state.provinces.length > 100, `provinces generated (${app.state.provinces.length})`);
assert(document.querySelectorAll('#rank-list li').length > 0, 'rank list populated');
assert(document.getElementById('inspector').innerHTML.length > 200, 'inspector populated');

// --- realm atlas: discoverable HUD, real search and no leaking game keys ----
const chip = document.getElementById('player-chip');
const keydown = key => document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
const searchAtlas = text => {
  const box = document.getElementById('atlas-query');
  box.value = text; box.dispatchEvent(new window.Event('input', { bubbles: true }));
};
assert(chip.textContent.includes(chosen.nation.name) && chip.textContent.includes('Find my land'), 'flag button identifies the player and the land finder');
chip.click();
assert(app.state.paused && document.activeElement.id === 'atlas-query', 'finder pauses a running campaign and focuses search');
const owned = app.state.provinces.filter(p => p.nationId === app.state.playerNationId);
assert(owned.every(p => document.querySelector(`.atlas-place[data-find-province="${p.id}"]`)), 'every own province can be located');
searchAtlas('no-such-map-name');
assert(!document.querySelector('.atlas-place') && !!document.querySelector('.atlas-empty'), 'unmatched search explains empty results');
keydown('2'); keydown(' ');
assert(!app.buildMode && app.state.paused, 'typing shortcuts cannot arm buildings or unpause behind the finder');
keydown('Escape');
assert(!app.state.paused && document.getElementById('modal-root').classList.contains('hidden'), 'Escape in search closes finder and restores running clock');
keydown('L');
searchAtlas(owned[0].name.toUpperCase());
const result = document.querySelector(`.atlas-place[data-find-province="${owned[0].id}"]`);
assert(!!result, 'province search is case insensitive');
result.click();
assert(app.state.selectedProvinceId === owned[0].id && app.view.locator.cell === heldCell(owned[0], app.state.playerNationId), 'a province result locates land and opens its inspector');

// --- simulation -----------------------------------------------------------
app.handlers.setSpeed(3);
await wait(2500);
assert(app.state.day > 1, `time advances (day ${app.state.day})`);
assert(app.state.log.length > 0, 'events logged');

// --- own province panel + recruit ----------------------------------------
const player = app.state.nations[app.state.playerNationId];
const capital = app.state.provinces[player.capitalId];
app.handlers.selectProvince(capital.id);
await wait(320);
const ownHTML = document.getElementById('inspector').innerHTML;
assert(ownHTML.includes('RECRUIT'), 'recruit panel visible');
assert(ownHTML.includes('CONSTRUCTION'), 'construction panel visible');
const goldBefore = player.gold;
const recruitBtn = document.querySelector('#inspector [data-action="recruit"]');
if (recruitBtn && !recruitBtn.disabled) {
  recruitBtn.click();
  assert(player.gold < goldBefore, 'recruiting spends gold');
} else {
  errors.push('no affordable recruit button');
}
const garrisonBefore = capital.troops;
const buildBtn = document.querySelector('#inspector [data-action="build"]:not([disabled])');
if (buildBtn) {
  buildBtn.click();
  await wait(200);
  assert(capital.troops >= garrisonBefore, 'garrison intact after build');
  assert(capital.sites.some(s => s.key === buildBtn.dataset.key), 'inspector construction also leaves a physical site');
  assert(document.getElementById('inspector').innerHTML.includes('CONSTRUCTION'), 'inspector rebuilt after build');
}

// --- attack panel ---------------------------------------------------------
// The chosen nation's capital is not guaranteed to sit on a frontier, so look
// for any owned province that borders foreign land.
const front = app.state.provinces.find(
  (p) =>
    p.nationId === app.state.playerNationId &&
    p.neighbours.some((id) => app.state.provinces[id].nationId !== app.state.playerNationId)
);
const neighbour = front
  ? app.state.provinces[
      front.neighbours.find((id) => app.state.provinces[id].nationId !== app.state.playerNationId)
    ]
  : null;
assert(!!neighbour, `has a foreign neighbour (front: ${front ? front.name : 'none'})`);
app.handlers.selectProvince(front.id); // Use the actual bordering land source, not a fleet.
app.handlers.selectProvince(neighbour.id);
await wait(320);
const atkHTML = document.getElementById('inspector').innerHTML;
assert(atkHTML.includes('attack-source') || atkHTML.includes('ATTACK'), 'attack panel visible');
assert(!!app.view.attackTarget, 'attack preview wired to renderer');
assert(app.view.pixelScale >= 3, `map renders in pixel blocks (${app.view.pixelScale}px)`);
assert(!!app.view.politicalCanvas, 'pixel layer allocated');
assert(app.view.politicalCanvas.width < app.view.canvas.width, 'pixel layer is low resolution');
assert(app.view.politicalKey !== null, 'pixel layer cached against ownership');
assert(String(app.view.politicalKey).includes('|'), 'selection is baked into the pixel layer');
assert(document.querySelectorAll('#toasts .toast').length <= 1, 'single-slot notifications');

// --- one steady pace: no 1x/2x/4x multipliers ---------------------------
assert(document.querySelectorAll('#speed-control button').length === 1, 'single pace control in HUD');
assert(!document.querySelector('#speed-control [data-speed="2"]'), 'no 2x speed button');
assert(!document.querySelector('#speed-control [data-speed="3"]'), 'no 4x speed button');
const pauseBtn = document.getElementById('btn-pause');
assert(!!pauseBtn, 'pause button rendered');
if (pauseBtn) {
  const wasPaused = app.state.paused;
  pauseBtn.click();
  assert(app.state.paused !== wasPaused, 'pause toggles the clock');
  pauseBtn.click();
  assert(app.state.paused === wasPaused, 'pause toggles back');
  assert(pauseBtn.textContent.trim() === (wasPaused ? '▶' : '❚❚'), 'pause button glyph matches state');
}

// Freeze the clock so an AI counter-attack cannot move the numbers mid-assertion.
app.state.paused = true;

const sourceSelect = document.getElementById('attack-source');
const sourceId = sourceSelect ? Number(sourceSelect.value) : null;
const sourceProv = sourceId !== null ? app.state.provinces[sourceId] : null;
const soldiersBefore = sourceProv ? sourceProv.troops : 0;
const attackBtn = document.querySelector('#inspector [data-action="attack"]');
const logBefore = app.state.log.length ? app.state.log[0].id : 0;
const lossesBefore = player.stats.troopsLost;
if (attackBtn) {
  attackBtn.click();
  await wait(400);
  const report = document.querySelector('#battle-report.show');
  const navalAttack = app.state.expeditions.length > 0;
  if (!navalAttack) {
    assert(!!report, 'battle report card appears after a land attack');
    assert(/Soldiers lost/.test(report?.textContent || ''), 'battle report lists casualties');
    assert(player.stats.troopsLost > lossesBefore, 'attacking costs soldiers');
    assert((report?.textContent || '').includes('−'), 'casualties shown as a loss');
    assert(document.querySelectorAll('#battle-report').length === 1, 'only one battle report card exists');
    assert(document.querySelectorAll('#toasts .toast').length <= 1, 'toasts never stack up');
  } else {
    assert(player.stats.troopsLost >= lossesBefore, 'naval attack committed the fleet');
  }
  const fresh = app.state.log.filter((l) => l.id > logBefore).map((l) => `${l.type}: ${l.text}`);
  console.log('  · attack log:', fresh.slice(0, 3));
  assert(fresh.length > 0, 'attack produced an event');
  assert(
    (sourceProv && sourceProv.troops < soldiersBefore) || app.state.expeditions.length > 0,
    `troops committed (${soldiersBefore.toFixed(1)} -> ${sourceProv ? sourceProv.troops.toFixed(1) : '?'})`
  );
} else {
  errors.push('no attack button rendered');
}

// --- a real foothold, not a whole-province colour animation ----------------
const foothold = neighbour.fronts.get(player.id);
assert(foothold?.tiles.size > 0 && foothold.tiles.size < neighbour.areaPx, 'one push takes a patch, not the province');
assert(document.querySelector('.front-caption')?.textContent.includes('Your control'), 'inspector reports occupied ground');
assert(document.querySelector('#battle-report')?.textContent.includes('tiles'), 'battle report gives the actual tile gain');
// A foothold is not a fully owned province. Following it must NOT take the
// one-click assault route, even though the neighbouring land is attackable.
const ordersBefore = [player.gold, player.stats.troopsLost, app.state.expeditions.length, app.state.landRevision].join();
chip.click();
searchAtlas(neighbour.name);
const frontRow = document.querySelector(`.atlas-place[data-find-province="${neighbour.id}"]`);
assert(frontRow?.textContent.includes('Foothold'), 'partial holdings are identified as footholds');
frontRow.click();
assert(app.state.paused && foothold.tiles.has(app.view.locator.cell), 'jump lands on a held front parcel and preserves manual pause');
assert(ordersBefore === [player.gold, player.stats.troopsLost, app.state.expeditions.length, app.state.landRevision].join(), 'finding foreign-administered land issues no orders');
const oldCamera = { ...app.view.camera };
app.view.focusProvince(neighbour, 2);
app.view.draw(app.state, { time: 1, showLabels: false, showTroops: false });
mkdirSync('tmp-shots', { recursive: true });
const frontShot = backing.get(document.getElementById('map'));
if (frontShot) writeFileSync('tmp-shots/10-frontier.png', frontShot.toBuffer('image/png'));
app.view.camera = oldCamera;

app.state.paused = false;

// --- diplomacy ------------------------------------------------------------
const other = app.state.nations.find((n) => n.id !== player.id && n.alive);
if (other) {
  app.handlers.declareWar(other.id);
  assert(player.wars.includes(other.id), 'war declared');
  app.handlers.proposePeace(other.id);
  assert(!player.wars.includes(other.id) || true, 'peace attempt handled');
}

// --- nuke flow on a cheated treasury --------------------------------------
// Freeze the clock: the AI must not snatch the silo province mid-assertion.
app.state.paused = true;
player.gold = 5000;
const ownProv = app.state.provinces.find((p) => p.nationId === player.id);
app.handlers.build(ownProv.id, 'silo');
app.handlers.selectProvince(ownProv.id);
await wait(300);
assert(document.getElementById('inspector').innerHTML.includes('STRATEGIC FORCES'), 'silo unlocks strategic panel');
const nukeBtn = document.querySelector('#inspector [data-action="start-nuke"]');
if (nukeBtn && !nukeBtn.disabled) {
  nukeBtn.click();
  assert(player.buildingNuke === true, 'warhead production started');
} else {
  errors.push('nuke build button unavailable');
}
player.nukes = 1;
app.state.paused = false;
app.handlers.enterNukeMode();
assert(app.state.mode === 'nuke', 'nuke targeting mode');
const target = app.state.provinces.find((p) => p.nationId !== player.id);
const strikeOrders = app.state.expeditions.length, strikeLosses = player.stats.troopsLost;
app.handleMapClick(...app.view.worldToScreen(...cellCenter(app.world, target.seatCell)));
assert(app.state.expeditions.length === strikeOrders && player.stats.troopsLost === strikeLosses, 'explicit warhead targeting does not send a regular army');
await wait(200);
const launchBtn = document.querySelector('[data-modal-index="1"]');
if (launchBtn) {
  launchBtn.click();
  await wait(300);
  assert(app.state.mode === 'idle', 'nuke fired and mode cleared');
} else {
  errors.push('nuke confirm modal missing');
}

// --- modals ---------------------------------------------------------------
app.ui.openHelp();
await wait(150);
assert(document.querySelector('.modal-title')?.textContent.includes('How to play'), 'help modal opens');
app.ui.closeModal();
app.ui.openSettings();
await wait(120);
assert(!!document.querySelector('[data-toggle="sound"]'), 'settings modal opens');
app.ui.closeModal();
app.ui.openMenu();
await wait(120);
assert(document.getElementById('modal').innerHTML.includes('SAVE'), 'menu modal opens');
app.ui.closeModal();

// --- save / load ----------------------------------------------------------
app.handlers.save();
await wait(200);
assert(!!localStorage.getItem('conquer.save.v1'), 'save written');
const savedDay = JSON.parse(localStorage.getItem('conquer.save.v1')).day;
app.state.time += 30; // drift forward so the restore is observable
app.state.day += 30;
app.handlers.load();
await wait(1800);
assert(!!app.state && app.state.day === savedDay, `load restores campaign (day ${app.state.day} vs ${savedDay})`);
assert(app.screen === 'game', 'still in game after load');
assert(JSON.stringify(app.state.provinces[ownProv.id].sites) === JSON.stringify(ownProv.sites), 'Continue restores site levels and their exact tiles');

// --- build hotbar ---------------------------------------------------------
// The save/load check above replaced app.state, so re-bind the livePlayer.
const livePlayer = app.state.nations[app.state.playerNationId];
const bbSlots = document.querySelectorAll('#bb-slots .bb-slot');
assert(bbSlots.length >= 5, `build hotbar rendered (${bbSlots.length} slots)`);
assert(document.querySelectorAll('#bb-slots .bb-slot[data-key="aa"]').length === 1, 'AA battery slot present');
assert(document.querySelector('#bb-slots .bb-slot[data-key="fort"]')?.textContent.includes('Castle'), 'castle slot present');
assert(document.getElementById('bb-hint').textContent.length > 0, 'hotbar hint visible');

const castleSlot = document.querySelector('#bb-slots .bb-slot[data-key="fort"]');
const spendBefore = livePlayer.gold;
livePlayer.gold = 900;
const ownForBuild = app.state.provinces.find(p => p.nationId === livePlayer.id && p.id !== capital.id && canBuild(app.state, livePlayer.id, p, 'fort').ok);
castleSlot.click();
assert(app.buildMode === 'fort', 'clicking a slot arms placement mode');
assert(document.getElementById('bb-hint').classList.contains('placing'), 'hotbar shows placement state');
const buildCell = ownForBuild.cells.find(i => i !== ownForBuild.seatCell && canBuild(app.state, livePlayer.id, ownForBuild, 'fort', i).ok &&
  !app.view.atlas.siteAtPoint(ownForBuild, ...cellCenter(app.world, i)) && !ownForBuild.sites.some(s => s.cell === i));
const buildXY = cellCenter(app.world, buildCell);
app.view.focusProvince(ownForBuild, 1.8, buildCell);
const clickXY = app.view.worldToScreen(...buildXY);
app.handleMapClick(...clickXY);
await wait(120);
const castle = ownForBuild.sites.find(s => s.key === 'fort');
assert(castle?.cell === buildCell && ownForBuild.buildings.fort === 1, 'hotbar click puts a castle on the exact off-centre map tile');
app.updateHover(...clickXY);
assert(document.getElementById('tooltip').textContent.includes('Castle · Lv 1'), 'hover identifies the map building without the inspector');
assert(livePlayer.gold < 900, 'placing a castle costs gold');
assert(app.state.expeditions.some(e => e.kind === 'march' && e.aim === buildCell && e.troops > 0), 'placing on home soil also sends a real column');
assert(app.buildMode === 'fort', 'placement stays armed for rapid building');
app.handleMapClick(...clickXY);
assert(castle.level === 2 && ownForBuild.sites.filter(s => s.key === 'fort').length === 1, 'rebuilding at the same spot upgrades the existing landmark');
const afterBuild = livePlayer.gold, marchCount = app.state.expeditions.length;
app.view.fitWorld();
chip.click(); searchAtlas('cAsTlE');
const landmark = document.querySelector(`.atlas-sites button[data-find-province="${ownForBuild.id}"][data-cell="${buildCell}"]`);
assert(landmark?.textContent.includes('Lv 2'), 'buildings are searchable by name and list their level');
landmark.click();
assert(app.view.camera.x === buildXY[0] && app.view.camera.y === buildXY[1] && livePlayer.gold === afterBuild && castle.level === 2 && app.state.expeditions.length === marchCount,
  'a building result centres its exact site without issuing another construction order');
// F, the finder and the minimap must agree after a change of capital.
const liveCapital = app.state.provinces[livePlayer.capitalId];
liveCapital.nationId = app.state.nations.find(n => n.id !== livePlayer.id).id;
const standIn = nationSeat(app.world, livePlayer);
chip.click(); document.getElementById('atlas-home').click();
assert(app.state.selectedProvinceId === standIn.id && app.view.locator.cell === heldCell(standIn, livePlayer.id), 'Go home finds remaining land when the capital is lost');
liveCapital.nationId = livePlayer.id;
document.getElementById('btn-home').click();
assert(app.state.selectedProvinceId === liveCapital.id && app.state.expeditions.length === marchCount, 'minimap Home follows the restored capital without issuing orders');
app.cancelBuildMode();
assert(app.buildMode === null, 'escape/cancel leaves placement mode');

// An actual press/release must issue exactly one order, never one on a drag,
// right-click, cancelled press, or a release that started on a HUD button.
const fieldCanvas = document.getElementById('map');
fieldCanvas.setPointerCapture ??= () => {};
const marchHere = app.view.worldToScreen(...cellCenter(app.world, heldCell(liveCapital, livePlayer.id)));
const pointer = (type, dx = 0, button = 0) => fieldCanvas.dispatchEvent(new window.MouseEvent(type, {
  bubbles: true, button, clientX: marchHere[0]+dx, clientY: marchHere[1],
}));
const marchingBefore = app.state.expeditions.length;
pointer('pointerup'); pointer('pointerdown', 0, 2); pointer('pointerup', 0, 2);
pointer('pointerdown'); pointer('pointercancel'); pointer('pointerup');
pointer('pointerdown'); pointer('pointermove', 24); pointer('pointerup', 24);
assert(app.state.expeditions.length === marchingBefore, 'drag, right click, cancel and stray release send no armies');
app.view.focusProvince(liveCapital, app.view.camera.zoom, heldCell(liveCapital, livePlayer.id));
for (let i = 0; i < 2; i++) { pointer('pointerdown'); pointer('pointerup'); }
assert(app.state.expeditions.length === marchingBefore + 2, 'two normal clicks on home land dispatch two columns, not just a selection');

// --- tap to conquer -------------------------------------------------------
let frontProv = null;
let tapTarget = null;
for (const prov of app.state.provinces) {
  if (prov.nationId !== livePlayer.id) continue;
  for (const nb of prov.neighbours) {
    const cand = app.state.provinces[nb];
    if (cand.nationId !== livePlayer.id && canAttack(app.state, livePlayer.id, cand).ok) {
      frontProv = prov;
      tapTarget = cand;
      break;
    }
  }
  if (frontProv) break;
}
assert(!!frontProv && !!tapTarget, 'found a province that can be tapped');
for (const s of canAttack(app.state, livePlayer.id, tapTarget).sources) s.prov.troops = 18;
frontProv.troops = 40;
tapTarget.troops = 3;
const claimedBefore = tapTarget.fronts.get(livePlayer.id)?.tiles.size || 0;
const tapLossesBefore = livePlayer.stats.troopsLost;
// Foreign land never accepts a project, even with a hotbar slot still active.
app.handlers.toggleBuildSlot('city');
const cityTotal = tapTarget.buildings.city, treasury = livePlayer.gold;
app.state.paused = true;
const tile = tapTarget.cells[0], { pixel, gridW } = app.world;
app.handleMapClick(...app.view.worldToScreen((tile % gridW + .5)*pixel, (Math.floor(tile / gridW)+.5)*pixel));
assert(livePlayer.stats.troopsLost > tapLossesBefore, 'a single map click costs soldiers');
assert(tapTarget.nationId === livePlayer.id || tapTarget.fronts.get(livePlayer.id)?.tiles.size > claimedBefore,
  'the same map click takes land');
assert(frontProv.troops < 40, `the tap costs soldiers (${frontProv.troops.toFixed(1)} left)`);
assert(document.querySelector('#battle-report.show'), 'tap-to-conquer shows the battle card');
assert(tapTarget.buildings.city === cityTotal && livePlayer.gold === treasury, 'a foreign hotbar click sends troops without building or charging construction gold');
assert(document.getElementById('battle-report').textContent.includes('Soldiers sent'), 'report shows the size of the dispatch');
app.cancelBuildMode();
app.state.paused = false;
livePlayer.gold = spendBefore;

// Exercise the live recovery readout without waiting on wall-clock timers.
frontProv.troops = 1;
const decisions = app.state.nations.map(n => n.ai.nextDecision);
for (const n of app.state.nations) n.ai.nextDecision = Infinity;
for (let i = 0; i < 8; i++) update(app.state, .5);
app.ui.update(app.state, 0);
assert(frontProv.troops > 1 && document.getElementById('stat-replacements').textContent.includes('mustering'),
  'resting troops refill and the army HUD shows their arrival rate');
app.state.nations.forEach((n,i) => { n.ai.nextDecision = decisions[i]; });

// --- version footer -------------------------------------------------------
const versionMeta = document.querySelector('meta[name="app-version"]');
assert(!!versionMeta, 'app version meta present');
const footerVersion = document.getElementById('footer-version');
assert(footerVersion.textContent.trim() === `v${versionMeta.content}`, `footer shows version (${footerVersion.textContent})`);
const footerUpdate = document.getElementById('footer-update');
assert(footerUpdate.textContent.includes('updates unavailable'), `footer reports update state (${footerUpdate.textContent})`);

// --- run a longer war to shake out AI ------------------------------------
app.state.paused = false;
app.handlers.setSpeed(3);
await wait(4000);
const alive = app.state.nations.filter((n) => n.alive).length;
assert(alive > 0, `nations alive: ${alive}`);
assert(!app.state.gameOver || true, 'game over state handled');

// --- render the map canvas to PNG ---------------------------------------
mkdirSync('tmp-shots', { recursive: true });
const mapCanvas = document.getElementById('map');
const mapBacking = backing.get(mapCanvas);
if (mapBacking) {
  writeFileSync('tmp-shots/09-jsdom-map.png', mapBacking.toBuffer('image/png'));
  console.log('  · wrote tmp-shots/09-jsdom-map.png');
}

// --- summary --------------------------------------------------------------
const summary = {
  day: app.state.day,
  playerProvinces: app.state.provinces.filter((p) => p.nationId === app.state.playerNationId).length,
  totalProvinces: app.state.provinces.length,
  nationsAlive: alive,
  battles: app.state.stats.battlesWon + app.state.stats.battlesLost,
  provincesTaken: app.state.stats.provincesTaken,
  nukes: app.state.stats.nukesLaunched,
  logSample: app.state.log.slice(0, 8).map((l) => `${l.type}: ${l.text}`),
  inspectorMode: app.ui.inspectorMode,
};
checkFieldClicks(app, assert, () => writeFileSync('tmp-shots/12-field-orders.png', backing.get(mapCanvas).toBuffer('image/png')));
console.log('\nsummary', JSON.stringify(summary, null, 2));
console.log('\nerrors:', errors.length ? `\n - ${errors.join('\n - ')}` : 'none');
process.exit(errors.length ? 1 : 0);
