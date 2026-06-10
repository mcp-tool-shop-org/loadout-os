---
title: Commands
description: Full CLI reference for Claude Rules.
sidebar:
  order: 3
---

## analyze

Score sections and propose splits. Shows which sections are core (stay inline) and which can be extracted.

```bash
claude-rules analyze [path]
claude-rules analyze .claude/CLAUDE.md
claude-rules analyze --memory          # also process MEMORY.md
claude-rules analyze --signals my.json # custom scoring signals
```

**Output:** Section-by-section breakdown with priority classification, suggested filenames, keywords, and a budget estimate showing potential savings.

---

## split

Interactive extraction — approve each section before it's written to disk.

```bash
claude-rules split [path]
claude-rules split --dry-run       # preview without writing
claude-rules split --yes           # accept all, no prompts (scriptable)
claude-rules split --memory        # also include MEMORY.md sections
claude-rules split --lazy          # store in .claude/loadout/ (not auto-loaded)
claude-rules split --rules-dir .rules   # custom output directory
```

For each proposed extraction, you see:
- The section content (trimmed preview)
- Suggested filename and path
- Suggested keywords and priority
- Option to approve or skip

Use `--yes` for scripted/CI workflows. Writes are atomic — if anything fails, originals are untouched and CLAUDE.md is backed up to `.bak`.

**Generates:**
- `.claude/rules/<id>.md` — rule file with frontmatter (or `.claude/loadout/` with `--lazy`)
- `.claude/rules/index.json` — dispatch table
- Updated `CLAUDE.md` — lean index with core rules and a routing table
- `CLAUDE.md.bak` — backup of the original

With `--lazy`, rule files are stored in `.claude/loadout/` instead of `.claude/rules/`. The agent reads them on demand via the dispatch table rather than Claude Code auto-loading them.

---

## validate

Lint the rules directory for health issues.

```bash
claude-rules validate
claude-rules validate --rules-dir .rules
```

**Checks:**
- Missing file references (index points to file that doesn't exist)
- Orphaned rule files (file exists but isn't in index)
- Frontmatter drift (ID or priority in file doesn't match index)
- Empty keywords on domain rules
- Duplicate IDs

**Exit codes:** 0 = clean, 1 = issues found.

---

## stats

Token budget dashboard showing the physics of your system.

```bash
claude-rules stats
claude-rules stats --json              # machine-readable JSON output
claude-rules stats --rules-dir .rules
```

**Output (split state):**

```
claude-rules stats

  CLAUDE.md (always loaded)
    Lines: 42    Tokens (est): 320

  Rule files (on-demand)
    github-actions           56 lines    680 tokens  domain
    shipping                 38 lines    310 tokens  domain
    ──────────────────────────────────────────────────────
    Total on-demand:         94 lines    990 tokens

  Budget
    Always loaded:         320 tokens
    On-demand total:       990 tokens
    Avg task load (est):   420 tokens  (keyword-weighted)
    Savings vs monolithic: 75%
```

The average task load is keyword-weighted — rules with more keywords are assumed more likely to be triggered and contribute proportionally more to the estimate.

If no split has been done yet, shows the monolithic file stats and suggests running `split`.

---

## init-signals

Generate a default `signals.json` to customize how sections are scored:

```bash
claude-rules init-signals
claude-rules init-signals --signals custom/path.json
```

The signals file controls three things:
- **domainSignals** — words that trigger domain classification (e.g. "ci", "workflow", "marketing")
- **stopWords** — words filtered from extracted keywords (e.g. "the", "and", "must")
- **patterns** — content patterns mapped to named intents (e.g. `"ci_pipeline": ["ci", "workflow"]`)

When no signals file exists, built-in defaults are used. Edit the generated file to tune scoring for your project.

---

## Global Options

| Flag | Description |
|------|-------------|
| `--memory` | Also process MEMORY.md (analyze, split) |
| `--dry-run` | Preview without writing files (split); safety signal for validate |
| `--yes` | Accept all proposals without prompting (split) |
| `--lazy` | Store rule files in `.claude/loadout/` for on-demand loading (split) |
| `--json` | Machine-readable JSON output (stats) |
| `--signals <path>` | Custom signals config path (default: `.claude/signals.json`) |
| `--rules-dir <path>` | Custom rules directory (default: `.claude/rules/`) |
| `--version` | Show version |
| `--help` | Show help |
