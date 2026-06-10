# Product Brief — @mcptoolshop/ai-loadout

## What this is

Context-aware knowledge router for AI agents. Maintains a dispatch table of knowledge payloads, matches them against task descriptions using deterministic keyword/pattern scoring, resolves across a 4-layer hierarchy (global → org → project → session), and returns a LoadPlan that separates preload (core), on-demand (matched domain), and manual (everything else) entries — with provenance, conflict tracking, and observability.

## Type

CLI + library (pure functions for matching/merging/validation, filesystem I/O only in resolve/runtime layers)

## Core value

Dispatch is deterministic, explainable, and observable. Every match result includes a score, matched keywords/patterns, a reason string, and provenance showing which layer the entry came from. The system never guesses — it scores, thresholds, and reports.

## What it is not

- Not a recommender — it matches against declared keywords and patterns, not inferred relevance
- Not a capability evaluator — it routes to payloads, it does not assess whether payloads are accurate or current
- Not an LLM — zero model dependency, zero heuristics, zero randomness in matching
- Not a filesystem manager — consumers are responsible for reading payload files; ai-loadout routes to them
- Not a quality filter — a matched entry might be stale; ai-loadout's job is to match correctly, not to evaluate freshness

## Anti-thesis (7 statements)

1. Must never become a vibes-based router — dispatch is keyword/pattern scoring, not "feels relevant"
2. Must never be a "best effort" selector that hides uncertainty — if no entry matches, the result is an empty onDemand list, not a guess
3. Must never be a capability fantasy layer — the system routes to declared payloads, it does not claim those payloads are true, current, or sufficient
4. Must never be a silent fallback broker — when a layer is missing, malformed, or overridden, the resolver reports it in searched/conflicts, not silently
5. Must never become a generic recommender with no dispatch truth — every match must have a score, matched keywords, and a reason
6. Must never imply a tool/model knows something it was never actually given — routing to a payload is not the same as the agent having read it
7. Must never soften the MIN_SCORE threshold into a "soft match" zone — below 0.1 means excluded, not "maybe"

## Highest-risk seam

**Knowledge dispatch correctness** — the boundary where the system claims the right loadout was selected. The liar-paths are: wrong match looks right (keywords overlap ambiguously), correct entry excluded by threshold, layer override silently replaces a better version, or stale index routes to outdated payloads.
