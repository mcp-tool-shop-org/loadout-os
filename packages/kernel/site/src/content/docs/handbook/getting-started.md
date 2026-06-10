---
title: Getting Started
description: Install AI Loadout and write your first dispatch table.
sidebar:
  order: 1
---

## Requirements

- Node.js 20+
- TypeScript (recommended, not required)

## Install

```bash
npm install -g @mcptoolshop/ai-loadout   # CLI
npm install @mcptoolshop/ai-loadout       # library
```

## Your first dispatch table

A `LoadoutIndex` is a JSON object that maps task keywords to knowledge payloads:

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
    "on_demand_total_est": 680,
    "avg_task_load_est": 340,
    "avg_task_load_observed": null
  }
}
```

## Match a task

```typescript
import { matchLoadout } from "@mcptoolshop/ai-loadout";

const results = matchLoadout("fix the CI workflow", index);

for (const { entry, score, matchedKeywords } of results) {
  console.log(`${entry.id}: ${score} (matched: ${matchedKeywords.join(", ")})`);
}
// github-actions: 0.67 (matched: ci, workflow)
```

## Plan a load (agent runtime)

The primary agent-facing API — resolve layers, match task, decide what to load:

```typescript
import { planLoad } from "@mcptoolshop/ai-loadout";

const plan = planLoad("fix the CI workflow");
// plan.preload   — core entries, load immediately
// plan.onDemand  — domain matches, load when needed
// plan.manual    — available via explicit lookup only
```

## Use the CLI

Resolve your layered loadouts and inspect entries:

```bash
ai-loadout resolve                       # show all layers and entries
ai-loadout explain github-actions        # trace an entry's decision path
ai-loadout budget .claude/rules/index.json  # token budget breakdown
```

## Next steps

Read [Concepts](/ai-loadout/handbook/concepts/) to understand priority tiers, the resolver, and the agent runtime.
