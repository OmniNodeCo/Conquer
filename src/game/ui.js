// Interface controller: HUD, ranking, province inspector, dialogs, screens.

import { icon } from './icons.js';
import { flagFor } from './flags.js';
import { TERRAIN } from './worldgen.js';
import { formatTroops } from './render.js';
import { heldCell, heldTiles, nationSeat, sectorGuard, tileOwner } from './fronts.js';
import {
  BUILDINGS,
  TUNING,
  VICTORY_SHARE,
  attackableSources,
  buildingCost,
  canAttack,
  canBuild,
  canRecruit,
  defenseMultiplier,
  hasSilo,
  garrisonTarget,
  nationArmy,
  nationIncome,
  nationManpowerRegen,
  nationPopulation,
  nationPower,
  nationProvinces,
  provinceIncome,
  recruitCost,
  relationLabel,
  relationWith,
  resolveBattle,
  worldShare,
} from './state.js';

const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
const fmtGold = (n) => Math.floor(n).toLocaleString('en-US');
const pct = (n, digits = 0) => `${(n * 100).toFixed(digits)}%`;

const FEED_TAGS = {
  war: 'WAR',
  victory: 'GAIN',
  defeat: 'LOSS',
  battle: 'BATTLE',
  naval: 'FLEET',
  nuke: 'NUKE',
  diplomacy: 'DIPLO',
  peace: 'PEACE',
  build: 'BUILD',
  system: 'INFO',
  elimination: 'WIPED',
};

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function dateLabel(day) {
  const d = Math.max(1, day);
  const year = 2026 + Math.floor((d - 1) / 360);
  const month = Math.floor(((d - 1) % 360) / 30);
  return `${MONTHS[month]} ${year}`;
}

function flagStyle(nation, w = 26, h = 18) {
  return `background-image:url(${flagFor(nation)});background-size:cover;background-position:center;width:${w}px;height:${h}px;`;
}

function oddsLabel(prob) {
  if (prob >= 0.82) return { text: 'Overwhelming', cls: 'good' };
  if (prob >= 0.62) return { text: 'Favourable', cls: 'good' };
  if (prob >= 0.45) return { text: 'Coin flip', cls: 'mid' };
  if (prob >= 0.25) return { text: 'Risky', cls: 'bad' };
  return { text: 'Hopeless', cls: 'bad' };
}

export function battleOdds(troops, target, defMult) {
  if (troops <= 0) return 0;
  let wins = 0;
  const trials = 220;
  const rand = Math.random;
  for (let i = 0; i < trials; i += 1) {
    const res = resolveBattle(troops, target, defMult, rand);
    if (res.win) wins += 1;
  }
  return wins / trials;
}

/**
 * Monte-Carlo forecast for the assault panel: win chance plus the soldiers the
 * attacker can expect to bury. Attacks are never free — every assault costs lives.
 */
export function battleForecast(troops, target, defMult, trials = 160) {
  if (troops <= 0) return { prob: 0, expectedLoss: 0 };
  let wins = 0;
  let loss = 0;
  const rand = Math.random;
  for (let i = 0; i < trials; i += 1) {
    const res = resolveBattle(troops, target, defMult, rand);
    if (res.win) wins += 1;
    loss += res.attackerLosses;
  }
  return { prob: wins / trials, expectedLoss: loss / trials };
}

export class UI {
  constructor(handlers) {
    this.h = handlers;
    this.state = null;
    this.inspectorMode = 'province';
    this.inspectorId = null;
    this.inspectorKey = '';
    this.dirtyInspector = false;
    this.lastFeedId = -1;
    this.lastRankKey = '';
    this.toasts = [];
    this.settings = { sound: true, labels: true, troops: true, autosave: true, volume: 0.6 };

    this.el = {
      hud: document.getElementById('hud'),
      playerFlag: document.getElementById('player-flag'),
      playerName: document.getElementById('player-name'),
      playerChip: document.getElementById('player-chip'),
      gold: document.getElementById('stat-gold'),
      income: document.getElementById('stat-income'),
      manpower: document.getElementById('stat-manpower'),
      regen: document.getElementById('stat-regen'),
      army: document.getElementById('stat-army'),
      replacements: document.getElementById('stat-replacements'),
      prov: document.getElementById('stat-prov'),
      share: document.getElementById('stat-share'),
      clockDate: document.getElementById('clock-date'),
      clockSpeed: document.getElementById('clock-speed'),
      rankList: document.getElementById('rank-list'),
      rankCount: document.getElementById('rank-count'),
      inspector: document.getElementById('inspector'),
      feed: document.getElementById('feed'),
      toasts: document.getElementById('toasts'),
      hint: document.getElementById('hint-bar'),
      modalRoot: document.getElementById('modal-root'),
      modal: document.getElementById('modal'),
      buildBar: document.getElementById('build-bar'),
      bbSlots: document.getElementById('bb-slots'),
      bbHint: document.getElementById('bb-hint'),
      footerVersion: document.getElementById('footer-version'),
      footerUpdate: document.getElementById('footer-update'),
      footerUpdateBtn: document.getElementById('footer-update-btn'),
      modalBackdrop: document.getElementById('modal-backdrop'),
      victoryFill: document.getElementById('victory-fill'),
      victoryYou: document.getElementById('victory-you'),
      victoryPct: document.getElementById('victory-pct'),
      nationList: document.getElementById('nation-list'),
      nationDetail: document.getElementById('nation-detail'),
      startBtn: document.getElementById('btn-start'),
      loading: document.getElementById('loading'),
      tooltip: document.getElementById('tooltip'),
      mapMode: document.getElementById('map-mode'),
    };

    this.injectIcons();
    this.bindEvents();
  }

  injectIcons() {
    document.querySelectorAll('[data-icon]').forEach((node) => {
      node.innerHTML = icon(node.dataset.icon);
    });
  }

  // ------------------------------------------------------------------ screens
  showScreen(name) {
    const title = document.getElementById('screen-title');
    const nations = document.getElementById('screen-nations');
    title.classList.toggle('hidden', name !== 'title');
    nations.classList.toggle('hidden', name !== 'nations');
    this.el.hud.classList.toggle('hidden', name !== 'game');
  }

  setLoading(on) {
    this.el.loading.classList.toggle('hidden', !on);
  }

  // -------------------------------------------------------------------- bind
  bindEvents() {
    const root = document.body;

    root.addEventListener('click', (ev) => {
      const actionEl = ev.target.closest('[data-action]');
      if (!actionEl) return;
      const action = actionEl.dataset.action;
      const id = actionEl.dataset.id ? Number(actionEl.dataset.id) : null;
      this.handleAction(action, id, actionEl, ev);
    });

    this.el.modalBackdrop.addEventListener('click', () => this.closeModal());

    document.getElementById('btn-pause').addEventListener('click', () => {
      this.h.setSpeed(this.state && !this.state.paused ? 0 : 1);
    });

    this.el.bbSlots.addEventListener('click', (ev) => {
      const slot = ev.target.closest('.bb-slot');
      if (!slot) return;
      this.h.toggleBuildSlot(slot.dataset.key);
    });

    if (this.el.footerUpdateBtn) {
      this.el.footerUpdateBtn.addEventListener('click', () => this.h.installUpdate());
    }

    document.getElementById('btn-menu').addEventListener('click', () => this.openMenu());
    this.el.playerChip.addEventListener('click', () => this.openLandFinder());
    document.getElementById('btn-home').addEventListener('click', () => this.h.goHome());
    document.getElementById('btn-help').addEventListener('click', () => this.openHelp());
    document.getElementById('btn-zoom-in').addEventListener('click', () => this.h.zoom(1.25));
    document.getElementById('btn-zoom-out').addEventListener('click', () => this.h.zoom(0.8));
    document.getElementById('btn-reset-view').addEventListener('click', () => this.h.resetView());

    document.getElementById('btn-new').addEventListener('click', () => this.h.newCampaign());
    document.getElementById('btn-continue').addEventListener('click', () => this.h.continueCampaign());
    document.getElementById('btn-howto').addEventListener('click', () => this.openHelp());
    document.getElementById('btn-settings').addEventListener('click', () => this.openSettings());
    document.getElementById('btn-quit').addEventListener('click', () => this.h.quit());
    document.getElementById('btn-back-title').addEventListener('click', () => this.h.backToTitle());
    document.getElementById('btn-start').addEventListener('click', () => this.h.startCampaign());

    document.getElementById('difficulty-control').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-difficulty]');
      if (!btn) return;
      document.querySelectorAll('#difficulty-control button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      this.h.setDifficulty(btn.dataset.difficulty);
    });

    this.el.nationList.addEventListener('click', (ev) => {
      const card = ev.target.closest('.nation-card');
      if (!card) return;
      this.h.previewNation(Number(card.dataset.id));
    });

    document.querySelectorAll('.ns-filters .chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.ns-filters .chip').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        this.nationSort = chip.dataset.sort;
        this.renderNationList(this.nationsData || [], this.selectedNationId);
      });
    });

    this.el.inspector.addEventListener('input', (ev) => {
      if (ev.target.id === 'attack-slider') this.updateAttackPreview();
    });
    this.el.inspector.addEventListener('change', (ev) => {
      if (ev.target.id === 'attack-source') this.updateAttackPreview();
    });

    this.el.tooltip.classList.add('hidden');
  }

  handleAction(action, id, el, ev) {
    const state = this.state;
    switch (action) {
      case 'close-inspector':
        this.h.deselect();
        break;
      case 'select-province':
        this.h.selectProvince(id);
        break;
      case 'recruit':
        this.h.recruit(this.inspectorId, Number(el.dataset.count));
        break;
      case 'build':
        this.h.build(this.inspectorId, el.dataset.key);
        break;
      case 'attack': {
        const slider = document.getElementById('attack-slider');
        const percent = slider ? Number(slider.value) : 80;
        const sourceId = Number(document.getElementById('attack-source')?.value);
        this.h.attack(Number(el.dataset.target), sourceId, percent);
        break;
      }
      case 'find-land':
        this.openLandFinder();
        break;
      case 'locate':
        this.h.locateProvince(id);
        break;
      case 'war':
        this.h.declareWar(id);
        break;
      case 'peace':
        this.h.proposePeace(id);
        break;
      case 'alliance':
        this.h.proposeAlliance(id);
        break;
      case 'break-alliance':
        this.h.breakAlliance(id);
        break;
      case 'gift':
        this.h.gift(id, 100);
        break;
      case 'focus':
        this.h.focusNation(id);
        break;
      case 'start-nuke':
        this.h.startNuke();
        break;
      case 'nuke-mode':
        this.h.enterNukeMode();
        break;
      case 'cancel-modal':
        this.closeModal();
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------------ toasts
  /**
   * Flip-card report shown right after a land assault resolves, so the cost of
   * the attack is impossible to miss.
   */
  battleReport(state, prov, result) {
    const host = this.el.hud || document.getElementById('hud');
    if (!host) return;
    let node = document.getElementById('battle-report');
    if (!node) {
      node = document.createElement('div');
      node.id = 'battle-report';
      host.appendChild(node);
    }
    const lost = Math.round(result.attackerLosses * 1000).toLocaleString();
    const killed = Math.round(result.defenderLosses * 1000).toLocaleString();
    node.className = result.win || result.captured ? 'show win' : 'show loss';
    node.innerHTML = `
      <div class="br-head">${result.captured ? 'PROVINCE SECURED' : result.win ? 'FRONT ADVANCED' : 'COSTLY GROUND'}</div>
      <div class="br-sub">${prov.name} · +${result.gained} tiles</div>
      <div class="br-rows">
        <div class="br-row"><span>Soldiers sent</span><b>${fmtInt(result.sent * 1000)}</b></div>
        <div class="br-row minus"><span>Soldiers lost</span><b>−${lost}</b></div>
        <div class="br-row"><span>Defender losses</span><b>${killed}</b></div>
        <div class="br-row"><span>Ground held</span><b>${pct(result.held / prov.areaPx)}</b></div>
      </div>`;
    clearTimeout(this._brTimer);
    this._brTimer = setTimeout(() => {
      node.className = '';
    }, 4200);
  }

  /**
   * Single-slot notification. A new message replaces the one on screen instead
   * of stacking up, repeats inside a short window are swallowed, and world news
   * never piles on top of the player's own action feedback.
   */
  toast(text, kind = 'info', iconChar = '') {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (this._lastToast && this._lastToast.text === text && now - this._lastToast.at < 2600) return;
    if (this._lastToast && now - this._lastToast.at < 450) return;
    this._lastToast = { text, at: now };

    const node = document.createElement('div');
    node.className = `toast ${kind}`;
    node.innerHTML = `${iconChar ? `<span class="t-icon">${iconChar}</span>` : ''}<span>${text}</span>`;
    this.el.toasts.appendChild(node);
    setTimeout(() => {
      node.style.transition = 'opacity .4s, transform .4s';
      node.style.opacity = '0';
      node.style.transform = 'translateY(-6px)';
      setTimeout(() => node.remove(), 420);
    }, 3400);
    // One message on screen at a time; the feed keeps the full history.
    while (this.el.toasts.children.length > 1) this.el.toasts.firstChild.remove();
  }

  // ------------------------------------------------------------------ update
  update(state, dt) {
    this.state = state;
    if (!state) return;

    const player = state.nations[state.playerNationId];
    if (this.hudPlayer !== player) {
      this.hudPlayer = player;
      this.el.playerName.textContent = player.name;
      this.el.playerFlag.style.cssText = flagStyle(player);
      this.el.playerChip.setAttribute('aria-label', `Find my land: ${player.fullName} (L)`);
    }
    const income = nationIncome(state, state.playerNationId) - nationArmy(state, state.playerNationId) * TUNING.upkeepPerTroop;
    const regen = nationManpowerRegen(state, state.playerNationId);
    const own = nationProvinces(state, state.playerNationId).length;

    this.el.gold.textContent = fmtGold(player.gold);
    this.el.income.textContent = `${income >= 0 ? '+' : ''}${income.toFixed(1)}/s`;
    this.el.income.className = income >= 0 ? 'pos' : 'neg';
    this.el.manpower.textContent = fmtInt(player.manpower);
    const netReserve = regen - (player.replacementRate || 0);
    this.el.regen.textContent = `${netReserve >= 0 ? '+' : ''}${netReserve.toFixed(1)}/s`;
    this.el.army.textContent = formatTroops(nationArmy(state, state.playerNationId));
    this.el.replacements.textContent = !state.paused && player.replacementRate > 0
      ? `+${formatTroops(player.replacementRate)}/s mustering` : 'standing army';
    this.el.prov.textContent = own;
    this.el.share.textContent = `${pct(worldShare(state), 1)} of globe`;
    this.el.clockDate.textContent = dateLabel(state.day);
    this.el.clockSpeed.textContent = state.paused || state.speed === 0 ? 'paused' : 'running';

    const share = worldShare(state);
    this.el.victoryFill.style.width = `${Math.min(100, (share / VICTORY_SHARE) * 100)}%`;
    this.el.victoryYou.style.left = `${Math.min(100, (share / VICTORY_SHARE) * 100)}%`;
    this.el.victoryPct.textContent = pct(share, 1);

    this.updateSpeedButtons(state);
    this.renderBuildBar(state);
    this.updateRankList(state);
    this.updateFeed(state);
    this.updateInspector(state);
    this.updateHint(state);
  }

  /** Build hotbar: every placable structure, with live affordability. */
  renderBuildBar(state) {
    if (!this.el.bbSlots) return;
    const keys = Object.keys(BUILDINGS);
    const nation = state ? state.nations[state.playerNationId] : null;
    const signature = `${keys.join(',')}|${this.buildMode || ''}`;
    if (signature !== this._bbSignature) {
      this._bbSignature = signature;
      this.el.bbSlots.innerHTML = keys
        .map((key, index) => {
          const def = BUILDINGS[key];
          const active = this.buildMode === key ? ' active' : '';
          return `
            <button class="bb-slot${active}" data-key="${key}" title="${def.name} — ${def.blurb}">
              <span class="bb-key">${index + 1}</span>
              ${icon(def.icon)}
              <span class="bb-name">${def.name}</span>
              <span class="bb-cost">${def.cost}g</span>
            </button>`;
        })
        .join('');
    }
    if (nation) {
      this.el.bbSlots.querySelectorAll('.bb-slot').forEach((slot) => {
        const def = BUILDINGS[slot.dataset.key];
        slot.classList.toggle('poor', !def || nation.gold < def.cost);
      });
    }
    if (this.el.bbHint) {
      this.el.bbHint.classList.toggle('placing', !!this.buildMode);
      this.el.bbHint.textContent = this.buildMode
        ? `HOME: ${BUILDINGS[this.buildMode].name.toUpperCase()} + REINFORCE · FOREIGN: SEND TROOPS · ESC CANCELS`
        : '1–6: build at home · each land order sends 25%';
    }
  }

  setBuildMode(key) {
    this.buildMode = key || null;
    this._bbSignature = '';
    if (this.state) this.renderBuildBar(this.state);
  }

  setVersion(version) {
    if (this.el.footerVersion && version) this.el.footerVersion.textContent = `v${version}`;
  }

  setUpdateStatus(status) {
    const el = this.el.footerUpdate;
    const btn = this.el.footerUpdateBtn;
    if (!el) return;
    el.className = '';
    if (btn) btn.classList.add('hidden');
    switch (status.state) {
      case 'checking':
        el.textContent = 'checking for updates…';
        break;
      case 'available':
        el.textContent = status.version ? `update v${status.version} found` : 'update found';
        el.classList.add('available');
        break;
      case 'downloading':
        el.textContent = `downloading update ${status.percent ?? 0}%`;
        el.classList.add('available');
        break;
      case 'ready':
        el.textContent = status.version ? `v${status.version} ready` : 'update ready';
        el.classList.add('available');
        if (btn) btn.classList.remove('hidden');
        break;
      case 'current':
        el.textContent = 'up to date';
        break;
      case 'error':
        el.textContent = 'update check failed';
        el.classList.add('error');
        break;
      case 'unsupported':
        el.textContent = status.message || 'updates unavailable';
        break;
      default:
        el.textContent = status.message || '';
    }
  }

  updateSpeedButtons(state) {
    const btn = document.getElementById('btn-pause');
    if (!btn) return;
    const paused = state.paused || state.speed === 0;
    btn.textContent = paused ? '▶' : '❚❚';
    btn.title = paused ? 'Resume (Space)' : 'Pause (Space)';
    btn.classList.toggle('active', paused);
  }

  updateRankList(state) {
    const nations = [...state.nations]
      .map((n) => ({ n, count: nationProvinces(state, n.id).length }))
      .sort((a, b) => b.count - a.count || nationArmy(state, b.n.id) - nationArmy(state, a.n.id));
    const key = nations.map((x) => `${x.n.id}:${x.count}`).join('|') + state.nations.map((n) => n.wars.length).join(',');
    if (key === this.lastRankKey) return;
    this.lastRankKey = key;

    const player = state.nations[state.playerNationId];
    this.el.rankCount.textContent = `${state.nations.filter((n) => n.alive).length} powers`;
    this.el.rankList.innerHTML = nations
      .filter((x) => x.n.alive || x.n.id === player.id)
      .slice(0, 12)
      .map((entry, idx) => {
        const n = entry.n;
        const atWar = n.id !== player.id && player.wars.includes(n.id);
        const ally = n.id !== player.id && player.allies.includes(n.id);
        return `<li class="${n.id === player.id ? 'selected' : ''} ${n.alive ? '' : 'dead'}" data-action="focus" data-id="${n.id}" title="${n.fullName}">
          <span class="rank-pos">${idx + 1}</span>
          <span class="rank-flag" style="${flagStyle(n, 16, 11)}"></span>
          <span class="rank-name ${n.id === player.id ? 'you' : ''}">${n.id === player.id ? 'YOUR REALM' : n.name}</span>
          ${atWar ? '<span class="rank-tag war">war</span>' : ally ? '<span class="rank-tag ally">ally</span>' : ''}
          <span class="rank-value">${entry.count}</span>
        </li>`;
      })
      .join('');
  }

  updateFeed(state) {
    if (!state.log.length) return;
    const newest = state.log[0].id;
    if (newest === this.lastFeedId) return;
    this.lastFeedId = newest;
    this.el.feed.innerHTML = state.log
      .slice(0, 7)
      .map((entry) => {
        const tag = FEED_TAGS[entry.type] || 'EVENT';
        return `<div class="feed-item ${entry.type}"><span class="f-tag">${tag}</span><span>${entry.text}</span></div>`;
      })
      .join('');
  }

  orderMessage(text) {
    // One field readout, replaced on every click. No stream of toast popups.
    this.lastOrder = { state: this.state, text, until: performance.now() + 3500 };
    this.el.hint.textContent = text;
  }

  updateHint(state) {
    if (state.mode === 'nuke') {
      this.el.hint.innerHTML = '<b>NUCLEAR STRIKE</b><span>Choose a target · Esc cancels</span>';
    } else if (this.lastOrder?.state === state && performance.now() < this.lastOrder.until) {
      this.el.hint.textContent = this.lastOrder.text;
    } else {
      this.el.hint.innerHTML = '<b>SEND 25%</b><span>Click home to reinforce · foreign land to advance · L to inspect safely</span>';
    }
  }

  // --------------------------------------------------------------- inspector
  selectProvince(id) {
    this.inspectorMode = 'province';
    this.inspectorId = id;
    this.inspectorKey = '';
    this.dirtyInspector = true;
  }

  selectNation(id) {
    this.inspectorMode = 'nation';
    this.inspectorId = id;
    this.inspectorKey = '';
    this.dirtyInspector = true;
  }

  deselect() {
    this.inspectorMode = null;
    this.inspectorId = null;
    this.inspectorKey = '';
    this.el.inspector.classList.add('hidden');
  }

  markDirty() {
    this.dirtyInspector = true;
  }

  updateInspector(state) {
    if (this.inspectorMode === null || this.inspectorId === null) {
      this.el.inspector.classList.add('hidden');
      return;
    }
    const p = this.inspectorMode === 'province' && state.provinces[this.inspectorId];
    const key = `${this.inspectorMode}:${this.inspectorId}:${p?.nationId}:${p?.frontRevision || 0}:${p?.buildRevision || 0}`;
    if (key !== this.inspectorKey || this.dirtyInspector) {
      this.inspectorKey = key;
      this.dirtyInspector = false;
      this.renderInspector(state);
    } else {
      this.refreshInspectorLive(state);
    }
  }

  renderInspector(state) {
    this.h.clearPreview();
    const el = this.el.inspector;
    el.classList.remove('hidden');
    if (this.inspectorMode === 'nation') {
      el.innerHTML = this.nationPanel(state, this.inspectorId);
      return;
    }
    const prov = state.provinces[this.inspectorId];
    if (!prov) {
      el.classList.add('hidden');
      return;
    }
    const isOwn = prov.nationId === state.playerNationId;
    el.innerHTML = isOwn ? this.ownProvincePanel(state, prov) : this.foreignProvincePanel(state, prov);
    if (!isOwn) this.updateAttackPreview();
  }

  provinceHeader(state, prov) {
    const nation = prov.nationId === null ? null : state.nations[prov.nationId];
    const tribe = prov.tribeId !== null && prov.tribeId !== undefined ? state.world.tribes[prov.tribeId] : null;
    const ownerName = nation ? nation.name : tribe ? tribe.name : 'Unclaimed';
    const ownerFlag = nation ? `<span class="flag" style="${flagStyle(nation, 16, 11)}"></span>` : `<span class="flag" style="background:#4b5563"></span>`;
    return `<div class="insp-head">
      <div class="insp-kicker">${prov.continent} · ${(TERRAIN[prov.terrain] || TERRAIN.plains).label}</div>
      <div class="insp-title">
        <h2>${prov.name}</h2>
        <button class="insp-close" data-action="close-inspector" title="Close">✕</button>
      </div>
      <div class="insp-owner">${ownerFlag}<span>${ownerName}</span></div>
      ${prov.fronts.size ? `<div class="front-strip" title="Land held by each power">
        <i style="width:${pct(heldTiles(prov, prov.nationId)/prov.areaPx, 2)};background:${nation?.color || '#88977a'}"></i>
        ${[...prov.fronts].map(([id, f]) => `<i style="width:${pct(f.tiles.size/prov.areaPx, 2)};background:${state.nations[id].color}"></i>`).join('')}
      </div><div class="front-caption">Your control <b>${pct(heldTiles(prov,state.playerNationId)/prov.areaPx)}</b> · ${prov.nationId === state.playerNationId ? 'Tap occupied ground to reclaim it' : 'Survivors hold the line'}</div>` : ''}
    </div>`;
  }

  statCell(label, value, liveKey = '') {
    return `<div class="stat-cell"><span>${label}</span><b ${liveKey ? `data-live="${liveKey}"` : ''}>${value}</b></div>`;
  }

  ownProvincePanel(state, prov) {
    const nation = state.nations[state.playerNationId];
    const income = provinceIncome(prov, state);
    const def = defenseMultiplier(prov);
    const recruitRows = [10, 25, 100]
      .map((count) => {
        const cost = Math.round(recruitCost(prov, count));
        const ok = canRecruit(state, nation.id, prov, count).ok;
        return `<button class="btn small" data-action="recruit" data-count="${count}" ${ok ? '' : 'disabled'}
          title="${count}k troops for ${cost} gold">+${count}k <span class="muted" style="font-size:9px">· ${cost}g</span></button>`;
      })
      .join('');

    const buildRows = Object.values(BUILDINGS)
      .map((b) => {
        const level = prov.buildings[b.key] || 0;
        const maxed = level >= b.max;
        const check = canBuild(state, nation.id, prov, b.key);
        const cost = buildingCost(prov, b.key);
        const reason = check.ok ? b.blurb : check.reason;
        return `<button class="build-btn" data-action="build" data-key="${b.key}" ${check.ok ? '' : 'disabled'} title="${reason}">
          ${icon(b.icon)}
          <span>
            <span class="b-name">${b.name}</span>
            <span class="b-cost">${maxed ? 'max level' : `${cost} gold`}</span>
          </span>
          <span class="b-lvl">${'◆'.repeat(level)}${'◇'.repeat(Math.max(0, b.max - level))}</span>
        </button>`;
      })
      .join('');

    const neighbours = (prov.neighbours || [])
      .map((id) => state.provinces[id])
      .sort((a, b) => b.value - a.value)
      .slice(0, 6)
      .map((nb) => {
        const owner = nb.nationId === null ? null : state.nations[nb.nationId];
        return `<div class="diplo-row" data-action="select-province" data-id="${nb.id}" style="cursor:pointer">
          <span class="flag" style="${owner ? flagStyle(owner, 16, 11) : 'background:#4b5563'}"></span>
          <span style="flex:1">${nb.name}</span>
          <span class="muted" style="font-size:10px">${owner ? owner.name : nb.tribe ? 'Tribe' : 'Free'}</span>
          <span class="rank-value">${formatTroops(nb.troops)}</span>
        </div>`;
      })
      .join('');

    const silo = prov.buildings.silo > 0;
    const nukeSection = silo
      ? `<div>
          <div class="insp-section-title">STRATEGIC FORCES</div>
          <div class="insp-note" style="margin-bottom:8px">
            Warheads ready: <b>${nation.nukes}</b> ${nation.buildingNuke ? `· assembly ${Math.floor((nation.nukeProgress / TUNING.nukeBuildTime) * 100)}%` : ''}
          </div>
          <div class="recruit-row">
            <button class="btn small" data-action="start-nuke" ${nation.nukes === 0 && !nation.buildingNuke && nation.gold >= TUNING.nukeCost ? '' : 'disabled'}>
              ${icon('nuke')} Build warhead · ${TUNING.nukeCost}g
            </button>
            <button class="btn small danger" data-action="nuke-mode" ${nation.nukes > 0 ? '' : 'disabled'}>Launch</button>
          </div>
        </div>`
      : '';

    return `
      ${this.provinceHeader(state, prov)}
      <div class="stat-grid">
        ${this.statCell('Garrison', `<span data-live="garrison">${formatTroops(prov.troops)}</span>`)}
        ${this.statCell('Defence', `×${def.toFixed(2)}`)}
        ${this.statCell('Income', `<span data-live="income">${income.toFixed(2)}</span>/s`)}
        ${this.statCell('Population', `${prov.population.toFixed(1)}M`)}
      </div>
      <div class="insp-body">
        <div>
          <div class="insp-section-title">RECRUIT <span>${fmtInt(nation.manpower)} manpower</span></div>
          <div class="recruit-row">${recruitRows}</div>
          <div class="muster-note">After ${TUNING.musterDelay}s of rest, reserves refill this garrison to ${formatTroops(garrisonTarget(prov))}. Recruit to go higher.</div>
        </div>
        <div>
          <div class="insp-section-title">CONSTRUCTION <span>${fmtGold(nation.gold)} gold</span></div>
          <div class="build-grid">${buildRows}</div>
        </div>
        ${nukeSection}
        ${
          neighbours
            ? `<div>
                 <div class="insp-section-title">BORDERING PROVINCES</div>
                 <div class="diplo-list">${neighbours}</div>
               </div>`
            : ''
        }
      </div>`;
  }

  foreignProvincePanel(state, prov) {
    const player = state.nations[state.playerNationId];
    const owner = prov.nationId === null ? null : state.nations[prov.nationId];
    const check = canAttack(state, player.id, prov);
    const def = defenseMultiplier(prov);
    const relations = owner ? relationWith(owner, player.id) : 0;
    const atWar = owner ? player.wars.includes(owner.id) : false;
    const allied = owner ? player.allies.includes(owner.id) : false;

    let attackBody;
    if (check.ok) {
      const hint = this.selectedSourceHint;
      const sources = [...check.sources].sort((a, b) => {
        if (hint == null) return 0;
        return (b.prov.id === hint ? 1 : 0) - (a.prov.id === hint ? 1 : 0);
      });
      const options = sources
        .map(
          (s) =>
            `<option value="${s.prov.id}" data-naval="${s.naval}" data-troops="${s.prov.troops.toFixed(2)}">
              ${s.prov.name} · ${formatTroops(s.prov.troops)}${s.naval ? ' · naval' : ''}
            </option>`
        )
        .join('');
      const first = sources[0];
      const send = Math.max(1, Math.floor(first.prov.troops * 0.8));
      const { prob, expectedLoss } = battleForecast(send, sectorGuard(prov), def * (first.naval ? 0.92 : 1));
      const odds = oddsLabel(prob);
      attackBody = `
        <div class="attack-box">
          <div class="insp-section-title">PLAN THE ASSAULT <span>${atWar ? 'at war' : owner ? 'will declare war' : 'tribal land'}</span></div>
          <select class="source-select" id="attack-source">${options}</select>
          <div class="slider-row">
            <input type="range" id="attack-slider" min="10" max="100" value="80" />
            <span class="slider-value" id="attack-troops">${formatTroops(send)}</span>
          </div>
          <div class="odds ${odds.cls}" id="attack-odds">${odds.text} · ${Math.round(prob * 100)}% breakthrough</div>
          <div class="casualty-note" id="attack-losses">≈ ${formatTroops(expectedLoss)} soldiers expected to fall</div>
          <button class="btn danger wide" data-action="attack" data-target="${prov.id}">
            ${icon('sword')} ${first.naval ? 'LAUNCH INVASION' : 'ATTACK'} ${first.naval ? `· ${TUNING.navalCost}g` : ''}
          </button>
        </div>`;
    } else {
      attackBody = `<div class="attack-box"><div class="insp-note">${check.reason}.</div></div>`;
    }

    const diplomacy = owner
      ? `<div>
          <div class="insp-section-title">DIPLOMACY <span>${relationLabel(relations)} (${relations})</span></div>
          <div class="recruit-row">
            ${
              atWar
                ? `<button class="btn small" data-action="peace" data-id="${owner.id}">${icon('peace')} Sue for peace</button>`
                : allied
                ? `<button class="btn small" data-action="break-alliance" data-id="${owner.id}">Break alliance</button>`
                : `<button class="btn small danger" data-action="war" data-id="${owner.id}">Declare war</button>
                   <button class="btn small" data-action="alliance" data-id="${owner.id}">Alliance</button>`
            }
          </div>
          <div class="recruit-row" style="margin-top:6px">
            <button class="btn small ghost" data-action="gift" data-id="${owner.id}">${icon('gift')} Send 100 gold</button>
            <button class="btn small ghost" data-action="focus" data-id="${owner.id}">View nation</button>
          </div>
        </div>`
      : '';

    return `
      ${this.provinceHeader(state, prov)}
      <div class="stat-grid">
        ${this.statCell('Garrison', `<span data-live="garrison">${formatTroops(prov.troops)}</span>`)}
        ${this.statCell('Defence', `×${def.toFixed(2)}`)}
        ${this.statCell('Income', `${provinceIncome(prov, state).toFixed(2)}/s`)}
        ${this.statCell('Population', `${prov.population.toFixed(1)}M`)}
      </div>
      <div class="insp-body">
        ${attackBody}
        ${diplomacy}
        <div class="insp-note">${(TERRAIN[prov.terrain] || TERRAIN.plains).label}${prov.buildings.fort ? ` · Fort lvl ${prov.buildings.fort}` : ''}${prov.buildings.port ? ' · Port' : ''}${prov.isCapital ? ' · Capital' : ''}</div>
      </div>`;
  }

  nationPanel(state, id) {
    const nation = state.nations[id];
    const player = state.nations[state.playerNationId];
    if (!nation) return '';
    const provinces = nationProvinces(state, id);
    const income = nationIncome(state, id);
    const army = nationArmy(state, id);
    const atWar = nation.wars.includes(player.id);
    const allied = player.allies.includes(nation.id);
    const relation = relationWith(nation, player.id);
    const isPlayer = nation.id === player.id;
    const wars = nation.wars.map((wid) => state.nations[wid]).filter(Boolean).slice(0, 4);

    const actions = isPlayer
      ? `<button class="btn small" data-action="find-land">Find my land</button>`
      : `<div class="recruit-row">
          ${
            atWar
              ? `<button class="btn small" data-action="peace" data-id="${nation.id}">${icon('peace')} Peace</button>`
              : allied
              ? `<button class="btn small" data-action="break-alliance" data-id="${nation.id}">Break alliance</button>`
              : `<button class="btn small danger" data-action="war" data-id="${nation.id}">Declare war</button>
                 <button class="btn small" data-action="alliance" data-id="${nation.id}">Alliance</button>`
          }
        </div>
        <div class="recruit-row" style="margin-top:6px">
          <button class="btn small ghost" data-action="gift" data-id="${nation.id}">${icon('gift')} Gift 100</button>
          <button class="btn small ghost" data-action="locate" data-id="${nation.capitalId}">Capital</button>
        </div>`;

    return `
      <div class="insp-head">
        <div class="insp-kicker">${nation.government} · ${nation.personality}</div>
        <div class="insp-title"><h2>${nation.name}</h2>
          <button class="insp-close" data-action="close-inspector" title="Close">✕</button>
        </div>
        <div class="insp-owner"><span class="flag" style="${flagStyle(nation, 16, 11)}"></span>
          <span>${atWar ? 'At war with you' : allied ? 'Allied with you' : relationLabel(relation)}</span></div>
      </div>
      <div class="stat-grid">
        ${this.statCell('Provinces', provinces.length)}
        ${this.statCell('Army', formatTroops(army))}
        ${this.statCell('Income', `${income.toFixed(1)}/s`)}
        ${this.statCell('Relations', relation)}
      </div>
      <div class="insp-body">
        <div>
          <div class="insp-section-title">STANDING</div>
          <div class="insp-note">
            ${provinces.length ? provinces[0].continent : '—'} power ·
            ${nation.nukes ? `☢ ${nation.nukes} warhead${nation.nukes > 1 ? 's' : ''} · ` : ''}
            ${wars.length ? `at war with ${wars.map((w) => w.name).join(', ')}` : 'at peace'}
          </div>
        </div>
        ${actions}
      </div>`;
  }

  refreshInspectorLive(state) {
    if (this.inspectorMode !== 'province' || this.inspectorId === null) return;
    const prov = state.provinces[this.inspectorId];
    if (!prov) return;
    const garrison = this.el.inspector.querySelector('[data-live="garrison"]');
    if (garrison) garrison.textContent = formatTroops(prov.troops);
    const income = this.el.inspector.querySelector('[data-live="income"]');
    if (income) income.textContent = provinceIncome(prov, state).toFixed(2);
  }

  updateAttackPreview() {
    const state = this.state;
    if (!state || this.inspectorMode !== 'province') return;
    const prov = state.provinces[this.inspectorId];
    if (!prov) return;
    const select = document.getElementById('attack-source');
    const slider = document.getElementById('attack-slider');
    if (!select || !slider) return;
    const option = select.selectedOptions[0];
    if (!option) return;
    const available = state.provinces[Number(select.value)].troops;
    const share = Number(slider.value) / 100;
    const troops = Math.max(0.5, available * share);
    const { prob, expectedLoss } = battleForecast(troops, sectorGuard(prov), defenseMultiplier(prov) * (option.dataset.naval === 'true' ? 0.92 : 1));
    const label = oddsLabel(prob);
    slider.style.setProperty('--fill', `${slider.value}%`);
    const troopsEl = document.getElementById('attack-troops');
    if (troopsEl) troopsEl.textContent = formatTroops(troops);
    const oddsEl = document.getElementById('attack-odds');
    if (oddsEl) {
      oddsEl.className = `odds ${label.cls}`;
      oddsEl.textContent = `${label.text} · ${Math.round(prob * 100)}% breakthrough`;
    }
    const lossEl = document.getElementById('attack-losses');
    if (lossEl) {
      lossEl.textContent = `≈ ${formatTroops(expectedLoss)} soldiers expected to fall`;
    }
    const naval = option.dataset.naval === 'true';
    const btn = this.el.inspector.querySelector('[data-action="attack"]');
    if (btn) {
      btn.innerHTML = `${icon('sword')} ${naval ? 'LAUNCH INVASION' : 'ATTACK'} ${naval ? `· ${TUNING.navalCost}g` : ''}`;
    }
    if (this.h.previewAttack) {
      this.h.previewAttack({ targetId: prov.id, sourceId: Number(select.value), naval });
    }
  }

  // ------------------------------------------------------------------ modals
  openModal({ kicker = '', title = '', sub = '', body = '', actions = [], wide = false, onMount = null }) {
    if (this.el.modalRoot.classList.contains('hidden')) this.beforeModal = document.activeElement;
    this.el.modalRoot.classList.remove('hidden');
    this.el.hud.inert = true;
    this.el.modal.classList.toggle('wide', wide);
    this.el.modal.innerHTML = `
      <button class="modal-close" aria-label="Close dialog" data-modal-action="close">✕</button>
      ${kicker ? `<div class="modal-kicker">${kicker}</div>` : ''}
      ${title ? `<h2 id="modal-title" class="modal-title">${title}</h2>` : ''}
      ${sub ? `<p class="modal-sub">${sub}</p>` : ''}
      <div class="modal-body">${body}</div>
      <div class="modal-actions">
        ${actions
          .map(
            (a, i) =>
              `<button class="btn ${a.kind || ''}" data-modal-index="${i}" ${a.disabled ? 'disabled' : ''}>${a.label}</button>`
          )
          .join('')}
      </div>`;

    this.el.modal.querySelectorAll('[data-modal-index]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = actions[Number(btn.dataset.modalIndex)];
        if (action && action.onClick) action.onClick();
      });
    });
    this.el.modal.querySelectorAll('[data-modal-action="close"]').forEach((btn) => {
      btn.addEventListener('click', () => this.closeModal());
    });
    if (onMount) onMount(this.el.modal);
    this.modalActions = actions;
  }

  closeModal() {
    this.el.modalRoot.classList.add('hidden');
    this.el.modal.innerHTML = '';
    this.el.hud.inert = false;
    this.beforeModal?.focus();
    this.beforeModal = null;
    this.h.modalClosed();
  }

  openLandFinder() {
    const state = this.state;
    if (!state?.started) return;
    this.h.pauseForMenu();
    this.hideTooltip();
    const { player, world } = state;
    const home = nationSeat(world, player);
    const provinces = nationProvinces(state, player.id);
    const footholds = state.provinces.filter(p => p.fronts.has(player.id));
    const places = [...provinces, ...footholds].sort((a, b) =>
      Number(b === home) - Number(a === home) ||
      Number(b.nationId === player.id) - Number(a.nationId === player.id) || a.name.localeCompare(b.name));
    this.openModal({
      kicker: 'REALM ATLAS', title: 'Find my land',
      body: `<div class="atlas-nation">
          <span class="flag" style="${flagStyle(player, 40, 28)}"></span>
          <div><b>${player.fullName}</b><small>${provinces.length} province${provinces.length === 1 ? '' : 's'} · ${footholds.length} foothold${footholds.length === 1 ? '' : 's'} · ${pct(worldShare(state), 1)} of the globe</small></div>
          <button type="button" class="btn small" id="atlas-home" ${home ? '' : 'disabled'}>Go home</button>
        </div>
        <label class="atlas-search">Search your territory
          <input id="atlas-query" type="search" autocomplete="off" placeholder="Province or building name…">
        </label>
        <ul id="atlas-results" aria-label="Held territory"></ul>
        <small class="atlas-note">Pick a province or a building to see it on the map. No orders are issued.</small>`,
      onMount: modal => {
        const input = modal.querySelector('#atlas-query'), list = modal.querySelector('#atlas-results');
        const render = () => {
          const q = input.value.trim().toLowerCase();
          list.innerHTML = places.map(p => {
            const own = p.nationId === player.id;
            const label = !own ? 'Foothold' : p === home ? (p.id === player.capitalId ? 'Capital' : 'Home province') : 'Province';
            const provinceMatch = `${p.name} ${label}`.toLowerCase().includes(q);
            const sites = own ? p.sites.filter(s => provinceMatch || `${s.key} ${BUILDINGS[s.key].name}`.toLowerCase().includes(q)) : [];
            if (!provinceMatch && !sites.length) return '';
            const cell = heldCell(p, player.id);
            return `<li>
              <button class="atlas-place" data-find-province="${p.id}" data-cell="${cell}">
                <span><b>${p.name}</b><small>${label} · ${fmtInt(heldTiles(p, player.id))} tiles held</small></span>
                <span class="atlas-link">Locate ›</span>
              </button>
              ${sites.length ? `<div class="atlas-sites">${sites.map(s => {
                const def = BUILDINGS[s.key];
                return `<button data-find-province="${p.id}" data-cell="${s.cell}" title="Locate ${def.name} in ${p.name}">
                  ${icon(def.icon)} ${def.name}${s.level > 1 ? ` · Lv ${s.level}` : ''}${tileOwner(p, s.cell) !== player.id ? ' · occupied' : ''}</button>`;
              }).join('')}</div>` : ''}
            </li>`;
          }).join('') || `<li class="atlas-empty">${places.length ? 'No matching provinces or buildings.' : 'You hold no territory.'}</li>`;
        };
        input.addEventListener('input', render);
        list.addEventListener('click', ev => {
          const btn = ev.target.closest('[data-find-province]');
          if (!btn) return;
          this.closeModal();
          this.h.locateProvince(Number(btn.dataset.findProvince), Number(btn.dataset.cell));
        });
        modal.querySelector('#atlas-home').addEventListener('click', () => { this.closeModal(); this.h.goHome(); });
        render();
        input.focus();
      },
    });
  }

  openMenu() {
    this.h.pauseForMenu();
    const settings = this.settings;
    this.openModal({
      kicker: 'CAMPAIGN MENU',
      title: 'Command paused',
      sub: 'Your nation waits. Take your time — the world will resume when you return.',
      actions: [
        { label: 'RESUME', kind: 'primary', onClick: () => this.closeModal() },
        { label: 'SAVE', onClick: () => this.h.save() },
        { label: 'LOAD', onClick: () => this.h.load() },
        { label: 'SETTINGS', onClick: () => this.openSettings() },
        {
          label: 'ABANDON CAMPAIGN',
          kind: 'danger',
          onClick: () =>
            this.confirm(
              'Abandon this campaign?',
              'All progress in this world will be lost.',
              () => this.h.backToTitle()
            ),
        },
      ],
      body: `
        <div class="help-grid">
          <div class="help-card">
            <h4>Run of play</h4>
            <p>Day ${this.state ? this.state.day : 1} · ${this.state ? nationProvinces(this.state, this.state.playerNationId).length : 0} provinces held · ${this.state ? pct(worldShare(this.state), 1) : '0%'} of the globe.</p>
          </div>
          <div class="help-card">
            <h4>Reminder</h4>
            <p>Neutral tribes are free land — but their garrisons bite. Build cities for gold, forts for defence and ports to invade across water.</p>
          </div>
        </div>`,
    });
  }

  openHelp() {
    this.h.pauseForMenu();
    this.openModal({
      kicker: 'FIELD MANUAL',
      title: 'How to play',
      wide: true,
      sub: 'Hold 80% of the land tiles to win. Even a narrow foothold counts.',
      actions: [{ label: 'UNDERSTOOD', kind: 'primary', onClick: () => this.closeModal() }],
      body: `
        <div class="help-grid">
          <div class="help-card">
            <h4>The basics</h4>
            <ul>
              <li>Time runs at one steady pace. Hit <b>Space</b> to pause and resume.</li>
              <li>Click your flag’s <b>Find my land</b> button to locate a province, foothold or building without issuing orders.</li>
              <li>Every land order sends 25% of a ready garrison. Click home to reinforce or patrol. Click foreign land to advance; without a route, troops stage on your side.</li>
              <li>Tap enemy-coloured ground inside your own province to push them back.</li>
            </ul>
          </div>
          <div class="help-card">
            <h4>Economy</h4>
            <ul>
              <li><b>Gold</b> flows from provinces every second. Cities and ports raise it.</li>
              <li><b>Manpower</b> refills from population. After 3s of rest, reserves automatically join depleted garrisons.</li>
              <li>With <b>1–6</b> armed, a home dispatch can also place a structure. Its whole site must clear rival land. A foreign click sends soldiers, never a building. Cities use small gold dots.</li>
              <li>Armies cost upkeep every second. Bankrupt armies still fight, but you cannot recruit.</li>
            </ul>
          </div>
          <div class="help-card">
            <h4>War</h4>
            <ul>
              <li>Each assault fights one sector. A breakthrough takes a wider patch; even a costly push keeps a foothold.</li>
              <li>Terrain and forts multiply the defender. Mountains and cities are costly.</li>
              <li>Ports unlock naval invasions — send troops across water to any coastal province within reach.</li>
              <li>When the last defending tile falls, the largest occupier takes the province and its buildings.</li>
            </ul>
          </div>
          <div class="help-card">
            <h4>Diplomacy &amp; nukes</h4>
            <ul>
              <li>Declare war, sue for peace, or buy goodwill with gold.</li>
              <li>Allies will not attack you, and may drag you into their wars.</li>
              <li>Missile silos let you build warheads. Nukes gut a province — and the world remembers.</li>
            </ul>
          </div>
          <div class="help-card" style="grid-column: span 2">
            <h4>Controls</h4>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 24px">
              <div class="kbd-row"><span>Pause / resume</span><kbd>Space</kbd></div>
              <div class="kbd-row"><span>Pan map</span><kbd>drag</kbd> / <kbd>arrows</kbd></div>
              <div class="kbd-row"><span>Zoom</span><kbd>scroll</kbd> / <kbd>+</kbd> <kbd>−</kbd></div>
              <div class="kbd-row"><span>Go home</span><kbd>F</kbd></div>
              <div class="kbd-row"><span>Find my land</span><kbd>L</kbd></div>
              <div class="kbd-row"><span>Quick save</span><kbd>Ctrl</kbd>+<kbd>S</kbd></div>
              <div class="kbd-row"><span>Close panel / cancel</span><kbd>Esc</kbd></div>
              <div class="kbd-row"><span>This manual</span><kbd>H</kbd></div>
            </div>
          </div>
        </div>`,
    });
  }

  openSettings() {
    this.h.pauseForMenu();
    const s = this.settings;
    const toggle = (key, label, hint) => `
      <div class="setting-row">
        <div><div class="s-label">${label}</div><div class="s-hint">${hint}</div></div>
        <button class="switch ${s[key] ? 'on' : ''}" data-toggle="${key}"></button>
      </div>`;
    this.openModal({
      kicker: 'OPTIONS',
      title: 'Settings',
      actions: [{ label: 'DONE', kind: 'primary', onClick: () => this.closeModal() }],
      body: `
        ${toggle('sound', 'Sound effects', 'Procedural audio for battles, building and diplomacy')}
        ${toggle('labels', 'Map labels', 'Province and nation names')}
        ${toggle('troops', 'Garrison numbers', 'Strength badges on every province')}
        ${toggle('autosave', 'Autosave', 'Save automatically at the end of each year')}
        <div class="setting-row">
          <div><div class="s-label">Volume</div><div class="s-hint">Master output level</div></div>
          <input type="range" min="0" max="100" value="${Math.round(s.volume * 100)}" id="volume-slider" style="width:140px" />
        </div>
        <div class="setting-row">
          <div><div class="s-label">Fullscreen</div><div class="s-hint">Toggle the window</div></div>
          <button class="btn small" id="btn-fullscreen">TOGGLE</button>
        </div>`,
      onMount: (modal) => {
        modal.querySelectorAll('[data-toggle]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const key = btn.dataset.toggle;
            s[key] = !s[key];
            btn.classList.toggle('on', s[key]);
            this.h.settingsChanged({ ...s });
          });
        });
        const slider = modal.querySelector('#volume-slider');
        if (slider) {
          slider.addEventListener('input', () => {
            s.volume = Number(slider.value) / 100;
            this.h.settingsChanged({ ...s });
          });
        }
        const fs = modal.querySelector('#btn-fullscreen');
        if (fs) fs.addEventListener('click', () => this.h.toggleFullscreen());
      },
    });
  }

  confirm(title, body, onYes, confirmLabel = 'CONFIRM') {
    this.openModal({
      title,
      sub: body,
      actions: [
        { label: 'CANCEL', onClick: () => this.closeModal() },
        { label: confirmLabel, kind: 'danger', onClick: () => { this.closeModal(); onYes(); } },
      ],
    });
  }

  openGameOver({ win, stats }) {
    this.openModal({
      kicker: win ? 'VICTORY' : 'DEFEAT',
      title: win ? 'The world is yours' : 'Your nation has fallen',
      sub: win
        ? 'Eighty percent of the globe answers to your flag. Historians will argue about how.'
        : 'The last of your provinces has been taken. The map is redrawn without you.',
      wide: true,
      actions: [
        { label: 'NEW CAMPAIGN', kind: 'primary', onClick: () => { this.closeModal(); this.h.newCampaign(); } },
        { label: 'RETURN TO TITLE', onClick: () => { this.closeModal(); this.h.backToTitle(); } },
      ],
      body: `<div class="help-grid">
        <div class="help-card"><h4>Campaign</h4><p>${stats.days} days · ${stats.provinces} provinces held · ${stats.share} of the globe</p></div>
        <div class="help-card"><h4>Battles</h4><p>${stats.won} won · ${stats.lost} lost · ${stats.taken} provinces taken</p></div>
        <div class="help-card"><h4>Treasure</h4><p>${fmtGold(stats.gold)} gold banked · ${stats.nukes} warhead${stats.nukes === 1 ? '' : 's'} launched</p></div>
        <div class="help-card"><h4>Legacy</h4><p>${win ? 'A single flag over every continent.' : 'A cautionary tale for the next empire.'}</p></div>
      </div>`,
    });
  }

  offerDialog({ type, nationId, text }) {
    const nation = this.state.nations[nationId];
    const isAlliance = type === 'alliance-offer';
    this.openModal({
      kicker: 'DIPLOMATIC MESSAGE',
      title: text,
      sub: isAlliance
        ? `${nation.name} admires your strength and offers a formal alliance. Allies will not attack you and may join your wars.`
        : `${nation.name} is exhausted by this war and proposes a ceasefire. Your conquests would be frozen where they stand.`,
      actions: [
        {
          label: isAlliance ? 'DECLINE' : 'FIGHT ON',
          onClick: () => this.closeModal(),
        },
        {
          label: isAlliance ? 'ACCEPT ALLIANCE' : 'ACCEPT PEACE',
          kind: 'primary',
          onClick: () => {
            this.closeModal();
            this.h.resolveOffer(type, nationId);

          },
        },
      ],
      body: `<div class="help-grid">
        <div class="help-card"><h4>${nation.name}</h4><p>${nation.government} · ${nationProvinces(this.state, nation.id).length} provinces · army ${formatTroops(nationArmy(this.state, nation.id))}</p></div>
        <div class="help-card"><h4>Your position</h4><p>Relations ${relationWith(this.state.nations[this.state.playerNationId], nation.id)} · ${this.state.nations[this.state.playerNationId].allies.length} allies</p></div>
      </div>`,
    });
  }

  // ------------------------------------------------------------ nation select
  renderNationSelect(state, world, preselectId) {
    this.state = state;
    this.nationSort = this.nationSort || 'power';
    this.nationsData = world.nations.map((n) => ({
      nation: n,
      provinces: world.provinces.filter((p) => p.nationId === n.id).length,
      value: world.provinces
        .filter((p) => p.nationId === n.id)
        .reduce((acc, p) => acc + p.value, 0),
    }));
    this.selectedNationId = preselectId ?? this.nationsData[0]?.nation.id ?? 0;
    this.renderNationList(this.nationsData, this.selectedNationId);
    this.renderNationDetail(world.nations[this.selectedNationId]);
  }

  renderNationList(data, selectedId) {
    const sort = this.nationSort || 'power';
    const sorted = [...data].sort((a, b) => {
      if (sort === 'name') return a.nation.name.localeCompare(b.nation.name);
      if (sort === 'provinces') return b.provinces - a.provinces;
      if (sort === 'random') return (a.nation.id * 7919) % 101 - (b.nation.id * 7919) % 101;
      return b.value - a.value;
    });
    this.el.nationList.innerHTML = sorted
      .map(({ nation, provinces, value }) => {
        return `<div class="nation-card ${nation.id === selectedId ? 'selected' : ''}" data-id="${nation.id}">
          <span class="flag" style="${flagStyle(nation, 30, 20)}"></span>
          <span class="nc-text">
            <b>${nation.name}</b>
            <i>${nation.government}</i>
          </span>
          <span class="nc-stats">
            <div><span>Land</span>${provinces}</div>
            <div><span>Economy</span>${Math.round(value * 3.4)}</div>
          </span>
        </div>`;
      })
      .join('');
  }

  renderNationDetail(nation) {
    if (!nation) return;
    const world = this.state.world;
    const provinces = world.provinces.filter((p) => p.nationId === nation.id);
    const value = provinces.reduce((acc, p) => acc + p.value, 0);
    const difficulty = Math.min(4, Math.max(1, Math.round(5 - provinces.length * 0.7)));
    const coast = provinces.filter((p) => p.coastal).length;
    this.el.nationDetail.innerHTML = `
      <div class="gov">${nation.government}</div>
      <h3>${nation.name}</h3>
      <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
        <span class="flag" style="${flagStyle(nation, 44, 29)}"></span>
        <div class="diff-pips">${[1, 2, 3, 4].map((i) => `<i class="${i <= difficulty ? 'on' : ''}"></i>`).join('')}</div>
      </div>
      <p class="desc">${nation.personality === 'aggressive' ? 'A martial power that expands by force.' : nation.personality === 'defensive' ? 'A cautious state that fortifies its borders.' : nation.personality === 'opportunist' ? 'A pragmatic power that strikes where it is weak.' : 'A balanced power, dangerous in any direction.'}
      ${coast} of its ${provinces.length} provinces touch the sea.</p>
      <div class="ns-stat-row">
        <div class="ns-stat"><span>Provinces</span><b>${provinces.length}</b></div>
        <div class="ns-stat"><span>Economy</span><b>${Math.round(value)}</b></div>
        <div class="ns-stat"><span>Coast</span><b>${coast}</b></div>
      </div>
      <div class="desc" style="margin-bottom:0">Starting difficulty
        <b style="color:var(--gold)">${difficulty <= 1 ? 'Easy' : difficulty === 2 ? 'Moderate' : difficulty === 3 ? 'Hard' : 'Brutal'}</b>
        · ${provinces.length <= 2 ? 'a small nation with room to grow' : provinces.length >= 5 ? 'a regional power with many borders' : 'a middling power'}.
      </div>`;
    this.el.startBtn.disabled = false;
  }

  setSelectedNation(id) {
    this.selectedNationId = id;
    this.renderNationList(this.nationsData, id);
    this.renderNationDetail(this.state.world.nations[id]);
  }

  // ------------------------------------------------------------------ tooltip
  showTooltip(text, x, y) {
    const tip = this.el.tooltip;
    tip.innerHTML = text;
    tip.classList.remove('hidden');
    const rect = tip.getBoundingClientRect();
    tip.style.left = `${Math.min(window.innerWidth - rect.width - 12, x + 14)}px`;
    tip.style.top = `${Math.min(window.innerHeight - rect.height - 12, y + 16)}px`;
  }

  hideTooltip() {
    this.el.tooltip.classList.add('hidden');
  }
}
