# Current Priorities — @mcptoolshop/ai-loadout

## Status

Locked (Role OS lockdown 2026-03-24). Primary seam: knowledge dispatch correctness.

## Classification

Lock candidate → locked.

## Seam family

Dispatch/routing truth — same family as any system where the selector claims correctness about which path/entry/payload was chosen.

## Must-preserve invariants (9)

1. **Scoring determinism** — same task + same index = same MatchResult[] (same scores, order, reasons). No randomness, no heuristics.
2. **MIN_SCORE hard filter** — domain entries scoring below 0.1 are excluded. No soft-match zone. No "close enough."
3. **Core always included** — priority="core" entries always get score 1.0 and mode "eager". No exceptions.
4. **Manual never auto-included** — priority="manual" entries always get score 0. Explicit lookup only.
5. **Layer order immutability** — global → org → project → session. Later wins. This order is a contract, not a default.
6. **Override transparency** — every layer override is recorded as a conflict with resolution and provenance. The operator can always see which layer won.
7. **Reason string machine-readability** — every MatchResult includes a reason string that names the matched keywords and/or patterns. This is the dispatch truth surface.
8. **Pure-function core** — match, merge, validate, analysis modules have zero I/O, zero side effects. I/O is isolated to resolve/runtime/usage.
9. **Zero dependencies in matching** — no LLM, no network, no external service. Dispatch is self-contained.

## Banned detours

- Adding "fuzzy matching" or "semantic similarity" to the scoring engine (breaks determinism and keyword grounding)
- Introducing "priority between domain entries" beyond score ranking (scores already rank; adding tiers within domain would obscure the formula)
- Making MIN_SCORE configurable per-entry or per-layer (destroys the single-threshold contract)
- Adding "auto-refresh" for stale indexes (the system routes, consumers refresh)
- Introducing LLM-based matching ("is this entry relevant?") — that's a different product
