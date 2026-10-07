# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.4] - 2026-10-07

### Fixed

- **Markdown-link index entries were never parsed** (MEM-B12): the MEMORY.md parser's
  header promised Markdown links, but no branch handled them, so every entry written
  as `- [Title](file.md) — hook` was dropped. That is the format Claude Code's own
  memory instructions prescribe. Each such entry was left out of the dispatch index and
  reported `ORPHAN_TOPIC_FILE` even though MEMORY.md links it, so the UserPromptSubmit
  hook never surfaced any memory written that way. The parser now accepts a bullet whose
  first token is a link to a relative `.md` file, optionally bolded and led by a short
  status marker (`- **⭐ [Title](memory/x.md)** — hook`). The text after the link
  becomes the description. An em-dash inside the link text splits name from subtitle.
  Gated like MEM-001: links inside prose, URLs, absolute paths, globs and non-`.md`
  targets are rejected, and arrow-format lines keep their existing branch. On the
  canonical store the index went 542 → 559 entries and orphan warnings 39 → 24. The
  change also surfaced one link that pointed at the wrong directory.

## [1.0.3] - 2026-09-07

### Fixed

- **Index entries recorded the raw pointer instead of the resolved file** (FT-MR11) —
  `generateIndex` resolved each MEMORY.md reference correctly (trying the store dir,
  then its parent) and then discarded the result, storing `ref.path` verbatim. The
  store's own convention writes pointers as `memory/foo.md`, where `memory/` is a
  namespace label for the store rather than a subdirectory of it, so `refresh`'s
  `rewritePathsAbsolute` re-applied the prefix and emitted a doubled
  `…/memory/memory/foo.md`. On the canonical store that left **420 of 492 published
  entries (85%) pointing at files that do not exist** — and because the
  UserPromptSubmit hook reads that published index on every prompt, every session was
  silently handed dead paths and fell back to paraphrasing one-line summaries, which
  is precisely what the store's own rule forbids. Entries now record the location that
  actually resolved, relative to the store root with POSIX separators, so both store
  layouts resolve. Live index went 72/492 → **492/492**. Regression fixture
  `fixtures/flat-store/` pins the shape the original fixture never exercised: the
  previous fixture put MEMORY.md *above* its `memory/` directory, so every ref
  matched on the first base and the parent-base fallback was never under test.
- **`DEFAULT_STORE` hardcoded one machine's home directory** — the shipped default
  store path was an absolute literal containing a username, so it resolved on exactly
  one computer and leaked that username into a public package. It is now derived from
  `homedir()`, matching `defaultDest()` directly below it.

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
