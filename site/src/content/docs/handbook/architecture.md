---
title: Architecture
description: How loadout-os works — the live data flow from the canonical and project stores through the dispatch indexes to the runtime hooks, and the role of each component.
sidebar:
  order: 2
---

loadout-os has a single backbone: knowledge flows from human-edited **stores** (`MEMORY.md` + linked `index-*.md` sub-indexes) through generated **dispatch indexes** to the **global** (`~/.ai-loadout/index.json`) and **project** (`<root>/.claude/loadout/index.json`) resolver layers that the runtime hooks read.

## The live data flow

```
memory store   (MEMORY.md + index-*.md sub-indexes + topic .md files)
      │  refresh [--project <root>] [--fix]   ← Index Freshness Ritual
      ▼
resolver layers   ~/.ai-loadout/index.json (global) + <root>/.claude/loadout/index.json (project)
      │  read on EVERY UserPromptSubmit (walk-up from payload.cwd)
      ▼
runtime hook   loadout-hook.mjs
      │  resolveLoadout → matchLoadout(prompt) → ≤5 pointer lines (fair share + sub-index preference)
      ▼
injected additionalContext   +   usage events (with layer: "global" | "project") → ~/.ai-loadout/usage.jsonl
```

Key design properties:

- **Global + project layers merge automatically.** `loadout-hook.mjs` walks up from `payload.cwd` (or `process.cwd()`, overridable via `AI_LOADOUT_PROJECT_INDEX`) to find `.claude/loadout/index.json`, merges it with `~/.ai-loadout/index.json` via `resolveLoadout` (project wins on ID collisions), and emits project matches under `[loadout-hook] Project memory entries relevant to this prompt...`.
- **Fair share and sub-index preference.** Up to 5 pointer lines are injected in total, with fair-share allocation across global and project layers and preference for sub-index entries (`subindex: true`) over top-level `MEMORY.md` entries. `core` entries marked `metadata.loadout_inject: session-start` are injected in full by `loadout-os hook session-start` and excluded from per-prompt pointer slots.
- **Single-source summaries and loader limits.** Topic frontmatter `description` is the authoritative summary source (`memories sync-summaries` and `refresh --fix` keep index bullets in sync), and `memories validate` enforces a hard error (`MEMORY_LIMIT_EXCEEDED`) above 180 lines or 24,000 bytes so `MEMORY.md` is never silently truncated by Claude Code's 200-line / 25 KB auto-loader cap.
- **Shell-edit fallback.** Edits through `Write`/`Edit` trigger `loadout-os hook post-write` (`PostToolUse`), while edits made through a shell (`Bash`/`PowerShell`) skip `PostToolUse` and are caught by `loadout-os hook session-start` when any `<store>/*.md` is newer than the project `index.json`.

## The four components

### Kernel — the knowledge router

- **Match** — `matchLoadout(task, index)` scores a task against the index.
- **Resolve** — `resolveLoadout()` discovers and merges loadout indexes from **global** (`~/.ai-loadout/index.json`) → **org** → **project** (walking up to `.claude/loadout/index.json`) → **session**.
- **Plan** — `planLoad(task)` separates entries into `preload`, `onDemand`, and `manual`.
- **Observe** — `usage.jsonl` records `layer: "global" | "project"` for every hook injection.

### Memories adapter

Parses a `MEMORY.md` store and expands linked sub-indexes (`index-*.md` or `metadata.loadout_role: subindex`), reads each topic file's frontmatter (`name`, `description`, `type`, `priority`, `metadata`), strips punctuation in keyword extraction while preserving file-stem tokens, and generates a kernel-compatible dispatch table. Entries in `index-archive.md` (or sub-indexes with `metadata.loadout_default_priority: manual`) default to `priority: "manual"` unless overridden in topic frontmatter.

### Rules adapter

Analyzes and splits a `CLAUDE.md` instruction file into a lean always-loaded index plus on-demand rule files with `.bak` backups.

### Runtime hooks

- `loadout-hook.mjs` — `UserPromptSubmit` pointer router.
- `loadout-os hook session-start` — `SessionStart` full-board UTF-8 injector, cap enforcer, staleness checker, and shell-edit fallback refresher (plus `--user-prompt-submit` warning-only mode).
- `loadout-os hook pre-compact` — `PreCompact` board staleness warning before compaction.
- `loadout-os hook post-write` — `PostToolUse` validator and project index refresher (exiting `2` on errors for `asyncRewake`).
