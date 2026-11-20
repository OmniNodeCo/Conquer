// Headless simulation smoke test / balance probe.
import { createGame, update, worldShare, nationArmy, nationIncome } from '../src/game/state.js';

const seed = Number(process.argv[2] || 20261120);
const minutes = Number(process.argv[3] || 15);
const t0 = Date.now();
const state = createGame({ seed, playerNationId: 0, difficulty: 'normal' });
console.log('world generated in', Date.now() - t0, 'ms;', state.provinces.length, 'provinces');

// Let the player's nation be driven by the AI too, for a full picture.
state.player.isPlayer = false;
state.player.ai = state.player.ai || { nextDecision: 2 };
state.player.ai.nextDecision = 2;
const playerId = 0;

const dt = 0.1;
const steps = Math.round((minutes * 60) / dt);
for (let i = 0; i < steps; i += 1) {
  if (i % 600 === 0) state.player.ai.nextDecision = 1; // keep player nation moving
  update(state, dt);
  if (state.gameOver) {
    console.log('game over at t=', state.time.toFixed(0), state.gameOver);
    break;
  }
}
state.player.isPlayer = true;

const owned = state.provinces.filter((p) => p.nationId === playerId).length;
const alive = state.nations.filter((n) => n.alive);
console.log('sim', Date.now() - t0, 'ms; t=', state.time.toFixed(0), 's');
console.log('player provinces', owned, 'share', (owned / state.provinces.length * 100).toFixed(1) + '%');
console.log('player army', Math.round(nationArmy(state, playerId) * 1000), 'income', nationIncome(state, playerId).toFixed(2), 'gold', state.nations[playerId].gold.toFixed(0));
console.log('nations alive', alive.length, '/', state.nations.length);
console.log('neutral provinces', state.provinces.filter((p) => p.nationId === null).length);
const top = alive
  .map((n) => ({ n, c: state.provinces.filter((p) => p.nationId === n.id).length }))
  .sort((a, b) => b.c - a.c)
  .slice(0, 6);
console.log('top nations', top.map((t) => `${t.n.name}:${t.c}`).join(', '));
console.log('battles', state.stats.battlesWon + state.stats.battlesLost, 'wars now', state.nations.reduce((a, n) => a + n.wars.length, 0) / 2);
console.log('log sample');
for (const entry of state.log.slice(0, 12)) console.log(' ', entry.type.padEnd(9), entry.text);
