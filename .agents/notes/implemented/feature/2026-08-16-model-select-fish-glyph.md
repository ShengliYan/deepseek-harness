# Agent Note: Model select fish glyph and narrow-container chip

Status: implemented

English | [中文](2026-08-16-model-select-fish-glyph.zh.md)

## Problem

The model chip in the composer identified the current model only through its text label. Below the 460px composer width shared with the permission chip, the label ellipsized into near-nothing, so narrow windows lost the model affordance while the sibling permission chip still showed its glyph. The trigger also had no glyph at any width, leaving the model control text-only next to a glyph-led sibling.

## Decision

The model-select trigger now leads with the 16px `FishLogo` before its label. Below the 460px container query the chip collapses to glyph plus chevron: label and effort text are hidden, and the full model name stays on `aria-label`/`title` and inside the open menu. The glyph rule hides the icon outside the narrow query, so wide rows keep their previous text-only look pixel-for-pixel; the container query is anonymous for the same reason as the sibling `PermissionSelect` rule, and the icon rule is declared before it so the same-specificity ordering lands on the narrow behavior.

## Alternatives considered

**Keep the label and let it ellipsize.** Rejected: at 460px and below the ellipsized label is unreadable, and the sibling chip already established the collapse-to-glyph pattern.

**A slot for trigger adornments.** Rejected: a contract slot for one static glyph is over-engineering; a slot can be added if a second consumer ever needs the seat.

**Move the glyph into a shared primitive.** Rejected: `FishLogo` already lives in `dsh-client-ui-primitives`; this change is usage, not a new primitive.

## Consequences

Wide composer rows render exactly as before. Narrow rows show the fish-plus-chevron chip consistent with the permission chip, and assistive technology reads the full model name. The change is CSS plus one rendered glyph: no API, contract, or locale surface.
