---
title: Overview
description: What the loadout-os Knowledge OS is, the four surfaces it unifies, the problem it solves, and who it is for.
sidebar:
  order: 0
---

**loadout-os is a Knowledge OS for AI coding agents** — one repo and one `loadout-os` CLI that route the right context to the model on demand, instead of dumping every memory file and rule into the context window at the start of each session.

This is the handbook for the consolidated tool. For the landing page, see [loadout-os](/loadout-os/); the source lives at [mcp-tool-shop-org/loadout-os](https://github.com/mcp-tool-shop-org/loadout-os).

## The problem

Instruction files and memory stores grow without bound. A `CLAUDE.md` that started at 40 lines becomes 300; a memory store accumulates hundreds of topic files. Every line costs tokens on every prompt, whether or not it matters to the task in front of the agent. A real workspace can pour 40K+ tokens of mostly-irrelevant context into each session before the agent has read a single word of the actual request.

The deeper failure is fragmentation. When knowledge is spread across many repos and many always-loaded files, the agent never sees a coherent picture — and the operator pays the token tax forever.

## The idea

Keep a tiny **dispatch table** always loaded — a machine-readable index of every knowledge payload with its keywords, priority, and a one-line summary. Load the heavy payloads (memory topics, rule files) only when the task keywords match. Think of it like a game loadout: equip the agent with exactly the knowledge it needs for the mission, and nothing else.

Entries fall into three priority tiers:

| Tier | Behavior |
|------|----------|
| `core` | Always loaded — the rules that apply to every task |
| `domain` | Loaded when the task keywords match — e.g. CI rules when editing a workflow |
| `manual` | Never auto-loaded; available only on explicit lookup |

## The four surfaces

loadout-os unifies four previously-separate pieces under one binary:

- **Kernel — the knowledge router.** A deterministic keyword and pattern matcher, a hierarchical resolver that merges loadout indexes across layers (global → org → project → session), and the agent runtime contract (`planLoad`) that decides what to preload, what to load on demand, and what to leave for manual lookup. Pure functions, no network, no eval.
- **Memories adapter.** Parses a `MEMORY.md` store into a dispatch table compatible with the kernel, then validates it. The dispatch-table format means a 669-token `MEMORY.md` can route to 40K+ tokens of topic files that load only on match.
- **Rules adapter.** Splits a bloated `CLAUDE.md` into a lean always-loaded index plus on-demand rule files, each carrying its own routing frontmatter. Validates frontmatter against the generated index so the two never drift.
- **Runtime hook.** A `UserPromptSubmit` hook that, on each prompt, matches it against the global index and injects ≤5 pointer lines (≤200 tokens) to the most relevant entries. Pointers, not payloads — the agent opens the pointed file when it needs the detail. Fail-silent by design: every error path exits 0, so a broken hook can never block a prompt.

On top of these sit three **rituals** — `refresh`, `doctor`, and `report` — covered in [Rituals](./rituals/).

## Who it's for

loadout-os is for anyone running an AI coding agent (Claude Code in particular) against a growing body of project knowledge and wanting to stop paying a per-prompt token tax on context that rarely applies. It is the answer to multi-repo context fragmentation: one index, one router, one set of rituals, instead of N always-loaded files scattered across N repos.

## Where to go next

- [Getting started](./getting-started/) — install and your first commands
- [Architecture](./architecture/) — the live data flow and the four components
- [Command reference](./reference/) — every command, argument, and exit code
- [Rituals](./rituals/) — `refresh`, `doctor`, `report`, and when to run each
- [Migration](./migration/) — moving from the three legacy packages
