---
title: Getting Started
description: Install loadout-os, run your first health check and report, and get the command tree at a glance.
sidebar:
  order: 1
---

This page gets you from zero to a working knowledge router. If you want the conceptual picture first, read the [Overview](../).

## Install

```bash
npm install -g @mcptoolshop/loadout-os
```

Confirm the install and see the full command tree:

```bash
loadout-os --help
loadout-os --version
```

## First command: `doctor`

`doctor` is a read-only health screen — it never writes anything — so it's the safest first command to run. It composes the three libraries into one pass / warn / fail report over the live knowledge OS.

```bash
loadout-os doctor
```

It runs eight checks: the memory store's `MEMORY.md` validates, the global resolver index parses and validates, the runtime hook mirror matches the repo source (drift check), no resolver layers are malformed, at least one `core` entry exists, the observability loop is wired, the hook is wired in `settings.json`, and `usage.jsonl` is growing. Each check reports `pass`, `warn`, or `fail`; the command exits `0` when there are no failures and `1` otherwise. Failing and warning checks print a `hint` telling you what to fix.

Add `--json` for the machine-readable shape — `{ checks: [{ id, status, message, hint }], ok }`:

```bash
loadout-os doctor --json
```

## First report

Once the runtime hook has recorded some usage events to `~/.ai-loadout/usage.jsonl`, `report` shows you where your context budget actually goes: a usage summary, the dead entries that have never loaded, the token budget, and — when events carry a score — the score distribution.

```bash
loadout-os report
loadout-os report --json
```

`report` is read-only. It exits `2` when a required input (the index or the usage log) is missing, so you can tell "nothing recorded yet" apart from "the report ran."

## Index a memory store

To generate a dispatch table from a `MEMORY.md` store:

```bash
loadout-os memories index ~/.claude/projects/F--AI/memory/MEMORY.md
loadout-os memories validate ~/.claude/projects/F--AI/memory/MEMORY.md
```

`index` writes a dispatch table (`index.json`) derived from your memory topic files; `validate` lints the store and exits `1` if it finds any error-severity issue (warnings alone do not fail). For the full sync-and-publish flow, see [Rituals](../rituals/).

## The command tree at a glance

```
# Memory store adapter (wraps claude-memories)
loadout-os memories index    <MEMORY.md> [--lazy] [--json]
loadout-os memories validate <MEMORY.md> [--json]
loadout-os memories stats    <MEMORY.md> [--json]
loadout-os memories health   [path] [--json]

# Instruction-file adapter (wraps claude-rules)
loadout-os rules analyze  <CLAUDE.md> [--rules-dir <dir>] [--json]
loadout-os rules validate [--rules-dir <dir>] [--lazy] [--repo-root <dir>] [--json]
loadout-os rules stats    <CLAUDE.md> [--rules-dir <dir>] [--json]
loadout-os rules split    [CLAUDE.md] [--yes] [--dry-run]

# Knowledge router (flat kernel verbs)
loadout-os resolve                  # resolve layered loadouts
loadout-os explain <entry-id>       # how an entry resolved across layers
loadout-os usage <jsonl>            # usage summary from the event log
loadout-os dead <index> <jsonl>     # entries never loaded
loadout-os overlaps <index>         # keyword routing ambiguities
loadout-os budget <index> [jsonl]   # token budget breakdown
loadout-os validate <index>         # validate index STRUCTURE (kernel)

# Rituals + hook
loadout-os doctor [--json]
loadout-os report [--index <p>] [--jsonl <p>] [--json]
loadout-os hook test [--prompt "<text>"]
loadout-os refresh [--store <d>] [--dest <p>] [--dry-run]
```

Every leaf command has a per-command help block — run `loadout-os <command> --help` for its synopsis, positional arguments, flags, an example, and exit codes. The full surface is documented in the [Command reference](../reference/).
