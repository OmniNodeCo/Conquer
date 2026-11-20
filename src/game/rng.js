// Deterministic pseudo-random generator (mulberry32) with convenience helpers.
// Every world in Conquer is reproducible from a single integer seed.

export function makeRng(seed = 1) {
  let a = seed >>> 0;
  const rand = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  rand.range = (min, max) => min + rand() * (max - min);
  rand.int = (min, max) => Math.floor(min + rand() * (max - min + 1));
  rand.pick = (arr) => arr[Math.floor(rand() * arr.length)];
  rand.chance = (p) => rand() < p;
  rand.sign = () => (rand() < 0.5 ? -1 : 1);
  rand.gauss = (mean = 0, sd = 1) => {
    let u = 0;
    let v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  rand.shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  rand.weighted = (items, weightFn) => {
    let total = 0;
    for (const item of items) total += Math.max(0, weightFn(item));
    if (total <= 0) return rand.pick(items);
    let roll = rand() * total;
    for (const item of items) {
      roll -= Math.max(0, weightFn(item));
      if (roll <= 0) return item;
    }
    return items[items.length - 1];
  };

  return rand;
}

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function randomSeed() {
  return (Math.floor(Math.random() * 0xffffffff) ^ Date.now()) >>> 0;
}
