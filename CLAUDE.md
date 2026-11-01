# Pizza SIM: notes for Claude

A 3D pizzeria tycoon game written in **TypeScript** with a custom WebGL2 renderer. There's no web framework.
- Bundled with **esbuild** into one self-contained HTML file (`dist/index.html`), which is used for the browser and itch.io.
- Wrapped in **Electron** for the Windows desktop app, packaged with **electron-builder**.
- Node 20+ is required. CI uses Node 20; the commands below were checked locally on Node 22.

## Commands (all checked on Linux)

```bash
npm ci                    # install (npm ci --ignore-scripts skips the Electron binary download; fine for web build + tests)
npm run typecheck         # tsc --noEmit
npm run build             # dist/index.html, dist/PizzaSim-<ver>.html, dist/PizzaSim-<ver>-itch.zip
npm run build:desktop     # build + embed Google Fonts into dist/index.html (offline desktop use; needs internet)
```

Tests. These are plain tsx scripts; there's no test framework:

```bash
npx tsx scripts/systems-test.ts                                  # PASS/FAIL checks, exits non-zero on failure (~4s)
npx tsx scripts/migrate-test.ts scripts/itch/save-0.3.21.json    # loads an old save and plays 3 days (~2s)
npx tsx scripts/sim-test.ts 10 7 standard q                      # bot plays 10 days; crashes = failure (~4s)
npm run simtest                                                  # same bot, 40 days with full output (~30s)
```

The browser/itch test needs a running server plus Playwright and Chromium:
```bash
node scripts/itch/server.mjs &   # fake itch.io on ports 8701/8702
node scripts/itch/test.mjs       # Playwright isn't in devDependencies; link or install it first
```

Windows desktop package. CI and releases run this on `windows-latest`:
```bash
npm run build:desktop
npx electron-builder --win dir --x64 --publish never   # -> release/win-unpacked/Pizza SIM.exe
npm run dist:win                                       # NSIS installer + portable .exe
```

## What Linux can't do
- **Windows packaging can't finish on Linux.** `electron-builder --win` writes `release/win-unpacked/`, then fails at the step that stamps the icon and version into the exe. That step (rcedit) needs Windows or Wine. Use the CI / Release workflows (windows-latest) to check packaging.
- The Electron window (`npm start`) needs a display. You can't run it in a headless container. To check game behaviour, test the browser build with Playwright instead.

## CI / release
- `.github/workflows/ci.yml`: runs on every PR on windows-latest. It runs typecheck, the three test scripts, and the Windows package build.
- `.github/workflows/release.yml`: run it by hand with a `version` input (e.g. `1.3.0`). It runs the tests, builds `PizzaSIM-v<version>-win-x64.zip`, and creates tag `v<version>` plus a GitHub Release with auto-generated notes. It fails if the tag already exists.
- `.github/workflows/build-web.yml`: builds the HTML / itch.io version on every push, and on pushed `v*` tags makes a release with the itch zip. Tags created by release.yml do **not** trigger it, because GitHub doesn't start workflows from the built-in token.
- `.github/workflows/build-windows.yml`: the older installer/portable build, which runs on pushes to main/master.

## Conventions
- The version is stored in two places. Keep `package.json` `version` and `src/data/meta.ts` `VERSION` in sync (`scripts/assemble.mjs` warns if they differ).
- Balance numbers live in `src/data/`, the simulation in `src/core/` (no graphics), the renderer in `src/engine` + `src/render`, and the UI in `src/ui`.
