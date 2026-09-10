# Agent Note: DSH_APP_DATA_DIR test-isolation mode for the macOS shell

Status: implemented

English | [中文](2026-09-10-macos-app-data-dir-isolation.zh.md)

## Problem

Accepting a packaged desktop build on a developer machine (`integration-plan-2026-09-10` §5.3) must prove the App boots a real server and serves the GUI without touching the developer's real `~/.dsh` — sessions, settings, and caches included. Launching the production App pointed at a test directory was unsafe: the shell read its data home from the inherited environment, kept its Electron `userData` (and therefore its single-instance lock) in the production location, wrote its main log to a fixed `~/Library/Logs` path, and polled updates against the production feed.

## Decision

The shell gains a test-isolation mode, selected by one environment variable and validated before any other startup step. `macos-app/app-data-dir.js` is a pure module (no Electron import) that resolves `DSH_APP_DATA_DIR`: unset or empty keeps production mode; a set value must be an existing absolute directory and is normalized through `realpath`. It rejects the real `~/.dsh` itself, any subdirectory of it, and any ancestor of it (its `realpath` is the comparison anchor, so a symlink into it is caught by the normalization). Validation failures are fatal — `main.js` shows an error dialog and quits; the mode never silently falls back to the real directory.

In test mode `main.js` (1) fixes the server port at `13080` (`TEST_MODE_PORT`; an occupied port stops the launch and must never attach to or be served by a pre-existing service), (2) writes its main log inside the isolation directory, (3) redirects Electron `userData` to `<dir>/electron-userdata` **before** `requestSingleInstanceLock`, so the lock file is independent of the production app's, (4) sets the server subprocess's `DSH_HOME` to the isolation directory after the usual packaged-environment cleanup, and (5) disables updates: no polling timers, no focus trigger, no menu entry, and a guard at the top of `checkForUpdates`. Production mode (variable unset) is unchanged.

## Alternatives considered

**Dedicated CLI flag on the Electron shell.** Rejected: the shell has no flag parsing; environment variables are its existing configuration channel (`DSH_PORT`, `DSH_REPO_PATH`, `DSH_UPDATE_FEED`), and no renderer or preload change is needed.

**Create the directory if missing.** Rejected: the plan requires the variable to point at an existing directory; auto-creation hides a typo and turns a misconfiguration into a silent new data home.

**Attach to a pre-existing listener in test mode.** Rejected: the production attach behavior exists to recover a detached `dsh web`; in test mode a listener on `13080` is either a stale test server or something else entirely, and serving from it would make the acceptance test observe the wrong process.

## Consequences

The validation logic unit-tests under plain Node (`macos-app/tests/app-data-dir.test.cjs`, `node --test tests/`): unset/empty production behavior, resolution with symlink normalization, rejection of relative paths, missing directories, files, the real `~/.dsh`, its subdirectories, its ancestors, and acceptance of a sibling directory. The Electron-side wiring (independent lock, isolated `userData`, disabled updates) is verified in a dev launch and re-verified against the packaged App on port `13080` after the candidate build, since unit tests cannot exercise the lock. `start-dsh-web.ps1` at the repository root is the matching Windows side of the same acceptance: it validates its arguments, the fixed Node version, and a clean checkout at the tested commit, then launches `dsh web` from source with `DSH_HOME` pointed at the test directory.
