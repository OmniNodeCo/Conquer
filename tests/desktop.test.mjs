// Desktop shell tests: packaging config, icon assets, bundle graph and the
// app:// path resolver used by electron/main.cjs. Runs on plain Node — no
// Electron binary or display server required.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { resolveAppPath } = require('../electron/serve.cjs');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const signature = (file) => fs.readFileSync(file).subarray(0, 8);

test('package metadata points at a real Electron entry point', () => {
  assert.equal(pkg.main, 'electron/main.cjs');
  assert.equal(pkg.type, 'module', 'type: module keeps src/game/*.js working as ESM');
  assert.ok(fs.existsSync(path.join(ROOT, pkg.main)), 'main file must exist');
  assert.equal(pkg.build.appId, 'com.conquerstudio.ruletheglobe');
  assert.equal(pkg.build.productName, 'Conquer Rule the Globe');
});

test('electron entry points parse and stay sandboxed', () => {
  for (const file of ['electron/main.cjs', 'electron/preload.cjs', 'electron/serve.cjs']) {
    execFileSync(process.execPath, ['--check', path.join(ROOT, file)], { stdio: 'pipe' });
  }
  const main = fs.readFileSync(path.join(ROOT, 'electron/main.cjs'), 'utf8');
  assert.match(main, /contextIsolation: true/);
  assert.match(main, /nodeIntegration: false/);
  assert.match(main, /sandbox: true/);
  assert.match(main, /registerSchemesAsPrivileged/);
  assert.match(main, /requestSingleInstanceLock/);
  assert.match(main, /did-fail-load/, 'file:// fallback must be wired up');

  const preload = fs.readFileSync(path.join(ROOT, 'electron/preload.cjs'), 'utf8');
  for (const channel of ['game:save', 'game:load', 'game:quit', 'game:toggle-fullscreen', 'app:info']) {
    assert.ok(main.includes(channel) && preload.includes(channel), `missing IPC channel ${channel}`);
  }
});

test('app:// resolver keeps requests inside the bundle root', () => {
  assert.equal(resolveAppPath('/', ROOT), path.join(ROOT, 'index.html'));
  assert.equal(resolveAppPath('/index.html', ROOT), path.join(ROOT, 'index.html'));
  assert.equal(resolveAppPath('/src/game/main.js', ROOT), path.join(ROOT, 'src/game/main.js'));
  assert.equal(resolveAppPath('/assets/title-art.jpg', ROOT), path.join(ROOT, 'assets/title-art.jpg'));

  // Traversal attempts must never escape the root directory.
  for (const attack of ['/../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/src/../../secrets']) {
    const resolved = resolveAppPath(attack, ROOT);
    assert.ok(resolved === null || resolved.startsWith(ROOT + path.sep), `${attack} escaped the bundle`);
  }
  assert.equal(resolveAppPath('/bad%zz', ROOT), null);
  assert.equal(resolveAppPath('', ROOT), null);
  assert.equal(resolveAppPath(undefined, ROOT), null);
});

test('every asset referenced by index.html ships with the app', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((url) => !/^(https?:|data:|#|mailto:)/.test(url));
  assert.ok(refs.length >= 2, 'expected at least a stylesheet and a script reference');
  for (const ref of refs) {
    assert.ok(fs.existsSync(path.join(ROOT, ref)), `index.html references missing file: ${ref}`);
  }
});

test('the ES module graph from main.js resolves to real files', () => {
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = fs.readFileSync(file, 'utf8');
    for (const m of source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      const next = path.resolve(path.dirname(file), m[1]);
      assert.ok(fs.existsSync(next), `${path.relative(ROOT, file)} imports missing ${m[1]}`);
      walk(next);
    }
  };
  walk(path.join(ROOT, 'src/game/main.js'));
  assert.ok(seen.size >= 12, `expected the whole engine graph, walked ${seen.size} modules`);
  for (const file of seen) {
    assert.ok(!file.includes('node_modules'), 'game code must not depend on node_modules at runtime');
  }
});

test('build config asks for a signed Windows and macOS release', () => {
  const win = pkg.build.win;
  assert.equal(win.signtoolOptions.publisherName, 'Conquer Studio');
  assert.equal(win.signAndEditExecutable, true);
  assert.ok(win.target.some((t) => t.target === 'nsis'), 'needs an installer target');
  assert.ok(win.icon.endsWith('icon.ico'));

  const mac = pkg.build.mac;
  assert.equal(mac.hardenedRuntime, true);
  assert.equal(mac.gatekeeperAssess, false);
  assert.ok(mac.entitlements && fs.existsSync(path.join(ROOT, mac.entitlements)), 'mac entitlements file missing');
  assert.ok(mac.icon.endsWith('icon.icns'));
  const plist = fs.readFileSync(path.join(ROOT, mac.entitlements), 'utf8');
  assert.match(plist, /<plist/, 'entitlements must be a plist');
  assert.match(plist, /com\.apple\.security\.cs\.allow-jit/);
});

test('the pixel skin ships self-hosted fonts', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/styles/main.css'), 'utf8');
  for (const family of ['Pixelify Sans', 'VT323', 'Silkscreen']) {
    assert.ok(css.includes(`font-family: '${family}'`), `missing @font-face for ${family}`);
  }
  const refs = [...css.matchAll(/url\('\.\.\/\.\.\/(assets\/fonts\/[^']+)'\)/g)].map((m) => m[1]);
  assert.ok(refs.length >= 4, `expected self-hosted font files, found ${refs.length}`);
  for (const ref of refs) {
    const file = path.join(ROOT, ref);
    assert.ok(fs.existsSync(file), `missing font file ${ref}`);
    assert.equal(fs.readFileSync(file).subarray(0, 4).toString('latin1'), 'wOF2', `${ref} is not a woff2`);
  }
  // No remote font/CDN references anywhere: the game must run offline.
  assert.ok(!/https?:\/\//.test(css), 'stylesheet must not fetch anything remotely');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /default-src 'self'/, 'CSP default-src must cover font-src');
});

test('icon assets exist with valid headers', () => {
  const ico = path.join(ROOT, pkg.build.win.icon);
  const icns = path.join(ROOT, pkg.build.mac.icon);
  const png = path.join(ROOT, 'build/icon-1024.png');

  assert.deepEqual([...signature(ico).subarray(0, 4)], [0x00, 0x00, 0x01, 0x00], 'ICO header');
  assert.equal(signature(icns).subarray(0, 4).toString('latin1'), 'icns', 'ICNS magic');
  assert.deepEqual([...signature(png).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'PNG signature');

  // ICO directory must advertise the Windows-required 256px entry.
  const buf = fs.readFileSync(ico);
  const count = buf.readUInt16LE(4);
  const sizes = [];
  for (let i = 0; i < count; i += 1) {
    const entry = 6 + i * 16;
    sizes.push(buf[entry] === 0 ? 256 : buf[entry]);
  }
  assert.ok(sizes.includes(256), `ICO needs a 256px entry, got ${sizes.join(',')}`);
  assert.ok(sizes.includes(16) && sizes.includes(32) && sizes.includes(48));
});

test('the footer version and the package version cannot drift', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const meta = html.match(/<meta name="app-version" content="([^"]+)"/);
  assert.ok(meta, 'index.html needs an app-version meta tag');
  assert.equal(meta[1], pkg.version, 'app-version meta must match package.json');
});

test('auto-updates are wired to the GitHub releases', () => {
  assert.ok(pkg.dependencies['electron-updater'], 'electron-updater must be a runtime dependency');
  assert.ok(!pkg.devDependencies['electron-updater'], 'it cannot live in devDependencies or packaging drops it');
  const [provider] = pkg.build.publish || [];
  assert.ok(provider, 'build.publish is required for update metadata');
  assert.equal(provider.provider, 'github');
  assert.equal(provider.owner, 'OmniNodeCo');
  assert.equal(provider.repo, 'Conquer');

  const main = fs.readFileSync(path.join(ROOT, 'electron/main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(ROOT, 'electron/preload.cjs'), 'utf8');
  for (const channel of ['update:check', 'update:install', 'update:status']) {
    assert.ok(main.includes(channel) && preload.includes(channel), `missing updater channel ${channel}`);
  }
  assert.match(main, /require\('electron-updater'\)/, 'main process must load the updater');
  assert.match(main, /quitAndInstall/, 'the shell must be able to install an update');
  assert.match(preload, /onUpdateStatus/, 'the renderer needs update events');
  // The updater is optional at runtime: a missing module must not break the game.
  assert.match(main, /try \{[\s\S]{0,200}electron-updater/);
});

test('the electron-builder config validates against its own schema', () => {
  // electron-builder ships the JSON schema it enforces at pack time. Catching a
  // bad key here is much cheaper than catching it in a release build.
  const schemaPath = path.join(ROOT, 'node_modules/app-builder-lib/scheme.json');
  if (!fs.existsSync(schemaPath)) return; // dependencies not installed yet
  const Ajv = require('ajv');
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  const ok = validate(pkg.build);
  assert.ok(ok, `invalid build config: ${JSON.stringify(validate.errors?.slice(0, 4))}`);
  // publisherName only exists inside signtoolOptions in electron-builder 26.
  assert.equal(pkg.build.win.publisherName, undefined);
});

test('the portable executable launcher is self-contained', () => {
  const launcher = fs.readFileSync(path.join(ROOT, 'desktop/launcher.mjs'), 'utf8');
  assert.match(launcher, /Bun\.serve/, 'the launcher hosts the game itself');
  assert.match(launcher, /'--no-open'/, 'headless mode is needed for smoke tests');
  assert.match(launcher, /4317/, 'a stable default port keeps save data on one origin');
  assert.match(launcher, /font\/woff2/, 'fonts must be served with the right type');
  assert.match(launcher, /--app=\$\{url\}/, 'opens an app-style browser window');

  const builder = fs.readFileSync(path.join(ROOT, 'tools/build-exe.mjs'), 'utf8');
  assert.match(builder, /bun-windows-x64/, 'cross-builds a Windows executable');
  assert.match(builder, /bun-linux-x64/, 'builds a Linux executable');
  assert.match(builder, /base64/, 'assets are embedded in the binary');
  assert.ok(pkg.scripts['build:exe'], 'npm run build:exe must exist');
  assert.ok(pkg.scripts['get:bun'], 'npm run get:bun must exist');
});

test('packaged file list covers source, assets and the electron shell', () => {
  const files = pkg.build.files;
  for (const required of ['index.html', 'src/**/*', 'electron/**/*', 'assets/**/*']) {
    assert.ok(files.includes(required), `build.files must include ${required}`);
  }
  assert.ok(files.every((glob) => !glob.startsWith('tests/')), 'tests should not ship');
  assert.equal(pkg.build.directories.buildResources, 'build');
});
