<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center"><img src="logo.png" alt="loadout-os" width="500"></p>



**A Knowledge OS for AI coding agents.** One CLI that routes the right context to the model on demand — instead of dumping every memory file and rule into the context window at the start of each session.

Your instruction files and memory stores grow without bound. Every line costs tokens on every prompt, whether or not it matters to the task at hand. loadout-os keeps a tiny dispatch index always loaded and loads the heavy payloads — memory topics, rule files — only when the task keywords match. Think of it like a game loadout: equip the agent with exactly the knowledge it needs for the mission ahead.

## What's inside

loadout-os unifies four surfaces under one `loadout-os` binary:

| Surface | What it does |
|---|---|
| **Kernel** (knowledge router) | Deterministic keyword/pattern matcher, hierarchical layered resolver (global → org → project → session), and the agent runtime contract. Core entries always load; domain entries load on match; manual entries load on explicit lookup. |
| **Memories adapter** | Turns a `MEMORY.md` store into a machine-readable dispatch table and lints it (missing files, orphans, duplicates, over-long entries). |
| **Rules adapter** | Splits a bloated `CLAUDE.md` into a lean always-loaded index plus on-demand rule files, and validates frontmatter against the index. |
| **Runtime hook** | A `UserPromptSubmit` hook that injects ≤5 pointer lines (≤200 tokens) to the entries relevant to your prompt. Fail-silent: every error path exits 0, so a broken hook can never block a prompt. |

Plus three rituals that keep the system honest: **`refresh`** (regenerate → validate → publish the dispatch index, with a backup compensator), **`doctor`** (a read-only 8-check health screen), and **`report`** (usage / dead-entry / token-budget observability).

## Command surface

```
# Memory store adapter
loadout-os memories index    <MEMORY.md> [--lazy] [--json]
loadout-os memories validate <MEMORY.md> [--json]
loadout-os memories stats    <MEMORY.md> [--json]
loadout-os memories health   [path] [--json]

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

# Rituals + hook
loadout-os doctor [--json]                    # read-only health screen
loadout-os report [--index <p>] [--jsonl <p>] # observability over usage.jsonl
loadout-os hook test [--prompt "<text>"]      # drive the runtime hook on a sample prompt
loadout-os refresh [--store <d>] [--dest <p>] [--dry-run]  # index → validate → publish
```

> **Name collision, resolved by namespacing.** The flat `validate <index>` is the kernel's index-structure validator. The store and rules linters are namespaced — `memories validate <MEMORY.md>` and `rules validate` — so all three coexist. Run `loadout-os <command> --help` for per-command synopsis, arguments, and exit codes.

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

Decompose-by-secrets (Parnas 1972) was the clean answer for a team of N humans. For a solo operator plus an LLM crew it is operationally broken: multi-repo work fragments the agent's context across sessions, unpublished adapters rot (only the kernel ever shipped), and advancement serializes across repos. One named umbrella repo with one CLI serves the operator. Full reasoning lives in the canonical memory store (`feedback_consolidate_when_cant_juggle_repos.md`).

## Status

Consolidation in progress. loadout-os folds together the kernel and two adapters that previously lived as separate packages, plus the live runtime hook. The published upstream today is **`@mcptoolshop/ai-loadout`** (the kernel); the unified `loadout-os` package ships from this repo. The three legacy bins keep working until their planned retirement.

## Trust model

loadout-os runs entirely on your machine. There is no network call, no telemetry, and no account.

- **Data it touches (local only):** your memory store (`MEMORY.md` + topic files), your instruction files (`CLAUDE.md` + `.claude/rules/`), the generated dispatch index next to the store, the global resolver index (`~/.ai-loadout/index.json`), and the append-only usage log (`~/.ai-loadout/usage.jsonl`).
- **Data it does NOT touch:** no network egress, no telemetry, no remote services, no credentials or secrets. Nothing is read, stored, or transmitted off the local disk paths above.
- **Permissions required:** local filesystem only. `doctor` and `report` are pure reads (they never write). The only writes are the index files, the interactive `rules split` output, and the usage log — all in the expected local locations above. The irreversible write (`refresh` publishing the live global index) is guarded by an andon halt on validation failure and a `<dest>.bak` compensator. The runtime hook is fail-silent: every error path exits `0`, so it can never block a prompt.

Full threat model and reporting process: [SECURITY.md](./SECURITY.md).

## License

MIT — matches all upstream sources.
