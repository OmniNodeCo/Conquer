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

If the Windows **1.0.0** portable closes without a window, use **1.0.1** or
later. In File Explorer, choose **Extract All** on the download and open
**Conquer-Portable** from the extracted folder. The portable unpacks Electron
before the window appears; launch it once and leave your saved data in place.

## Highlights

- **Procedural earth-like world** — value-noise terrain, marching-squares coastlines,
  rivers, mountain ranges, deserts and tundra. Every campaign has a new map.
- **Pixel-art everything** — the map, the HUD and the title screen share one art
  direction: square corners, flat fills, hard offset shadows, chunky bars and a
  self-hosted bitmap typeface (Pixelify Sans for UI, VT323 for numbers, Silkscreen
  for headings). No gradients, no blur, no rounded corners, no CDN fonts — the
  whole game is offline and self-contained.
- **A world made of pixels** — a land tile is four world units across. The actual
  tile grid supplies the coasts, borders, mouse targets and minimap. On top of it
  sit tiny inked pines, palms, snowy ridges, farms and round settlement markers. Rivers join
  on their way to the sea; a few wave crests catch the light. Zoom in to see the
  brushwork. No scanlines or screen-space pixel filter.
- **Front lines, not colour wipes** — each assault claims a connected patch at
  the border (or a beachhead when a fleet lands). Survivors pitch camp on the
  tiles. The land stays yours after the flash fades and when you reload; it counts
  immediately towards the 80% goal. Lost ground cuts into the defender’s taxes.
- **Replacements** — after three simulation seconds without sending troops or
  being attacked, a depleted garrison gradually draws soldiers from national
  manpower. Cities raise its normal strength; manual recruitment can exceed it.
  Watch the army counter for the arrival rate. No recovery popups.
- **26 playable nations** across 3 difficulties, each with a capital, flag, government
  type and AI personality (aggressive / turtle / opportunist / diplomat).
- **Every land click is a troop order** — send 25% of a ready garrison, with
  the number sent shown immediately. Click home to bring up reinforcements (or
  patrol from the local garrison); click a reachable rival to attack. If the
  target has no invasion route, troops stage on your side of the border.
  Truces, allies, empty garrisons and open water do not spend soldiers.
- **Find my land** — click your flag in the top bar or press `L`. Search your
  provinces, footholds and buildings by name. Select a result to
  centre the map without attacking, spending gold or placing anything. The
  minimap's gold flag, **Home** button and `F` shortcut follow your capital, or
  your largest remaining holding if the capital falls.
- **Build hotbar** — arm a structure (`1`–`6`), then click a tile you hold in
  your province. A friendly order dispatches troops and can build; a foreign
  order dispatches troops but never builds. A red cross means no construction.
  A purchased city is a small gold circle, distinct from the nation-coloured
  settlement dots. Castles, batteries, ports, factories and silos keep their
  pixel silhouettes. Hover over a site for its name and level. Build the
  same type on that icon to upgrade it, or use another clear tile for a new site;
  costs and level caps are still per province. Inspector and bot orders choose
  their own sites. `Esc` cancels placement.
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
  floaters across the map, and distant advances only glint briefly.
- **Persistence** — autosave plus manual save/load; the desktop build writes a real
  `campaign.json` in the OS user-data folder through Electron IPC. Sites, their
  levels, occupied tiles, and troops in transit survive save/load. v1–v3 saves
  still load; older buildings without coordinates receive stable sites, and
  old naval expeditions remain fleets.

## Controls

| Input | Action |
| --- | --- |
| Click your held home land | Send a quarter-army reinforcement or local patrol; also inspect the province |
| Drag, scroll | Pan, zoom |
| `Space` | Pause / resume (single speed) |
| `1`-`6` | Arm a build hotbar slot |
| Click across a border | Advance into that province |
| Click enemy-held tiles in your own province | Counterattack with the local garrison |
| Click your flag / `L` | Open **Find my land**; search for a province or building |
| Minimap **Home** / `F` | Return to your capital or remaining home province |
| `H` | How to play |
| `Esc` | Deselect, then menu |
| `F11` | Fullscreen |
| `F12` | DevTools (development builds only) |

Attack flow: **click a reachable foreign province** — that is the attack. A quarter of your
strongest bordering army marches immediately (a port province will sail instead).
The battle card reports casualties, tiles gained and the share held. Click again
to press the front, or rest to muster reserves. When the last defending tile falls,
the largest occupier takes the province; other footholds stay in place. The
inspector still offers a manual commitment slider.

Building: press a hotbar key (`1`-`6`) or click a slot, then click a clear tile
on your land. The anchor must be in a province you administer and the footprint
must not cross onto foreign, tribal or enemy-occupied land. A foothold abroad
is not a build permit. Ports need a coastal province. The inspector can build
without issuing a troop order; `Esc` disarms the hotbar.

| Hotbar | Structure |
| --- | --- |
| `1` | City — income and manpower |
| `2` | Castle — +28% defence per level |
| `3` | AA Battery — intercepts warheads |
| `4` | Port — naval invasions |
| `5` | Factory — cheaper recruits, more income |
| `6` | Missile Silo — unlocks warheads |

[Roblox screenshots, map gallery and match footage](docs/visual-references.md) (reference only; not part of the game).

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
platforms. The Windows job starts the actual portable `.exe` without flags or a
profile override. It waits for a native window with the title the renderer sets
**after** the title screen initializes, then closes it and checks for a clean exit.
On Windows and Linux, a second test loads the packaged `app.asar` in Electron
with networking blocked, starts a campaign, builds a city and locates its site
using the on-screen buttons. A native mouse click on that site must dispatch one
reinforcement column.
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

The installer publisher, executable company name and expected Windows update signer
are **OmniNodeCo** (`author.name` and `build.win.signtoolOptions.publisherName`).
Windows gets **Verified publisher** from the Authenticode certificate, not these
metadata fields. To display that name, configure `WIN_CSC_LINK` and
`WIN_CSC_KEY_PASSWORD` for builds of `main` with a trusted code-signing certificate
whose subject common name (CN) is exactly `OmniNodeCo`. Signed builds check both
signature validity and the signer name before uploading the executables. Unsigned
builds do not gain a verified publisher. To inspect a signed download in Windows,
right-click the `.exe` and choose **Properties → Digital Signatures**. From PowerShell:

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
src/game/fronts.js         connected parcel advances, sector strength and tile control
src/game/map-art.js        seeded two-pixel atlas, hand-authored sprites and river drainage
src/game/render.js         camera, political map, overlays, forecasts and minimap
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
