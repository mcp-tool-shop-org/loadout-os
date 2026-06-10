---
title: Concepts
description: Dispatch tables, priorities, resolver, runtime, load modes, and the budget model.
sidebar:
  order: 2
---

## The Dispatch Table

A `LoadoutIndex` is the central data structure. It contains:

- **version** — the schema version (currently `"1.0.0"`)
- **generated** — ISO 8601 timestamp of when the index was generated
- **entries** — an array of `LoadoutEntry` objects, each describing one knowledge payload
- **budget** — token estimates for context planning
- **lazyLoad** (optional) — when `true`, signals that payloads should not be pre-loaded by consumers

The index is designed to be always-loaded alongside a lean instruction file. Payloads are loaded on demand when the matcher finds a hit.

## Priority Tiers

Every entry has a `priority` that controls how it's matched:

| Tier | Behavior | Score | Use for |
|------|----------|-------|---------|
| `core` | Always included in results | 1.0 | Non-negotiable rules |
| `domain` | Included when keywords match | 0-1 | Topic-specific knowledge |
| `manual` | Never auto-included | N/A | Obscure or dangerous knowledge |

Manual entries are only accessible via `lookupEntry(id, index)` — they never appear in `matchLoadout()` results.

## Trigger Phases

Each entry specifies when it should be loaded relative to the agent loop:

```typescript
interface Triggers {
  task: boolean;   // load during task interpretation
  plan: boolean;   // load during plan formation
  edit: boolean;   // load before file edits
}
```

The default is `{ task: true, plan: true, edit: false }`. These are advisory — the consumer decides how to interpret them.

## Keyword Matching

The matcher tokenizes the task description into lowercase words (replacing non-alphanumeric characters with spaces, splitting on whitespace, and filtering out single-character tokens), then compares against each entry's `keywords` array:

1. For each keyword, split it on spaces/hyphens and check if all words are present in the task tokens
2. Calculate **overlap proportion** = matched keywords / total entry keywords
3. For patterns, split each on `_` and check if **any** word appears in the task tokens
4. Add **pattern bonus** (+0.2) if any entry pattern matched
5. Cap the score at 1.0
6. Exclude domain entries below the minimum score threshold (0.1)
7. Sort results by score descending, then by token cost ascending (lighter payloads first on ties)

## The Budget Model

```typescript
interface Budget {
  always_loaded_est: number;        // tokens always in context
  on_demand_total_est: number;      // sum of all payload tokens
  avg_task_load_est: number;        // estimated average per session
  avg_task_load_observed: number | null;  // from usage telemetry
}
```

The budget helps tooling answer: "How much context am I saving by routing instead of dumping?"

## Frontmatter

Each payload file carries its own routing metadata:

```markdown
---
id: github-actions
keywords: [ci, workflow, runner, dependabot]
patterns: [ci_pipeline]
priority: domain
triggers:
  task: true
  plan: true
  edit: false
---

# GitHub Actions Rules
Content here...
```

**Frontmatter is the source of truth.** The index is derived from it, not the other way around. If they drift, validation catches it.

The frontmatter parser is hand-rolled — no YAML library, no `eval`, no prototype pollution vectors. It handles strings, inline arrays `[a, b]`, booleans, and one-level nested objects.

## Load Modes

Each matched entry gets a load mode that controls how it enters context:

| Mode | Maps from | Behavior |
|------|-----------|----------|
| `eager` | `core` priority | Preloaded immediately — always in context |
| `lazy` | `domain` priority | Available on demand — loaded when the task matches |
| `manual` | `manual` priority | Never auto-loaded — requires explicit lookup |

## The Resolver

The resolver discovers and merges loadout indexes from a canonical layer stack:

1. **global** — `~/.ai-loadout/index.json` (user-wide preferences)
2. **org** — explicit path or `$AI_LOADOUT_ORG` (team conventions)
3. **project** — `<cwd>/.claude/loadout/index.json` (repo contracts)
4. **session** — explicit path or `$AI_LOADOUT_SESSION` (ephemeral overrides)

Later layers win. Missing layers are normal — most setups only have project-level. The resolver never guesses; it looks in fixed places in a fixed order.

## Merge Semantics

When two layers define the same entry ID, the later layer overrides the earlier one. The merged index tracks **provenance** (which layer each entry came from) and **conflicts** (entries defined in multiple layers).

## Agent Runtime

The runtime wraps the full sequence: resolve layers → match task → separate by load mode. Agents integrate against one function:

- **`planLoad(task)`** returns a `LoadPlan` with `preload` (eager), `onDemand` (lazy), and `manual` entries, plus provenance, budget, and token costs.

This is the canonical agent-facing API. Everything else (resolve, merge, match, explain) is machinery that the runtime abstracts over.

## Observability

Usage events are recorded to an append-only JSONL log. This enables:

- **Dead entry detection** — entries that have never been loaded
- **Keyword overlap analysis** — routing ambiguities where multiple entries share keywords
- **Budget drift** — comparing estimated vs. observed token costs
