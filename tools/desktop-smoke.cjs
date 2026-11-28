// CI-only Electron entry. Boot the shipped main/preload/renderer from app.asar,
// with a fresh profile and network requests blocked. No automation/debug port.
const { app, session } = require('electron');
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const bundle = path.resolve(process.argv.at(-1));
app.setPath('userData', mkdtempSync(path.join(tmpdir(), 'conquer-smoke-')));
function fail(error) {
  console.error(error);
  if (process.env.GITHUB_ACTIONS) {
    const msg = String(error).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
    console.error(`::error title=Offline campaign startup::${msg}`);
  }
  app.exit(1);
}
setTimeout(() => fail('Timed out waiting for the desktop game'), 45000);
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (req, done) => {
    done({ cancel: true });
    fail(`Unexpected network request: ${req.url}`);
  });
});
app.once('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', async () => {
    try {
      assert.equal(win.webContents.getURL(), 'app://conquer/index.html');
      const state = await win.webContents.executeJavaScript('({ desktop: window.desktop?.isDesktop, screen: window.__app?.screen })');
      assert.deepEqual(state, { desktop: true, screen: 'title' });
      // Drive the bundled UI, not an external browser or a test-only app API.
      // Map generation is asynchronous; wait for the actual screen transition.
      const choices = await win.webContents.executeJavaScript(`new Promise(resolve => {
        const nations = document.getElementById('screen-nations');
        const observer = new MutationObserver(() => {
          if (nations.classList.contains('hidden')) return;
          observer.disconnect();
          resolve(nations.querySelectorAll('.nation-card').length);
        });
        observer.observe(nations, { attributes: true, attributeFilter: ['class'] });
        document.getElementById('btn-new').click();
      })`);
      assert.ok(choices > 1, 'New Campaign must offer a choice of nations');
      const started = await win.webContents.executeJavaScript(`
        document.getElementById('btn-start').click();
        window.__app.screen === 'game' && window.__app.state?.started === true &&
          !document.getElementById('hud').classList.contains('hidden')
      `);
      assert.equal(started, true, 'Begin Campaign must open the playable map');
      console.log('Packaged game opened its title screen and started a campaign offline.');
      const located = await win.webContents.executeJavaScript(`(() => {
        const city = document.querySelector('#inspector [data-action="build"][data-key="city"]:enabled');
        if (!city) return false;
        city.click();
        document.getElementById('player-chip').click();
        const site = document.querySelector('#atlas-results .atlas-sites button');
        if (!site || !site.textContent.includes('City')) return false;
        site.click();
        return document.getElementById('modal-root').classList.contains('hidden') &&
          !document.getElementById('inspector').classList.contains('hidden');
      })()`);
      assert.equal(located, true, 'The bundled land finder must locate a newly constructed city');
      console.log('Built a city and located its site from the realm atlas.');
      // The finder centres the actual parcel in the viewport. Send native mouse
      // input through Chromium, not a call to the simulation or a fake DOM click.
      const point = await win.webContents.executeJavaScript(`(() => {
        if (!window.__app.state.paused) document.getElementById('btn-pause').click();
        const x = Math.round(innerWidth / 2), y = Math.round(innerHeight / 2);
        if (document.elementFromPoint(x, y)?.id !== 'map') throw Error('The located city is covered by the HUD');
        return { x, y };
      })()`);
      win.focus();
      for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, ...point, button: 'left', clickCount: 1 });
      const sent = await win.webContents.executeJavaScript(`new Promise(resolve => {
        const game = window.__app, hint = document.getElementById('hint-bar');
        const delivered = () => game.state.expeditions.filter(e => e.kind === 'march' &&
          e.aim === game.view.locator.cell && e.troops > 0).length === 1;
        if (delivered()) return resolve(true);
        const watch = new MutationObserver(() => { if (delivered()) { watch.disconnect(); resolve(true); } });
        watch.observe(hint, { childList: true });
        setTimeout(() => { watch.disconnect(); resolve(delivered()); }, 5000);
      })`);
      assert.equal(sent, true, 'A primary click on the packaged map must send an army to the city');
      console.log('One native map click dispatched a reinforcement column offline.');
      app.exit(0);
    } catch (error) { fail(error); }
  });
});
require(path.join(bundle, 'electron/main.cjs'));
