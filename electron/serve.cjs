// Electron's in-process protocol handler reads files from the application bundle
// (including app.asar). It doesn't start a service or use a network socket.
const fs = require('node:fs/promises');
const path = require('node:path');

const APP_HOST = 'conquer';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2',
};

function resolveAppPath(pathname, root) {
  if (!pathname || typeof pathname !== 'string') return null;
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded === '/') decoded = '/index.html';
  if (/[\\:\0]/.test(decoded) || decoded.split('/').includes('..')) return null;
  if (decoded !== '/index.html' && !/^\/(src|assets)\//.test(decoded)) return null;
  return path.join(root, decoded);
}

async function readAppFile(url, root) {
  const { protocol, host, pathname } = new URL(url);
  if (protocol !== 'app:' || host !== APP_HOST) return new Response(null, { status: 404 });
  const file = resolveAppPath(pathname, root);
  if (!file) return new Response(null, { status: 403 });
  try {
    return new Response(await fs.readFile(file), {
      headers: { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' },
    });
  } catch (error) {
    if (!['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code)) throw error;
    return new Response(null, { status: 404 });
  }
}

module.exports = { APP_HOST, resolveAppPath, readAppFile };
