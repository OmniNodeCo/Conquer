# Conquer: Rule the Globe

A **desktop** grand-strategy game of world conquest — built with Electron, not Roblox.
Pick a nation, raise armies, invade coastlines, build silos, launch nukes and take
**80% of the globe** before the bots do.

The whole game is offline single-player against 25 AI nations on a procedurally
generated world (26 nations, ~165 provinces, deterministic per seed).

---

## Play the desktop app

Download your platform's file from [Releases](https://github.com/OmniNodeCo/Conquer/releases).
For an unreleased build, open its **Actions → Build → Artifacts** entry and
extract the platform archive first. Use the desktop download, not *Source code*.

| Platform | How to launch |
| --- | --- |
| Windows x64 | Double-click **`Conquer-Portable-<version>-x64.exe`** to play without installing. Or double-click **`Conquer-Setup-<version>-x64.exe`** to install and launch from the **Conquer** shortcut. |
| macOS | Open the `.dmg` for Apple Silicon (`arm64`) or Intel (`x64`), drag **Conquer Rule the Globe** to Applications and open it there. |
| Linux x64 | Open the `.deb` with your software installer, then launch Conquer from the applications menu. Or mark the `.AppImage` executable in your file manager’s **Properties → Permissions** and double-click it. |

Each download includes Electron and the game files. Opening it starts a game
window, not a terminal or your web browser. There is no local web server, port
or URL to open, and no need to install Node.js. If you have the old browser-based
portable, download the new **Conquer-Portable** instead.

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

## Developer setup

Players use the desktop downloads above. For development from source:

```bash
npm ci              # install dependencies including the Electron runtime
npm start           # opens the Electron window; npm run dev does the same
npm test            # logic, save, packaging and workflow tests
npm run test:ui     # offline jsdom campaign smoke test
```

The renderer loads HTML, ES modules, fonts and images from the application
bundle. Electron handles `app://conquer/` **in-process** by reading files,
including inside `app.asar`. No web server or browser fallback is involved.
The sandboxed preload exposes desktop save/load, fullscreen and updater IPC.
The gameplay renderer cannot make network connections (`connect-src 'none'`).

### Packaging (maintainers)

```bash
npm run pack         # unpacked desktop app in release/
npm run dist:win     # Windows setup and no-install GUI executables
npm run build:exe    # just the Windows portable Electron executable
npm run dist:mac     # DMGs and updater zips (arm64 + x64)
npm run dist:linux   # AppImage + deb
npm run icons        # regenerate the bundled application icons
```

### Auto-updates

Installed builds check GitHub Releases on launch and every six hours. Windows
and Linux use `electron-updater`; signed macOS apps use Squirrel.Mac's native
HTTPS feed and architecture-specific release zip directly. An offline check
may fail without interrupting play. The footer shows the version, update status
and **RESTART TO UPDATE** when a download is ready. The Windows no-install
edition does not run an installer behind your back: replace the portable `.exe`
to update. Both editions keep saves in the app's user-data directory.

## CI and releasing

[Build](.github/workflows/build.yml) tests pushes, pull requests and manual
runs. After tests pass on a push or manual run, it packages the three desktop
platforms. The Windows job checks the PE GUI subsystem of both `.exe` files
and the inner game. The Linux smoke test loads the packaged `app.asar` in a
real Electron window with network requests blocked and checks the title screen.
Desktop artifacts are kept for 30 days. UI screenshots are diagnostic only.

[Release](.github/workflows/release.yml) publishes **those artifacts**, without
checking out or rebuilding the game. A successful **push build of `main`**
automatically releases `v<package.json version>` from that run. To ship a new
version, bump `package.json`, `package-lock.json` and the `app-version` meta tag
in `index.html` before merging. **No tag push is required**; pushing just a tag
doesn't start a Build or Release.

To release by hand, use **Actions → Release → Run workflow**:

| Optional input | Default / effect |
| --- | --- |
| `tag` | Exact tag to release (e.g. `v1.0.0` or `preview`). Blank uses `v` + the version **at the build's commit**. |
| `run_id` | Blank selects the latest successful `build.yml` run on `main` (push or manual). Supply a run ID to pin another such build. |
| `draft` / `prerelease` | Both default to false. |

A **missing tag** is created at the selected build's SHA. An **existing tag** is
reused without moving it, even if it points to an older commit. If the release
already exists, same-named assets are replaced with `--clobber`. The notes link
to the source build, and `SHA256SUMS.txt` covers the desktop downloads
and updater files. Failed/PR builds and incomplete artifact sets are not
published. Both workflows must land on the default branch for the automatic
handoff and *Run workflow* UI to be available.

Signing secrets used by **Build** on `main` (Release needs only the automatic `GITHUB_TOKEN`):

| Secret | Platform | Purpose |
| --- | --- | --- |
| `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` | Windows | Authenticode `.pfx` (base64 or HTTPS URL) |
| `MAC_CSC_LINK` / `MAC_CSC_KEY_PASSWORD` | macOS | Developer ID `.p12` |
| `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` | macOS | Notarization |

With a certificate, Build checks `Get-AuthenticodeSignature` or `codesign --verify`
(and `spctl --assess` for notarized apps). Without signing secrets it still
produces installers, but they are not publisher-signed.

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

`package.json` sets `win.signtoolOptions.publisherName` to
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

This repository does not contain a signing certificate. Windows and macOS
builds are publisher-signed only when the corresponding credentials are provided.
Unsigned test builds can trigger SmartScreen or Gatekeeper warnings.

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
electron/main.cjs          desktop window, local bundle protocol, save/load, menu
electron/preload.cjs       window.desktop bridge (sandboxed)
electron/serve.cjs         in-process reader for bundled renderer assets
build/                     icons (ico/icns/png set) + mac entitlements
tests/                     node:test suites (logic + desktop packaging)
tools/ui-test.mjs          jsdom end-to-end UI harness
tools/pixelate.mjs         downsample + nearest upscale artwork to true pixel blocks
tools/desktop-smoke.cjs    CI launch check for the packaged Electron game
assets/fonts/              self-hosted woff2 (Pixelify Sans, VT323, Silkscreen)
assets/icon-pixel-src.png  pixel-art icon source, snapped to a 96-block grid
```

Desktop saves live in `campaign.json` under Electron’s per-user application data directory.

## License

MIT.
