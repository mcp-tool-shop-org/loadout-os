# Agent Contract

> How any agent consumes a resolved loadout.
> Version: 1.4.0

## Overview

ai-loadout provides a portable knowledge routing contract. This document defines how agents — Claude Code, MCP servers, CLI wrappers, editor extensions, or any other consumer — integrate against it.

The contract is three things:

1. **A resolved-loadout schema** — the stable output shape agents receive
2. **A match-and-load sequence** — the steps agents follow
3. **Integration patterns** — how different agent types wire it up

## The Sequence

Every agent follows the same five steps:

```
1. RESOLVE   — discover and merge layered indexes
2. MATCH     — score entries against the current task
3. DECIDE    — separate preload / on-demand / manual
4. LOAD      — read payload files into context
5. RECORD    — log what was loaded (optional, enables observability)
```

Steps 1-3 are handled by `planLoad(task)`. Steps 4-5 are the agent's responsibility.

## API Surface

### `planLoad(task, opts?)`

The primary integration point. Returns a `LoadPlan`:

```typescript
import { planLoad } from "@mcptoolshop/ai-loadout";

const plan = planLoad("set up CI pipeline for the new repo");

// plan.preload     — MatchResult[] — load these immediately (core entries)
// plan.onDemand    — MatchResult[] — load when task warrants it (domain entries)
// plan.manual      — LoadoutEntry[] — only on explicit request
// plan.provenance  — Record<string, string> — entryId → source layer
// plan.budget      — Budget — token budget summary
// plan.conflicts   — MergeConflict[] — entries overridden across layers
// plan.layerNames  — string[] — which layers contributed
// plan.preloadTokens  — number — total tokens in preload set
// plan.onDemandTokens — number — total tokens in on-demand set
```

### `recordLoad(entryId, trigger, mode, tokensEst, opts?)`

Optional. Records that an entry was loaded into context.

```typescript
import { recordLoad } from "@mcptoolshop/ai-loadout";

recordLoad("github-actions", "keyword-ci", "lazy", 330, {
  usagePath: ".claude/loadout-usage.jsonl",
  taskHash: "abc123",
});
```

### `manualLookup(id, opts?)`

Explicit lookup for manual-priority entries.

```typescript
import { manualLookup } from "@mcptoolshop/ai-loadout";

const entry = manualLookup("xrpl-reference");
if (entry) {
  // read entry.path, load into context
}
```

## LoadPlan Schema

The stable output shape agents integrate against:

| Field | Type | Stability | Description |
|-------|------|-----------|-------------|
| `preload` | `MatchResult[]` | Stable | Core entries — always load these |
| `onDemand` | `MatchResult[]` | Stable | Domain entries — load when task matches |
| `manual` | `LoadoutEntry[]` | Stable | Manual entries — explicit lookup only |
| `provenance` | `Record<string, string>` | Stable | entryId → source layer name |
| `budget` | `Budget` | Stable | Token budget from resolved index |
| `conflicts` | `MergeConflict[]` | Stable | Entries defined in multiple layers |
| `layerNames` | `string[]` | Stable | Contributing layer names in order |
| `preloadTokens` | `number` | Stable | Sum of preload entry tokens |
| `onDemandTokens` | `number` | Stable | Sum of on-demand entry tokens |

### MatchResult (per entry)

| Field | Type | Description |
|-------|------|-------------|
| `entry` | `LoadoutEntry` | The full entry with id, path, keywords, etc. |
| `score` | `number` | 0-1, match strength |
| `matchedKeywords` | `string[]` | Which keywords matched |
| `matchedPatterns` | `string[]` | Which patterns matched |
| `reason` | `string` | Human-readable explanation |
| `mode` | `LoadMode` | `"eager"` / `"lazy"` / `"manual"` |

## Layer Resolution

The resolver checks fixed locations in a fixed order:

| Priority | Layer | Location |
|----------|-------|----------|
| 1 (lowest) | `global` | `~/.ai-loadout/index.json` |
| 2 | `org` | `$AI_LOADOUT_ORG` or explicit path |
| 3 | `project` | `<cwd>/.claude/loadout/index.json` |
| 4 (highest) | `session` | `$AI_LOADOUT_SESSION` or explicit path |

Later layers override earlier ones for the same entry ID. Missing layers are normal.

## Integration Patterns

### Claude Code Agent

The most common pattern. CLAUDE.md references the loadout, and the agent uses keyword matching to load rules on demand.

```
.claude/
  loadout/
    index.json          ← dispatch table
  rules/
    github-actions.md   ← payload files
    shipcheck.md
    ...
CLAUDE.md               ← references loadout, instructs lazy loading
```

The agent:
1. Reads CLAUDE.md (which includes the dispatch table or a pointer to it)
2. On each task, matches against the index
3. Loads matching payloads via the Read tool
4. Records loads to `.claude/loadout-usage.jsonl`

### MCP Server

An MCP server can expose loadout matching as a tool:

```
Tool: match_knowledge
Input: { task: "deploy to production" }
Output: { entries: [...], budget: {...} }
```

The server calls `planLoad()` internally and returns the plan. The calling agent decides what to load.

### CLI Wrapper

A CLI tool wraps the runtime for shell-based workflows:

```bash
# What should I load for this task?
ai-loadout resolve

# Why did this entry win?
ai-loadout explain github-actions

# After a session, what went unused?
ai-loadout dead .claude/loadout/index.json usage.jsonl
```

### Editor Extension

An editor extension (VS Code, etc.) can use the runtime to suggest relevant knowledge files when the user opens a project or starts a task.

## Observability Contract

Usage recording is optional but enables three diagnostic capabilities:

| Capability | Function | Requires |
|-----------|----------|----------|
| Dead entry detection | `findDeadEntries()` | Usage log |
| Budget drift analysis | `analyzeBudget()` | Usage log |
| Frequency tracking | `summarizeUsage()` | Usage log |

Usage events are:
- **Append-only** — never modified or deleted
- **Local-only** — never transmitted over the network
- **JSONL format** — one JSON object per line
- **Optional** — the system works without recording

## Guarantees

1. **Deterministic** — same inputs produce the same plan (except timestamps)
2. **Graceful degradation** — missing layers, files, or configs don't crash
3. **No network** — everything is local filesystem
4. **No side effects** — `planLoad()` only reads; `recordLoad()` only appends
5. **Backward compatible** — new fields are additive; existing fields don't change meaning
6. **Zero dependencies** — no runtime deps beyond Node.js
