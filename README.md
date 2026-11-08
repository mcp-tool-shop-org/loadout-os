<p align="center">
  <a href="README.md">English</a> | <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center"><img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/loadout-os/readme.png" alt="loadout-os" width="400"></p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/loadout-os/actions/workflows/ci.yml"><img src="https://github.com/mcp-tool-shop-org/loadout-os/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://codecov.io/gh/mcp-tool-shop-org/loadout-os"><img src="https://codecov.io/gh/mcp-tool-shop-org/loadout-os/graph/badge.svg" alt="Coverage"></a>
  <a href="https://www.npmjs.com/package/@mcptoolshop/loadout-os"><img src="https://img.shields.io/npm/v/@mcptoolshop/loadout-os" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License"></a>
  <a href="https://mcp-tool-shop-org.github.io/loadout-os/"><img src="https://img.shields.io/badge/landing-page-blue" alt="Landing Page"></a>
</p>

**A Knowledge OS for AI coding agents.** One CLI that routes the right context to the model on demand — instead of dumping every memory file and rule into the context window at the start of each session.

Your instruction files and memory stores grow without bound. Every line costs tokens on every prompt, whether or not it matters to the task at hand. loadout-os keeps a tiny dispatch index always loaded and loads the heavy payloads — memory topics, rule files — only when the task keywords match. Think of it like a game loadout: equip the agent with exactly the knowledge it needs for the mission ahead.

## What's inside

loadout-os unifies four surfaces under one `loadout-os` binary:

| Surface | What it does |
|---|---|
| **Kernel** (knowledge router) | Deterministic keyword/pattern matcher, hierarchical layered resolver (global → org → project → session), and the agent runtime contract. Core entries always load; domain entries load on match; manual entries load on explicit lookup. |
| **Memories adapter** | Turns a `MEMORY.md` store (plus linked `index-*.md` or `metadata.loadout_role: subindex` sub-indexes) into a machine-readable dispatch table and lints it (loader truncation limits at 180 lines / 24 KB — warning by default, error when opted in via `--max-lines`/`--max-bytes`, frontmatter `metadata.enforce_limits: true`, or `.loadout.json` — plus missing files, orphans across sub-indexes, stale bullet summaries, duplicates, over-long entries). |
| **Rules adapter** | Splits a bloated `CLAUDE.md` into a lean always-loaded index plus on-demand rule files, and validates frontmatter against the index. |
| **Runtime hooks** | `UserPromptSubmit` pointer router (`loadout-hook.mjs`, merging global + project layers with fair-share cap and sub-index preference), `hook session-start` (UTF-8 board injection + staleness & shell-edit refresh), `hook pre-compact` (staleness warning before compaction), and `hook post-write` (`PostToolUse` validator + project refresh). |

Plus three rituals that keep the system honest: **`refresh`** (regenerate → validate → publish the dispatch index to global or `--project <root>`, with a `.bak` compensator, OS file lock, and optional `--snapshot-repo` / `--mirror-repo`), **`doctor`** (a read-only 8-check health screen), and **`report`** (usage / dead-entry / token-budget observability).

## Command surface

```
# Memory store adapter
loadout-os memories index          <MEMORY.md> [--lazy] [--json]
loadout-os memories validate       <MEMORY.md> [--max-lines <n>] [--max-bytes <n>] [--json]
loadout-os memories stats          <MEMORY.md> [--json]
loadout-os memories health         [path] [--json]
loadout-os memories sync-summaries <MEMORY.md> [--fix] [--json]
loadout-os memories place          <topic.md> <index> [--store <dir>] [--into <index>] [--json]
loadout-os memories move           <topic.md> <index> [--store <dir>] [--into <index>] [--json]

# Instruction-file adapter
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

# Rituals + hooks
loadout-os doctor [--json]                    # read-only health screen
loadout-os report [--index <p>] [--jsonl <p>] # observability over usage.jsonl
loadout-os hook test [--prompt "<text>"]      # drive the runtime hook on a sample prompt
loadout-os hook session-start [--project <r>] [--user-prompt-submit]
loadout-os hook pre-compact   [--project <r>]
loadout-os hook post-write    [--project <r>] [--snapshot-repo <d>] [--mirror-repo <b>] [--fix]
loadout-os refresh [--store <d>] [--dest <p>] [--project <r>] [--snapshot-repo <d>] [--mirror-repo <b>] [--fix] [--dry-run]
```

> **Name collision, resolved by namespacing.** The flat `validate <index>` is the kernel's index-structure validator. The store and rules linters are namespaced — `memories validate <MEMORY.md>` and `rules validate` — so all three coexist. Run `loadout-os <command> --help` for per-command synopsis, arguments, and exit codes.

## Project-Layer Memory & Claude Code Hook Wiring

Each project seat can keep its own `.claude/loadout/index.json` built from its memory store (`loadout-os refresh --store <store> --project <root>`).

### 1. Topic & Board Frontmatter

```markdown
---
name: Active Board
description: Current active task board and handoff state
priority: core
metadata:
  loadout_inject: session-start
  stale_after_min: 60
  max_lines: 60
  max_bytes: 6000
---
```

- Sub-indexes (`index-*.md` or files with `metadata.loadout_role: subindex`) are expanded one level into the dispatch index with `subindex: true`.
- `index-archive.md` (or a sub-index with `metadata.loadout_default_priority: manual`) defaults its entries to `priority: "manual"` unless a topic file explicitly sets `priority:` in frontmatter.
- `core` entries with `metadata.loadout_inject: session-start` are injected in full at `SessionStart` (and excluded from per-prompt pointer slots so they never starve routed entries).

### 2. Example `.claude/settings.local.json` Hook Blocks

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

> **Note on shell edits:** Edits made to memory files through a shell (`Bash` / `PowerShell`) skip `PostToolUse` (`Write|Edit`). As a built-in fallback, `loadout-os hook session-start` checks whether any `<store>/*.md` file is newer than the project `index.json` and automatically refreshes the project index (or warns if validation fails).

## Install

```bash
npm install -g @mcptoolshop/loadout-os    # the loadout-os CLI
loadout-os --help            # the full command tree
loadout-os doctor            # confirm the system is healthy
```

The kernel is also importable as a library — `@mcptoolshop/ai-loadout` exposes `planLoad`, `matchLoadout`, `resolveLoadout`, `recordLoad`, and the dispatch-table types.

## Documentation

- **[Handbook](https://mcp-tool-shop-org.github.io/loadout-os/handbook/)** — overview, install, architecture, command reference, rituals, and migration from the legacy packages.
- **[Repository](https://github.com/mcp-tool-shop-org/loadout-os)** — source, roadmap, and issues.

## Why consolidate

Decompose-by-secrets (Parnas 1972) was the clean answer for a team of N humans. For a solo operator plus an LLM crew it is operationally broken: multi-repo work fragments the agent's context across sessions, unpublished adapters rot (only the kernel ever shipped), and advancement serializes across repos. One named umbrella repo with one CLI serves the operator.

## Status

Shipped. **`@mcptoolshop/loadout-os`** is published on npm (public) and folds the kernel, the two adapters (memories + rules), and the live runtime hook into one CLI — install it with `npm install -g @mcptoolshop/loadout-os`. The three legacy packages it supersedes are retired: the kernel `@mcptoolshop/ai-loadout` is deprecated on npm (still installable, but receives no further work); `claude-memories` and `claude-rules` were local-only and are parked. All new work lands here.

## Trust model

loadout-os runs entirely on your machine. There is no network call, no telemetry, and no account.

- **Data it touches (local only):** your memory store (`MEMORY.md` + topic files), your instruction files (`CLAUDE.md` + `.claude/rules/`), the generated dispatch index next to the store, the global resolver index (`~/.ai-loadout/index.json`), the project resolver index (`<project>/.claude/loadout/index.json`), and the append-only usage log (`~/.ai-loadout/usage.jsonl`).
- **Data it does NOT touch:** no network egress, no telemetry, no remote services, no credentials or secrets. Nothing is read, stored, or transmitted off the local disk paths above.
- **Permissions required:** local filesystem only. `doctor` and `report` are pure reads (they never write). The only writes are the index files, the interactive `rules split` output, and the usage log — all in the expected local locations above. The irreversible write (`refresh` publishing the live global or project index) is guarded by an andon halt on validation failure and a `<dest>.bak` compensator. The prompt and session-start runtime hooks are fail-open: every error path exits `0`, so they can never block a prompt.

Full threat model and reporting process: [SECURITY.md](./SECURITY.md).

## License

MIT — matches all upstream sources.

---

<p align="center">Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a></p>
