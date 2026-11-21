// Produces a runnable browser build of the game in release/web plus a tarball.
// The desktop installers are built by electron-builder (see .github/workflows/
// build.yml); this target is what you can build and check without the Electron
// binary, and it doubles as a store-page demo build.
import { cp, mkdir, rm, writeFile, readFile, copyFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'release', 'web');
const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

for (const entry of ['index.html', 'src', 'assets']) {
  await cp(path.join(ROOT, entry), path.join(OUT, entry), { recursive: true });
}

await mkdir(path.join(OUT, 'scripts'), { recursive: true });
await copyFile(path.join(ROOT, 'scripts', 'dev-server.mjs'), path.join(OUT, 'scripts', 'serve.mjs'));

await writeFile(
  path.join(OUT, 'README.txt'),
  `Conquer: Rule the Globe ${version} — browser build

Run it:

  node scripts/serve.mjs      (then open http://localhost:5173)
  PORT=9000 node scripts/serve.mjs

A plain static server works too — it must be served over http(s), because the
game is an ES-module app and browsers refuse module scripts on file:// URLs.

The desktop installers are built by .github/workflows/build.yml and published
by .github/workflows/release.yml.
`,
  'utf8'
);

// Report what actually landed in the bundle.
async function walk(dir) {
  const out = [];
  for (const entry of await (await import('node:fs/promises')).readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}
const files = await walk(OUT);
let bytes = 0;
for (const f of files) bytes += (await stat(f)).size;

const tarball = path.join(ROOT, 'release', `conquer-web-${version}.tar.gz`);
if (existsSync(tarball)) await rm(tarball);
try {
  execFileSync('tar', ['-czf', tarball, '-C', OUT, '.'], { stdio: 'pipe' });
} catch (err) {
  console.warn('tar unavailable, skipping archive:', err.message);
}

console.log(`web build: ${files.length} files, ${(bytes / 1024).toFixed(0)} KB -> release/web`);
if (existsSync(tarball)) {
  const size = (await stat(tarball)).size;
  console.log(`archive:   release/conquer-web-${version}.tar.gz (${(size / 1024).toFixed(0)} KB)`);
}
