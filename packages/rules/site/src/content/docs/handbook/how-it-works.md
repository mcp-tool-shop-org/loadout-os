---
title: How It Works
description: The three-layer architecture and routing system behind Claude Rules.
sidebar:
  order: 2
---

## Three Layers

Claude Rules reorganizes your instruction file into three layers:

### 1. Operator Console (CLAUDE.md)

After splitting, your CLAUDE.md becomes a lean index — just core rules that must always be loaded, plus a table pointing to extracted rule files. Typically under 50 lines.

### 2. Dispatch Table (index.json)

A machine-readable JSON file at `.claude/rules/index.json`. Contains every extracted rule's ID, path, keywords, patterns, priority, and token estimate. The agent reads this to decide what to load.

### 3. Rule Payloads (.claude/rules/*.md)

Markdown files with frontmatter metadata. Each file covers one topic (GitHub Actions, shipping hygiene, etc.). Loaded on demand when the task matches.

## Priority Tiers

Every section gets classified into one of three tiers:

| Tier | Behavior | Example |
|------|----------|---------|
| `core` | Always inline in CLAUDE.md | "test is right until proven otherwise" |
| `domain` | Loaded when keywords match | CI rules when editing workflows |
| `manual` | Never auto-loaded | Obscure platform gotchas |

The classifier uses heading text, content length, and domain signal words (CI, deploy, publish, security, etc.) to determine priority.

## How Routing Works

The agent sees the dispatch table in CLAUDE.md and two signals nudge it to load a rule file:

1. **Semantic match** — the task mentions "publishing" or "CI"
2. **Explicit instruction** — CLAUDE.md says "read that rule file before planning"

This is a hint system, not magic. The combination of keyword matching and explicit instruction makes it reliable.

## Frontmatter

Each rule file carries its own routing metadata:

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
Content here...
```

Frontmatter is the source of truth. The index is derived from it. If they drift, `validate` catches it.

## Knowledge OS Architecture

claude-rules is a **Layer 2 adapter** in the Knowledge OS stack:

| Layer | Package | Role |
|-------|---------|------|
| Kernel | `@mcptoolshop/ai-loadout` | Dispatch table, matching, resolver, agent runtime |
| Adapter | `@mcptoolshop/claude-rules` | CLAUDE.md optimization |
| Adapter | `@mcptoolshop/claude-memories` | MEMORY.md optimization |

The dispatch tables produced by `split` are compatible with the kernel's resolver (`ai-loadout resolve`) and agent runtime (`planLoad`).

## Invariants

These always hold:

- Every extracted section leaves a 1-line summary in CLAUDE.md
- Every `domain`/`manual` rule exists in `index.json`
- Every `core` rule stays inline (never extracted to file-only)
- Frontmatter is the source of truth; `index.json` is derived
- The parser only splits on ATX headings (`##`, `###`)
