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

- **Project-layer runtime hook routing** (`apps/hook/loadout-hook.mjs`, `packages/kernel`) —
  the `UserPromptSubmit` hook now resolves both the global (`~/.ai-loadout/index.json`) and
  project (`<root>/.claude/loadout/index.json`) layers via `resolveLoadout`, walking up from
  `payload.cwd` (or `process.cwd()`, overridable via `AI_LOADOUT_PROJECT_INDEX`). Project
  entries win on ID collisions, share the 5-entry total cap fairly across layers with
  preference for sub-index entries (`subindex: true`) over top-level `MEMORY.md` entries,
  exclude `metadata.loadout_inject: session-start` boards from per-prompt slots, emit under
  `[loadout-hook] Project memory entries relevant to this prompt...`, and log
  `layer: "global" | "project"` to `~/.ai-loadout/usage.jsonl`. With no project index, output
  is byte-identical to global-only mode.
- **Sub-index expansion, frontmatter summary authority, and loader-limit enforcement**
  (`packages/memories`, `packages/kernel`) — `MEMORY.md` can link to sub-index files
  (`index-*.md` or files with `metadata.loadout_role: subindex` in frontmatter); sub-index
  bullets are expanded into the dispatch index with `subindex: true`, counted by orphan
  detection, and checked for broken links (`MISSING_TOPIC_FILE`). Entries in
  `index-archive.md` (or sub-indexes with `metadata.loadout_default_priority: manual`)
  default to `priority: "manual"` unless overridden in topic frontmatter. `parseFrontmatter`
  now accepts Claude Code's `name` / `description` / `type` / `priority` / `metadata`
  frontmatter (falling back from `id` to kebab-cased `name`), sources entry `summary` from
  topic frontmatter `description`, warns with `STALE_INDEX_SUMMARY` when index bullets drift,
  and adds `loadout-os memories sync-summaries`, `place`, and `move`. `memories validate`
  reports `MEMORY_LIMIT_EXCEEDED` above 180 lines or 24,000 bytes (`warning` by default;
  `error` when opted in via `MEMORY.md` frontmatter `enforce_limits: true` / `max_lines` /
  `max_bytes`, `<store>/.loadout.json`, or `--max-lines` / `--max-bytes`), citing the
  measured 2026-11-08 truncation event.
- **Project refresh, OS file locking, and git snapshot/mirror** (`packages/cli`) —
  `loadout-os refresh --store <dir> --project <root>` writes `<root>/.claude/loadout/index.json`
  (recording `source` for `post-write` store discovery) while leaving the global index
  untouched, keeping the andon halt and `.bak` compensator natively, serializing via an OS
  lockfile (`withFileLock`), and supporting `--fix`, `--snapshot-repo <dir>`, and
  `--mirror-repo <bare>` (`git init --bare -b main`, non-zero exit on commit/push failure,
  exit `2` on subprocess timeout).
- **SessionStart, PreCompact, and PostToolUse hooks** (`packages/cli`) —
  - `loadout-os hook session-start`: prints every `core` entry with
    `metadata.loadout_inject: session-start` in full as UTF-8 under a file header, enforces
    line/byte caps with a visible truncation note, warns when older than
    `metadata.stale_after_min` (with `--user-prompt-submit` warning-only mode), fails open
    with visible warnings when the index or board is missing or corrupt, and auto-refreshes
    when any `<store>/*.md` is newer than the project `index.json` (catching shell edits).
  - `loadout-os hook pre-compact`: warns on stdout when the session-start board is older
    than `stale_after_min` before compaction.
  - `loadout-os hook post-write`: `PostToolUse` command for `Write`/`Edit` that validates
    and refreshes the project index when the edited path is inside the configured store,
    exiting `2` with the errors on any failure (for `asyncRewake`) and `0` silently otherwise.
- **Workspace monorepo** — `packages/{kernel,memories,rules,cli}` + `apps/hook` wired
  under one npm-workspaces root, with an intentional topological build order
  (kernel → memories → rules → cli) so the adapters build against the kernel's dist.
- **Unified `@mcptoolshop/loadout-os` CLI** (`packages/cli`) — one binary that wraps the
  three library surfaces (kernel = ai-loadout, memories, rules) and absorbs the
  operational rituals:
  - Namespaced adapter surfaces: `memories <index|validate|stats|health|sync-summaries|place|move>` and
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

- **Keyword punctuation stripping and stem patterns** (**F-04**) — punctuation (`:`, `(`, `)`,
  `,`, etc.) is stripped before stop-word filtering during keyword extraction, file-stem
  tokens are included, and stem/id tokens populate `patterns` so 1–2 exact technical words
  clear the hook's `0.5` score floor.
- **Matcher recall** (FT-K1) — domain entries were scored by pure coverage
  (`matched / declared keyword count`), which starved keyword-rich entries: a genuine
  2–3 keyword match on the live 30+-keyword entries scored below the 0.1 inclusion floor.
  The matcher now blends coverage with an absolute recall signal (`max(coverage,
  matched / 5)`), so real multi-keyword matches are reachable while single incidental
  hits stay quiet.
- **Unmigrated global stores pass `refresh` and `doctor`** (Q5-1) — `slugifyName` in
  `packages/kernel/src/frontmatter.ts` now strips ASCII and curly apostrophes (`'`,
  `\u2018`, `\u2019`) before splitting words (aligned with `nameToId` in
  `packages/memories/src/index-gen.ts`), preventing false `ID_FILENAME_MISMATCH` warnings
  on possessive titles. `generateIndex` deduplicates multiple bullets pointing to the same
  resolved `storePath` into one entry at the first bullet's position instead of emitting
  `DUPLICATE_ID` errors. `MEMORY_LIMIT_EXCEEDED` in `packages/memories/src/validate.ts`
  is now `severity: "warning"` by default and `severity: "error"` only when a store opts in
  via `MEMORY.md` frontmatter (`enforce_limits: true` / `max_lines` / `max_bytes`),
  `<store>/.loadout.json`, or explicit `--max-lines` / `--max-bytes` flags.
- **`doctor` `hook-drift` compares against the built standalone bundle** (Q7-3) — root
  `npm run build` now builds `apps/hook/dist/loadout-hook.mjs` (`npm run build -w apps/hook`),
  and `packages/cli/src/doctor.ts` points `hookSource` to `apps/hook/dist/loadout-hook.mjs`
  instead of the unbundled `apps/hook/loadout-hook.mjs` entry file.
- **CLI `--help` and README synopses for `memories sync-summaries`, `place`, and `move`**
  (Q7-2) — aligned `packages/cli/src/help.ts`, `packages/cli/src/cli.ts`, `README.md`, and
  `packages/cli/README.md` with `packages/cli/src/commands.ts` (`sync-summaries <MEMORY.md>
  [--fix] [--json]`, `place <topic.md> <index> [--store <dir>] [--into <index>] [--json]`,
  and `move <topic.md> <index> [--store <dir>] [--into <index>] [--json]`).
- **Windows path normalization in `hook post-write`** (Q3-1) — `normalizeHookPath`,
  `isPathInsideDir`, and `runPostWrite` in `packages/cli/src/hook.ts` now resolve relative
  `tool_input.file_path` values against `payload.cwd` (`startDir`), expand `~/...` and MSYS
  `/c/...` paths, strip Windows `\\?\` extended-length prefixes, and compare paths
  case-insensitively on Windows.
- **`withFileLock` wait timeout vs `gitTimeoutMs`** (Q3-4) — raised `LOCK_WAIT_MS` in
  `packages/cli/src/refresh.ts` from `15_000` ms to `DEFAULT_GIT_TIMEOUT_MS + 5_000`
  (`35_000` ms, scaling with `opts.gitTimeoutMs + 5_000`) so a second `post-write` waits
  for a slow git snapshot/mirror push rather than timing out with `LOCK_TIMEOUT`.
- **Atomic index writes in `runRefresh`** (Q2-6) — `runRefresh` in
  `packages/cli/src/refresh.ts` now writes `<dest>.tmp.<pid>` (and
  `<storeIndexPath>.tmp.<pid>`) and commits via `renameSync` instead of `copyFileSync`,
  preventing a crash mid-write from leaving a truncated global or project `index.json`.

### Changed

- The three legacy bins (ai-loadout, claude-memories, claude-rules) keep working until
  their planned retirement; the unified `loadout-os` package ships from this repo. The
  published upstream today remains `@mcptoolshop/ai-loadout` (the kernel).

<!-- ## [1.0.0] - YYYY-MM-DD -->
<!-- ### Added -->
<!-- - First consolidated release. -->
