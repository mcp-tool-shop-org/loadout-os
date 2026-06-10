---
title: Beginners
description: New to Claude Rules? This guide covers everything you need to get started.
sidebar:
  order: 99
---

## What is this tool?

Claude Rules is a CLI that optimizes your CLAUDE.md instruction files for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). It takes a large instruction file and splits it into a lean routing index (always loaded) and topic-specific rule files (loaded on demand). The result: fewer tokens consumed per session, with no loss of functionality.

Instead of loading every instruction every time, the agent reads a small dispatch table and only pulls in the rules relevant to the current task. A 300-line instruction file that previously loaded in full every session can be reduced to around 30 lines always-loaded, with the rest loaded only when needed.

## Who is this for?

Claude Rules is for anyone who uses Claude Code with instruction files (CLAUDE.md) and wants to:

- **Reduce token waste** -- large instruction files cost tokens every session, even when most content is irrelevant to the task at hand
- **Keep instructions organized** -- as projects grow, a single CLAUDE.md becomes hard to maintain
- **Speed up agent responses** -- less context to process means faster, more focused responses
- **Work on teams** -- split rule files make it easier for multiple people to maintain different instruction domains

If your CLAUDE.md is under 20 lines, you probably do not need this tool. If it has grown past 50 lines and covers multiple topics (CI, security, publishing, coding standards), Claude Rules will help.

## Prerequisites

- **Node.js 20 or later** -- check with `node --version`
- **A CLAUDE.md file** -- either at `.claude/CLAUDE.md` or `CLAUDE.md` in your project root
- **Basic CLI comfort** -- you will run commands in a terminal

No database, no network access, no API keys. Claude Rules is a purely local tool that reads and writes markdown files.

## Your First 5 Minutes

**Step 1: Install**

```bash
npm install -g @mcptoolshop/claude-rules
```

Or skip the install and run directly:

```bash
npx @mcptoolshop/claude-rules analyze
```

**Step 2: Analyze your CLAUDE.md**

Navigate to your project directory and run:

```bash
claude-rules analyze
```

This reads your instruction file, scores each section, and shows which sections should stay inline (core) and which can be extracted to separate files (domain). You will see a budget estimate showing how many tokens you can save.

**Step 3: Split interactively**

If the analysis looks good, run the split:

```bash
claude-rules split
```

For each section proposed for extraction, you will see a preview and can approve or skip. Nothing is written until you approve. Your original CLAUDE.md is backed up to `.bak` before any changes.

To preview without writing anything:

```bash
claude-rules split --dry-run
```

**Step 4: Validate**

After splitting, confirm everything is healthy:

```bash
claude-rules validate
```

This checks that all index references point to real files, frontmatter matches the index, and no rule files are orphaned.

**Step 5: Check your savings**

```bash
claude-rules stats
```

This shows your token budget: how much is always loaded vs on-demand, and the percentage saved per session.

## Common Mistakes

**Running split before analyze.** Always run `analyze` first to understand what will be proposed. The `split` command runs analysis internally, but reviewing the analysis output first helps you make better approve/skip decisions.

**Editing index.json by hand.** The index file is generated from rule file frontmatter. If you need to change keywords or priority, edit the frontmatter in the `.md` file and re-run `split`. Manual edits to `index.json` will drift from frontmatter and `validate` will flag the mismatch.

**Extracting everything.** Not every section benefits from extraction. Short sections (under 8 lines) that apply universally should stay as core. The analyzer already classifies these correctly -- trust its core/domain classification unless you have a specific reason to override.

**Forgetting to run validate after manual changes.** If you rename, move, or edit rule files by hand, always run `claude-rules validate` afterward to catch broken references or frontmatter drift.

**Ignoring the --dry-run flag.** When trying `split` for the first time, use `--dry-run` to see exactly what would be generated without touching any files.

## Next Steps

- Read **[Getting Started](/claude-rules/handbook/getting-started/)** for a deeper walkthrough of installation and first use
- Read **[How It Works](/claude-rules/handbook/how-it-works/)** to understand the three-layer architecture and routing system
- Explore the **[Commands](/claude-rules/handbook/commands/)** reference for all flags and options
- Review the **[Security](/claude-rules/handbook/security/)** page for the threat model and attack surface analysis
- Customize scoring with `claude-rules init-signals` to tune domain detection for your project

## Glossary

| Term | Definition |
|------|------------|
| **CLAUDE.md** | The instruction file that Claude Code reads at the start of every session. Can live at `.claude/CLAUDE.md` or `CLAUDE.md` in the project root. |
| **Core** | A priority tier for sections that must always be loaded. Short, universal rules stay inline in CLAUDE.md. |
| **Domain** | A priority tier for sections loaded on demand when the task matches their keywords. |
| **Manual** | A priority tier for sections that are never auto-loaded. Used for obscure or rarely-needed rules. |
| **Dispatch table** | The `index.json` file that maps rule IDs to file paths, keywords, and priorities. The agent reads this to decide which rules to load. |
| **Frontmatter** | YAML metadata at the top of each rule file (between `---` markers). Contains the rule's ID, keywords, patterns, priority, and trigger settings. |
| **Rule file** | A markdown file in `.claude/rules/` containing one extracted topic with frontmatter routing metadata. |
| **Signals** | A configuration file (`.claude/signals.json`) that controls which words trigger domain classification, which words are filtered from keywords, and which content patterns map to named intents. |
| **Token budget** | The estimated token cost of your instruction setup. Always-loaded tokens are the fixed cost per session; on-demand tokens are loaded only when relevant. |
| **Lazy loading** | An optional mode (`--lazy` flag) where rule files are stored in `.claude/loadout/` and are not auto-loaded by Claude Code. The agent reads them explicitly via the dispatch table. |
