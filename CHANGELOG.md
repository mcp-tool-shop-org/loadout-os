# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

The consolidation of the Knowledge OS into a single npm-workspaces monorepo with one
unified CLI. Three previously-separate packages and the live runtime hook now live and
ship together under `loadout-os`.

### Added

- **Workspace monorepo** — `packages/{kernel,memories,rules,cli}` + `apps/hook` wired
  under one npm-workspaces root, with an intentional topological build order
  (kernel → memories → rules → cli) so the adapters build against the kernel's dist.
- **Unified `@mcptoolshop/loadout-os` CLI** (`packages/cli`) — one binary that wraps the
  three library surfaces (kernel = ai-loadout, memories, rules) and absorbs the
  operational rituals:
  - Namespaced adapter surfaces: `memories <index|validate|stats|health>` and
    `rules <analyze|validate|stats|split>`.
  - Flat kernel verbs: `resolve`, `explain`, `usage`, `dead`, `overlaps`, `budget`,
    `validate` (the kernel index-structure validator — the flat-vs-namespaced split is
    how the `validate` name collision is resolved).
  - **`doctor`** — a read-only 8-check health screen over the live store, global index,
    runtime-hook drift, resolver layers, core entries, observability loop, hook wiring,
    and usage growth. Never writes.
  - **`report`** — read-only observability over `usage.jsonl`: usage summary, dead
    entries, token budget, and a score distribution for calibrating the hook floor.
  - **`refresh`** — the Index Freshness Ritual (index → validate → publish) folded into
    one command, with an andon halt on validation failure and a `<dest>.bak` compensator
    on the one irreversible write.
  - `hook test` — drive the runtime hook on a sample prompt in an isolated HOME.
- **Runtime hook unified** (`apps/hook/loadout-hook.mjs`) — the `UserPromptSubmit` hook
  that injects ≤5 pointer lines (≤200 tokens). Fail-silent: every error path exits `0`.
- **Shared CLI substrate** — one arg parser, one structured `CliError { code, message,
  hint }` shape routed at the process boundary (no raw stack traces), and per-command
  `--help` with synopsis, arguments, flags, an example, and exit codes for every leaf
  command.
- **Documentation** — a Starlight handbook (overview, getting started, architecture,
  command reference, rituals, migration) connected to the landing page, plus a root
  `SECURITY.md` covering the consolidated attack surface.

### Fixed

- **Matcher recall** (FT-K1) — domain entries were scored by pure coverage
  (`matched / declared keyword count`), which starved keyword-rich entries: a genuine
  2–3 keyword match on the live 30+-keyword entries scored below the 0.1 inclusion floor.
  The matcher now blends coverage with an absolute recall signal (`max(coverage,
  matched / 5)`), so real multi-keyword matches are reachable while single incidental
  hits stay quiet.

### Changed

- The three legacy bins (ai-loadout, claude-memories, claude-rules) keep working until
  their planned retirement; the unified `loadout-os` package ships from this repo. The
  published upstream today remains `@mcptoolshop/ai-loadout` (the kernel).

<!-- ## [1.0.0] - YYYY-MM-DD -->
<!-- ### Added -->
<!-- - First consolidated release. -->
