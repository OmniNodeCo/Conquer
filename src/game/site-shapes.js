// World-space site symbols. There are two ink pixels per land parcel. The same
// silhouettes determine what the player sees, hits, and is allowed to build.
export const SITE_STAMPS = {
  // Five ink pixels across: a little gold city dot, not another village sprite.
  city: ['.kkk.', 'knppk', 'kpwwk', 'kwwak', '.kkk.'],
  fort: [   // Crenellated towers, pennant and a dark gate.
    '....kpp....', '....kp.....', '.ok.k..oko.', '.omkoooomo.', '.umumuumuk.',
    '.uouuuuouk.', '.ukumukmuk.', '.uuukkkuuk.', '.uoukskuok.', 'kmmukskummk', 'kkkkkkkkkkk',
  ],
  aa: [     // Twin barrels pointing skyward on a low field carriage.
    '.........ok', '........ouk', '.......ouk.', '.....okuk..', '....oukk...',
    '...oukgk...', '..kdglggk..', '.kdgggdddk.', 'kmmmmmrrrmk', '.kskokoks..', '..kk...kk..',
  ],
  port: [   // A white sail above a blue harbour and a timber pier.
    '.....k.....', '....nk.....', '...nnkn....', '..nnnkon...', '.nnnnkoon..',
    '.....t.....', '.kbaaaaabk.', 'ejjkbttkkje', 'kcccccctttk', '.tk.je..tk.', '.kkjjfe.kk.',
  ],
  factory: [ // Banded stack and a saw-toothed brick works.
    '.......ooo.', '......ko...', '......kvk..', '......kok..', '...k..kvk..',
    '..kak.kbk..', '.kaabkbbbk.', 'kvvvvbaabk.', 'kbppbppbbk.', 'kbrrbsstbk.', 'kkkkkkkkkkk',
  ],
  silo: [   // Red-tipped silver rocket in a reinforced bunker.
    '.....v.....', '....kvk....', '....kok....', '...koonk...', '...konmk...',
    '...kvvbk...', '..ukonmku..', '.ummuuummu.', 'kouukkkumuk', 'kuuuupuupuk', 'kkkkkkkkkkk',
  ],
};

export function siteOrigin(cell, key, gridW) {
  const half = SITE_STAMPS[key].length >> 1;
  return [(cell % gridW) * 2 + 1 - half, Math.floor(cell / gridW) * 2 + 1 - half];
}

// Unique parcel offsets occupied by opaque pixels (transparent corners do not count).
export const SITE_PARCELS = Object.fromEntries(Object.entries(SITE_STAMPS).map(([key, rows]) => {
  const half = rows.length >> 1, offsets = new Map();
  rows.forEach((row, y) => [...row].forEach((ink, x) => {
    if (ink === '.') return;
    const dx = Math.floor((1 + x - half) / 2), dy = Math.floor((1 + y - half) / 2);
    offsets.set(`${dx},${dy}`, [dx, dy]);
  }));
  return [key, [...offsets.values()]];
}));
