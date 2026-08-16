# Agent Note: macOS desktop auto-update pipeline

Status: implemented

English | [中文](2026-08-16-macos-desktop-auto-update.zh.md)

## Problem

The Electron desktop shell (`macos-app`) reached machines only through manually built dmg/zip artifacts: a user on an old bundle stayed on it until they noticed and reinstalled by hand. The mainstream updaters did not fit: Electron's `autoUpdater` speaks Squirrel.Mac, whose update feeds assume code-signed builds, and Sparkle is an Objective-C framework with the same signing-shaped assumptions. This shell is deliberately unsigned (`identity: null`), so it needed an update channel that works without signatures and without a signing pipeline.

## Decision

The shell carries a self-rolled update loop, unsigned-friendly by construction. Every `dist:mac*` run stamps a `build-id` and emits a `latest.json` feed (`version`, `buildId`, release `notes`, artifact URL and hash) through `scripts/make-update-feed.mjs`; the packaged `build/update-config.json` carries the `feedUrl` the app reads from `process.resourcesPath` (env `DSH_UPDATE_FEED` overrides, and dev runs never update). `updater.js` fetches the feed, decides "new" by `buildId` mismatch first and version compare second (so same-version hotfixes are detected), verifies the downloaded zip against the feed's `size` and `sha256`, pre-extracts the new bundle, and stages it under `userData/updates` before handing off to a detached apply script that polls for app exit, swaps the bundle (keeping a rollback backup), relaunches, and rolls back on failure. `main.js` owns the check cadence (startup silent check, explicit menu check with progress window and restart prompt, badge-driven apply) and `preload.js` bridges the `dsh-update-state` events and the apply IPC into the renderer.

The dist pipeline became a chain: `require-app-not-running.mjs` (a stale bundle must not race the build), `stage-runtime.mjs` (materializes the harness runtime closure under `apps/desktop-runtime` via `pnpm deploy` and lays it into `runtime-stage/` as `extraResources`), `gen-icon.mjs`, `electron-builder`, `verify-bundle.mjs` (smoke-checks the emitted app), and `make-update-feed.mjs`. `scripts/install-app.mjs` installs the current build locally for the manual channel.

## Alternatives considered

**`electron-updater` / Squirrel.Mac.** Rejected: Squirrel.Mac update feeds require code-signed builds and a signing identity; this shell ships unsigned by design.

**Sparkle.** Rejected: an Objective-C framework plus appcast infrastructure is far more than an unsigned-friendly feed-and-swap needs, and it carries the same signing-shaped assumptions.

**Re-download the full app on every launch.** Rejected: unconditional full-bandwidth downloads punish every start and still need gating logic; the feed-and-hash loop is that gating with less waste.

**Adopt a signing pipeline now.** Deferred: `hardenedRuntime` stays on and the feed format does not preclude signed artifacts later, but signing/notarization is an Apple-account-shaped process cost this shell does not yet pay.

## Consequences

Users on any packaged build get in-place updates from a static JSON feed, and the dev loop uses a `file://` feed against the dist directory. Rollback on failed apply restores the previous bundle rather than touching user data. The loop is plain CommonJS in the shell (no vitest there): the verification that pins it is `verify-bundle.mjs` plus the manual dev-loop feed, and the notes/artifact/hash columns of the feed are produced by the generator rather than assembled by hand.
