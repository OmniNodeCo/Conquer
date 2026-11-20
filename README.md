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
- **26 playable nations** across 3 difficulties, each with a capital, flag, government
  type and AI personality (aggressive / turtle / opportunist / diplomat).
- **Province economy** — tax income, manpower, supply and upkeep, city / port /
  factory / silo construction, recruit & reinforce.
- **Real combat costs** — *every* assault kills soldiers. Even a walkover against a
  token garrison costs ~14% of the men you send; a failed assault loses almost the
  whole force. Casualties are deducted on the click, shown as a battle report card
  on the map, floating `-412` numbers over the province and a line in the feed.
- **Naval invasions** — coastal provinces with a port can sail troops across sea lanes,
  with travel time and fleet cost.
- **Diplomacy** — declare war, sue for peace, form and break alliances, gift gold;
  the AI negotiates back.
- **Strategic weapons** — build a silo, produce a warhead, target any province from
  your own borders, and erase a garrison.
- **One steady pace** — the clock has a single speed. `Space` pauses and resumes;
  there is no 1× / 2× / 4× multiplier to micromanage.
- **Persistence** — autosave plus manual save/load; the desktop build writes a real
  `campaign.json` in the OS user-data folder through Electron IPC.

## Controls

| Input | Action |
| --- | --- |
| Click province | Inspect it / select your source province |
| Drag, scroll | Pan, zoom |
| `Space` | Pause / resume (single speed) |
| `F` | Focus your capital |
| `H` | How to play |
| `Esc` | Deselect, then menu |
| `F11` | Fullscreen |
| `F12` | DevTools (development builds only) |

Attack flow: click a foreign province → pick a border province (or a port for a sea
invasion) → drag the troop slider → **ATTACK**. The slider panel shows the win chance
*and* the men it expects you to bury before you commit.

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
```

`npm run test:ui` drives the actual UI — starts a campaign, recruits, builds, attacks,
launches a nuke, saves and reloads — and fails on any console error. It also writes
`tmp-shots/09-jsdom-map.png`, a render of the map from the live canvas code.

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
npm run icons        # regenerate every icon from build/icon-1024.png
```

The game is served from a custom **`app://conquer/`** origin instead of `file://`.
A `file://` page has an opaque origin, which makes the strict CSP in `index.html`
(`script-src 'self'`) reject the game's ES modules; a registered standard, secure
scheme gives the page a real origin while still shipping as a plain static bundle.
If the scheme ever fails to load, `main.cjs` falls back to `loadFile()`.

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

No code-signing certificate exists in this sandbox (and no certificate authority will
issue one for an unsigned demo project), so the artifacts you can build here are
**unsigned** — Windows SmartScreen and macOS Gatekeeper will warn until you sign with
your own certificate using the variables above. The signing pipeline, entitlements,
publisher identity and installer targets are all in place and ready to run on a
machine that holds the certificate.

## Project layout

```
index.html                 shell, HUD, title screen, modals
src/styles/main.css        all styling (no framework, no network fonts)
src/game/worldgen.js       terrain + province generation (deterministic seed)
src/game/state.js          the simulation: economy, recruitment, combat, nukes, victory
src/game/ai.js             AI nation behaviour and diplomacy
src/game/render.js         canvas map renderer (coastlines, borders, labels, effects)
src/game/ui.js             HUD/inspector/modals, battle forecast + report cards
src/game/save.js           versioned save/load
src/game/main.js           app boot, loop, input, handlers
electron/main.cjs          window, app:// server, IPC save/load, menu
electron/preload.cjs       window.desktop bridge (sandboxed)
electron/serve.cjs         testable app:// path resolver
build/                     icons (ico/icns/png set) + mac entitlements
tests/                     node:test suites (logic + desktop packaging)
tools/ui-test.mjs          jsdom end-to-end UI harness
```

Save data lives at:

- desktop: `<userData>/campaign.json` (e.g. `%APPDATA%/Conquer Rule the Globe/`)
- browser preview: `localStorage["conquer.save.v1"]`

## License

MIT.
