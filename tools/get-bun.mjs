// Downloads the Bun runtime matching this platform into .buntools/node_modules,
// so `npm run build:exe` works without installing Bun globally. Bun is only a
// build tool here — the game's runtime is Electron.
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const VERSION = process.env.BUN_VERSION || '1.4.5';
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
const tag = `${process.platform}-${arch}`;
const pkgName = `@oven/bun-${tag}`;
const ROOT = process.cwd();
const target = path.join(ROOT, '.buntools', 'node_modules', '@oven', `bun-${tag}`);
const bin = path.join(target, 'bin', process.platform === 'win32' ? 'bun.exe' : 'bun');

if (existsSync(bin)) {
  console.log(`bun already present: ${bin}`);
  process.exit(0);
}

// The platform package is published with a restrictive "os"/"cpu" field, so we
// fetch the tarball directly instead of asking npm to install it.
const meta = await fetch(`https://registry.npmjs.org/${pkgName.replace('/', '%2f')}/${VERSION}`).then((r) => {
  if (!r.ok) throw new Error(`registry lookup failed: ${r.status}`);
  return r.json();
});
const tarballUrl = meta.dist.tarball;
console.log(`downloading ${tarballUrl}`);
const res = await fetch(tarballUrl);
if (!res.ok) throw new Error(`download failed: ${res.status}`);
const buf = Buffer.from(await res.arrayBuffer());
const tmp = path.join(os.tmpdir(), `bun-${tag}.tgz`);
await writeFile(tmp, buf);

await mkdir(path.dirname(target), { recursive: true });
await rm(target, { recursive: true, force: true });
execFileSync('tar', ['-xzf', tmp, '-C', path.dirname(target)]);
// npm tarballs unpack into ./package
const unpacked = path.join(path.dirname(target), 'package');
if (existsSync(unpacked)) {
  await rm(target, { recursive: true, force: true });
  execFileSync('mv', [unpacked, target]);
}
await rm(tmp, { force: true });
console.log(`bun ${VERSION} ready at ${bin}`);
