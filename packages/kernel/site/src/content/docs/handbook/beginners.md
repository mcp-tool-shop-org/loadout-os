---
title: Beginners Guide
description: New to AI Loadout? This page explains what it is, who it's for, and walks you through your first five minutes.
sidebar:
  order: 99
---

## What is this tool?

AI Loadout is a context-aware knowledge router for AI agents. When you give an AI agent a large set of rules, instructions, or domain knowledge, dumping everything into context every session wastes tokens and clutters the agent's attention. AI Loadout solves this by maintaining a lightweight **dispatch table** (always loaded) that routes the agent to topic-specific **payloads** (loaded on demand).

The dispatch table is a JSON index where each entry has an ID, keywords, a priority tier, and a token estimate. When the agent receives a task like "fix the CI workflow," the matcher scores entries by keyword overlap and returns the relevant payloads -- in this case, your CI rules -- while leaving unrelated knowledge unloaded.

The library also provides a hierarchical resolver that merges indexes across four layers (global, org, project, session), an agent runtime contract (`planLoad`) that wraps the full resolve-match-load sequence, and an observability layer for tracking which payloads actually get used.

## Who is this for?

AI Loadout is designed for:

- **AI tool authors** building agents that need structured access to domain knowledge without overloading context windows
- **Teams managing shared rules** across multiple projects who want a global/org/project layer hierarchy
- **Claude Code users** who maintain large CLAUDE.md files and want to break them into routed, on-demand payloads
- **Anyone building AI-powered CLI tools** that need to load the right instructions for the right task

You do NOT need this if your agent's total instructions fit comfortably in a single prompt (under ~2,000 tokens). AI Loadout shines when you have tens of knowledge payloads that should be loaded selectively.

## Prerequisites

- **Node.js 20 or later** -- check with `node --version`
- **npm** -- comes with Node.js
- **TypeScript** is recommended but not required; the library ships compiled JavaScript with type declarations

No native dependencies, no build tools, no database. It runs anywhere Node.js runs.

## Your First 5 Minutes

### 1. Install the package

```bash
npm install @mcptoolshop/ai-loadout
```

Or install globally for the CLI:

```bash
npm install -g @mcptoolshop/ai-loadout
```

### 2. Create a dispatch table

Create a file at `.claude/loadout/index.json` in your project:

```json
{
  "version": "1.0.0",
  "generated": "2026-01-01T00:00:00Z",
  "entries": [
    {
      "id": "testing-rules",
      "path": ".rules/testing.md",
      "keywords": ["test", "jest", "vitest", "coverage"],
      "patterns": ["test_suite"],
      "priority": "domain",
      "summary": "Testing conventions and required coverage thresholds",
      "triggers": { "task": true, "plan": true, "edit": false },
      "tokens_est": 400,
      "lines": 30
    },
    {
      "id": "never-skip-tests",
      "path": ".rules/core.md",
      "keywords": [],
      "patterns": [],
      "priority": "core",
      "summary": "Non-negotiable: every commit must include tests",
      "triggers": { "task": true, "plan": true, "edit": true },
      "tokens_est": 120,
      "lines": 8
    }
  ],
  "budget": {
    "always_loaded_est": 120,
    "on_demand_total_est": 400,
    "avg_task_load_est": 200,
    "avg_task_load_observed": null
  }
}
```

### 3. Match a task

```typescript
import { matchLoadout } from "@mcptoolshop/ai-loadout";
import { readFileSync } from "node:fs";

const index = JSON.parse(readFileSync(".claude/loadout/index.json", "utf-8"));
const results = matchLoadout("add unit tests for the parser", index);

for (const { entry, score, matchedKeywords, mode } of results) {
  console.log(`${entry.id}: score=${score}, mode=${mode}, matched=[${matchedKeywords}]`);
}
// never-skip-tests: score=1, mode=eager, matched=[]
// testing-rules: score=0.25, mode=lazy, matched=[test]
```

The core entry always appears (score 1.0, mode eager). The domain entry matched on the keyword "test" and got a score of 0.25 (1 out of 4 keywords matched).

### 4. Use the agent runtime

```typescript
import { planLoad } from "@mcptoolshop/ai-loadout";

const plan = planLoad("add unit tests for the parser");
console.log("Preload:", plan.preload.map(m => m.entry.id));
console.log("On-demand:", plan.onDemand.map(m => m.entry.id));
console.log("Token cost:", plan.preloadTokens, "preload +", plan.onDemandTokens, "on-demand");
```

`planLoad` calls the resolver behind the scenes, which looks for index files at four canonical paths: `~/.ai-loadout/index.json` (global), `$AI_LOADOUT_ORG` (org), `<cwd>/.claude/loadout/index.json` (project), and `$AI_LOADOUT_SESSION` (session). Missing layers are normal -- most setups only use the project layer. If no index is found anywhere, the plan returns empty arrays.

### 5. Validate your index

```bash
ai-loadout validate .claude/loadout/index.json
```

This checks for structural issues: missing fields, duplicate IDs, non-kebab-case IDs, domain entries without keywords, summaries over 120 characters, and negative budget values.

Add `--json` for machine-readable output:

```bash
ai-loadout validate .claude/loadout/index.json --json
```

You can also run `ai-loadout --help` to see all available commands, or `ai-loadout --version` to confirm which version is installed.

### 6. Write a payload file with frontmatter

Create the file referenced by your entry's `path` field. Include frontmatter so that the routing metadata lives with the content:

```markdown
---
id: testing-rules
keywords: [test, jest, vitest, coverage]
patterns: [test_suite]
priority: domain
triggers:
  task: true
  plan: true
  edit: false
---

# Testing Conventions

All code must have tests. Minimum coverage: 80%.
Use vitest for unit tests...
```

The frontmatter is the source of truth for routing. The index is derived from it. If they ever drift, `ai-loadout validate` catches the mismatch.

## Common Mistakes

**Putting everything at `core` priority.** Core entries are always loaded regardless of the task. If you make everything core, you lose the benefit of on-demand routing. Reserve core for truly non-negotiable rules (3-5 entries max).

**Forgetting keywords on domain entries.** Domain entries with no keywords can never be matched by the matcher. The `validate` command catches this as an error (`EMPTY_KEYWORDS`).

**Using regex in patterns.** The `patterns` field contains named intents like `"ci_pipeline"` -- they are not regular expressions. The matcher splits each pattern on `_` and checks if **any** of those words appear in the task. A pattern of `"ci_pipeline"` matches a task containing the word "ci" or "pipeline." A matching pattern adds a +0.2 bonus to the entry's score.

**Huge payloads behind a single entry.** If one payload is 5,000 tokens and others are 200, the budget becomes misleading. Break large payloads into focused sub-topics with separate entries.

**Hand-editing the budget numbers.** The `budget` object should reflect the actual token estimates from your entries. When adding or removing entries, update the budget totals accordingly, or use tooling (like `@mcptoolshop/claude-rules`) that regenerates them automatically.

## Next Steps

- Read [Concepts](/ai-loadout/handbook/concepts/) to understand priority tiers, the resolver layer stack, and merge semantics
- Read [API Reference](/ai-loadout/handbook/reference/) for the full list of exports and CLI commands
- Try `ai-loadout resolve` to see how the resolver discovers and merges your indexes
- Try `ai-loadout explain <entry-id>` to trace how a specific entry resolves across layers
- Explore the [CLI commands](/ai-loadout/handbook/reference/#cli) for budget analysis, dead entry detection, and keyword overlap reporting

## Glossary

| Term | Definition |
|------|------------|
| **Dispatch table** | The `LoadoutIndex` JSON structure containing entries and a budget. Always loaded into agent context as a lightweight routing index. |
| **Payload** | A markdown file containing domain knowledge (rules, instructions, reference material). Loaded on demand when the matcher finds a keyword hit. |
| **Entry** | A single row in the dispatch table (`LoadoutEntry`). Contains an ID, path to the payload file, keywords, patterns, priority, summary, triggers, and token estimate. |
| **Priority** | One of `core` (always loaded), `domain` (loaded when keywords match), or `manual` (never auto-loaded, explicit lookup only). |
| **Load mode** | How an entry enters context: `eager` (immediately, for core), `lazy` (on demand, for domain), or `manual` (explicit lookup only). |
| **Layer** | One level in the resolver hierarchy: global (~/.ai-loadout/), org ($AI_LOADOUT_ORG), project (.claude/loadout/), or session ($AI_LOADOUT_SESSION). Later layers override earlier ones. |
| **Resolver** | The module that discovers index files from canonical layer paths and merges them deterministically. |
| **Provenance** | A mapping from entry ID to the layer name it came from. Answers "where did this rule originate?" |
| **Frontmatter** | YAML-like metadata at the top of a payload file (between `---` delimiters). Contains id, keywords, patterns, priority, and triggers. The source of truth for routing metadata. |
| **Budget** | Token estimates for context planning: always-loaded total, on-demand total, and average task load. Helps answer "how much context am I saving?" |
| **Dead entry** | An entry that has never been loaded according to usage logs. Candidate for demotion to manual or removal. |
| **Keyword overlap** | When multiple entries share the same keyword, creating routing ambiguity. Detected by `findKeywordOverlaps()`. |
