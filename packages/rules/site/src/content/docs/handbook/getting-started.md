---
title: Getting Started
description: Install Claude Rules and analyze your first CLAUDE.md file.
sidebar:
  order: 1
---

## Requirements

- Node.js 20+
- A CLAUDE.md file (or any markdown instruction file)

## Install

```bash
npm install -g @mcptoolshop/claude-rules
```

Or run directly with npx:

```bash
npx @mcptoolshop/claude-rules analyze
```

## Analyze your CLAUDE.md

The `analyze` command scores each section and proposes extractions:

```bash
claude-rules analyze
```

You'll see output like:

```
File: .claude/CLAUDE.md  (258 lines, ~2388 tokens)

Keep inline (core): 4 sections
✓ (preamble)  2 lines
✓ Role  9 lines
✓ Guardian Self-Check  4 lines
✓ Document Delight  8 lines

Proposed extractions: 8 sections
  1. "GitHub Actions Rules" (L92-149, 58 lines, ~330 tokens)
     → .claude/rules/github-actions.md
     keywords: [github, actions, workflow, runner]

Budget estimate:
  Always loaded:    ~208 tokens (23 lines)
  On-demand:        ~2180 tokens (225 lines)
  Savings:          91% per session
```

## Split interactively

When you're ready to extract, run `split`:

```bash
claude-rules split
```

For each proposed section, you'll see a preview and can approve or skip. Approved sections get extracted to `.claude/rules/` with frontmatter metadata.

To preview without writing anything:

```bash
claude-rules split --dry-run
```

## Validate and monitor

After splitting, use `validate` to check health and `stats` to see your budget:

```bash
claude-rules validate
claude-rules stats
```

## Next steps

Read [How It Works](/claude-rules/handbook/how-it-works/) to understand the three-layer architecture and routing system.
