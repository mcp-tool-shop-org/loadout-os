---
title: Handbook
description: Everything you need to know about Claude Rules.
sidebar:
  order: 0
---

Welcome to the Claude Rules handbook. This is the complete guide to analyzing, splitting, and maintaining your CLAUDE.md instruction files.

## What's inside

- **[Beginners](/claude-rules/handbook/beginners/)** — New to Claude Rules? Start here
- **[Getting Started](/claude-rules/handbook/getting-started/)** — Install and analyze your first file
- **[How It Works](/claude-rules/handbook/how-it-works/)** — The three-layer architecture
- **[Commands](/claude-rules/handbook/commands/)** — Full CLI reference
- **[Security](/claude-rules/handbook/security/)** — Attack surface and threat model

## The Problem

CLAUDE.md files grow over time. Every line costs tokens every session — whether it matters for the current task or not. A 300-line instruction file quietly becomes a tax on every thought the model has.

## The Fix

Claude Rules splits your instruction file into three layers:

| Layer | File | Loaded |
|-------|------|--------|
| Operator console | `CLAUDE.md` | Always (lean index) |
| Dispatch table | `.claude/rules/index.json` | Always (machine-readable) |
| Rule payloads | `.claude/rules/*.md` | On demand |

The agent reads the dispatch table and loads rule files when the task matches their keywords. The rest stay unloaded, saving context tokens every session.

[Back to landing page](/claude-rules/)
