// Miniature atlas. One political parcel is 2×2 ink pixels. All shading, stamps,
// river bends and shorelines live here, in world space, never in a screen filter.
import { TERRAIN } from './worldgen.js';
import { mix, darken, lighten } from './color.js';
import { makeRng } from './rng.js';
import { valueNoise2 } from './noise.js';

const INK = {
  s: '#453e43', t: '#765237', d: '#315349', g: '#528159', l: '#94b66a',
  h: '#d3ca83', r: '#776b6c', m: '#a09a87', n: '#e9e4c9', a: '#c2875c',
  b: '#9a5341', w: '#f4c678', c: '#d3aa73', e: '#4c8590', f: '#a6cfc4',
};
// Transparent dots are intentional negative space: flags and land remain readable.
const STAMPS = {
  pine: ['...l...', '..lg...', '..ggd..', '.lggd..', '..gdd..', '.gggdd.', 'gggdddd', '...ts..'],
  grove: ['..ll.g..', '.lgglgd.', 'lgggggdd', '.ggdgdd.', '..ddddd.', '...tt...', '...tss..'],
  ridge: ['....n....', '...nnm...', '..mnrm...', '..mmrrm..', '.hmmrrrm.', 'hmmrrrrrm', '...rrrss.'],
  palm: ['..lg.g..', 'llgglggd', '.g.tt.dd', 'g..t...d', '...tt...', '....t...', '...hss..'],
  dune: ['....hh..', '..hhcch.', 'hhccaa..', '...aa...'],
  grass: ['l...h.', '.g.hg.', '..g...'],
  stone: ['..nn...', '.mmmr.m', 'mrrr.rr'],
  field: ['..hh..hh', '.hcc.hcc', '.ca..ca.', '........', '.hh..hh.', 'hcc.hcc.', 'ca..ca..'],
  camp: ['..n..', '.nnc.', 'ncstc', 'sssss'],
  cottage: ['...b....', '..aab.t.', '.aaabbb.', 'bbbbsbb.', '.cwwcsc.', '.cstccc.', '.sssss..'],
  keep: ['..w.....', '..s..n..', 'n.s.nmn.', 'mnnnrmr.', 'mwwmrmr.', 'rmmmnmr.', 'rmssmmr.', 'sssssss.'],
  mill: ['.....mr.', '.....rr.', '..c..mr.', '.ababrm.', 'bbbbbbr.', '.cwccwr.', '.stsssr.'],
  wave: ['...f....', '.ee.ffe.'],
  swell: ['....e..', '..ee.ee'],
  sail: ['...n...', '..nn...', '.nnn...', '...t...', 'baaatbb', '.sssss.'],
};
export function stamp(ctx, name, x, y, scale = 1) {
  const rows = STAMPS[name];
  for (let dy = 0; dy < rows.length; dy++) for (let dx = 0; dx < rows[dy].length; dx++) {
    const ink = INK[rows[dy][dx]];
    if (ink) { ctx.fillStyle = ink; ctx.fillRect(x + dx * scale, y + dy * scale, scale, scale); }
  }
}

const SEA = ['#102938', '#163748', '#20495a', '#2d6270', '#42818a', '#70aaa4'];
const OCEAN = -32768;
// Pack the native ImageData byte order, including opaque alpha.
function rgba(hex) {
  const n = parseInt(hex.slice(1), 16);
  return new Uint32Array(new Uint8Array([n >> 16, n >> 8, n, 255]).buffer)[0];
}
const SAND = rgba('#cdbe91'), SELECT = rgba('#ffe6a0'), HOVER = rgba('#e5dfbb');
const biomeStamps = { forest: ['pine', 'grove', 'pine'], jungle: ['palm', 'grove'], mountain: ['ridge', 'ridge', 'stone'],
  plains: ['grass', 'field', 'grass'], steppe: ['grass', 'grass', 'stone'], desert: ['dune', 'dune', 'stone'], tundra: ['stone', 'pine'], island: ['palm', 'grass'] };

export class PixelAtlas {
  constructor(world, surface) {
    this.world = world;
    const { gridW: w, gridH: h, land, elevation, distance } = world;
    this.tiles = surface(w, h);
    this.ctx = this.tiles.getContext('2d');
    this.image = this.ctx.createImageData(w, h);
    this.pixels = new Uint32Array(this.image.data.buffer);
    this.owners = new Int16Array(w * h).fill(OCEAN);
    this.tone = new Uint8Array(w * h);
    this.palettes = new Map();
    const sea = SEA.map(rgba);
    for (let i = 0; i < land.length; i++) {
      // Depth follows the submerged hills as well as distance from shore; broad
      // shelves and deep channels need not be concentric rings around an island.
      const coast = distance[i];
      const bed = Math.max(0, world.seaLevel - elevation[i]);
      const d = coast <= 1 ? coast : coast * .65 + Math.min(coast * .8, bed * 48)
        + Math.min(4, coast * .15) * valueNoise2(i % w / 19, Math.floor(i / w) / 19, world.seed);
      this.pixels[i] = sea[d <= 1 ? 5 : d <= 3 ? 4 : d <= 6 ? 3 : d <= 11 ? 2 : d <= 19 ? 1 : 0];
      if (land[i]) {
        const slope = elevation[i-w] + elevation[i-1] - elevation[i+w] - elevation[i+1];
        this.tone[i] = slope < -0.065 ? 3 : slope < -0.013 ? 2 : slope < 0.035 ? 1 : 0;
      }
    }
    this.scenery = surface(w * 2, h * 2);
    this.paper = surface(w * 2, h * 2);
    this.seats = world.provinces.map(p => {
      const cx = p.centroid[0] / world.pixel, cy = p.centroid[1] / world.pixel;
      const rank = i => (i % w + 0.5 - cx) ** 2 + (Math.floor(i / w) + 0.5 - cy) ** 2;
      return p.cells.reduce((a, b) => rank(a) < rank(b) ? a : b);
    });
    this.wavelets = [];
    this.capitals = new Set(world.nations.map(n => n.capitalId));
    this.illustrate();
  }

  illustrate() {
    const { gridW: w, gridH: h, seed, land, provinceAt, distance, elevation, provinces } = this.world;
    const ctx = this.scenery.getContext('2d'), rng = makeRng(seed ^ 0x4e2d1);
    // Flood *in* from the coast, taking the lowest available pass first. Each
    // cell now has an outlet, including the bottoms of inland depressions. Run
    // rainfall back down those parent links so rivers join and reach the sea.
    const runoff = new Uint32Array(w * h).fill(1);
    const outlet = new Int32Array(w * h).fill(-1);
    const bands = Array.from({ length: 256 }, () => []), order = [];
    const level = i => Math.max(0, Math.min(255, Math.floor((elevation[i] - this.world.seaLevel) * 420)));
    const steps = [-1, -w, 1, w];
    for (const p of provinces) for (const i of p.cells) {
      const shore = steps.find(d => !land[i+d]);
      if (shore !== undefined) { outlet[i] = i+shore; bands[level(i)].push(i); }
    }
    for (let l = 0; l < bands.length; l++) for (const i of bands[l]) {
      order.push(i);
      for (const d of steps) {
        const j = i+d;
        if (land[j] && outlet[j] < 0) { outlet[j] = i; bands[Math.max(l, level(j))].push(j); }
      }
    }
    for (let n = order.length - 1; n >= 0; n--) {
      const i = order[n], j = outlet[i];
      runoff[j] += runoff[i];
      if (runoff[i] < 75) continue;
      const x = i % w * 2 + 1, y = Math.floor(i / w) * 2 + 1;
      const dx = Math.sign(j % w - i % w), dy = Math.sign(Math.floor(j/w) - Math.floor(i/w));
      ctx.fillStyle = '#588c94';
      ctx.fillRect(x, y, 1, 1);
      ctx.fillRect(x+dx, y+dy, 1, 1);
      if (runoff[i] > 220) { ctx.fillStyle = '#81b4ad'; ctx.fillRect(x-dy, y+dx, 1, 1); }
    }
    // Jittered patches, not a wallpaper: relief determines the motif, and a
    // clear margin keeps tree crowns out of the surf and off village roofs.
    for (let by = 4; by < h - 4; by += 6) for (let bx = 4; bx < w - 4; bx += 7) {
      const x = bx + rng.int(-2, 2), y = by + rng.int(-2, 2), i = y*w+x;
      const p = provinces[provinceAt[i]];
      if (!p) {
        if (distance[i] > 3 && rng() < (distance[i] < 12 ? 0.24 : 0.045)) {
          ctx.globalAlpha = distance[i] < 12 ? 0.53 : 0.22;
          stamp(ctx, distance[i] < 12 ? 'wave' : 'swell', x*2, y*2);
          if (distance[i] < 12 && x % 3 === 0) this.wavelets.push([x*2, y*2, (i % 59) / 8]);
          ctx.globalAlpha = 1;
        }
        continue;
      }
      if (rng() > (['forest','jungle','mountain'].includes(p.terrain) ? 0.9 : 0.52)) continue;
      const seat = this.seats[p.id];
      if (Math.abs(seat % w - x) < 4 && Math.abs(Math.floor(seat/w) - y) < 4) continue;
      if ([-2*w-2,-2*w+2,2*w-2,2*w+2].some(d => !land[i+d]) || runoff[i] > 28) continue;
      stamp(ctx, rng.pick(biomeStamps[p.terrain]), x*2-3, y*2-4);
    }
  }

  // A few crests catch the light on different beats. Don't repaint the atlas
  // or animate a full-screen texture to make the shoreline breathe.
  drawTide(ctx, time) {
    const u = this.world.pixel / 2;
    ctx.fillStyle = '#8bbab6';
    for (const [x, y, beat] of this.wavelets) {
      const frame = Math.floor((time + beat) * 2) % 12;
      if (frame < 3) ctx.fillRect((x+frame)*u, y*u, (frame === 1 ? 3 : 1)*u, u);
    }
  }

  drawReplacements(ctx, state, zoom) {
    if (!state.started || zoom < 1) return;
    const u = this.world.pixel / 2, w = this.world.gridW;
    for (const p of state.provinces) {
      if (p.nationId !== state.playerNationId || !p.replacementDue || !state.player.replacementRate) continue;
      const seat = this.seats[p.id];
      const stride = Math.floor(state.time * 3 + p.id) % 6;
      // One little coat and a pair of marching boots, rather than +troops text.
      const x = (seat % w * 2 - 6 + stride) * u, y = (Math.floor(seat / w) * 2 + 2) * u;
      ctx.fillStyle = '#373d41'; ctx.fillRect(x, y-4*u, 2*u, u);
      ctx.fillStyle = '#ebc299'; ctx.fillRect(x+u, y-3*u, u, u);
      ctx.fillStyle = state.player.color; ctx.fillRect(x, y-2*u, 2*u, 2*u);
      ctx.fillStyle = '#353c41'; ctx.fillRect(x+(stride%2)*u, y, u, u);
    }
  }

  palette(p, owner) {
    const key = owner + ':' + p.terrain;
    if (!this.palettes.has(key)) {
      const flag = owner >= 0 ? this.world.nations[owner].color : this.world.tribes[-owner-1]?.color || '#899273';
      const ground = mix(TERRAIN[p.terrain].color, flag, owner >= 0 ? 0.71 : 0.24);
      this.palettes.set(key, [darken(ground, .15), ground, lighten(ground, .07), lighten(ground, .14), darken(ground,.52), darken(ground,.19)].map(rgba));
    }
    return this.palettes.get(key);
  }

  paint(selected, hovered) {
    const { provinces, provinceAt, gridW: w, gridH: h } = this.world;
    const { owners, pixels, tone } = this;
    for (const p of provinces) {
      const id = p.nationId ?? -(1 + p.tribeId);
      for (const i of p.cells) owners[i] = id;
      if (p.fronts) for (const [invader, f] of p.fronts) for (const i of f.tiles) owners[i] = invader;
    }
    for (const p of provinces) {
      const home = p.nationId ?? -(1 + p.tribeId), homePalette = this.palette(p, home);
      for (const i of p.cells) {
        const id = owners[i], pal = id === home ? homePalette : this.palette(p, id);
        const seam = provinceAt[i-1] !== p.id || provinceAt[i-w] !== p.id;
        const outline = seam || provinceAt[i+1] !== p.id || provinceAt[i+w] !== p.id;
        pixels[i] = outline && p.id === selected ? SELECT : outline && p.id === hovered ? HOVER :
          owners[i-w] === OCEAN || owners[i-1] === OCEAN ? SAND :
          id !== owners[i-1] || id !== owners[i-w] ? pal[4] : seam ? pal[5] : pal[tone[i]];
      }
    }
    this.ctx.putImageData(this.image, 0, 0);
    const ctx = this.paper.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.tiles, 0, 0, w*2, h*2);
    ctx.drawImage(this.scenery, 0, 0);
    for (const p of provinces) {
      if (p.fronts) for (const [id, front] of p.fronts) {
        const first = front.tiles.values().next().value;
        const x = first % w * 2, y = Math.floor(first / w) * 2;
        stamp(ctx, 'camp', x-2, y-2);
        ctx.fillStyle = this.world.nations[id].color;
        ctx.fillRect(x, y-3, 3, 1);
      }
      if (p.nationId === null) continue;
      const i = this.seats[p.id], x = i % w * 2, y = Math.floor(i/w)*2;
      const fort = this.capitals.has(p.id) || p.buildings?.fort;
      stamp(ctx, fort ? 'keep' : p.buildings?.factory ? 'mill' : 'cottage', x-3, y-5);
      if (p.buildings?.city) stamp(ctx, 'cottage', x+3, y-2);
      ctx.fillStyle = this.world.nations[owners[i]].color;
      ctx.fillRect(x-1,y-5,3,2);
    }
    return this.paper;
  }
}
