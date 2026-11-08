---
title: Rituals
description: The loadout-os rituals and lifecycle hooks — refresh, doctor, report, and the session-start / pre-compact / post-write hooks — that keep the knowledge OS in sync, healthy, and observable.
sidebar:
  order: 4
---

The rituals are the consolidation payoff. Before loadout-os, keeping the knowledge OS healthy meant a multi-step manual sequence run by hand. Now there are three rituals (**`refresh`**, **`doctor`**, **`report`**) plus lifecycle hooks (**`session-start`**, **`pre-compact`**, **`post-write`**) that automate project-layer memory.

## `refresh` — keep the index in sync

```
loadout-os refresh [--store <dir>] [--dest <path>] [--project <root>] [--snapshot-repo <dir>] [--mirror-repo <bare>] [--fix] [--dry-run]
```

`refresh` folds the entire Index Freshness Ritual into one command. It (a) optionally syncs drifted bullet summaries from topic frontmatter (`--fix`), (b) regenerates the store index from `MEMORY.md` (expanding linked `index-*.md` and `metadata.loadout_role: subindex` files, and collapsing duplicate bullets targeting the same topic file into one entry), (c) validates it with an **andon halt** on any error-severity issue (`MEMORY_LIMIT_EXCEEDED` at 180 lines / 24 KB is a warning by default and becomes a hard error when a store opts in via frontmatter `metadata.enforce_limits: true`, `.loadout.json`, or `--max-lines` / `--max-bytes`), (d) rewrites relative entry paths to absolute paths under the store root and writes the global resolver index (`~/.ai-loadout/index.json`) or the project resolver index (`<root>/.claude/loadout/index.json` when `--project <root>` is passed), and (e) optionally commits all store `.md` files to `--snapshot-repo` and pushes to `--mirror-repo`.

Three safety properties protect the write:

- **Andon halt.** If validation surfaces any error-severity issue, `refresh` prints the issues and exits `1`, writing nothing downstream.
- **Named compensator.** Before overwriting an existing destination, `refresh` copies it to `<dest>.bak`. On any write failure it restores the destination from that backup and re-throws.
- **OS file lock.** Concurrent `refresh` and `post-write` runs serialize via an atomic OS lockfile so overlapping runs cannot corrupt `index.json` or race on git snapshots.

```bash
loadout-os refresh --dry-run                          # see what would change
loadout-os refresh                                    # publish global index
loadout-os refresh --store ./memory --project .       # publish project index only
```

Exit codes: `0` index written (or dry-run printed) · `1` validation error (andon), write failure, or git failure · `2` store / MEMORY.md missing or subprocess timeout.

## Lifecycle Hooks (`session-start`, `pre-compact`, `post-write`)

For project-level memory stores, wire the four Claude Code hooks in `.claude/settings.local.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "loadout-os hook session-start"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/loadout-hook/loadout-hook.mjs"
          },
          {
            "type": "command",
            "command": "loadout-os hook session-start --user-prompt-submit"
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "loadout-os hook pre-compact"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "loadout-os hook post-write --fix"
          }
        ]
      }
    ]
  }
}
```

- **`loadout-os hook session-start`** prints every `core` entry marked `metadata.loadout_inject: session-start` (such as `BOARD.md`) in full as UTF-8 under a file header, enforces configurable line/byte caps (`--max-lines` / `--max-bytes`) with a visible truncation note, warns when the board is older than `metadata.stale_after_min`, and checks whether any `<store>/*.md` is newer than the project `index.json` (auto-refreshing when edits were made through a shell, which skip `PostToolUse`).
- **`loadout-os hook pre-compact`** warns on stdout when the injected board is older than `stale_after_min` so the agent refreshes `BOARD.md` before compaction.
- **`loadout-os hook post-write`** runs after `Write`/`Edit` tool calls. When the edited path is inside the store recorded in `index.source`, it validates and refreshes the project index, exiting `2` with the errors on any failure (for `asyncRewake`) and `0` silently otherwise.

## `doctor` — is the system healthy?

```
loadout-os doctor [--store <dir>] [--index <p>] [--settings <p>] [--usage <p>] [--repo-root <dir>] [--json]
```

`doctor` is a read-only health screen — it **never writes**. It runs eight checks across the whole live system, each delegating to a library validator rather than self-grading.

## `report` — is the index earning its keep?

```
loadout-os report [--index <p>] [--jsonl <p>] [--json]
```

`report` is the observability loop. It composes the kernel's usage, dead-entry, and budget analysers over `usage.jsonl` and the global index into one report.
