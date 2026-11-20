// Small, dependency-free value-noise + fBm implementation used for world generation.

function hash2(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 362437);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

export function valueNoise2(x, y, seed = 0) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = fade(x - x0);
  const ty = fade(y - y0);
  const v00 = hash2(x0, y0, seed);
  const v10 = hash2(x0 + 1, y0, seed);
  const v01 = hash2(x0, y0 + 1, seed);
  const v11 = hash2(x0 + 1, y0 + 1, seed);
  const a = v00 + (v10 - v00) * tx;
  const b = v01 + (v11 - v01) * tx;
  return (a + (b - a) * ty) * 2 - 1; // -1..1
}

export function fbm2(x, y, { octaves = 4, lacunarity = 2, gain = 0.5, seed = 0 } = {}) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += amp * valueNoise2(x * freq, y * freq, seed + i * 1013);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

export function ridgedFbm2(x, y, opts = {}) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  const { octaves = 4, lacunarity = 2, gain = 0.5, seed = 0 } = opts;
  for (let i = 0; i < octaves; i += 1) {
    const n = 1 - Math.abs(valueNoise2(x * freq, y * freq, seed + i * 733));
    sum += amp * n * n;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

// Domain-warped fbm: produces coastlines that look eroded rather than blobby.
export function warpedFbm2(x, y, { seed = 0, warp = 2.4, scale = 1, octaves = 5 } = {}) {
  const wx = fbm2(x * 0.6 + 11.3, y * 0.6 - 4.7, { octaves: 3, seed: seed + 91 }) * warp;
  const wy = fbm2(x * 0.6 - 7.1, y * 0.6 + 8.9, { octaves: 3, seed: seed + 137 }) * warp;
  return fbm2((x + wx) * scale, (y + wy) * scale, { octaves, seed });
}
