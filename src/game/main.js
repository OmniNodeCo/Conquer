// Application shell: boot, campaign flow, input handling and the game loop.

import {
  createGame,
  update,
  recruit,
  build,
  beginAttack,
  declareWar,
  proposePeace,
  proposeAlliance,
  giftGold,
  breakAlliance,
  startNuke,
  launchNuke,
  makePeace,
  orderTile,
  marchSource,
  canAttack,
  canBuild,
  BUILDINGS,
  nationProvinces,
  worldShare,
  pushLog,
} from './state.js';
import { heldCell, nationSeat, tileOwner } from './fronts.js';
import { homePlot, siteAt } from './buildings.js';
import { generateWorld, findProvinceAt, cellAt } from './worldgen.js';
import { MapView } from './render.js';
import { SoundEngine } from './audio.js';
import { UI } from './ui.js';
import { randomSeed } from './rng.js';
import { saveToFile, loadLocal, hasLocalSave, saveLocal, clearLocal, deserialize } from './save.js';

const SETTINGS_KEY = 'conquer.settings.v1';

class App {
  constructor() {
    this.canvas = document.getElementById('map');
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.view = new MapView(this.canvas, { dpr: this.dpr });
    this.audio = new SoundEngine();
    this.state = null;
    this.previewState = null;
    this.screen = 'title';
    this.lastTs = performance.now();
    this.uiTick = 0;
    this.lastLogId = 0;
    this.hoverProvince = null;
    this.dragging = false;
    this.dragMoved = false;
    this.pointer = { x: 0, y: 0, sx: 0, sy: 0, downX: 0, downY: 0 };
    this.pausedByModal = false;
    this.autosaveYear = 2026;
    this.soundTimes = {};
    this.settings = this.loadSettings();

    this.ui = new UI(this.buildHandlers());
    this.ui.settings = { ...this.ui.settings, ...this.settings };
    this.applySettings();

    this.bindInput();
    this.bindWindow();
    this.initFooter();
    this.resize();
    this.view.fitWorld();
    this.showTitle();
    requestAnimationFrame((ts) => this.loop(ts));
  }

  // ------------------------------------------------------- version / updater
  initFooter() {
    this.ui.setVersion(document.querySelector('meta[name="app-version"]')?.content);
    if (!window.desktop?.onUpdateStatus) {
      this.ui.setUpdateStatus({ state: 'unsupported' });
      return;
    }
    this.ui.setUpdateStatus({ state: 'checking' });
    window.desktop.onUpdateStatus((status) => this.ui.setUpdateStatus(status || {}));
    if (window.desktop.info) {
      window.desktop.info().then((info) => {
        if (info?.version) this.ui.setVersion(info.version);
      }).catch(() => {});
    }
    if (window.desktop.checkForUpdates) window.desktop.checkForUpdates();
  }

  // ---------------------------------------------------------------- settings
  loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (err) {
      /* ignore */
    }
    return { sound: true, labels: true, troops: true, autosave: true, volume: 0.55 };
  }

  applySettings() {
    this.ui.settings = { ...this.ui.settings, ...this.settings };
    this.audio.setEnabled(this.settings.sound);
    this.audio.setVolume(this.settings.volume);
  }

  saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch (err) {
      /* ignore */
    }
  }

  // ------------------------------------------------------------------ layout
  bindWindow() {
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('keydown', (ev) => this.onKey(ev));
    document.addEventListener('pointerdown', () => this.audio.resume(), { once: true });
    window.addEventListener('beforeunload', () => {
      if (this.state && this.state.started && this.settings.autosave) saveLocal(this.state);
    });
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.view.resize(w, h, this.dpr);
    const mini = document.getElementById('minimap');
    if (mini) {
      mini.width = Math.round(234 * this.dpr);
      mini.height = Math.round(132 * this.dpr);
      mini.style.width = '234px';
      mini.style.height = '132px';
    }
    this.minimapDirty = true;
    if (this.world) this.minimapDirty = true;
  }

  // ------------------------------------------------------------------- input
  bindInput() {
    const canvas = this.canvas;

    canvas.addEventListener('pointerdown', (ev) => {
      if (this.screen !== 'game' || ev.button !== 0 || ev.isPrimary === false || !this.ui.el.modalRoot.classList.contains('hidden')) return;
      this.pointer.id = ev.pointerId;
      this.audio.resume();
      this.pointer.down = true;
      this.pointer.dragging = false;
      this.pointer.downX = ev.clientX;
      this.pointer.downY = ev.clientY;
      this.pointer.lastX = ev.clientX;
      this.pointer.lastY = ev.clientY;
      canvas.setPointerCapture(ev.pointerId);
    });

    canvas.addEventListener('pointermove', (ev) => {
      if (ev.isPrimary === false || (this.pointer.down && ev.pointerId !== this.pointer.id)) return;
      this.pointer.overMap = true;
      this.pointer.x = ev.clientX;
      this.pointer.y = ev.clientY;
      if (this.pointer.down) {
        const dx = ev.clientX - this.pointer.lastX;
        const dy = ev.clientY - this.pointer.lastY;
        if (Math.abs(ev.clientX - this.pointer.downX) + Math.abs(ev.clientY - this.pointer.downY) > 5) {
          this.pointer.dragging = true;
        }
        if (this.pointer.dragging) {
          this.view.panBy(dx, dy);
          this.minimapDirty = true;
          this.canvas.style.cursor = 'grabbing';
          this.view.plotCursor = null;
          this.ui.hideTooltip();
        }
        this.pointer.lastX = ev.clientX;
        this.pointer.lastY = ev.clientY;
      } else if (this.screen === 'game') {
        this.updateHover(ev.clientX, ev.clientY);
      }
    });

    canvas.addEventListener('pointerup', (ev) => {
      if (!this.pointer.down || ev.pointerId !== this.pointer.id || ev.button !== 0) return;
      const wasDragging = this.pointer.dragging || Math.abs(ev.clientX - this.pointer.downX) + Math.abs(ev.clientY - this.pointer.downY) > 5;
      this.pointer.down = false;
      this.pointer.dragging = false;
      this.canvas.style.cursor = 'crosshair';
      if (this.screen === 'game' && !wasDragging && this.ui.el.modalRoot.classList.contains('hidden')) this.handleMapClick(ev.clientX, ev.clientY);
    });

    const leaveMap = ev => {
      if (ev.isPrimary === false || (this.pointer.down && ev.pointerId !== this.pointer.id)) return;
      this.pointer.overMap = false;
      this.view.plotCursor = null;
      this.pointer.down = false;
      this.pointer.dragging = false;
      this.view.hoveredId = null;
      this.ui.hideTooltip();
    };
    canvas.addEventListener('pointerleave', leaveMap);
    canvas.addEventListener('pointercancel', leaveMap);

    canvas.addEventListener(
      'wheel',
      (ev) => {
        if (this.screen !== 'game' && this.screen !== 'nations') return;
        ev.preventDefault();
        const factor = Math.pow(1.0016, -ev.deltaY);
        this.view.zoomAt(ev.clientX, ev.clientY, factor);
        this.minimapDirty = true;
        if (this.screen === 'game') this.updateHover(ev.clientX, ev.clientY);
      },
      { passive: false }
    );

    canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
    const mini = document.getElementById('minimap');
    mini.addEventListener('click', (ev) => {
      if (!this.world) return;
      const rect = mini.getBoundingClientRect();
      const fx = (ev.clientX - rect.left) / rect.width;
      const fy = (ev.clientY - rect.top) / rect.height;
      this.view.camera.x = fx * this.world.width;
      this.view.camera.y = fy * this.world.height;
      this.view.clampCamera();
      this.minimapDirty = true;
    });
  }

  onKey(ev) {
    // Escape must work in the finder search box. Never pan, arm a slot, or
    // unpause the game while the player is navigating a dialog with the keyboard.
    if (!this.ui.el.modalRoot.classList.contains('hidden')) {
      if (ev.key === 'Escape') { ev.preventDefault(); this.ui.closeModal(); }
      return;
    }
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (ev.key === 'Escape') {
      if (this.state?.mode === 'nuke') {
        this.setNukeMode(false);
        return;
      }
      if (this.cancelBuildMode()) return;
      if (this.state?.selectedProvinceId !== null) {
        this.deselect();
        return;
      }
      if (this.screen === 'game') this.ui.openMenu();
      return;
    }
    if (this.screen === 'nations') {
      if (ev.key === 'Enter') this.handlers.startCampaign();
      return;
    }
    if (this.screen !== 'game' || !this.state) return;

    switch (ev.key) {
      case ' ':
        ev.preventDefault();
        this.handlers.setSpeed(this.state.paused ? 1 : 0);
        break;
      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
      case '6': {
        const key = Object.keys(BUILDINGS)[Number(ev.key) - 1];
        if (key) this.handlers.toggleBuildSlot(key);
        break;
      }
      case 'l':
      case 'L':
        this.ui.openLandFinder();
        break;
      case 'f':
      case 'F':
        this.focusCapital();
        break;
      case 'h':
      case 'H':
        this.ui.openHelp();
        break;
      case '+':
      case '=':
        this.handlers.zoom(1.25);
        break;
      case '-':
      case '_':
        this.handlers.zoom(0.8);
        break;
      case 's':
      case 'S':
        if (ev.ctrlKey || ev.metaKey) {
          ev.preventDefault();
          this.handlers.save();
        }
        break;
      case 'ArrowLeft':
        this.view.panBy(90, 0);
        this.minimapDirty = true;
        break;
      case 'ArrowRight':
        this.view.panBy(-90, 0);
        this.minimapDirty = true;
        break;
      case 'ArrowUp':
        this.view.panBy(0, 90);
        this.minimapDirty = true;
        break;
      case 'ArrowDown':
        this.view.panBy(0, -90);
        this.minimapDirty = true;
        break;
      default:
        break;
    }
  }

  updateHover(sx, sy) {
    if (!this.world) return;
    const [wx, wy] = this.view.screenToWorld(sx, sy);
    const prov = findProvinceAt(this.world, wx, wy);
    const id = prov ? prov.id : null;
    const cell = cellAt(this.world, wx, wy);
    const ownerId = prov ? tileOwner(prov, cell) : null;
    const site = prov && (siteAt(prov, cell) || this.view.atlas.siteAtPoint(prov, wx, wy));
    let hint = '';
    this.view.plotCursor = null;
    if (this.buildMode && this.state?.mode === 'idle') {
      const key = this.buildMode;
      if (!prov) hint = 'Water · no orders here';
      else if (homePlot(this.world, this.state.playerNationId, prov, cell)) {
        const plot = site?.cell ?? cell;
        const check = canBuild(this.state, this.state.playerNationId, prov, key, plot);
        const ready = !!marchSource(this.state, this.state.playerNationId, prov);
        this.view.plotCursor = { cell: plot, key, valid: ready && check.ok };
        hint = !ready ? 'No ready troops for this order · use the inspector to build without marching'
          : check.ok ? `${site ? 'Upgrade' : 'Place'} ${BUILDINGS[key].name} · ${check.cost} gold · send 25%`
            : `No build: ${check.reason} · reinforce only`;
      } else {
        this.view.plotCursor = { cell, key, valid: false };
        const check = canAttack(this.state, this.state.playerNationId, prov, cell);
        hint = `No building here · ${check.ok ? 'click to send an assault' : check.code === 'no-route' ? 'click to stage troops' : check.reason}`;
      }
    }
    const siteKey = `${site ? `${site.key}:${site.cell}:${site.level}` : ''}|${hint}`;
    if (id !== this.view.hoveredId || ownerId !== this.hoveredOwner || siteKey !== this.hoveredSiteKey) {
      this.hoveredOwner = ownerId;
      this.hoveredSiteKey = siteKey;
      this.view.hoveredId = id;
      this.hoverProvince = prov;
      this.canvas.style.cursor = prov ? 'pointer' : 'crosshair';
      if (prov && this.state) {
        const owner = this.state.nations[ownerId];
        const ownerName = owner ? owner.name : prov.tribe || 'Free territory';
        const landmark = site ? `<b>${BUILDINGS[site.key].name} · Lv ${site.level}</b><br/>` : '';
        this.ui.showTooltip(
          `${hint ? `<b>${hint}</b><br/>` : ''}${landmark}<b>${prov.name}</b><br/>${ownerName} · ${prov.terrain}<br/>Garrison ${Math.round((prov.fronts.get(ownerId)?.troops ?? prov.troops) * 1000).toLocaleString()}`,
          sx,
          sy
        );
      } else if (hint) this.ui.showTooltip(hint, sx, sy);
      else this.ui.hideTooltip();
    }
  }

  // ------------------------------------------------- tap-to-conquer helpers
  issueOrder(prov, cell, plot) {
    const state = this.state, key = this.buildMode;
    const res = orderTile(state, state.playerNationId, prov, cell, key, plot);
    this.handlers.selectProvince(prov.id); // inspection accompanies the order; it never makes another one
    if (!res.ok) { this.ui.orderMessage(res.reason); return; }
    const number = Math.round(res.sent * 1000).toLocaleString();
    let note;
    if (res.march) {
      note = res.staging ? `${number} staging at ${res.destination.name} · no route into ${prov.name} yet`
        : `${number} ${res.source === prov ? 'on local patrol' : 'reinforcements sent'} to ${prov.name}`;
      if (res.construction?.ok) {
        note += ` · ${BUILDINGS[key].name} ${res.construction.site.level > 1 ? 'upgraded' : 'placed'}`;
        this.audio.build();
        if (state.player.gold < BUILDINGS[key].cost) this.cancelBuildMode();
      } else if (res.construction) note += ` · No build: ${res.construction.reason}`;
    } else if (res.naval) {
      this.audio.naval();
      note = `${number} sailing to ${prov.name}`;
    } else {
      this.audio.cannon();
      this.ui.battleReport(state, prov, res.result);
      note = `${number} dispatched from ${res.source.name} · ${res.result.gained} tiles taken`;
    }
    this.ui.orderMessage(note);
    this.ui.markDirty();
    this.ui.update(state, 0);
  }

  cancelBuildMode() {
    if (!this.buildMode) return false;
    this.buildMode = null;
    this.ui.setBuildMode(null);
    this.view.plotCursor = null;
    this.ui.update(this.state, 0);
    return true;
  }

  handleMapClick(sx, sy) {
    if (!this.state || this.screen !== 'game' || !this.ui.el.modalRoot.classList.contains('hidden')) return;
    const [wx, wy] = this.view.screenToWorld(sx, sy);
    const prov = findProvinceAt(this.world, wx, wy);
    if (!prov) {
      this.deselect();
      this.ui.orderMessage('Open water · choose a land tile');
      return;
    }
    if (this.state.mode === 'nuke') {
      this.confirmNuke(prov);
      return;
    }
    const cell = cellAt(this.world, wx, wy);
    // An upgrade may hit the roof rather than its central parcel. Never snap
    // across an occupied tile, or change the aim of a normal assault.
    const site = this.buildMode && homePlot(this.world, this.state.playerNationId, prov, cell)
      ? siteAt(prov, cell) || this.view.atlas.siteAtPoint(prov, wx, wy) : null;
    this.handlers.clickProvince(prov.id, cell, site?.cell ?? cell);
  }

  // -------------------------------------------------------------- game flow
  showTitle() {
    this.screen = 'title';
    this.state = null;
    this.previewState = null;
    this.buildMode = null;
    this.ui.setBuildMode(null);
    this.lastOwnProvinceId = null;
    this.ui.showScreen('title');
    this.ui.deselect();
    const seedEl = document.getElementById('title-seed');
    if (seedEl) seedEl.textContent = hasLocalSave() ? 'campaign detected' : randomSeed().toString(16);
    const cont = document.getElementById('btn-continue');
    if (cont) cont.disabled = !hasLocalSave();
    document.getElementById('btn-continue').style.opacity = hasLocalSave() ? '1' : '0.45';
  }

  newCampaign() {
    this.ui.setLoading(true);
    requestAnimationFrame(() => {
      setTimeout(() => {
        const seed = randomSeed();
        const world = generateWorld(seed);
        this.world = world;
        this.view.setWorld(world);
        const preview = {
          world,
          provinces: world.provinces,
          nations: world.nations,
          playerNationId: world.nations[0].id,
          expeditions: [],
          effects: [],
          time: 0,
          log: [],
          mode: 'idle',
          day: 1,
        };
        this.previewState = preview;
        this.state = null;
        this.ui.renderNationSelect(preview, world, world.nations[0].id);
        this.ui.showScreen('nations');
        this.screen = 'nations';
        this.ui.setLoading(false);
        this.previewNation(world.nations[0].id);
        this.audio.click();
      }, 30);
    });
  }

  previewNation(id) {
    if (!this.world) return;
    this.ui.setSelectedNation(id);
    if (this.previewState) this.previewState.playerNationId = id;
    if (this.state) this.state.playerNationId = id;
    const nation = this.world.nations[id];
    const capital = this.world.provinces[nation.capitalId];
    this.view.focusProvince(capital, Math.max(0.85, this.view.camera.zoom));
    this.minimapDirty = true;
    this.audio.select();
  }

  startCampaign() {
    if (!this.world) return;
    const id = this.ui.selectedNationId ?? 0;
    const difficulty = this.selectedDifficulty || 'normal';
    this.state = createGame({ world: this.world, seed: this.world.seed, playerNationId: id, difficulty });
    this.state.started = true;
    this.state.paused = false;
    this.state.speed = 1;
    this.previewState = null;
    this.ui.state = this.state;
    this.screen = 'game';
    this.ui.showScreen('game');
    this.ui.setLoading(false);
    this.lastLogId = this.state.log[0]?.id ?? 0;
    this.view.selected = null;
    this.view.hoveredId = null;
    const capital = this.state.provinces[this.state.nations[id].capitalId];
    this.view.focusProvince(capital, 1.15);
    this.ui.toast(`${this.state.nations[id].fullName} — the world awaits.`, 'win', '◆');
    this.handlers.selectProvince(capital.id);
    this.audio.victory();
    saveLocal(this.state);
  }

  async continueCampaign() {
    let loaded = null;
    if (window.desktop?.loadGame) {
      try {
        const res = await window.desktop.loadGame();
        if (res?.ok) loaded = deserialize(JSON.parse(res.data));
      } catch (err) {
        /* fall back to the browser save */
      }
    }
    if (!loaded) loaded = loadLocal();
    if (!loaded) {
      this.ui.toast('No saved campaign found.', 'loss');
      return;
    }
    this.adoptState(loaded);
    this.ui.toast('Campaign restored.', 'info');
  }

  adoptState(state) {
    if (!this.ui.el.modalRoot.classList.contains('hidden')) this.ui.closeModal();
    this.state = state;
    this.world = state.world;
    this.view.setWorld(state.world);
    this.ui.state = state;
    this.ui.lastFeedId = -1;
    this.ui.lastRankKey = '';
    this.ui.deselect();
    this.screen = 'game';
    this.ui.showScreen('game');
    this.state.started = true;
    this.state.paused = true;
    this.lastLogId = state.log[0]?.id ?? 0;
    this.buildMode = null;
    this.ui.setBuildMode(null);
    this.focusCapital();
    this.ui.update(state, 0);
    this.minimapDirty = true;
  }

  backToTitle() {
    if (this.state && this.state.started) saveLocal(this.state);
    this.showTitle();
  }

  focusCapital() {
    if (!this.state) return;
    const { world, player } = this.state;
    const home = nationSeat(world, player);
    if (home) this.handlers.locateProvince(home.id, heldCell(home, player.id));
  }

  deselect() {
    if (this.state) this.state.selectedProvinceId = null;
    this.view.selected = null;
    this.view.attackTarget = null;
    this.view.attackSource = null;
    this.ui.deselect();
  }

  setNukeMode(on) {
    if (!this.state) return;
    if (on) this.cancelBuildMode();
    this.state.mode = on ? 'nuke' : 'idle';
    if (on) {
      this.ui.toast('Select a target province for the warhead.', 'war', '☢');
    }
  }

  confirmNuke(prov) {
    const state = this.state;
    if (prov.nationId === state.playerNationId) {
      this.ui.toast('That is your own province.', 'loss');
      return;
    }
    const owner = prov.nationId === null ? 'tribal land' : state.nations[prov.nationId].name;
    this.ui.confirm(
      `Launch a nuclear strike on ${prov.name}?`,
      `This will devastate ${owner} and horrify the world. One warhead will be consumed.`,
      () => {
        const res = launchNuke(state, state.playerNationId, prov);
        if (!res.ok) this.ui.toast(res.reason, 'loss');
        else {
          this.audio.nuke();
          this.ui.markDirty();
          this.setNukeMode(false);
          this.ui.update(state, 0);
        }
      },
      'LAUNCH'
    );
  }

  // --------------------------------------------------------------- handlers
  buildHandlers() {
    const self = this;
    this.handlers = {
      clickProvince(id, cell, plot = cell) {
        const prov = self.state?.provinces[id];
        if (prov) self.issueOrder(prov, cell, plot);
      },
      toggleBuildSlot(key) {
        if (!self.state || !BUILDINGS[key]) return;
        if (self.state.mode === 'nuke') self.setNukeMode(false);
        self.buildMode = self.buildMode === key ? null : key;
        self.ui.setBuildMode(self.buildMode);
        self.view.plotCursor = null;
        self.ui.update(self.state, 0);
      },
      installUpdate() {
        if (window.desktop?.installUpdate) window.desktop.installUpdate();
      },
      selectProvince(id) {
        if (!self.state) return;
        const prov = self.state.provinces[id];
        if (prov && prov.nationId === self.state.playerNationId) self.lastOwnProvinceId = id;
        self.state.selectedProvinceId = id;
        self.view.selected = id;
        self.ui.selectedSourceHint = self.lastOwnProvinceId;
        self.ui.selectProvince(id);
        self.ui.update(self.state, 0);
        self.audio.select();
      },
      locateProvince(id, cell = null) {
        if (!self.state) return;
        const prov = self.state.provinces[id];
        if (!prov || (cell !== null && self.world.provinceAt[cell] !== id)) return;
        self.view.locate(prov, cell ?? prov.seatCell);
        self.minimapDirty = true;
        self.ui.hideTooltip();
        self.view.hoveredId = null;
        self.handlers.selectProvince(id); // navigation is never an attack or build order
      },
      goHome() { self.focusCapital(); },
      focusNation(id) {
        if (!self.state) return;
        self.ui.selectNation(id);
        self.ui.update(self.state, 0);
        const home = nationSeat(self.world, self.state.nations[id]);
        if (home) {
          self.view.focusProvince(home, Math.max(0.75, Math.min(1.2, self.view.camera.zoom)), heldCell(home, id));
          self.minimapDirty = true;
        }
      },
      recruit(provId, count) {
        if (!self.state) return;
        const prov = self.state.provinces[provId];
        const res = recruit(self.state, self.state.playerNationId, prov, count);
        if (!res.ok) self.ui.toast(res.reason, 'loss');
        else {
          self.audio.recruit();
          self.ui.markDirty();
        }
      },
      build(provId, key) {
        if (!self.state) return;
        const prov = self.state.provinces[provId];
        const res = build(self.state, self.state.playerNationId, prov, key);
        if (!res.ok) self.ui.toast(res.reason, 'loss');
        else {
          self.audio.build();
          self.ui.markDirty();
        }
      },
      attack(targetId, sourceId, percent = 80) {
        if (!self.state) return;
        const target = self.state.provinces[targetId];
        const source = self.state.provinces[sourceId];
        if (!target || !source) return;
        const naval = !source.neighbours.includes(target.id);
        const troops = source.troops * (percent / 100);
        const res = beginAttack(self.state, self.state.playerNationId, source, target, troops, naval);
        if (!res.ok) {
          self.ui.toast(res.reason, 'loss');
          return;
        }
        self.audio[naval ? 'naval' : 'cannon']();
        self.ui.markDirty();
        if (naval) {
          self.ui.toast(`Fleet away — ${Math.round(troops * 1000).toLocaleString()} men at sea.`, 'info', '⚓');
        } else if (res.result) {
          // The report card is the feedback; no extra toast on top of it.
          self.ui.battleReport(self.state, target, res.result);
          if (res.result.captured) self.handlers.selectProvince(target.id);
        }
        self.ui.update(self.state, 0);
      },
      declareWar(id) {
        if (!self.state) return;
        declareWar(self.state, self.state.playerNationId, id);
        self.audio.war();
        self.ui.markDirty();
        self.ui.update(self.state, 0);
      },
      proposePeace(id) {
        if (!self.state) return;
        const res = proposePeace(self.state, self.state.playerNationId, id);
        self.ui.toast(res.accepted ? 'Peace agreed.' : 'Offer rejected.', res.accepted ? 'info' : 'loss');
        self.audio.click();
        self.ui.markDirty();
        self.ui.update(self.state, 0);
      },
      proposeAlliance(id) {
        if (!self.state) return;
        const res = proposeAlliance(self.state, self.state.playerNationId, id);
        self.ui.toast(res.accepted ? 'Alliance formed.' : 'Alliance refused.', res.accepted ? 'win' : 'loss');
        self.audio.click();
        self.ui.markDirty();
        self.ui.update(self.state, 0);
      },
      breakAlliance(id) {
        if (!self.state) return;
        breakAlliance(self.state, self.state.playerNationId, id);
        self.ui.markDirty();
        self.ui.update(self.state, 0);
      },
      gift(id, amount) {
        if (!self.state) return;
        const res = giftGold(self.state, self.state.playerNationId, id, amount);
        if (!res.ok) self.ui.toast(res.reason, 'loss');
        else {
          self.audio.cash();
          self.ui.markDirty();
          self.ui.update(self.state, 0);
        }
      },
      startNuke() {
        if (!self.state) return;
        const res = startNuke(self.state, self.state.playerNationId);
        if (!res.ok) self.ui.toast(res.reason, 'loss');
        else {
          self.ui.toast('Warhead assembly started.', 'info', '☢');
          self.ui.markDirty();
          self.ui.update(self.state, 0);
        }
      },
      enterNukeMode() {
        self.setNukeMode(true);
        self.ui.update(self.state, 0);
      },
      resolveOffer(type, nationId) {
        if (!self.state) return;
        if (type === 'alliance-offer') {
          self.state.nations[self.state.playerNationId].allies.push(nationId);
          self.state.nations[nationId].allies.push(self.state.playerNationId);
          self.state.nations[self.state.playerNationId].relations[nationId] = 100;
          self.state.nations[nationId].relations[self.state.playerNationId] = 100;
          makePeace(self.state, self.state.playerNationId, nationId, { silent: true });
          self.ui.toast('Alliance formed.', 'win');
        } else {
          makePeace(self.state, self.state.playerNationId, nationId);
          self.ui.toast('Ceasefire signed.', 'info');
        }
        self.audio.cash();
        self.ui.markDirty();
        self.ui.update(self.state, 0);
      },
      setSpeed(speed) {
        if (!self.state) return;
        const running = speed > 0;
        self.state.speed = running ? 1 : 0;
        self.state.paused = !running;
        self.ui.updateSpeedButtons(self.state);
        self.ui.update(self.state, 0);
        self.minimapDirty = true;
        if (speed > 0) self.audio.click();
      },
      pauseForMenu() {
        if (!self.state || self.state.gameOver) return;
        if (!self.state.paused) {
          self.pausedByModal = true;
          self.state.paused = true;
          self.ui.updateSpeedButtons(self.state);
        }
      },
      modalClosed() {
        if (self.pausedByModal && self.state && !self.state.gameOver) {
          self.state.paused = false;
          self.pausedByModal = false;
          self.ui.updateSpeedButtons(self.state);
        }
      },
      zoom(factor) {
        self.view.zoomAt(self.view.width / 2, self.view.height / 2, factor);
        self.minimapDirty = true;
      },
      resetView() {
        self.view.fitWorld();
        self.minimapDirty = true;
      },
      save() {
        if (!self.state) return;
        saveLocal(self.state);
        saveToFile(self.state).then(() => self.ui.toast('Campaign saved.', 'info', '✓'));
      },
      load() {
        self.continueCampaign();
      },
      quit() {
        if (window.desktop?.quit) window.desktop.quit();
        else self.ui.toast('Close the window to quit the game.', 'info');
      },
      toggleFullscreen() {
        if (window.desktop?.toggleFullscreen) window.desktop.toggleFullscreen();
        else if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen?.();
      },
      newCampaign() {
        clearLocal();
        self.newCampaign();
      },
      continueCampaign() {
        self.continueCampaign();
      },
      startCampaign() {
        self.startCampaign();
      },
      backToTitle() {
        self.backToTitle();
      },
      previewNation(id) {
        self.previewNation(id);
      },
      setDifficulty(key) {
        self.selectedDifficulty = key;
      },
      settingsChanged(settings) {
        self.settings = { ...self.settings, ...settings };
        self.applySettings();
        self.saveSettings();
      },
      clearPreview() {
        self.view.attackTarget = self.view.attackSource = null;
      },
      previewAttack({ targetId, sourceId, naval }) {
        if (!self.state) return;
        const target = self.state.provinces[targetId];
        const source = self.state.provinces[sourceId];
        if (!target || !source) return;
        self.view.attackTarget = target;
        self.view.attackSource = { centroid: source.centroid, navalRoute: naval };
      },
    };
    return this.handlers;
  }

  // -------------------------------------------------------------------- loop
  loop(ts) {
    const dt = Math.min(0.25, (ts - this.lastTs) / 1000);
    this.lastTs = ts;

    if (this.state && this.state.started && !this.state.gameOver) {
      if (!this.state.paused) {
        update(this.state, dt);
        this.processLog();
        this.maybeAutosave();
      }
    }

    if (this.state?.gameOver) this.checkGameOver();
    const renderState = this.state || this.previewState;
    if (this.world && renderState) {
      this.view.draw(renderState, {
        time: performance.now() / 1000,
        showLabels: this.settings.labels,
        showTroops: this.settings.troops && this.screen === 'game',
        selectedId: this.screen === 'game' ? this.state?.selectedProvinceId ?? null : null,
        hoveredId: this.view.hoveredId,
      });
      if (this.screen === 'game') {
        this.minimapTick(ts);
        this.uiTick += dt;
        if (this.uiTick > 0.12) {
          this.uiTick = 0;
          this.ui.update(this.state, dt);
          if (this.pointer.overMap && this.buildMode && !this.pointer.down && this.ui.el.modalRoot.classList.contains('hidden')) {
            this.updateHover(this.pointer.x, this.pointer.y);
          }
          this.handlePendingDialog();
        }
      }
    }

    requestAnimationFrame((t) => this.loop(t));
  }

  minimapTick(ts) {
    if (!this.state) return;
    const now = ts / 1000;
    if (this.minimapDirty || !this.lastMinimapAt || now - this.lastMinimapAt > 0.4) {
      this.view.drawMinimap(document.getElementById('minimap'), this.state);
      this.lastMinimapAt = now;
      this.minimapDirty = false;
    }
  }

  processLog() {
    const state = this.state;
    if (!state || !state.log.length) return;
    const newestId = state.log[0].id;
    if (newestId === this.lastLogId) return;
    const fresh = [];
    for (const entry of state.log) {
      if (entry.id === this.lastLogId) break;
      fresh.push(entry);
    }
    this.lastLogId = newestId;
    fresh.reverse();

    const now = performance.now();
    const throttle = (key, ms) => {
      if (now - (this.soundTimes[key] || 0) < ms) return false;
      this.soundTimes[key] = now;
      return true;
    };

    const playerName = state.nations[state.playerNationId].name;
    const mentionsPlayer = (entry) => entry.text.includes(playerName);

    for (const entry of fresh) {
      switch (entry.type) {
        case 'victory':
          if (throttle('victory', 900)) this.audio.cannon();
          this.ui.toast(entry.text, 'win', '⚔');
          break;
        case 'defeat':
          if (throttle('defeat', 900)) this.audio.defeat();
          this.ui.toast(entry.text, 'loss', '✕');
          break;
        case 'war':
          if (throttle('war', 1400)) this.audio.war();
          if (mentionsPlayer(entry)) this.ui.toast(entry.text, 'war', '⚔');
          break;
        case 'nuke':
          if (mentionsPlayer(entry)) {
            if (throttle('nuke', 1200)) this.audio.nuke();
            this.ui.toast(entry.text, 'war', '☢');
          }
          break;
        case 'diplomacy':
          // Only the player's own treaties interrupt; the feed has the rest.
          if (mentionsPlayer(entry)) {
            if (throttle('diplomacy', 900)) this.audio.cash();
            this.ui.toast(entry.text, 'info', '✉');
          }
          break;
        case 'elimination':
          this.ui.toast(entry.text, 'info', '☠');
          break;
        default:
          break;
      }
    }
  }

  handlePendingDialog() {
    const state = this.state;
    if (!state || !state.pendingDialog || !this.ui.el.modalRoot.classList.contains('hidden')) return;
    const dialog = state.pendingDialog;
    state.pendingDialog = null;
    this.handlers.pauseForMenu();
    this.ui.offerDialog(dialog);
    this.audio.alert();
  }

  maybeAutosave() {
    if (!this.settings.autosave || !this.state) return;
    const year = 2026 + Math.floor((this.state.day - 1) / 360);
    if (year !== this.autosaveYear) {
      this.autosaveYear = year;
      saveLocal(this.state);
    }
  }

  checkGameOver() {
    const state = this.state;
    if (!state || !state.gameOver || state.gameOverShown) return;
    state.gameOverShown = true;
    pushLog(state, state.gameOver.win ? 'Victory — the globe is yours.' : 'Defeat — your nation is gone.', 'system');
    this.ui.openGameOver({
      win: state.gameOver.win,
      stats: {
        days: state.day,
        provinces: nationProvinces(state, state.playerNationId).length,
        share: `${(worldShare(state) * 100).toFixed(1)}%`,
        won: state.stats.battlesWon,
        lost: state.stats.battlesLost,
        taken: state.stats.provincesTaken,
        gold: state.nations[state.playerNationId].gold,
        nukes: state.stats.nukesLaunched,
      },
    });
    if (state.gameOver.win) this.audio.victory();
    else this.audio.defeat();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.__app = new App();
  document.title = 'Conquer: Rule the Globe';
});
