# Conquer: Rule the Globe

A **desktop** grand-strategy game of world conquest — built with Electron, not Roblox.
Pick a nation, raise armies, invade coastlines, build silos, launch nukes and take
**80% of the globe** before the bots do.

The whole game is offline single-player against 25 AI nations on a procedurally
generated world (26 nations, ~165 provinces, deterministic per seed).

---

## Highlights

- **Procedural earth-like world** — value-noise terrain, marching-squares coastlines,
  rivers, mountain ranges, deserts and tundra. Every campaign has a new map.
- **Pixel-art everything** — the map, the HUD and the title screen share one art
  direction: square corners, flat fills, hard offset shadows, chunky bars and a
  self-hosted bitmap typeface (Pixelify Sans for UI, VT323 for numbers, Silkscreen
  for headings). No gradients, no blur, no rounded corners, no CDN fonts — the
  whole game is offline and self-contained.
- **Pixel-art map** — the political layer is rasterised into a world-anchored block
  grid (one block = 4 world units) and scaled up with smoothing disabled, so
  coastlines, borders and the banded sea stay chunky at every zoom level instead of
  looking like smooth vector drawings. The layer is cached by ownership and only
  rebuilt when the map changes or a takeover is playing.
- **Pixelated takeovers** — capturing a province paints the new flag across it in a
  blocky sweep over ~0.9s, old colours still visible under the advancing edge.
- **Blocky interaction cues** — selection and hover are hard block outlines baked
  into the map layer, attack orders draw as stepped, snapped arrows with marching
  troop blocks, and label plates are square with a hard offset text shadow.
- **26 playable nations** across 3 difficulties, each with a capital, flag, government
  type and AI personality (aggressive / turtle / opportunist / diplomat).
- **Tap to conquer** — a single click on foreign land immediately sends a quarter of
  the strongest army on that border. Clicking again sends another slice; if the
  defenders hold, those men are lost. No slider, no confirmation dialog.
- **Build hotbar** — a bar along the bottom holds every structure (City, Castle,
  Port, Factory, Missile Silo, AA Battery, keys `1`-`6`). Arm a slot, then click
  your own provinces to place; placement stays armed for rapid building and
  disarms itself when you run out of gold.
- **AA batteries** — a new defensive building: each level has a 35% + 25% chance
  (capped at 85%) of shooting an incoming warhead out of the sky, and it stiffens
  the province's defence.
- **Version footer with auto-updates** — the bottom-right corner shows the running
  version and the updater state (checking / update found / downloading / ready).
  Packaged builds query the GitHub Releases published by the release workflow and
  install on restart.
- **Province economy** — tax income, manpower, supply and upkeep, city / port /
  factory / silo construction, recruit & reinforce.
- **Real combat costs** — *every* assault kills soldiers. Even a walkover against a
  token garrison costs ~14% of the men you send; a failed assault loses almost the
  whole force. Casualties are deducted on the click and reported by a single battle
  card (plus one floating `-412` and a feed line) — no toast on top of it.
- **Naval invasions** — coastal provinces with a port can sail troops across sea lanes,
  with travel time and fleet cost.
- **Diplomacy** — declare war, sue for peace, form and break alliances, gift gold;
  the AI negotiates back.
- **Strategic weapons** — build a silo, produce a warhead, target any province from
  your own borders, and erase a garrison.
- **One steady pace** — the clock has a single speed. `Space` pauses and resumes;
  there is no 1× / 2× / 4× multiplier to micromanage.
- **Quiet HUD** — one notification on screen at a time, repeats swallowed, and world
  news only interrupts when your nation is in it. AI drafts no longer spray `+15,000`
  floaters across the map, and far-away AI battles animate as small, dim rings.
- **Persistence** — autosave plus manual save/load; the desktop build writes a real
  `campaign.json` in the OS user-data folder through Electron IPC.

## Controls

| Input | Action |
| --- | --- |
| Click province | Inspect it / select your source province |
| Drag, scroll | Pan, zoom |
| `Space` | Pause / resume (single speed) |
| `1`-`6` | Arm a build hotbar slot |
| Click enemy land | Attack / conquer it |
| `F` | Focus your capital |
| `H` | How to play |
| `Esc` | Deselect, then menu |
| `F11` | Fullscreen |
| `F12` | DevTools (development builds only) |

Attack flow: **click a foreign province** — that is the attack. A quarter of your
strongest bordering army marches immediately (a port province will sail instead).
Click repeatedly to press the assault; the battle card reports the casualties each
time. The inspector still offers a manual slider for a full-commitment attack.

Building: press a hotbar key (`1`-`6`) or click a slot, then click one of your
provinces. `Esc` cancels placement.

| Hotbar | Structure |
| --- | --- |
| `1` | City — income and manpower |
| `2` | Castle — +28% defence per level |
| `3` | AA Battery — intercepts warheads |
| `4` | Port — naval invasions |
| `5` | Factory — cheaper recruits, more income |
| `6` | Missile Silo — unlocks warheads |

## Running it

```bash
npm install          # Electron, electron-builder, jsdom (dev-only test tooling)
npm start            # launch the desktop game
```

Browser-only preview of the same build (handy while iterating on UI):

```bash
npm run dev          # http://localhost:5173
```

## Verification

```bash
npm test             # 27 headless assertions: worldgen, economy, combat, saves, packaging
npm run test:ui      # boots the real index.html in jsdom, plays a full campaign turn
npm run build:web    # browser build in release/web (serve it with scripts/serve.mjs)
```

`npm run test:ui` drives the actual UI — starts a campaign, recruits, builds, attacks,
launches a nuke, saves and reloads — and fails on any console error. It also writes
`tmp-shots/09-jsdom-map.png` (the live pixel map) and `tmp-shots/10-takeover.png`
(a mid-frame capture of the blocky takeover sweep).

> The desktop shell itself (`electron/main.cjs`) cannot be launched in this sandbox:
> downloading the Electron binary is blocked here. Everything it depends on — the
> bundle graph, the `app://` file server, the IPC channel names, the packaging config
> and the icon assets — is covered by `tests/desktop.test.mjs`.

## Packaging

```bash
npm run pack         # unpacked app in release/ (fast smoke test)
npm run dist:win     # NSIS installer + zip  (build/icon.ico)
npm run dist:mac     # DMG, x64 + arm64, hardened runtime (build/icon.icns)
npm run dist:linux   # AppImage + deb
npm run build:web    # runnable browser build -> release/web + release/*.tar.gz
npm run get:bun      # fetch the Bun build tool into .buntools/ (once)
npm run build:exe    # portable single-file executables (.exe + Linux binary)
npm run icons        # rebuild PNG/ICO/ICNS from assets/icon-pixel-src.png
```

The `build` block in `package.json` is validated against electron-builder's own
JSON schema by `npm test` (this is how the `win.publisherName` → `signtoolOptions`
migration was caught), so a bad packaging key fails in CI rather than at release
time.

The game is served from a custom **`app://conquer/`** origin instead of `file://`.
A `file://` page has an opaque origin, which makes the strict CSP in `index.html`
(`script-src 'self'`) reject the game's ES modules; a registered standard, secure
scheme gives the page a real origin while still shipping as a plain static bundle.
If the scheme ever fails to load, `main.cjs` falls back to `loadFile()`.

## Auto-updates

`electron/main.cjs` wires `electron-updater` to the GitHub Releases that the
release workflow produces (`build.publish` → `OmniNodeCo/Conquer`). In a packaged
build the app checks a few seconds after launch and then every six hours, streams
progress to the renderer over the `update:status` channel, and shows the result in
the bottom-right footer:

| Footer | Meaning |
| --- | --- |
| `up to date` | running the newest release |
| `update v1.2.0 found` / `downloading update 42%` | fetching in the background |
| `v1.2.0 ready` + **RESTART TO UPDATE** | downloaded, `quitAndInstall` on click |
| `update check failed` | network/API problem — the game keeps running |
| `browser build` | not packaged (or updater missing), so no self-update |

The updater module is loaded inside a `try`/`catch`, so a source checkout without
production dependencies still runs; it simply reports `browser build`. Versions
must be bumped in **both** `package.json` and the `app-version` meta tag in
`index.html` — a test fails if the two drift apart.

## Portable executables

`npm run get:bun && npm run build:exe` produces two dependency-free binaries:

| File | Size | Runs on |
| --- | --- | --- |
| `release/Conquer-Rule-the-Globe-1.0.0-windows-x64.exe` | ~112 MB | Windows 10/11 x64, no install |
| `release/Conquer-Rule-the-Globe-1.0.0-linux-x64` | ~106 MB | Linux x64, no install |

Each one carries its own JavaScript runtime (Bun) plus the entire game — HTML,
ES modules, fonts and artwork — embedded as a base64 payload. Launching it starts
a private HTTP server on `127.0.0.1:4317` (a fixed port so campaign saves keep the
same localStorage origin), then opens an app-style browser window
(`msedge --app=` / `chrome --app=` / `xdg-open`). `--no-open` serves headlessly and
`--port=N` overrides the port, which is what CI's smoke test uses.

These are a **portable fallback**, not the Electron product: no installer, no code
signature, and it needs a Chromium-based browser to draw the window. The signed
Electron installers are built by `release.yml`; the portable binaries are built by
the `portable` job there too, and attached to the same GitHub Release.

Why both exist: Electron's binary downloads (and therefore `electron-builder`) are
blocked in this sandbox, so the portables are the executables that can actually be
produced here — verified by launching the Linux build and hashing every served
file against the repository.

## Releasing

`.github/workflows/release.yml` is the whole pipeline. It runs on every `v*` tag
push (and on demand via *Run workflow*):

1. **Verify** — `npm ci`, `npm test`, `npm run test:ui` on Ubuntu; the rendered
   map frames are uploaded as an artifact.
2. **Build** — a three-way matrix: `windows-latest` (`--win`), `macos-14`
   (`--mac`, arm64 + x64 DMGs) and `ubuntu-latest` (`--linux`), each running
   `electron-builder --publish never` and uploading installers as artifacts.
   Signing secrets are passed per platform; **when they are absent the build is
   simply unsigned**, so forks and pull requests still produce artifacts.
3. **Publish** — on a tag, all artifacts (including the `latest*.yml` update
   manifests electron-updater reads) are downloaded, checksummed into
   `SHA256SUMS.txt` and attached to the GitHub Release with `gh release create`
   (re-running the job uploads with `--clobber` instead of failing).

Cut a release with:

```bash
git tag v1.0.0
git push origin v1.0.0
```

Repository secrets used by the workflow:

| Secret | Platform | Purpose |
| --- | --- | --- |
| `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` | Windows | Authenticode `.pfx` (path, base64 or https URL) |
| `MAC_CSC_LINK` / `MAC_CSC_KEY_PASSWORD` | macOS | Developer ID `.p12` |
| `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` | macOS | Notarization |
| `GITHUB_TOKEN` (automatic) | all | Uploading release assets |

The workflow also verifies the produced binaries when a certificate is present
(`Get-AuthenticodeSignature` on Windows, `codesign --verify` + `spctl --assess`
on macOS) and skips that step cleanly when it is not.

## Code signing

The build is configured to produce **signed** release artifacts. Signing is done by
electron-builder using your own certificates — nothing is faked in this repo, and no
key material is committed.

### Windows (Authenticode)

```bash
export CSC_LINK=/absolute/path/conquer-signing.pfx   # or a base64 blob / https URL
export CSC_KEY_PASSWORD='pfx-password'
npm run dist:win
```

`package.json` sets `win.publisherName` and `win.signtoolOptions.publisherName` to
`Conquer Studio`, and `signAndEditExecutable: true` so the exe is signed and
version-stamped. To verify a produced artifact:

```powershell
Get-AuthenticodeSignature .\release\Conquer*.exe | Format-List
signtool verify /pa /v .\release\Conquer*.exe
```

### macOS (Developer ID + notarization)

```bash
export CSC_LINK=/absolute/path/developerID.p12
export CSC_KEY_PASSWORD='p12-password'
export APPLE_ID='you@example.com'
export APPLE_APP_SPECIFIC_PASSWORD='abcd-efgh-ijkl-mnop'
export APPLE_TEAM_ID='ABCDE12345'
npm run dist:mac
```

The mac target runs with `hardenedRuntime: true`, `gatekeeperAssess: false` and the
entitlements in `build/entitlements.mac.plist` (JIT + unsigned executable memory,
required by V8). Notarization is performed by electron-builder when the three
`APPLE_*` variables are present. Verify with:

```bash
codesign --verify --deep --strict --verbose=2 "release/mac/Conquer Rule the Globe.app"
spctl --assess --type execute -vv "release/mac/Conquer Rule the Globe.app"
xcrun stapler validate release/*.dmg
```

### Honest status

`npx electron-builder --dir` gets as far as resolving the app, validating the
config and running `@electron/rebuild`, then fails while fetching the Electron
binary — this sandbox's egress allow-list does not include the release-asset host
(`release-assets.githubusercontent.com`), so **no Electron installer can be
produced here**. That is why the installers come from the release workflow, and
why `npm run build:exe` exists: it cross-compiles portable single-file executables
from assets that *are* reachable (the npm registry hosts the Bun runtime).

No code-signing certificate exists in this sandbox (and no certificate authority will
issue one for an unsigned demo project), so the artifacts you can build here are
**unsigned** — Windows SmartScreen and macOS Gatekeeper will warn until you sign with
your own certificate using the variables above. The signing pipeline, entitlements,
publisher identity and installer targets are all in place and ready to run on a
machine that holds the certificate.

## Project layout

```
index.html                 shell, HUD, title screen, modals
src/styles/main.css        all styling + the pixel skin (no framework, no network fonts)
src/game/worldgen.js       terrain + province generation (deterministic seed)
src/game/state.js          the simulation: economy, recruitment, combat, nukes, victory
src/game/ai.js             AI nation behaviour and diplomacy
src/game/render.js         pixel-art map renderer (block layer, borders, takeovers, effects)
src/game/ui.js             HUD/inspector/modals, battle forecast + report cards
src/game/save.js           versioned save/load
src/game/main.js           app boot, loop, input, handlers
electron/main.cjs          window, app:// server, IPC save/load, menu
electron/preload.cjs       window.desktop bridge (sandboxed)
electron/serve.cjs         testable app:// path resolver
build/                     icons (ico/icns/png set) + mac entitlements
tests/                     node:test suites (logic + desktop packaging)
tools/ui-test.mjs          jsdom end-to-end UI harness
tools/pixelate.mjs         downsample + nearest upscale artwork to true pixel blocks
tools/build-exe.mjs        embeds the game in Bun and cross-compiles portable binaries
tools/get-bun.mjs          fetches the Bun build tool from the npm registry
desktop/launcher.mjs       the portable build's entry point (server + app window)
assets/fonts/              self-hosted woff2 (Pixelify Sans, VT323, Silkscreen)
assets/icon-pixel-src.png  pixel-art icon source, snapped to a 96-block grid
```

Save data lives at:

- desktop: `<userData>/campaign.json` (e.g. `%APPDATA%/Conquer Rule the Globe/`)
- browser preview: `localStorage["conquer.save.v1"]`

## License

MIT.
