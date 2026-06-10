# Workflow: Protect Dispatch Truth

**Repo:** @mcptoolshop/ai-loadout
**Seam:** Knowledge dispatch correctness — the boundary where the system claims the right loadout was selected for a given task.

## What this workflow protects

The contract that dispatch decisions are deterministic, explainable, and grounded in declared keywords/patterns — and that the system never claims more about a match than the scoring formula actually computed.

## Automatic reject criteria (8)

A proposed change MUST be rejected if it:

1. **Makes dispatch reasoning less explicit** — removes or weakens reason strings, provenance tracking, or conflict reporting so the operator cannot trace why an entry was selected
2. **Weakens deterministic selection rules** — introduces randomness, heuristics, LLM-based scoring, or environment-dependent behavior into the matching engine
3. **Blurs primary selection with fallback/degraded selection** — frames an empty onDemand result as though entries were found, or hides that layers were missing/malformed
4. **Invents or overstates capability/knowledge access** — implies that routing to a payload means the agent has that knowledge, or that a matched entry is accurate/current
5. **Allows stale capability assumptions to masquerade as current truth** — weakens observability tools (dead entry detection, usage tracking, budget analysis) that catch staleness
6. **Softens failure or mismatch classification into advisory mush** — converts the MIN_SCORE hard filter into a soft boundary, introduces "partial match" zones, or makes excluded entries appear as weak recommendations
7. **Changes output semantics without synchronized docs/tests/context updates** — modifies LoadPlan structure, reason string format, provenance shape, or conflict reporting without updating all consumers
8. **Makes human-facing reassurance stronger while leaving machine-facing semantics unchanged** — e.g., CLI output says "good coverage" while LoadPlan shows most entries in manual (org-wide reassurance drift rule)

## The key question this workflow answers

**When ai-loadout chooses a loadout, what must it say about why, and what must it never imply about capability or knowledge access?**

### Must say
- Score: the exact keyword ratio + pattern bonus (0-1)
- Matched keywords: which declared keywords were found in the task
- Matched patterns: which declared patterns triggered
- Reason: human-readable explanation combining the above
- Mode: eager (core), lazy (domain match), or manual (explicit lookup only)
- Provenance: which layer provided the winning version of each entry
- Conflicts: which entries were overridden and by which layers

### Must never imply
- That a matched entry means the agent has that knowledge (routing ≠ loading ≠ comprehension)
- That a high score means high relevance (score is keyword overlap ratio, not semantic relevance)
- That an entry's declared keywords are current (the system matches against declarations, not reality)
- That missing layers are errors (most setups only have project-level; missing layers are normal)
- That an empty onDemand list means no relevant knowledge exists (it means no declared entry matched — the knowledge might exist but not be indexed)
- That a conflict was resolved "correctly" (later-wins is a rule, not a judgment)

## When to re-prove

Re-prove this workflow when:
- The scoring formula changes (keyword weighting, pattern bonus, threshold)
- The layer discovery or merge algorithm changes
- MIN_SCORE value changes
- New match modes are added beyond eager/lazy/manual
- Reason string format changes
- The LoadPlan output shape changes
