---
title: Architecture
description: How loadout-os works — the live data flow from the canonical store through the dispatch index to the runtime hook, and the role of each of the four components.
sidebar:
  order: 2
---

loadout-os has a single backbone: knowledge flows from a human-edited **store** through a generated **dispatch index** to a global **resolver layer** the runtime hook reads on every prompt. This page traces that flow and then describes the four components that implement it.

## The live data flow

```
canonical store   ~/.claude/projects/F--AI/memory/   (memory topic .md files + MEMORY.md)
      │  memories index + validate          ← the Index Freshness Ritual
      ▼
store dispatch table   <store>/index.json
      │  refresh  (absolute-path rewrite + copy, with .bak compensator)
      ▼
global layer   ~/.ai-loadout/index.json     (the merged, always-resolvable index)
      │  read on EVERY UserPromptSubmit
      ▼
runtime hook   loadout-hook.mjs   (wired in ~/.claude/settings.json)
      │  matchLoadout(prompt) → ≤5 pointer lines, ≤200 tokens, pointers NOT payloads
      ▼
injected additionalContext   +   usage events → ~/.ai-loadout/usage.jsonl
```

Three consequences fall out of this shape:

- **The hook reads the global copy, not the store.** Edits to your `MEMORY.md` do not take effect until you regenerate the index and publish it to `~/.ai-loadout/index.json`. That regenerate-validate-publish sequence is exactly what the `refresh` ritual automates.
- **Pointers, not payloads.** The hook never injects the body of a memory entry — it injects a short pointer line so the agent can open the right file on demand. This is what keeps the per-prompt cost under ~200 tokens regardless of how large the store grows.
- **The loop closes through `usage.jsonl`.** Every injected pointer records a usage event. That append-only log is what `report` reads to find dead entries (never loaded) and to measure the real token budget against the estimate.

## The four components

### Kernel — the knowledge router

The kernel is the engine. It does four jobs:

- **Match** — `matchLoadout(task, index)` scores a task against the index. Core entries are always included (score 1.0); manual entries are never auto-included; domain entries are scored by keyword overlap plus a pattern bonus, then sorted by score and broken ties by token cost.
- **Resolve** — `resolveLoadout()` discovers and merges loadout indexes from the canonical layer stack: **global** (`~/.ai-loadout/index.json`) → **org** → **project** (`<cwd>/.claude/loadout/index.json`) → **session**. Later layers win; missing layers are normal. `explainEntry` traces an entry's override chain across those layers.
- **Plan** — `planLoad(task)` is the agent-facing runtime contract. It returns a plan separating entries into `preload` (core, load immediately), `onDemand` (domain matches), and `manual`, along with provenance and a token budget.
- **Observe** — an append-only JSONL usage log feeds `findDeadEntries`, `findKeywordOverlaps`, and `analyzeBudget` (observed-vs-estimated token comparison).

The matching, merging, and validation modules are pure functions with no side effects. There is no user-supplied regex (patterns are plain string lookups, so no regex DoS), no network, and no native dependencies.

### Memories adapter

Parses a `MEMORY.md` store for topic references in arrow format (`Topic Name — description → path`), reads each topic file, extracts keywords from headings and content, and generates a kernel-compatible dispatch table. Topic files may carry optional frontmatter (`id`, `keywords`, `patterns`, `priority`, `triggers`) for fine-grained routing control; without it, keywords are auto-extracted. `validate` catches missing topic files, orphans, duplicate references, and over-long ids/summaries.

### Rules adapter

Does the same job for a `CLAUDE.md` instruction file. `analyze` scores each section and proposes which to keep inline (`core`) and which to extract to on-demand rule files. `split` performs the extraction with atomic writes and a `.bak` backup — originals are untouched if anything fails. Frontmatter on each rule file is the source of truth; the generated `index.json` is derived from it, and `validate` flags any drift between the two.

### Runtime hook

A single-file `UserPromptSubmit` hook (`loadout-hook.mjs`). On each prompt it matches against the global index, applies a score floor (so off-topic matches stay silent) and the manual-entry filter, and injects up to five pointer lines as `additionalContext`. It is fail-silent by design: every error path exits `0`, so a broken hook can never block a prompt. The hook can be disabled for testing via the `AI_LOADOUT_HOOK=off` environment variable, and `loadout-os hook test` drives it against a sample prompt in an isolated HOME so the live `usage.jsonl` is never written.

## How routing actually works

The router is a hint system for the agent loop, not magic. Two signals make it reliable: a **semantic match** (the task mentions "CI" or "publishing" and the keyword scorer surfaces the matching entry) and an **explicit instruction** (the index entry, and the hook's injected pointer, tell the agent to open that file before planning or editing). The combination of deterministic keyword matching plus explicit instruction is what makes on-demand loading dependable rather than aspirational.
