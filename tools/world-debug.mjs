// Debug render of a generated world (used while tuning the generator).
import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync } from 'node:fs';
import { generateWorld } from '../src/game/worldgen.js';

const seed = Number(process.argv[2] || 20261120);
const t0 = Date.now();
const world = generateWorld(seed);
console.log('generated in', Date.now() - t0, 'ms', 'provinces:', world.provinces.length, 'nations:', world.nations.length);
console.log('sea level', world.seaLevel.toFixed(4));
const byTerrain = {};
for (const p of world.provinces) byTerrain[p.terrain] = (byTerrain[p.terrain] || 0) + 1;
console.log(byTerrain);
const sizes = world.provinces.map((p) => p.areaPx).sort((a, b) => a - b);
console.log('province px min/med/max', sizes[0], sizes[Math.floor(sizes.length / 2)], sizes[sizes.length - 1]);
const nb = world.provinces.map((p) => p.neighbours.length);
console.log('neighbours avg', (nb.reduce((a, b) => a + b, 0) / nb.length).toFixed(2), 'min', Math.min(...nb), 'max', Math.max(...nb));
console.log('coastal', world.provinces.filter((p) => p.coastal).length, 'sea lanes avg', (world.provinces.reduce((a, p) => a + p.seaLanes.length, 0) / world.provinces.length).toFixed(2));
console.log('owned provinces', world.provinces.filter((p) => p.nationId !== null).length);

const W = 1920;
const H = 1080;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');
const sx = W / world.width;
const sy = H / world.height;

ctx.fillStyle = '#0b2237';
ctx.fillRect(0, 0, W, H);
ctx.save();
ctx.scale(sx, sy);

// ocean depth
const g = ctx.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, 1600);
g.addColorStop(0, '#123a55');
g.addColorStop(1, '#081a2a');
ctx.fillStyle = g;
ctx.fillRect(0, 0, world.width, world.height);

const terrainColors = {
  plains: '#8aa062', forest: '#577a4d', jungle: '#3f6f4a', desert: '#b79a63',
  steppe: '#93a06a', tundra: '#94a6a8', mountain: '#8d8375', island: '#7f9a6e',
};

for (const prov of world.provinces) {
  const nation = prov.nationId === null ? null : world.nations[prov.nationId];
  const tribe = prov.tribeId === null || prov.tribeId === undefined ? null : world.tribes[prov.tribeId];
  ctx.beginPath();
  for (const ring of prov.parts) {
    ctx.moveTo(ring[0][0], ring[0][1]);
    for (let i = 1; i < ring.length; i += 1) ctx.lineTo(ring[i][0], ring[i][1]);
    ctx.closePath();
  }
  ctx.fillStyle = nation ? nation.color : (tribe ? tribe.color : '#3d4652');
  ctx.fill();
  ctx.strokeStyle = 'rgba(6,10,16,0.55)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
}

// nation name markers
for (const n of world.nations) {
  const cap = world.provinces[n.capitalId];
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.arc(cap.centroid[0], cap.centroid[1], 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(n.name, cap.centroid[0], cap.centroid[1] - 22);
}
ctx.restore();

writeFileSync('/home/user/Conquer/tmp-world.png', canvas.toBuffer('image/png'));
console.log('wrote /home/user/Conquer/tmp-world.png');
