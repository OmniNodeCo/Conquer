// The province owns its unoccupied tiles. A foothold contains only the parcels
// and surviving troops actually taken there; different invaders never share a tile.
export function tileOwner(prov, cell) {
  if (prov.fronts) for (const [id, front] of prov.fronts) if (front.tiles.has(cell)) return id;
  return prov.nationId;
}

export function heldTiles(prov, id) {
  if (id !== prov.nationId) return prov.fronts?.get(id)?.tiles.size || 0;
  let home = prov.areaPx;
  if (prov.fronts) for (const front of prov.fronts.values()) home -= front.tiles.size;
  return home;
}

// Soldiers fight over one sector, not the entire garrison on every tap. As its
// perimeter contracts the remaining defenders are concentrated on less ground.
export function sectorGuard(prov, id = prov.nationId) {
  const troops = id === prov.nationId ? prov.troops : prov.fronts.get(id).troops;
  return troops * Math.min(1, 0.20 * prov.areaPx / Math.max(1, heldTiles(prov, id)));
}

export function advanceTiles(world, source, target, attacker, defender, limit, naval, aim) {
  const w = world.gridW;
  const eligible = target.cells.filter(i => tileOwner(target, i) === defender);
  if (!eligible.length) return [];
  const offsets = [-w, -1, 1, w]; // world generation keeps a sea frame around the grid
  const contact = i => offsets.some(d => {
    const other = world.provinces[world.provinceAt[i + d]];
    return (other === target || other === source) && tileOwner(other, i + d) === attacker;
  });
  let edge = eligible.filter(contact);
  if (!edge.length && naval) edge = eligible.filter(i => offsets.some(d => !world.land[i + d]));
  // Some generated provinces include detached islands or only meet on a diagonal.
  // Finish the reachable pocket first; a later push can land at the nearest remnant.
  if (!edge.length) edge = eligible.filter(i => offsets.some(d => world.provinceAt[i + d] !== target.id));
  if (!edge.length) edge = eligible;
  const aimed = Number.isInteger(aim) && world.provinceAt[aim] === target.id;
  const ax = aimed ? aim % w : source.centroid[0] / world.pixel;
  const ay = aimed ? Math.floor(aim / w) : source.centroid[1] / world.pixel;
  const rank = i => (i % w - ax) ** 2 + (Math.floor(i / w) - ay) ** 2;
  const start = edge.reduce((best, i) => rank(i) < rank(best) ? i : best);
  const open = new Set(eligible);
  const queue = [start];
  open.delete(start);
  for (let n = 0; n < queue.length && queue.length < limit; n++) {
    const i = queue[n];
    // Rotate the sweep on each parcel; no straight rectangular wipe or scattershot dots.
    const turn = ((i ^ world.seed) >>> 2) % 4;
    for (let d = 0; d < 4 && queue.length < limit; d++) {
      const next = i + offsets[(turn + d) % 4];
      if (open.delete(next)) queue.push(next);
    }
  }
  return queue;
}
