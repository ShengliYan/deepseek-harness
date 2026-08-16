# Agent Note: Rewind affordance and fork lineage in the session header

Status: implemented

English | [中文](2026-08-16-rewind-affordance-and-fork-lineage.zh.md)

## Problem

The harness has a complete fork primitive — `session.fork` cuts a child from a completed-turn prefix, and the Web client exposes it from the message branch icon and the Session-row menu — but a Codex-style "rewind to an earlier point" is undiscoverable: the message icon reads only as "branch", and after the fork the child session shows no trace of where it came from. The header's ancestry breadcrumb deliberately walked only `origin: 'subagent'` chains, so a fork child rendered as if it were a root session, and the user could not navigate back to the source that seeded it.

## Decision

The existing fork-and-open flow IS the rewind primitive; this change names it and makes its lineage visible.

Copy: the message branch affordance now reads 从此处回退，在新会话中继续 / *Rewind here - continue in a new conversation*, and the Session-row menu entry 回退到上一轮（新会话） / *Rewind to the previous turn (new session)*. No behavior changed — both entry points still fork through the runtime's shared `sessions.fork` action, increment the inherited title, and open the child; a failure still leaves the source selected.

Lineage: `deriveAncestry` now walks `parentId` unconditionally (oldest first, current last, cycle-terminating) instead of stopping at the first non-subagent summary. `parentId` is the wire `parentSessionId` passthrough, which already carries both fork and subagent lineage, so the change is purely a visibility decision: a fork child's header shows its source session as a clickable crumb and the child's own title as the disabled tail crumb. Roots, orphaned parents, and cycles degrade to the single current crumb exactly as before.

## Alternatives considered

**A true in-place rewind that truncates the session log.** Rejected: the session log is append-only and model-visible content must be reconstructable from it (`Model-visible ⟺ logged`); a truncation primitive would weaken that invariant, while fork already expresses "continue from an earlier completed turn" without destroying the future branch.

**Show fork children nested beneath their source in the session list.** Rejected: the peer-row model (both rows independently selectable, searchable, drag-reorderable) is the established decision ([2026-07-27-web-session-fork-actions.md](2026-07-27-web-session-fork-actions.md)); the header breadcrumb adds lineage navigation without changing list ownership.

**Keep the subagent-only breadcrumb and add a separate fork chip.** Rejected: one ancestry surface is simpler, and the two lineages share the same `parentId` field.

## Consequences

A fork child's header shows its source chain; clicking a crumb opens that ancestor. Subagent breadcrumbs are unchanged. Root sessions render a single crumb. The copy change touches the two locales (zh/en), the component specs that address the buttons by name, and the message-actions web snapshot goldens (refreshed in the same change). Unit coverage pins fork-chain, multi-hop subagent, orphan, and cycle behavior of `deriveAncestry`; the message-actions e2e now additionally asserts the two-crumb header and crumb navigation after a fork.
