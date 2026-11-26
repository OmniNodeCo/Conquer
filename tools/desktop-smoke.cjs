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
      app.exit(0);
    } catch (error) { fail(error); }
  });
});
require(path.join(bundle, 'electron/main.cjs'));
