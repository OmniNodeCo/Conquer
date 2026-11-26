// Computer opponents: economy management, opportunistic wars, diplomacy.

import {
  BUILDINGS,
  TUNING,
  buildingCost,
  build,
  canBuild,
  declareWar,
  defenseMultiplier,
  launchNuke,
  makePeace,
  nationArmy,
  nationIncome,
  nationPower,
  nationProvinces,
  proposeAlliance,
  pushLog,
  recruit,
  relationWith,
  startNuke,
  beginAttack,
  quickAttack,
  hasSilo,
} from './state.js';
import { sectorGuard } from './fronts.js';

function borderProvinces(state, nationId) {
  return nationProvinces(state, nationId)
    .filter((p) => p.neighbours.some((id) => state.provinces[id].nationId !== nationId) || p.coastal)
    .sort((a, b) => b.troops - a.troops);
}

function pickBuild(state, nation) {
  const provs = nationProvinces(state, nation.id);
  const atWar = nation.wars.length > 0;
  const gold = nation.gold;
  const candidates = [];

  for (const prov of provs) {
    const isBorder = prov.neighbours.some((id) => state.provinces[id].nationId !== nation.id);
    if ((prov.buildings.city || 0) < BUILDINGS.city.max) {
      candidates.push({ prov, key: 'city', score: (10 - (prov.buildings.city || 0) * 2) + prov.value * 0.4 });
    }
    if (atWar && isBorder && (prov.buildings.fort || 0) < BUILDINGS.fort.max) {
      candidates.push({ prov, key: 'fort', score: 12 + prov.value * 0.3 });
    }
    if (prov.coastal && !prov.buildings.port && isBorder) {
      candidates.push({ prov, key: 'port', score: 9 + prov.value * 0.2 });
    }
    if ((prov.buildings.factory || 0) < BUILDINGS.factory.max && prov.value > 5) {
      candidates.push({ prov, key: 'factory', score: 4 + prov.value * 0.35 });
    }
    if (!prov.buildings.silo && provs.length >= 9 && nation.gold > 700) {
      candidates.push({ prov, key: 'silo', score: 6 });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  for (const cand of candidates) {
    const check = canBuild(state, nation.id, cand.prov, cand.key);
    if (!check.ok) continue;
    const reserve = atWar ? 40 : 110;
    if (gold - check.cost < reserve) continue;
    // Do not dump the entire treasury into one building.
    if (check.cost > gold * 0.75) continue;
    build(state, nation.id, cand.prov, cand.key);
    return true;
  }
  return false;
}

function chooseRecruitTargets(state, nation) {
  const provs = nationProvinces(state, nation.id);
  const borders = borderProvinces(state, nation.id);
  const targets = [];
  if (borders.length) {
    // Spread recruits across the most exposed provinces.
    const sorted = borders.slice(0, 4);
    for (const prov of sorted) targets.push(prov);
  }
  const capital = state.provinces[nation.capitalId];
  if (capital && capital.nationId === nation.id) targets.push(capital);
  return targets.slice(0, 3);
}

function aiEconomy(state, nation) {
  const income = nationIncome(state, nation.id) * state.diff.aiIncome;
  const army = nationArmy(state, nation.id);
  const provs = nationProvinces(state, nation.id);
  const atWar = nation.wars.length > 0;

  const desiredArmy = 18 + provs.length * 7 + income * 26 + (atWar ? 18 : 0);
  if (army < desiredArmy && nation.gold > 30 && nation.manpower > 8) {
    const targets = chooseRecruitTargets(state, nation);
    const budgetTroops = Math.min(
      nation.manpower,
      Math.floor((nation.gold - (atWar ? 12 : 45)) / TUNING.recruitGold)
    );
    if (budgetTroops > 2) {
      const per = Math.max(1, Math.floor((budgetTroops * nation.ai.recruitBias) / Math.max(1, targets.length)));
      for (const prov of targets) {
        const count = Math.min(per, Math.floor(nation.gold / (TUNING.recruitGold * 1.1)));
        if (count >= 1) recruit(state, nation.id, prov, count);
      }
    }
  }

  const reserve = atWar ? 55 : 130;
  if (nation.gold > reserve + 60) pickBuild(state, nation);
}

function scoreTarget(state, nation, prov, sources) {
  const bestSource = sources.reduce((acc, s) => (s.prov.troops > (acc ? acc.prov.troops : 0) ? s : acc), null);
  if (!bestSource) return null;
  const power = defenseMultiplier(prov) * Math.max(1, sectorGuard(prov));
  const available = bestSource.prov.troops;
  const needed = power * 1.25 + 2;
  if (available < needed) return null;
  const share = prov.value / 8;
  const strategic = prov.isCapital ? 3.2 : 1;
  const navalPenalty = bestSource.naval ? 0.85 : 1;
  return {
    prov,
    source: bestSource.prov,
    naval: bestSource.naval,
    score: (prov.fronts.has(nation.id) ? 1.65 : 1) * (1 + share) * strategic * navalPenalty * (1 + (available - needed) / (needed + 8)),
    troops: Math.min(available - 1, Math.max(needed * 1.05, available * 0.32)),
  };
}

function aiMilitary(state, nation) {
  const provs = nationProvinces(state, nation.id);
  if (!provs.length) return;
  // A home garrison can push back an incursion just as the player can by
  // tapping an occupied tile. Don't use every turn to counter-push.
  if (state.rng() < 0.35) {
    for (const p of provs) for (const f of p.fronts.values()) {
      if (quickAttack(state, nation.id, p, 0.25, f.tiles.values().next().value).ok) return 1;
    }
  }
  const atWar = nation.wars.length > 0;
  const aggression = nation.aggression * state.diff.aiAggro;

  const candidates = [];
  for (const prov of provs) {
    const neighbours = prov.neighbours.map((id) => state.provinces[id]);
    for (const target of neighbours) {
      if (target.nationId === nation.id) continue;
      let allowed = false;
      if (target.nationId === null) allowed = true;
      else if (nation.wars.includes(target.nationId)) allowed = true;
      else {
        const relation = relationWith(nation, target.nationId);
        const truce = (nation.truces[target.nationId] || 0) > state.time;
        const isAlly = nation.allies.includes(target.nationId);
        const targetNation = state.nations[target.nationId];
        if (
          !truce &&
          !isAlly &&
          targetNation.alive &&
          relation < 12 &&
          aggression > 0.55 &&
          Math.random() < 0.22 * aggression
        ) {
          if (target.nationId === state.playerNationId && state.time < TUNING.attackGrace) {
            // Give the player a moment to breathe.
          } else {
            declareWar(state, nation.id, target.nationId, { silent: false });
            allowed = true;
          }
        }
      }
      if (!allowed) continue;
      const sources = [{ prov, naval: false }];
      // Naval option.
      if (!prov.coastal || !prov.buildings.port) {
        // still fine for land attacks
      }
      const scored = scoreTarget(state, nation, target, sources);
      if (scored) candidates.push(scored);
    }
    // Naval strikes from ports.
    if (prov.buildings.port > 0) {
      for (const laneId of prov.seaLanes) {
        const target = state.provinces[laneId];
        if (target.nationId === nation.id) continue;
        const atWarTarget = target.nationId === null || nation.wars.includes(target.nationId);
        if (!atWarTarget || !target.coastal) continue;
        if (nation.gold < TUNING.navalCost * 2) continue;
        const scored = scoreTarget(state, nation, target, [{ prov, naval: true }]);
        if (scored) {
          scored.score *= 0.55; // Naval invasions are a bigger commitment.
          candidates.push(scored);
        }
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const attacksThisTurn = atWar ? (Math.random() < 0.35 ? 2 : 1) : 1;
  let launched = 0;
  for (const cand of candidates) {
    if (launched >= attacksThisTurn) break;
    if (cand.source.troops < 4) continue;
    const send = Math.min(cand.troops, cand.source.troops - 0.5);
    if (send < 3) continue;
    if (cand.naval && nation.gold < TUNING.navalCost + 10) continue;
    const result = beginAttack(state, nation.id, cand.source, cand.prov, send, cand.naval);
    if (result.ok) launched += 1;
  }
  return launched;
}

function aiDiplomacy(state, nation) {
  const player = state.player;
  const myPower = nationPower(state, nation.id);

  // Sue for peace when a war is going badly.
  for (const enemyId of [...nation.wars]) {
    const enemy = state.nations[enemyId];
    if (!enemy) continue;
    const ratio = myPower / Math.max(1, nationPower(state, enemyId));
    const losing = ratio < 0.72;
    if (losing && Math.random() < 0.5) {
      if (enemyId === state.playerNationId) {
        if (Math.random() < 0.5) {
          state.pendingDialog = {
            type: 'peace-offer',
            nationId: enemyId,
            text: `${nation.name} sues for peace.`,
          };
        }
      } else {
        makePeace(state, nation.id, enemyId);
      }
    }
  }

  // Court the player when they look unstoppable.
  if (
    player &&
    player.alive !== false &&
    player.id !== nation.id &&
    !nation.wars.includes(player.id) &&
    !nation.allies.includes(player.id) &&
    Math.random() < 0.035
  ) {
    const relation = relationWith(nation, player.id);
    if (relation > 30 && nationPower(state, player.id) > myPower * 1.1) {
      state.pendingDialog = {
        type: 'alliance-offer',
        nationId: nation.id,
        text: `${nation.fullName} proposes an alliance.`,
      };
    }
  }

  // Late-game nuclear aggression.
  if (nation.nukes > 0 && nation.wars.length && Math.random() < 0.45) {
    const targets = state.provinces.filter(
      (p) => p.nationId !== null && nation.wars.includes(p.nationId)
    );
    if (targets.length) {
      const target = targets.sort((a, b) => b.value - a.value)[0];
      launchNuke(state, nation.id, target);
    }
  } else if (hasSilo(state, nation.id) && !nation.buildingNuke && nation.nukes === 0) {
    const provs = nationProvinces(state, nation.id);
    if (provs.length > 10 && nation.gold > 900 && Math.random() < 0.25) {
      startNuke(state, nation.id);
    }
  }
}

export function runAiTurn(state, nation) {
  if (!nation.alive || nation.isPlayer) return;
  aiEconomy(state, nation);
  aiMilitary(state, nation);
  if (Math.random() < 0.55) aiDiplomacy(state, nation);
}

export function aiNationSummary(state, nationId) {
  const nation = state.nations[nationId];
  return {
    army: Math.round(nationArmy(state, nationId) * 1000),
    income: nationIncome(state, nationId),
    provinces: nationProvinces(state, nationId).length,
    power: nationPower(state, nationId),
    wars: nation.wars.slice(),
    allies: nation.allies.slice(),
  };
}

export { pushLog };
