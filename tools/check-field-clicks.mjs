// Screen-coordinate regressions in the real, paused UI. The same visible pixel
// changes flag during each scenario: never decide construction AFTER combat.
import { createGame, build, canBuild, update } from '../src/game/state.js';
import { cellAt, cellCenter } from '../src/game/worldgen.js';
import { tileOwner } from '../src/game/fronts.js';

export function checkFieldClicks(app, assert, saveFrame) {
  const s = createGame({ seed: 424242 });
  s.player.gold = 2000;
  for (const n of s.nations) n.ai.nextDecision = Infinity;
  const home = s.provinces.find(p => p.nationId === 0 && p.neighbours.some(i => s.provinces[i].nationId !== 0));
  const away = s.provinces[home.neighbours.find(i => s.provinces[i].nationId !== 0)];
  home.troops = 100;
  const fort = build(s, 0, home, 'fort').site;
  app.adoptState(s);
  const { view, world } = app, canvas = view.canvas;
  const arm = key => document.querySelector(`#bb-slots [data-key="${key}"]`).click();
  const at = cell => view.worldToScreen(...cellCenter(world, cell));
  const tap = ([clientX, clientY]) => {
    for (const type of ['pointerdown', 'pointerup']) {
      canvas.dispatchEvent(new window.MouseEvent(type, { clientX, clientY, button: 0, bubbles: true }));
    }
  };

  arm('fort');
  view.focusProvince(home, 2, fort.cell);
  const [x, y] = cellCenter(world, fort.cell), u = world.pixel / 2;
  let roof, raw;
  for (let dy = -5; dy <= 5 && !roof; dy++) for (let dx = -5; dx <= 5 && !roof; dx++) {
    const wx = x + (dx+.5)*u, wy = y + (dy+.5)*u, cell = cellAt(world, wx, wy);
    if (cell !== fort.cell && world.provinceAt[cell] === home.id && view.atlas.siteAtPoint(home, wx, wy) === fort) {
      raw = cell; roof = view.worldToScreen(wx, wy);
    }
  }
  assert(!!roof, 'found an opaque part of the castle on a different parcel than its anchor');
  home.fronts.set(1, { tiles: new Set([raw]), troops: .1 });
  const gold = s.player.gold;
  app.updateHover(...roof);
  assert(view.plotCursor?.valid === false && view.plotCursor.cell === raw, 'occupied roof shows the no-build cross on the raw parcel');
  tap(roof);
  assert(tileOwner(home, raw) === 0 && s.player.stats.troopsLost > 0, 'clicking the occupied roof sends a counterattack, not a selection');
  assert(fort.level === 1 && s.player.gold === gold && s.expeditions.length === 0, 'retaking the roof cannot upgrade it on the same click');
  app.updateHover(...roof);
  assert(view.plotCursor?.valid && view.plotCursor.cell === fort.cell, 'that same roof becomes an upgrade target once reclaimed');
  tap(roof);
  assert(fort.level === 2 && s.expeditions.at(-1)?.aim === raw, 'next click upgrades the anchor but sends its column to the clicked parcel');

  // A held camp is still in a foreign administration. The final tribal parcel
  // would be a legal city site after capture, making this a meaningful check.
  away.nationId = 0;
  const finalTile = canBuild(s, 0, away, 'city').cell;
  const camp = away.cells.find(i => i !== finalTile);
  away.nationId = null; away.troops = .5;
  away.fronts.set(0, { tiles: new Set([camp]), troops: 2 });
  arm('city');
  view.focusProvince(away, 1.6, camp);
  const treasury = s.player.gold;
  tap(at(camp));
  assert(away.nationId === null && away.fronts.get(0).tiles.size > 1 && !away.sites.length && s.player.gold === treasury,
    'clicking a friendly-coloured foothold presses the front without placing a city abroad');
  away.fronts.get(0).tiles = new Set(away.cells.filter(i => i !== finalTile));
  view.focusProvince(away, 2.25, finalTile);
  tap(at(finalTile));
  assert(away.nationId === 0 && away.sites.length === 0 && s.player.gold === treasury,
    'the click capturing the final neutral tile cannot also authorize a project there');
  tap(at(finalTile));
  assert(away.sites[0]?.key === 'city' && away.sites[0].cell === finalTile && s.expeditions.at(-1).aim === finalTile,
    'the next click on newly administered soil can both send troops and build the gold city dot');

  const orders = () => [s.player.gold, s.expeditions.length, s.landRevision, s.player.stats.troopsLost].join();
  const before = orders();
  app.ui.openLandFinder(); tap(at(finalTile)); app.ui.closeModal();
  assert(orders() === before, 'no map order leaks through an open land finder');
  view.focusProvince(away, 2, 0); // open ocean in the middle of the viewport
  tap(at(0));
  assert(orders() === before && document.getElementById('hint-bar').textContent.includes('water'), 'water never builds or dispatches soldiers');
  app.cancelBuildMode();

  view.focusProvince(away, 2.25, finalTile);
  s.paused = false; update(s, .5); s.paused = true;
  s.effects = []; // inspect the persistent dot and marching columns without a capture flash
  view.draw(s, { time: 1, selectedId: away.id, showLabels: true, showTroops: true });
  saveFrame();
}
