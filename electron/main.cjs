// Electron main process for Conquer: Rule the Globe.
const { app, BrowserWindow, ipcMain, dialog, Menu, protocol } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { APP_HOST, readAppFile } = require('./serve.cjs');

const isDev = !app.isPackaged;
let mainWindow = null;

let updater = null;
let updateReady = false;

function sendUpdate(status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update:status', status);
  }
}

// The game is served from a custom "app://" origin instead of file:// so that the
// page has a real, securable origin. A file:// page has an opaque origin, which
// makes `script-src 'self'` in index.html reject the game's module scripts.
const APP_SCHEME = 'app';
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
const APP_ROOT = path.join(__dirname, '..');

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      codeCache: true,
    },
  },
]);

function savePath() {
  return path.join(app.getPath('userData'), 'campaign.json');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 950,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#050c13',
    show: false,
    title: 'Conquer: Rule the Globe',
    icon: path.join(APP_ROOT, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  // This is a single-window game, not a browser. Never hand a URL to the OS.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.loadURL(`${APP_ORIGIN}/index.html`).catch(() => {
    dialog.showErrorBox('Conquer could not open', 'The game files could not be loaded. Please reinstall Conquer.');
    app.quit();
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev && process.env.CONQUER_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.control && input.shift && input.key.toLowerCase() === 'f')) {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      event.preventDefault();
    }
    if (input.key === 'F12' && isDev) {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
}

// Only update checks use the internet; the game itself runs from disk. A portable
// Windows copy must not download the NSIS installer over the standalone exe.
function setupAutoUpdater() {
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_FILE) return;
  try {
    if (process.platform === 'darwin') {
      // MacUpdater proxies downloads through a loopback HTTP server. Squirrel.Mac
      // can consume a static JSON feed and the signed zip directly over HTTPS.
      updater = require('electron').autoUpdater;
      updater.setFeedURL({
        url: `https://github.com/OmniNodeCo/Conquer/releases/latest/download/conquer-mac-${process.arch}.json`,
        serverType: 'json',
      });
    } else {
      updater = require('electron-updater').autoUpdater;
      updater.autoDownload = true;
      updater.autoInstallOnAppQuit = true;
      updater.logger = null;
    }
  } catch (error) {
    console.warn('[conquer] updates unavailable:', error.message);
    updater = null;
    return;
  }

  updater.on('checking-for-update', () => sendUpdate({ state: 'checking' }));
  updater.on('update-available', (info) => sendUpdate({ state: 'available', version: info?.version }));
  updater.on('update-not-available', () => sendUpdate({ state: 'current' }));
  updater.on('download-progress', (progress) =>
    sendUpdate({ state: 'downloading', percent: Math.round(progress?.percent || 0) })
  );
  updater.on('update-downloaded', (info, _notes, releaseName) => {
    updateReady = true;
    sendUpdate({ state: 'ready', version: info?.version || releaseName });
  });
  updater.on('error', (error) => sendUpdate({ state: 'error', message: error.message }));
  // The renderer makes the first check once the footer is listening.
  setInterval(checkForUpdates, 6 * 60 * 60 * 1000).unref();
}

async function checkForUpdates() {
  if (!updater) {
    sendUpdate({ state: 'unsupported', message: process.env.PORTABLE_EXECUTABLE_FILE ? 'portable edition' : 'updates unavailable' });
    return { ok: false, error: 'updater-unavailable' };
  }
  try {
    const result = await updater.checkForUpdates(); // Squirrel.Mac returns void and emits events.
    return { ok: true, version: result?.updateInfo?.version || null };
  } catch (error) {
    sendUpdate({ state: 'error', message: error.message });
    return { ok: false, error: error.message };
  }
}

function buildMenu() {
  const template = [
    {
      label: 'Game',
      submenu: [
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        ...(isDev ? [{ type: 'separator' }, { role: 'toggleDevTools' }] : []),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    protocol.handle(APP_SCHEME, ({ url }) => readAppFile(url, APP_ROOT));
    buildMenu();
    setupAutoUpdater();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

// --------------------------------------------------------------------- IPC
ipcMain.handle('game:save', async (_event, json) => {
  try {
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    await fs.writeFile(savePath(), json, 'utf8');
    return { ok: true, path: savePath() };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('game:load', async () => {
  try {
    const raw = await fs.readFile(savePath(), 'utf8');
    return { ok: true, data: raw };
  } catch (err) {
    if (err.code === 'ENOENT') return { ok: false, error: 'no-save' };
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('game:quit', () => {
  app.quit();
});

ipcMain.handle('game:toggle-fullscreen', () => {
  if (!mainWindow) return false;
  mainWindow.setFullScreen(!mainWindow.isFullScreen());
  return mainWindow.isFullScreen();
});

ipcMain.handle('update:check', checkForUpdates);

ipcMain.handle('update:install', () => {
  if (!updater || !updateReady) return false;
  updater.quitAndInstall();
  return true;
});

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  savePath: savePath(),
}));
