---
title: Architecture
description: How claude-memories fits into the Knowledge OS stack.
sidebar:
  order: 3
---

## Knowledge OS layers

claude-memories is a **Layer 2 adapter** in the Knowledge OS stack:

| Layer | Package | Role |
|-------|---------|------|
| Kernel | `@mcptoolshop/ai-loadout` | Dispatch table, matching, resolver, agent runtime |
| Adapter | `@mcptoolshop/claude-rules` | CLAUDE.md optimization — converts rule files to dispatch tables |
| Adapter | `@mcptoolshop/claude-memories` | MEMORY.md optimization — converts memory files to dispatch tables |

Same kernel, different document types. Both adapters produce compatible `LoadoutIndex` dispatch tables that the kernel's resolver and runtime (`planLoad`) can consume.

## How it works

1. **Parse** — reads MEMORY.md and finds all topic references (arrow format: `Name → path`)
2. **Read** — loads each referenced topic file from disk
3. **Extract** — pulls keywords from topic names, file headings, and optional frontmatter
4. **Index** — generates a `LoadoutIndex` with one entry per topic, keyed by extracted keywords
5. **Validate** — checks structural integrity (missing files, orphans, duplicates)

## The dispatch table

The output `index.json` is a standard `LoadoutIndex` from ai-loadout:

```json
{
  "version": "1.0.0",
  "generated": "2026-03-06T12:00:00Z",
  "entries": [
    {
      "id": "ai-loadout",
      "path": "memory/ai-loadout.md",
      "keywords": ["loadout", "routing", "dispatch", "kernel"],
      "patterns": ["knowledge_routing"],
      "priority": "domain",
      "summary": "Knowledge OS kernel, resolver, agent runtime contract, CLI",
      "triggers": { "task": true, "plan": true, "edit": false },
      "tokens_est": 1850,
      "lines": 147
    }
  ],
  "budget": {
    "always_loaded_est": 669,
    "on_demand_total_est": 42458,
    "avg_task_load_est": 1370,
    "avg_task_load_observed": null
  }
}
```

An agent calls `planLoad("work on ai-loadout")`, the kernel resolves layers, matches task keywords against entry keywords, and returns a load plan with only the matching topic files.

## Design constraints

- **Local-only** — no network calls, no telemetry, no external services
- **Read-mostly** — only writes `index.json`; never modifies MEMORY.md or topic files
- **Deterministic** — same inputs always produce the same outputs
- **Minimal dependencies** — single runtime dependency (ai-loadout kernel), which itself has zero dependencies
