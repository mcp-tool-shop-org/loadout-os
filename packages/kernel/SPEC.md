# ai-loadout Specification

> Context-aware knowledge router for AI agents.
> Version: 1.4.0

## Overview

ai-loadout is a zero-dependency kernel for routing context-budgeted knowledge to AI agents. It provides the data model, matching logic, validation, and merge semantics that consumers (like `claude-rules` or `claude-memories`) build on top of.

## Data Model

### LoadoutEntry

A single entry in the dispatch table.

| Field | Type | Constraints |
|-------|------|-------------|
| `id` | `string` | Kebab-case, unique, stable once created |
| `path` | `string` | Relative to repo root, non-empty |
| `keywords` | `string[]` | Lowercase surface words for matching. Required non-empty for `domain` entries |
| `patterns` | `string[]` | Named intents (e.g. `ci_pipeline`), not regex |
| `priority` | `Priority` | `"core"` \| `"domain"` \| `"manual"` |
| `summary` | `string` | Non-empty, max 120 chars, dense routing signal |
| `triggers` | `Triggers` | Which agent phases activate this entry |
| `tokens_est` | `number` | Estimated tokens (chars / 4), non-negative |
| `lines` | `number` | Line count of the payload file |

### Priority Tiers

| Tier | Behavior |
|------|----------|
| `core` | Always loaded. Score 1.0, mode `eager`. Cannot be skipped. |
| `domain` | Keyword-triggered. Score 0.1–1.0, mode `lazy`. Loaded when task matches. |
| `manual` | Never auto-loaded. Score 0, mode `manual`. Requires explicit `lookupEntry()`. |

### Triggers

Controls WHEN a payload should be loaded relative to the agent loop.

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `task` | `boolean` | `true` | Load during task interpretation |
| `plan` | `boolean` | `true` | Load during plan formation |
| `edit` | `boolean` | `false` | Load before file edits |

### LoadoutIndex

The dispatch table (`index.json`).

| Field | Type | Required |
|-------|------|----------|
| `version` | `string` | Yes |
| `generated` | `string` | Yes (ISO 8601) |
| `entries` | `LoadoutEntry[]` | Yes |
| `budget` | `Budget` | Yes |
| `lazyLoad` | `boolean` | No. When true, payloads are not pre-loaded into context |

### Budget

| Field | Type | Description |
|-------|------|-------------|
| `always_loaded_est` | `number` | Sum of `tokens_est` for all `core` entries |
| `on_demand_total_est` | `number` | Sum of `tokens_est` for all non-core entries |
| `avg_task_load_est` | `number` | Estimated average tokens loaded per session |
| `avg_task_load_observed` | `number \| null` | From usage telemetry (future) |

### LoadMode

Controls HOW a payload is loaded into agent context.

| Mode | When |
|------|------|
| `eager` | Loaded immediately (core entries) |
| `lazy` | Loaded on keyword match (domain entries) |
| `manual` | Only via explicit lookup |

## Matching

`matchLoadout(task, index)` → `MatchResult[]`

### Algorithm

1. Tokenize task description: lowercase, strip non-alphanumeric, split on whitespace, discard words ≤ 1 char
2. For each entry:
   - **Core**: score = 1.0, always included
   - **Manual**: score = 0, never included
   - **Domain**: score = (matched keywords / total keywords) + pattern bonus (0.2 if any pattern word matches)
3. Include entries with score ≥ 0.1
4. Sort by score descending, then by `tokens_est` ascending (cheaper first for ties)

### MatchResult

| Field | Type | Description |
|-------|------|-------------|
| `entry` | `LoadoutEntry` | The matched entry |
| `score` | `number` | 0–1, higher = stronger match |
| `matchedKeywords` | `string[]` | Which keywords matched |
| `matchedPatterns` | `string[]` | Which patterns matched |
| `reason` | `string` | Human-readable explanation |
| `mode` | `LoadMode` | How this entry should be loaded |

### Keyword Matching

- Keywords are split on whitespace/hyphens
- All words in a multi-word keyword must be present in the task tokens
- Score contribution: `matchedKeywords.length / totalKeywords.length`

### Pattern Matching

- Patterns are split on underscores
- Any word match triggers the pattern bonus (+0.2)
- Patterns are named intents, not regex

## Validation

`validateIndex(index)` → `ValidationIssue[]`

Validates structural integrity only. Does NOT check filesystem (that's the consumer's job).

### Issue Codes

| Code | Severity | Condition |
|------|----------|-----------|
| `MISSING_VERSION` | error | Empty version field |
| `MISSING_GENERATED` | warning | Empty generated timestamp |
| `INVALID_ENTRIES` | error | Entries is not an array |
| `MISSING_ID` | error | Entry has no id |
| `BAD_ID_FORMAT` | warning | ID is not kebab-case |
| `DUPLICATE_ID` | error | Same ID appears twice |
| `MISSING_PATH` | error | Entry has no path |
| `INVALID_PRIORITY` | error | Priority not in `core\|domain\|manual` |
| `MISSING_SUMMARY` | error | Empty summary |
| `LONG_SUMMARY` | warning | Summary exceeds 120 chars |
| `EMPTY_KEYWORDS` | error | Domain entry has no keywords |
| `BAD_TOKEN_EST` | warning | Negative or non-number token estimate |
| `NEGATIVE_BUDGET` | warning | Budget field is negative |

## Frontmatter

Payload files carry YAML-like frontmatter:

```
---
id: my-rule
keywords: [testing, unit, integration]
patterns: [test_strategy]
priority: domain
triggers:
  task: true
  plan: true
  edit: false
---
```

- `parseFrontmatter(content)` → `{ frontmatter, body }`
- `serializeFrontmatter(fm)` → frontmatter string
- Round-trips are deterministic
- Missing triggers default to `{ task: true, plan: true, edit: false }`
- Invalid priority defaults to `domain`

## Merge

`mergeIndexes(layers)` → `MergedIndex`

For hierarchical loadouts: multiple indexes merged deterministically.

### Semantics

- Layers are ordered earlier → later (e.g. global, org, project, task)
- Later layers override earlier for the same entry ID
- All overrides are tracked as conflicts with `resolution: "override"`
- Budget is recalculated from the merged entry set

### MergedIndex

Extends `LoadoutIndex` with:

| Field | Type | Description |
|-------|------|-------------|
| `provenance` | `Record<string, string>` | entryId → source layer name |
| `conflicts` | `MergeConflict[]` | Entries defined in multiple layers |

### MergeConflict

| Field | Type | Description |
|-------|------|-------------|
| `entryId` | `string` | Which entry was in conflict |
| `layers` | `string[]` | All layers that define this entry |
| `resolution` | `"override" \| "error"` | How it was resolved |

## Token Estimation

`estimateTokens(text)` → `number`

Heuristic: `Math.ceil(text.length / 4)`. Good enough for budget dashboards, not meant for billing.

## Usage Event Schema

For observability (append-only log, local-only, never networked):

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | `string` | ISO 8601 |
| `taskHash` | `string` | Session-local task identifier |
| `entryId` | `string` | Which payload was loaded |
| `trigger` | `string` | Which keyword/pattern caused the load |
| `mode` | `LoadMode` | eager, lazy, or manual |
| `tokensEst` | `number` | Estimated token cost |
| `sourceLayer` | `string?` | Which hierarchy layer (future) |

## Resolver

`discoverLayers(opts?)` → `{ layers, searched }`
`resolveLoadout(opts?)` → `ResolvedLoadout`
`explainEntry(entryId, layers)` → `EntryExplanation | null`

The resolver discovers, loads, and merges layered loadout indexes. It answers: "what is the merged state?" and "why did this entry win?"

### Canonical Layer Stack

Layers are checked in a fixed order. Later layers override earlier ones for the same entry ID.

| Layer | Location | Override |
|-------|----------|----------|
| `global` | `~/.ai-loadout/index.json` | Lowest priority |
| `org` | Explicit path or `$AI_LOADOUT_ORG` | Overrides global |
| `project` | `<cwd>/.claude/loadout/index.json` | Overrides org |
| `session` | Explicit path or `$AI_LOADOUT_SESSION` | Highest priority |

### Discovery Rules

- Missing layers are normal — most setups only have project-level
- Malformed files are treated as missing (skipped silently)
- The resolver never guesses; it looks in fixed places in a fixed order
- Environment variables: `$AI_LOADOUT_ORG`, `$AI_LOADOUT_SESSION`

### ResolvedLoadout

| Field | Type | Description |
|-------|------|-------------|
| `merged` | `MergedIndex` | The fully merged index with provenance |
| `layers` | `DiscoveredLayer[]` | Layers that were found and loaded |
| `searched` | `SearchedLayer[]` | All locations checked (found or not) |

### EntryExplanation

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Entry ID |
| `finalLayer` | `string` | Which layer the winning version came from |
| `definitions` | `EntryDefinition[]` | Every layer that defined this entry (in order) |
| `overrideChain` | `string[]` | Layer names in override order |
| `isConflict` | `boolean` | True if defined in multiple layers |

### EntryDefinition

| Field | Type | Description |
|-------|------|-------------|
| `layer` | `string` | Layer name |
| `summary` | `string` | Entry summary in this layer |
| `priority` | `Priority` | Entry priority in this layer |
| `tokens` | `number` | Token estimate in this layer |
| `keywords` | `string[]` | Keywords in this layer |
| `path` | `string` | Payload path in this layer |

## CLI

`ai-loadout` provides diagnostic commands. All support `--json` for scripting.

| Command | Description |
|---------|-------------|
| `resolve` | Show merged index from all layers with provenance |
| `explain <id>` | Show decision path for one entry across layers |
| `usage <jsonl>` | Usage summary from event log |
| `dead <index> <jsonl>` | Find entries never loaded |
| `overlaps <index>` | Find keyword routing ambiguities |
| `budget <index> [jsonl]` | Token budget breakdown |

### Resolver CLI Options

| Flag | Description |
|------|-------------|
| `--project <path>` | Project root (default: cwd) |
| `--global <path>` | Global config dir (default: `~/.ai-loadout`) |
| `--org <path>` | Org-level index path |
| `--session <path>` | Session overlay index path |

## Agent Runtime

`planLoad(task, opts?)` → `LoadPlan`
`recordLoad(entryId, trigger, mode, tokensEst, opts?)` → `void`
`manualLookup(id, opts?)` → `LoadoutEntry | undefined`

The runtime is the primary agent-facing API. It wraps the full sequence: resolve → match → decide → record.

### LoadPlan

| Field | Type | Stability | Description |
|-------|------|-----------|-------------|
| `preload` | `MatchResult[]` | Stable | Core entries — load immediately |
| `onDemand` | `MatchResult[]` | Stable | Domain entries — load when task matches |
| `manual` | `LoadoutEntry[]` | Stable | Manual entries — explicit lookup only |
| `provenance` | `Record<string, string>` | Stable | entryId → source layer |
| `budget` | `Budget` | Stable | Token budget from resolved index |
| `conflicts` | `MergeConflict[]` | Stable | Entries overridden across layers |
| `layerNames` | `string[]` | Stable | Contributing layer names |
| `preloadTokens` | `number` | Stable | Sum of preload entry tokens |
| `onDemandTokens` | `number` | Stable | Sum of on-demand entry tokens |

### RuntimeOptions

Extends `ResolveOptions` with:

| Field | Type | Description |
|-------|------|-------------|
| `usagePath` | `string?` | JSONL file path for usage recording |
| `taskHash` | `string?` | Session-local task identifier |

See `AGENT_CONTRACT.md` for full integration guide.

## Design Constraints

- Zero production dependencies
- Pure TypeScript ESM
- Node ≥ 20
- Deterministic: same inputs → same outputs (except `generated` timestamps)
- Core types, matcher, validator, and merge are pure functions (no I/O)
- Resolver, runtime, and usage modules perform filesystem I/O for practical use
