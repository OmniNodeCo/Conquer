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
  nationProvinces,
  worldShare,
  pushLog,
} from './state.js';
import { generateWorld, findProvinceAt } from './worldgen.js';
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
    this.resize();
    this.view.fitWorld();
    this.showTitle();
    requestAnimationFrame((ts) => this.loop(ts));
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
      if (this.screen !== 'game') return;
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
        }
        this.pointer.lastX = ev.clientX;
        this.pointer.lastY = ev.clientY;
      } else if (this.screen === 'game') {
        this.updateHover(ev.clientX, ev.clientY);
      }
    });

    canvas.addEventListener('pointerup', (ev) => {
      const wasDragging = this.pointer.dragging;
      this.pointer.down = false;
      this.pointer.dragging = false;
      this.canvas.style.cursor = 'crosshair';
      if (this.screen === 'game' && !wasDragging) this.handleMapClick(ev.clientX, ev.clientY);
    });

    canvas.addEventListener('pointerleave', () => {
      this.pointer.down = false;
      this.pointer.dragging = false;
      this.view.hoveredId = null;
      this.ui.hideTooltip();
    });

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
    canvas.addEventListener('dblclick', (ev) => {
      if (this.screen !== 'game') return;
      this.view.zoomAt(ev.clientX, ev.clientY, 1.6);
      this.minimapDirty = true;
    });

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
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (ev.key === 'Escape') {
      if (!document.getElementById('modal-root').classList.contains('hidden')) {
        this.ui.closeModal();
        return;
      }
      if (this.state?.mode === 'nuke') {
        this.setNukeMode(false);
        return;
      }
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
        this.handlers.setSpeed(1);
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
    if (id !== this.view.hoveredId) {
      this.view.hoveredId = id;
      this.hoverProvince = prov;
      this.canvas.style.cursor = prov ? 'pointer' : 'crosshair';
      if (prov && this.state) {
        const owner = prov.nationId === null ? null : this.state.nations[prov.nationId];
        const ownerName = owner ? owner.name : prov.tribe || 'Free territory';
        this.ui.showTooltip(
          `<b>${prov.name}</b><br/>${ownerName} · ${prov.terrain}<br/>Garrison ${Math.round(prov.troops * 1000).toLocaleString()}`,
          sx,
          sy
        );
      } else {
        this.ui.hideTooltip();
      }
    }
  }

  handleMapClick(sx, sy) {
    if (!this.world) return;
    const [wx, wy] = this.view.screenToWorld(sx, sy);
    const prov = findProvinceAt(this.world, wx, wy);
    if (!prov) {
      this.deselect();
      return;
    }
    if (this.state.mode === 'nuke') {
      this.confirmNuke(prov);
      return;
    }
    this.handlers.selectProvince(prov.id);
  }

  // -------------------------------------------------------------- game flow
  showTitle() {
    this.screen = 'title';
    this.state = null;
    this.previewState = null;
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
    const player = state.nations[state.playerNationId];
    const seat = state.provinces[player.capitalId];
    if (seat) this.view.focusProvince(seat, 1.0);
    this.ui.update(state, 0);
    this.minimapDirty = true;
  }

  backToTitle() {
    if (this.state && this.state.started) saveLocal(this.state);
    this.showTitle();
  }

  focusCapital() {
    if (!this.state) return;
    const player = this.state.nations[this.state.playerNationId];
    const seat =
      this.state.provinces[player.capitalId] &&
      this.state.provinces[player.capitalId].nationId === player.id
        ? this.state.provinces[player.capitalId]
        : nationProvinces(this.state, player.id)[0];
    if (seat) {
      this.view.focusProvince(seat, 1.2);
      this.handlers.selectProvince(seat.id);
      this.minimapDirty = true;
    }
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
      locateProvince(id) {
        if (!self.state) return;
        const prov = self.state.provinces[id];
        if (!prov) return;
        self.view.focusProvince(prov, Math.max(1.1, self.view.camera.zoom));
        self.minimapDirty = true;
        self.handlers.selectProvince(id);
      },
      focusNation(id) {
        if (!self.state) return;
        self.ui.selectNation(id);
        self.ui.update(self.state, 0);
        const provs = nationProvinces(self.state, id);
        if (provs.length) {
          const capital = self.state.provinces[self.state.nations[id].capitalId];
          const target = capital && capital.nationId === id ? capital : provs[0];
          self.view.focusProvince(target, Math.max(0.75, Math.min(1.2, self.view.camera.zoom)));
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
          const r = res.result;
          const lost = Math.round(r.attackerLosses * 1000).toLocaleString();
          const killed = Math.round(r.defenderLosses * 1000).toLocaleString();
          if (r.win) {
            self.ui.toast(
              `${target.name} taken — you lost ${lost} soldiers, ${killed} of the enemy fell.`,
              'win',
              '⚔'
            );
            self.handlers.selectProvince(target.id);
          } else {
            self.ui.toast(
              `Assault on ${target.name} repulsed — ${lost} soldiers lost, ${killed} enemy dead.`,
              'loss',
              '⚔'
            );
          }
          self.ui.battleReport(self.state, target, r);
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
        this.checkGameOver();
        this.maybeAutosave();
      }
    }

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
          if (entry.text.includes(state.nations[state.playerNationId].name)) {
            this.ui.toast(entry.text, 'war', '⚔');
          }
          break;
        case 'nuke':
          if (throttle('nuke', 1200)) this.audio.nuke();
          this.ui.toast(entry.text, 'war', '☢');
          break;
        case 'diplomacy':
          if (throttle('diplomacy', 900)) this.audio.cash();
          this.ui.toast(entry.text, 'info', '✉');
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
    if (!state || !state.pendingDialog) return;
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
});
