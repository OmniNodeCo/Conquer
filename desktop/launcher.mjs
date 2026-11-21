// Portable single-file build: serves the game from an embedded payload and opens
// it in an app-style browser window. Compiled by tools/build-exe.mjs with
// `bun build --compile`, so the shipped executable carries its own runtime and
// needs nothing installed on the target machine.
import { payload, meta } from './payload.js';

const args = process.argv.slice(2);
const noOpen = args.includes('--no-open');
const portArg = args.find((a) => a.startsWith('--port='));
// A stable port keeps localStorage (campaign saves) on the same origin between
// launches; if it is taken we fall back to a random one.
const preferredPort = portArg ? Number(portArg.slice('--port='.length)) : 4317;

const MIME = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  woff2: 'font/woff2',
  woff: 'font/woff',
  txt: 'text/plain; charset=utf-8',
};

const decoded = new Map();
function bodyFor(path) {
  if (!decoded.has(path)) decoded.set(path, Buffer.from(payload[path], 'base64'));
  return decoded.get(path);
}

function handle(request) {
  const url = new URL(request.url);
  let path = decodeURIComponent(url.pathname);
  if (path === '/' || path === '') path = '/index.html';
  const clean = path.replace(/\.\./g, '').replace(/\/+/g, '/');
  if (!payload[clean]) return new Response('Not found', { status: 404 });
  const ext = clean.split('.').pop().toLowerCase();
  return new Response(bodyFor(clean), {
    headers: {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    },
  });
}

let server;
try {
  server = Bun.serve({ hostname: '127.0.0.1', port: preferredPort, fetch: handle });
} catch {
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: handle });
}

const url = `http://127.0.0.1:${server.port}/`;

const WINDOW_ARGS = ['--window-size=1600,950', '--disable-extensions', '--no-first-run'];

function trySpawn(cmd) {
  try {
    Bun.spawn(cmd, { stdout: 'ignore', stderr: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function openWindow() {
  const platform = process.platform;
  if (platform === 'win32') {
    const candidates = [
      `${process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${process.env.ProgramFiles || 'C:\\Program Files'}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${process.env.ProgramFiles || 'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'}\\Google\\Chrome\\Application\\chrome.exe`,
    ];
    for (const exe of candidates) {
      if (trySpawn([exe, `--app=${url}`, ...WINDOW_ARGS])) return true;
    }
    return trySpawn(['cmd', '/c', 'start', '', url]);
  }
  if (platform === 'darwin') {
    if (trySpawn(['open', '-na', 'Google Chrome', '--args', `--app=${url}`, ...WINDOW_ARGS])) return true;
    return trySpawn(['open', url]);
  }
  if (trySpawn(['google-chrome', `--app=${url}`, ...WINDOW_ARGS])) return true;
  if (trySpawn(['chromium', `--app=${url}`, ...WINDOW_ARGS])) return true;
  if (trySpawn(['xdg-open', url])) return true;
  return false;
}

console.log('');
console.log(`  CONQUER: RULE THE GLOBE ${meta.version}`);
console.log(`  Serving the game at ${url}`);
if (noOpen) {
  console.log('  --no-open given: open that address yourself.');
} else if (!openWindow()) {
  console.log('  Could not launch a browser automatically — open the address above.');
}
console.log('  Keep this window open while playing; close it to stop the game.');
console.log('');

process.on('SIGINT', () => {
  server.stop(true);
  process.exit(0);
});
