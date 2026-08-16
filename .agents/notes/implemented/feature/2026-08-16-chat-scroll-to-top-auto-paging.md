# Agent Note: Chat scroll-to-top auto paging

Status: implemented

English | [中文](2026-08-16-chat-scroll-to-top-auto-paging.zh.md)

## Problem

Older chat history arrived only through a centered "Load earlier" button above the transcript: the reader had to stop at the top, target a control, and click before the previous page loaded. The gesture broke the read-back flow (scroll up, click, scroll up again), and the button was the only path to older history — a loaded window shorter than its viewport had no top edge to scroll toward, yet still forced the click.

## Decision

Arrival at the top is the paging gesture. In `ChatView`, reader scroll reaching the very top (scrollTop ≤ 2 px, reader-attributed through the observed-top ledger) pulls the next older page through the same anchored path the button used: the first visible settled row is armed as the paging anchor, `loadOlder()` runs, and the arriving prepend restores that row's viewport position. The click surface is removed; while a page is in flight, a non-interactive "Loading…" pill renders in its place.

Three supporting paths keep every position reachable without the button:

- **Fill:** on every layout pass, a loaded window shorter than its scrollport (`scrollHeight - clientHeight < 1`, with `clientHeight > 0` so zero-metric jsdom stays inert) pages itself until the flow overflows — otherwise a short tail page has no top edge and older history is unreachable.
- **Restored-at-top:** a remount whose saved position lands flush with the top cannot gain overscroll events (the position cannot move), so it pages itself when history remains.
- **Chained prepend:** a page too short to move the restored position off the top edge pages the next page instead of stranding the reader on it.

The anchor-drop on idle became transition-aware: the anchor clears when `loadingOlder` completes a true→false transition, not whenever the flag reads false, because the scroll that arms the anchor also flips bottom ownership and can commit a render before the session's busy flag reaches the snapshot. Reentry is not a component concern: `Session.loadOlder` dedupes concurrent requests and no-ops without `hasMore`.

## Alternatives considered

**Keep the button and only add the scroll trigger.** Rejected: the button would linger as dead chrome — arrival pages before the reader can click it, and the only case the click would still serve (a short, non-overflowing window) is covered by the fill path.

**Trigger at a deeper threshold (prefetch hundreds of pixels early).** Rejected: prefetching by proximity fires pages the reader never asked for (a fling past the top border), and the trigger must stay reader-attributed, which the ledger only guarantees for real movement.

**Drop only the button, no fill.** Rejected: a tail page shorter than the viewport cannot be scrolled, so older history would become unreachable entirely — the button's last remaining job.

## Consequences

Backward history walking is one continuous gesture: wheel, touch, or keyboard arrival at the top loads, anchors, and lands the next page with no click and no content jump. The `chat.loadOlder` locale key, the button, and its CSS are removed; the in-flight pill keeps the loading feedback. Unit tests drive the trigger, the fill, the guards (in-flight, exhausted), the restored-at-top chain, and the chained prepend; `chat-scroll-contract.e2e.ts` rewrote its paging steps around arrival (sample the anchor just above the trigger zone, then arrive), `stats-paged-history.e2e.ts` wheels to the top to page, and `complex-history.perf.ts` measures arrival-driven paging per page. The trajectory timeline keeps its own Load-earlier-history button — a different component, out of scope.

The reader's position after a landing is the trigger-time position shifted down by the prepended height; consecutive pages need repeated arrivals, one network round trip per page, which is the intended pacing.
