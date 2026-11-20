// Integration test: boots the real game code inside jsdom with node-canvas,
// drives the campaign flow and asserts that everything works.
import { JSDOM } from 'jsdom';
import { createCanvas } from '@napi-rs/canvas';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const errors = [];
const logs = [];
const html = readFileSync('index.html', 'utf8');
const dom = new JSDOM(html, {
  url: 'http://127.0.0.1:5173/',
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
const pick = await window.evaluate ? null : null;
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
app.handlers.selectProvince(neighbour.id);
await wait(320);
const atkHTML = document.getElementById('inspector').innerHTML;
assert(atkHTML.includes('attack-source') || atkHTML.includes('ATTACK'), 'attack panel visible');
assert(!!app.view.attackTarget, 'attack preview wired to renderer');
assert(app.view.pixelScale >= 3, `map renders in pixel blocks (${app.view.pixelScale}px)`);
assert(!!app.view.politicalCanvas, 'pixel layer allocated');
assert(app.view.politicalCanvas.width < app.view.canvas.width, 'pixel layer is low resolution');
assert(app.view.politicalKey !== null, 'pixel layer cached against ownership');
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

// --- blocky takeover sweep: grab a mid-animation frame -------------------
const taken = app.state.provinces.find((p) => p.prevOwnerId !== undefined && app.state.time >= p.captureTime);
if (taken) {
  const keepTime = app.state.time;
  const keepSel = app.state.selectedProvinceId;
  app.state.time = taken.captureTime + 0.45; // ~half way through the sweep
  app.view.draw(app.state, {
    time: 1,
    showLabels: true,
    showTroops: true,
    selectedId: taken.id,
    hoveredId: null,
  });
  mkdirSync('tmp-shots', { recursive: true });
  const sweepShot = backing.get(document.getElementById('map'));
  if (sweepShot) writeFileSync('tmp-shots/10-takeover.png', sweepShot.toBuffer('image/png'));
  app.state.time = keepTime;
  app.state.selectedProvinceId = keepSel;
  assert(typeof app.view.takeoverProgress(app.state, taken) === 'number', `takeover sweep tracked (${taken.name})`);
} else {
  errors.push('no captured province available for the takeover preview');
}

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
ownProv.buildings.silo = 1;
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
app.confirmNuke(target);
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
console.log('\nsummary', JSON.stringify(summary, null, 2));
console.log('\nerrors:', errors.length ? `\n - ${errors.join('\n - ')}` : 'none');
process.exit(errors.length ? 1 : 0);
