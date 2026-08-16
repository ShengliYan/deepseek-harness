# Agent Note: Rewind-and-resend versions

Status: implemented

English | [中文](2026-08-16-rewind-and-resend-versions.zh.md)

## Problem

Users want the ChatGPT/Cursor "edit and resend" gesture: from any question bubble, roll the conversation back to that question, edit it, and resend — keeping the previous attempt intact and reachable as a numbered version (1/1 → 2/2) with arrows between versions. The existing fork affordances both cut AT the anchor's turn (the child INCLUDES the clicked turn), which cannot express "rewind before this question", and version navigation did not exist.

## Decision

Versions are fork sessions. A rewind cuts a child seeded with the completed turns strictly BEFORE the anchor's turn and prefills its composer with the original question text; the source session stays untouched as the previous version. The session list's fork-title increment (`(1)`, `(2)`) supplies the version numbers, and `parentSessionId` supplies the chain.

Host: `session.fork` gains an optional `rewind` flag. With `rewind: true` and an `atSeq` anchor, the boundary is the last `turn/end` strictly before the turn containing the anchor; an anchor inside the first turn yields an EMPTY child (the empty prefix is a valid seed). Omitted/past-end anchors keep the last-completed-turn shortcut, and the ordinary fork-unavailable rejection is untouched.

Client: the runtime `sessions.fork` passes `rewind` through to the wire. ui-conversation's `rewindAt(seq, text)` injection forks with `rewind: true`, opens the child, and prefills its input shell with `text`. Every durable user bubble renders a Rewind button (edit glyph, "从此处回退并编辑" / *Rewind and edit from here*) beside copy; assistant turn tails keep the existing branch icon.

Version counting: versions are COMMITTED lineage members only. A blank member is a pending rewind draft (its resubmitted turn has not landed), so it counts for nobody — the source keeps reading 1/1 and flips to 1/2 only when the draft's first turn lands, and the draft itself renders no pager until then. `deriveVersionPager` therefore filters the lineage component on `!blank`, derives the 1-based index from the committed ancestor chain, and skips blank children when picking `next`.

Version pager: a `‹ n/m ›` control in the session header (`conversation.session.header.actions`, order −10). Left opens the direct committed parent, right opens the newest committed direct child; a multi-child point opens only the newest child and siblings stay reachable through the sidebar.

Per-question switch: every durable user bubble renders the same `‹ n/m ›` (hidden for single committed versions) beside its rewind button. Its arrows route through `openVersion(target, turn)`, which records a pending jump for the target session and opens it; the target's ChatView consumes the jump and scrolls to `data-chat-turn` — turn numbers are shared across versions because every child seeds the source prefix, so the jump lands on the same question. This is how the reader compares the answer each version produced under one question.

## Alternatives considered

**Edit the queued/delivered message in place.** Rejected: delivered messages are durable log events (`Model-visible ⟺ logged`); in-place rewriting would falsify the history the transcript reconstructs. The fork seed is the one supported way to "change the past".

**Version graph inside one session log.** Rejected: the log is a linear append-only stream; a version graph would need a new event vocabulary and a non-linear projection, while fork children already give each version its own searchable, forkable, durable session.

**Automatic branch-tree UI.** Deferred: the lineage component is derivable, but a full tree is a larger surface; the pager plus the existing sidebar rows cover linear rewind histories, which is the shipped scope.

## Consequences

Every rewind adds one session row (a peer in the workspace list) and bumps the fork title counter; the previous version remains openable and its own rewind points produce siblings. Package tests pin the rewind boundary mapping (mid-chain anchor, first-turn empty child, anchor-less default), the pager derivation (root, newest child, siblings, cycles), and the message-button wiring; `apps/web/tests/message-actions.e2e.ts` exercises a real rewind through the assembled app — child opens with the prompt prefilled, the pager shows `n/m`, and the left arrow opens the parent — with goldens refreshed for the new user-bubble button.
