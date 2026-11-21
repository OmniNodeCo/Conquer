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
      console.log('Packaged game opened its title screen in an offline Electron window.');
      app.exit(0);
    } catch (error) { fail(error); }
  });
});
require(path.join(bundle, 'electron/main.cjs'));
