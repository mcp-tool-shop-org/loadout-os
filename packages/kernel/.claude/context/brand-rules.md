# Brand Rules — @mcptoolshop/ai-loadout

## Tone

Precise and mechanical. ai-loadout is a dispatch table, not an advisor. It scores, filters, and reports. It does not recommend, suggest, or infer.

## Domain language

| Term | Meaning | Must not be confused with |
|------|---------|--------------------------|
| LoadoutEntry | A declared knowledge payload with ID, keywords, patterns, priority, and token estimate | A "suggestion" or "resource" |
| LoadPlan | The structured output of planLoad: preload + onDemand + manual with provenance | A "recommendation" or "context plan" |
| Score | Keyword ratio + pattern bonus (0-1), deterministic | A "relevance estimate" or "confidence" |
| MIN_SCORE | Hard threshold at 0.1; entries below are excluded | A "soft cutoff" or "guidance threshold" |
| Layer | One of 4 canonical locations (global/org/project/session) | A "source" or "config level" |
| Override | Later layer replacing earlier layer's version of same entry ID | A "merge" or "combination" |
| Provenance | Mapping from entry ID to the layer that provided the winning version | "Origin" in a vague sense |
| Conflict | Same entry ID defined in multiple layers — always resolved by "later wins" | An "error" or "inconsistency" |
| Dead entry | An entry that never matches any observed task | An "unused feature" |

## Enforcement bans

### Language that must never appear in ai-loadout output or docs

- "recommended" / "suggested" / "best match" (the system scores and filters, it does not recommend)
- "confident" / "likely" / "probably relevant" (scores are deterministic ratios, not confidence)
- "intelligent" / "smart" / "adaptive" (matching is keyword overlap, not inference)
- "understands" / "knows about" (routing to a payload is not comprehension)
- "approximately matched" / "close enough" (below MIN_SCORE means excluded, period)

### Contamination risks

1. **Relevance inflation** — if reason strings start implying deeper understanding than keyword overlap, the dispatch truth is compromised
2. **Capability conflation** — routing to an entry is not the same as the agent having that capability; language must never blur this
3. **Soft-match creep** — any weakening of MIN_SCORE or introduction of "partial match" zones would destroy the hard-filter contract
4. **Provenance hiding** — if override chains become invisible to operators, layer trust is undermined
5. **Freshness pretense** — the system matches against declared keywords; it does not know if payloads are current
