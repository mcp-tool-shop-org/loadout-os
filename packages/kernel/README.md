<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/ai-loadout/readme.png" width="400" alt="ai-loadout">
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/ai-loadout/actions/workflows/ci.yml"><img src="https://github.com/mcp-tool-shop-org/ai-loadout/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://codecov.io/gh/mcp-tool-shop-org/ai-loadout"><img src="https://codecov.io/gh/mcp-tool-shop-org/ai-loadout/graph/badge.svg" alt="Coverage"></a>
  <a href="https://www.npmjs.com/package/@mcptoolshop/ai-loadout"><img src="https://img.shields.io/npm/v/@mcptoolshop/ai-loadout" alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>
  <a href="https://mcp-tool-shop-org.github.io/ai-loadout/"><img src="https://img.shields.io/badge/Landing_Page-live-blue" alt="Landing Page"></a>
</p>

Context-aware knowledge router for AI agents.

`ai-loadout` is the kernel of the Knowledge OS stack — dispatch table format, matching engine, hierarchical resolver, and agent runtime contract. Instead of dumping everything into context, you keep a tiny index and load payloads on demand.

Think of it like a game loadout — you equip the agent with exactly the knowledge it needs before each mission.

## Install

```bash
npm install -g @mcptoolshop/ai-loadout   # CLI
npm install @mcptoolshop/ai-loadout       # library
```

## Core Concepts

### The Dispatch Table

A `LoadoutIndex` is a structured index of knowledge payloads:

```json
{
  "version": "1.0.0",
  "generated": "2026-03-06T12:00:00Z",
  "entries": [
    {
      "id": "github-actions",
      "path": ".rules/github-actions.md",
      "keywords": ["ci", "workflow", "runner"],
      "patterns": ["ci_pipeline"],
      "priority": "domain",
      "summary": "CI triggers, path gating, runner cost control",
      "triggers": { "task": true, "plan": true, "edit": false },
      "tokens_est": 680,
      "lines": 56
    }
  ],
  "budget": {
    "always_loaded_est": 320,
    "on_demand_total_est": 8100,
    "avg_task_load_est": 520,
    "avg_task_load_observed": null
  }
}
```

### Priority Tiers

| Tier | Behavior | Example |
|------|----------|---------|
| `core` | Always loaded | "never skip tests to make CI green" |
| `domain` | Loaded when task keywords match | CI rules when editing workflows |
| `manual` | Never auto-loaded, explicit lookup only | Obscure platform gotchas |

### Payload Frontmatter

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
CI minutes are finite...
```

Frontmatter is the source of truth. The index is derived from it.

## Agent Runtime (Primary API)

The runtime is the canonical way agents consume a loadout. It wraps the full sequence: resolve layers → match task → decide what to load → record usage.

### `planLoad(task, opts?)`

Plan what to load for a given task. This is the primary agent-facing function.

```typescript
import { planLoad } from "@mcptoolshop/ai-loadout";

const plan = planLoad("fix the CI workflow");
// plan.preload   — core entries, load immediately
// plan.onDemand  — domain matches, load when needed
// plan.manual    — available via explicit lookup only
```

Returns a `LoadPlan` with:
- `preload` / `onDemand` / `manual` — entries separated by load mode
- `provenance` — which layer each entry came from
- `budget` — token budget for the resolved index
- `preloadTokens` / `onDemandTokens` — token cost totals
- `layerNames` / `conflicts` — layer metadata

### `recordLoad(entryId, trigger, mode, tokensEst, opts?)`

Record that an agent loaded an entry. Enables observability (dead entries, budget drift, frequency tracking). Optional — only writes when `usagePath` is set in options.

### `manualLookup(id, opts?)`

Explicitly load a manual entry by ID from the resolved index.

## Resolver

Discovers and merges loadout indexes from a canonical layer stack:

1. **global** — `~/.ai-loadout/index.json`
2. **org** — explicit path or `$AI_LOADOUT_ORG`
3. **project** — `<cwd>/.claude/loadout/index.json`
4. **session** — explicit path or `$AI_LOADOUT_SESSION`

Later layers win. Missing layers are normal.

```typescript
import { resolveLoadout, explainEntry } from "@mcptoolshop/ai-loadout";

const { merged, layers, searched } = resolveLoadout();
// merged.entries — deduplicated entries from all layers
// merged.provenance — entryId → source layer name

const why = explainEntry("github-actions", layers);
// why.finalLayer, why.overrideChain, why.definitions
```

## Matching

### `matchLoadout(task, index)`

Match a task description against a loadout index. Returns entries ranked by match strength.

```typescript
import { matchLoadout } from "@mcptoolshop/ai-loadout";

const results = matchLoadout("fix the CI workflow", index);
// [{ entry, score: 0.67, matchedKeywords: ["ci", "workflow"], reason, mode }]
```

- Core entries always included (score 1.0)
- Manual entries never auto-included
- Domain entries scored by keyword overlap + pattern bonus
- Results sorted by score descending, then by token cost ascending

### `lookupEntry(id, index)`

Look up a specific entry by ID. For manual entries or explicit access.

## Observability

### `recordUsage()` / `readUsage()` / `summarizeUsage()`

Append-only JSONL usage log. Never networked, never creepy.

### `findDeadEntries(index, events)`

Find entries that have never been loaded.

### `findKeywordOverlaps(index)`

Find keywords shared between entries (routing ambiguities).

### `analyzeBudget(index, usage?)`

Token budget breakdown with observed-vs-estimated comparison.

## Merge

### `mergeIndexes(layers)`

Deterministic merge for hierarchical loadouts. Returns a `MergedIndex` with provenance tracking and conflict reporting.

## Utilities

### `parseFrontmatter(content)` / `serializeFrontmatter(fm)`

Parse and serialize YAML-like frontmatter from payload files.

### `validateIndex(index)`

Validate structural integrity of a `LoadoutIndex`. Checks: required fields, unique IDs, kebab-case format, summary bounds, keyword presence for domain entries, valid priorities, non-negative budgets.

### `estimateTokens(text)`

Estimate token count from text. Uses chars/4 heuristic.

## CLI

```
ai-loadout resolve                    Resolve layered loadouts
ai-loadout explain <entry-id>         Explain why an entry resolved to its current state
ai-loadout validate <index>           Validate index structure
ai-loadout usage <jsonl>              Usage summary from event log
ai-loadout dead <index> <jsonl>       Find entries never loaded
ai-loadout overlaps <index>           Find keyword routing ambiguities
ai-loadout budget <index> [jsonl]     Token budget breakdown
```

All commands support `--json` for scripting. Resolver commands accept `--project`, `--global`, `--org`, `--session`.

## Types

```typescript
import type {
  LoadoutEntry,
  LoadoutIndex,
  Frontmatter,
  MatchResult,
  ValidationIssue,
  Priority,          // "core" | "domain" | "manual"
  Triggers,          // { task, plan, edit }
  LoadMode,          // "eager" | "lazy" | "manual"
  Budget,
  UsageEvent,
  MergeConflict,
  MergedIndex,
  LoadPlan,          // returned by planLoad()
  ResolvedLoadout,   // returned by resolveLoadout()
  EntryExplanation,  // returned by explainEntry()
  IssueSeverity,     // "error" | "warning"
  RuntimeOptions,    // options for planLoad / recordLoad / manualLookup
  ResolveOptions,    // options for resolveLoadout / discoverLayers
  UsageSummary,      // returned by summarizeUsage()
  DeadEntry,         // returned by findDeadEntries()
  KeywordOverlap,    // returned by findKeywordOverlaps()
  BudgetBreakdown,   // returned by analyzeBudget()
  DiscoveredLayer,   // a layer found and loaded by the resolver
  SearchedLayer,     // a layer search location and its result
  EntryDefinition,   // one layer's version of a specific entry
} from "@mcptoolshop/ai-loadout";
```

## Consumers

- **[@mcptoolshop/claude-rules](https://github.com/mcp-tool-shop-org/claude-rules)** — CLAUDE.md optimizer for Claude Code. Uses ai-loadout for the dispatch table and matching.
- **[@mcptoolshop/claude-memories](https://github.com/mcp-tool-shop-org/claude-memories)** — MEMORY.md optimizer for Claude Code. Generates dispatch tables from memory topic files.

## Security

The core matching, merging, and validation modules are pure functions with no side effects. The usage module (`recordUsage` / `readUsage`) performs local filesystem I/O to an append-only JSONL log. The resolver reads index files from canonical layer paths. No network requests, no telemetry, no native dependencies.

### Threat Model

| Threat | Mitigation |
|--------|------------|
| Malformed frontmatter input | `parseFrontmatter()` returns `null` on invalid input — no exceptions, no eval |
| Prototype pollution | Hand-rolled parser uses plain object literals, no recursive merge of untrusted input |
| Index with bad data | `validateIndex()` catches structural issues before they propagate |
| Regex DoS | No user-supplied regex — patterns are matched as plain string lookups |

See [SECURITY.md](SECURITY.md) for the full security policy.

---

Built by [MCP Tool Shop](https://mcp-tool-shop.github.io/)
