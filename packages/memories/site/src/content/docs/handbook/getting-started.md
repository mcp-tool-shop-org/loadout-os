---
title: Getting Started
description: Install claude-memories and run your first analysis.
sidebar:
  order: 1
---

## Install

```bash
npm install -g @mcptoolshop/claude-memories
```

Requires Node.js 20 or later.

## First analysis

Point claude-memories at your MEMORY.md file:

```bash
claude-memories analyze MEMORY.md
```

This scans the file for topic references, reads each linked topic file, and reports what it finds — topics, references, token costs, and any structural issues.

## Generate a dispatch table

```bash
claude-memories index MEMORY.md
```

This writes `memory/index.json` (relative to MEMORY.md) that maps keywords to topic files. An agent can use this table to load only the relevant memory topic instead of the entire MEMORY.md.

Use `--lazy` to mark all entries as on-demand (loaded only when matched):

```bash
claude-memories index MEMORY.md --lazy
```

Use `--out` to write the index to a custom path:

```bash
claude-memories index MEMORY.md --out .claude/memory-index.json
```

## Validate your setup

After indexing, check for broken references or orphan files:

```bash
claude-memories validate MEMORY.md
```

This exits with code 1 if any errors are found, making it suitable for CI pipelines.

## MEMORY.md format

claude-memories expects topic references in arrow format:

```
Topic Name — description → `memory/topic-file.md`
```

Both bulleted and non-bulleted entries work:

```
- AI Loadout — routing core for agents → `memory/ai-loadout.md`
Claude Rules — CLAUDE.md optimizer → `memory/claude-rules.md`
```

Each referenced file becomes an entry in the dispatch table with keywords auto-extracted from the topic name and file headings.
