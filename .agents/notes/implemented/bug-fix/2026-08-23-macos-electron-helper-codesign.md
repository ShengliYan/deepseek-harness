# Agent Note: Unsigned Mac app helpers must be adhoc-signed after rename

Status: implemented

English | [中文](2026-08-23-macos-electron-helper-codesign.zh.md)

## Problem

electron-builder with `identity: null` leaves GPU/renderer helpers signed as `Electron Helper` after renaming the bundle to DeepSeek Harness. On macOS 15 the code-signing monitor SIGTRAPs those helpers at launch (`EXC_BREAKPOINT`, `codeSigningID` still `Electron Helper (GPU)`). The Electron shell then exits within a few seconds, while the detached `dsh web` child is adopted by PID 1 and keeps port 3080. The user sees a browser tab on that port, or "Failed to load plugins", instead of a Mac window.

A second fatal path is a SyntaxError in packed `main.js`. Electron evaluates that file as the process entry; parse failure exits before `process.on` handlers or the boot log, so `dsh web --no-open` never starts and a leftover Safari tab on 3080 looks like the product. Build 1549 shipped that defect: a leftover `createWindow` tail after `loadAppUrl` made `node --check macos-app/main.js` fail. From that tab, loopback settings writes against a dying or mid-boot host surface the welcome notice as "The acknowledgement could not be saved."

## Decision

`afterPack` adhoc-signs the unpacked `.app` (`codesign --force --deep --sign -`) with `build/entitlements.mac.plist` (`disable-library-validation`, JIT, unsigned executable memory). Unsigned local builds set `hardenedRuntime: false`. Info.plist `LSEnvironment` sets `ELECTRON_DISABLE_GPU=1` so Chromium sees the flag before JavaScript runs; the shell still passes `--disable-gpu` / `--in-process-gpu`, and a packaged Darwin build also passes `--no-sandbox` because adhoc-signed helpers still SIGTRAP under Chromium's sandbox (`codeSigningMonitor: 2`). The shell shows a window before `startServer` and spawns `dsh web --no-open`. A leftover bundled listener on 3080 is adopted instead of treated as a foreign occupant. Same-origin `window.open` is denied without `openExternal`, so the app origin cannot fall through to Safari. A packaged spawn drops inherited `DSH_HOME` / `DSH_SMOKE_PORT` so a smoke or agent shell cannot point the GUI at `/tmp/dsh-*` instead of `~/.dsh`. `electron-builder.mjs` runs `node --check` on `main.js` before packing, and `verify-bundle.mjs` extracts packed `main.js` from `app.asar` and checks it again.

## Consequences

A dist build is not launchable on macOS 15 until `afterPack` has signed it. Changing helper names or dropping the entitlements reintroduces the SIGTRAP. `dsh web` without `--no-open` still opens the system browser; that flag is required for this wrapper. A SyntaxError in `main.js` fails the dist scripts instead of shipping an app that cannot boot.

## Alternatives considered

**Disable GPU from `main.js` only (`app.disableHardwareAcceleration()`).** Rejected as sufficient: Chromium still spawns the GPU helper before that line runs; 1542 still SIGTRAPped `Electron Helper (GPU)`.

**Leave the orphaned `dsh web` as the product UI.** Rejected: the Mac wrapper exists to own the window and to kill the server on quit; a PID-1 node plus a Safari tab is the failure mode this change removes.

**Trust visual launch testing without `node --check`.** Rejected: 1549 proved a SyntaxError produces an empty boot log and a browser tab, which is indistinguishable from the GPU SIGTRAP until someone parses the asar.

**Forward the launch environment's `DSH_HOME` into packaged `dsh web`.** Rejected: `open` from a smoke or agent shell leaked `/tmp/dsh-plugin-smoke-*`, so `settings.describe` returned an empty `ui-onboarding` section while `~/.dsh/settings.yaml` already held the acknowledgement, and writes into a deleted temp home produced "The acknowledgement could not be saved." Dev `electron .` still forwards `DSH_HOME`.
