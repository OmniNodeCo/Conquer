// Electron main process for Conquer: Rule the Globe.
const { app, BrowserWindow, ipcMain, shell, Menu, protocol, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { resolveAppPath } = require('./serve.cjs');

const isDev = !app.isPackaged;
let mainWindow = null;

// The game is served from a custom "app://" origin instead of file:// so that the
// page has a real, securable origin. A file:// page has an opaque origin, which
// makes `script-src 'self'` in index.html reject the game's module scripts.
const APP_SCHEME = 'app';
const APP_HOST = 'conquer';
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
const APP_ROOT = path.join(__dirname, '..');

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
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
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
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

  mainWindow.loadURL(`${APP_ORIGIN}/index.html`);

  // If the custom protocol somehow fails (e.g. an unusual packaging layout),
  // fall back to plain file:// loading rather than showing a blank window.
  let fellBack = false;
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || fellBack) return;
    if (!validatedURL.startsWith(`${APP_ORIGIN}/`)) return;
    fellBack = true;
    console.error(`[conquer] app:// load failed (${errorCode} ${errorDescription}); falling back to file://`);
    mainWindow.loadFile(path.join(APP_ROOT, 'index.html'));
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev && process.env.CONQUER_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
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

// Serve the game bundle from APP_ROOT over the app:// scheme.
function serveAppFiles() {
  protocol.handle(APP_SCHEME, async (request) => {
    try {
      const { host, pathname } = new URL(request.url);
      if (host !== APP_HOST) return new Response('Not found', { status: 404 });

      const target = resolveAppPath(pathname, APP_ROOT);
      if (!target) return new Response('Forbidden', { status: 403 });
      return await net.fetch(pathToFileURL(target).toString());
    } catch (err) {
      console.error('[conquer] protocol error', err);
      return new Response('Internal error', { status: 500 });
    }
  });
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

  app.whenReady().then(async () => {
    serveAppFiles();
    buildMenu();
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

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  savePath: savePath(),
}));
