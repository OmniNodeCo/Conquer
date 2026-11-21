// Builds portable single-file executables: one Windows .exe and one Linux
// binary, each carrying its own JavaScript runtime plus the complete game
// (HTML, modules, fonts, art) embedded as a base64 payload.
//
// Requires Bun (https://bun.sh) to be available. `tools/get-bun.mjs` fetches a
// local copy into .buntools/ so this works without a global install.
import { readFile, writeFile, mkdir, rm, stat, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
const WORK = path.join(ROOT, 'release', 'exe');
const OUT = path.join(ROOT, 'release');

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

function findBun() {
  const candidates = [
    process.env.BUN,
    path.join(ROOT, '.buntools', 'node_modules', '@oven', `bun-${platformTag()}`, 'bin', platformTag() === 'windows-x64' ? 'bun.exe' : 'bun'),
    'bun',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const version = execFileSync(candidate, ['--version'], { encoding: 'utf8' }).trim();
      if (version) return { bin: candidate, version };
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

function platformTag() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return `${process.platform}-${arch}`;
}

const bun = findBun();
if (!bun) {
  console.error('Bun is required to build the portable executables.');
  console.error('Run `node tools/get-bun.mjs` first (downloads Bun into .buntools/).');
  process.exit(1);
}
console.log(`using bun ${bun.version} (${bun.bin})`);

// ---------------------------------------------------------------- payload
await rm(WORK, { recursive: true, force: true });
await mkdir(WORK, { recursive: true });

const entries = [];
for (const dir of ['src', 'assets']) {
  for (const file of await walk(path.join(ROOT, dir))) {
    entries.push(path.relative(ROOT, file).split(path.sep).join('/'));
  }
}
entries.push('index.html');
entries.sort();

const payload = {};
for (const rel of entries) {
  const data = await readFile(path.join(ROOT, rel));
  payload[`/${rel}`] = data.toString('base64');
}
const payloadBytes = Object.values(payload).reduce((sum, b64) => sum + b64.length, 0);

await writeFile(
  path.join(WORK, 'payload.js'),
  `export const meta = ${JSON.stringify({ version: pkg.version, files: entries.length, builtAt: new Date().toISOString() })};\nexport const payload = ${JSON.stringify(payload)};\n`,
  'utf8'
);
await readFile(path.join(WORK, 'payload.js'), 'utf8');
await writeFile(
  path.join(WORK, 'app.js'),
  (await readFile(path.join(ROOT, 'desktop', 'launcher.mjs'), 'utf8')).replace(
    "import { payload, meta } from './payload.js';",
    "import { payload, meta } from './payload.js';"
  ),
  'utf8'
);

console.log(`payload: ${entries.length} files, ${(payloadBytes / 1024).toFixed(0)} KB base64`);

// ------------------------------------------------------------------ builds
const targets = [
  { target: 'bun-windows-x64', file: `${pkg.productName.replace(/[^A-Za-z0-9]+/g, '-')}-${pkg.version}-windows-x64.exe` },
  { target: 'bun-linux-x64', file: `${pkg.productName.replace(/[^A-Za-z0-9]+/g, '-')}-${pkg.version}-linux-x64` },
];

const built = [];
for (const { target, file } of targets) {
  const outfile = path.join(OUT, file);
  await rm(outfile, { force: true });
  execFileSync(bun.bin, ['build', '--compile', `--target=${target}`, path.join(WORK, 'app.js'), '--outfile', outfile], {
    stdio: 'inherit',
    cwd: WORK,
  });
  const info = await stat(outfile);
  built.push({ file, size: info.size, target });
  console.log(`built ${file} (${(info.size / 1024 / 1024).toFixed(1)} MB)`);
}

if (existsSync(path.join(WORK, 'app.js'))) await rm(WORK, { recursive: true, force: true });

for (const { file, size } of built) {
  console.log(`  release/${file}  ${(size / 1024 / 1024).toFixed(1)} MB`);
}
