---
title: Usage
description: All commands, options, and workflows for claude-memories.
sidebar:
  order: 2
---

## Commands

### analyze

Analyze MEMORY.md structure, references, and token costs.

```bash
claude-memories analyze MEMORY.md
```

Reports: topic count, reference count, total tokens, per-topic token breakdown, and any issues found (missing files, orphans, duplicates).

### index

Generate a dispatch table from your memory files.

```bash
claude-memories index MEMORY.md
claude-memories index MEMORY.md --lazy
claude-memories index MEMORY.md --out .claude/memory-index.json
```

| Flag | Effect |
|------|--------|
| `--lazy` | Mark all entries as on-demand (loaded only when matched) |
| `--out <path>` | Write the index to a custom path instead of `memory/index.json` |

The output is a `LoadoutIndex` compatible with [@mcptoolshop/ai-loadout](https://www.npmjs.com/package/@mcptoolshop/ai-loadout).

### validate

Lint memory files for structural issues.

```bash
claude-memories validate MEMORY.md
```

Checks for:
- **Missing topic files** — referenced but not found on disk
- **Orphan files** — exist in the memory directory but aren't referenced
- **Duplicate references** — same file referenced more than once
- **Empty names** — entries with no topic name

Exits with code 1 if any errors are found. Warnings alone do not cause a non-zero exit.

### stats

Token budget dashboard.

```bash
claude-memories stats MEMORY.md
```

Shows total tokens, per-priority breakdown (core/domain/manual), always-loaded vs on-demand budget, estimated savings percentage, and the top 10 entries by token cost.

### health

Check installation and auto-detect MEMORY.md locations.

```bash
claude-memories health
```

Reports Node.js version compatibility (requires 20+), platform info, and scans common locations for existing memory files:

- `MEMORY.md` in the current directory
- `.claude/MEMORY.md`
- `~/.claude/projects`

## Frontmatter

Topic files can include optional frontmatter for fine-grained control over routing:

```markdown
---
id: ai-loadout
keywords: [loadout, routing, dispatch, kernel]
patterns: [knowledge_routing]
priority: domain
triggers:
  task: true
  plan: true
  edit: false
---
```

| Field | Purpose |
|-------|---------|
| `id` | Unique identifier (defaults to kebab-case of the topic name, e.g. "AI Loadout" becomes `ai-loadout`) |
| `keywords` | Override auto-extracted keywords |
| `patterns` | Named patterns this topic supports |
| `priority` | `core`, `domain`, or `manual` |
| `triggers` | Which agent actions trigger this topic |

Without frontmatter, keywords are auto-extracted from the topic name and headings.
