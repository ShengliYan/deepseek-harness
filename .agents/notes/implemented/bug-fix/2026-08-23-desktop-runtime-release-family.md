# Agent Note: Desktop deploy root joins the dsh release family

Status: implemented

English | [中文](2026-08-23-desktop-runtime-release-family.zh.md)

## Problem

`DshFamily.members()` sweeps every `apps/*/package.json` and requires an `@deepseek-ai/*` name plus one shared version across the whole family, so two off-family manifests made family verification throw before any release could run: `apps/desktop-runtime` — the private pnpm-deploy root that `macos-app/scripts/stage-runtime.mjs` regenerates — carried the unscoped name `dsh-desktop-runtime-pkg` and version `0.0.1`, and `packages/web/web-search-ark` declared `0.1.0-rc.5` while the family baseline was `0.1.1-rc.2`.

## Decision

The deploy root is named `@deepseek-ai/dsh-desktop-runtime`, and `stage-runtime.mjs` reads its version from the workspace root manifest, which carries the family version, instead of hardcoding one — each future bump flows into the regenerated manifest. The committed copy of the deploy-root manifest matches what the generator now emits, and `web-search-ark` moves to `0.1.1-rc.2`. `pnpm --filter` resolves the deploy root through the same constant the generator writes, so the rename cannot drift between the manifest and its consumers.

## Consequences

Family verification passes on the current tree (`releaseFamily('dsh').verifyVersions(members())`), and no release step needs to remember either manifest. A future package added under `apps/` inherits the same two requirements by construction: scoped name, family version.

## Alternatives considered

**Exclude private manifests or `apps/desktop-runtime` from the family glob.** Rejected: the sweep is what holds every app manifest to the family rules; a carve-out reintroduces per-package memory for exactly the manifests nothing else checks.

**Hand-bump the deploy-root version at each release.** Rejected: it relies on the operator remembering a manifest that no other gate reads, which is the failure this fix removes; deriving from the root manifest deletes the step.
