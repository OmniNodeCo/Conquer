// Render the real in-game map to PNG for visual checks.
import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync } from 'node:fs';
import { createGame } from '../src/game/state.js';
import { MapView } from '../src/game/render.js';

const seed = Number(process.argv[2] || 20261120);
const W = Number(process.argv[3] || 1600);
const H = Number(process.argv[4] || 900);
const state = createGame({ seed, playerNationId: 0, difficulty: 'normal' });
const canvas = createCanvas(W, H);
const view = new MapView(canvas, { surface: (w, h) => createCanvas(w, h), dpr: 1 });
view.resize(W, H, 1);
const t0 = Date.now();
view.setWorld(state.world);
console.log('prerender', Date.now() - t0, 'ms');
view.draw(state, { time: 12, selectedId: 4, hoveredId: 9 });
writeFileSync('tmp-map.png', canvas.toBuffer('image/png'));
console.log('wrote tmp-map.png');
