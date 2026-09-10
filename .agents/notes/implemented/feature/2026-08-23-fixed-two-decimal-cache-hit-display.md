# Agent Note: Cache hit always displays two decimal places

Status: implemented

English | [中文](2026-08-23-fixed-two-decimal-cache-hit-display.zh.md)

## Problem

The [minimum-precision cache-hit display](../../archived/feature/2026-08-19-high-cache-hit-decimal-display.md) kept every ratio below 100% at integer rounding, so a steady mid-band value such as 98.55% displayed as `98%` and hid sub-percent movement that users read per message. The policy only escalated precision near a full hit, which protected the full-hit distinction but left the whole rest of the band coarser than the user wants to see.

## Decision

`cacheHitPercent` now rounds half-up to exactly two decimal places over exact integer arithmetic — the ratio scaled by 20000 stays within safe integers for every realistic cumulative count — and always formats both decimals (`98.55`, `99.50`). The full-hit invariant from the earlier decision is kept: a non-full ratio whose two-decimal rounding reaches `100.00` caps at `99.99`, and only an exact full hit displays `100.00`. A zero billed-input denominator still omits the group. This supersedes the minimum-precision policy entirely; the owning note is archived unchanged.

## Consequences

Every non-empty ratio carries the same fixed width, so per-message movement inside one percent point stays visible without reading raw token counts. Ratios between 99.995% and a full hit all display `99.99%` — the coarsest band of the old variable-precision scheme — which trades that tail's distinguishability for the uniform format. The component spec pins the two-decimal table including both clamp arms, and the assembled `lifecycle-chrome` replay displays `99.50%`.

## Alternatives considered

**Keep the minimum-precision policy.** Rejected: it is exactly the behavior this change replaces — the mid band stays integer and per-message movement below one percent stays invisible.

**One fixed decimal place.** Rejected: `98.55%` collapses to `98.6%`, reintroducing visible rounding at the granularity users compare across messages; two places is the requested display contract.
