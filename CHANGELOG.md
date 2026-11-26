# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **PreToolUse hook framework (`loadout-os hook pre-tool`) and triad `doctor` checks** (`packages/cli`, `packages/kernel`, `packages/memories`, #24) —
  - Added the in-process `PreToolUse` guard (`runPreTool`, `--mode enforce|log-only`) with `stdin` schema validation, zero-I/O read-only tool and read-only Bash pipeline pass-through, longest-prefix `cwd` profile resolution, SHA-256 `input_hash` decision logging (`~/.ai-loadout/hook-decisions.jsonl`, `AI_LOADOUT_DECISIONS_LOG`), hard internal timeout (`300 ms`), and fail-open / fail-closed policy (`exit 2` + stderr only on block).
  - Added the 5-rule Layer A/B rule table (`unreviewed-merge`, `quote-gate`, `memory-shell-write`, `future-stamp`, `release-reminder`), provenance frontmatter metadata (`loadout_skill`, `loadout_triggers`, `author_agent`, `created_at`, `verification_status`, `evidence_ref`, `supersedes`), and `doctor` triad checks (`triad-memories`, `triad-skills`, `triad-pretool-hook`; note: `triad-pretool-hook` fails `doctor` with exit `1` until `loadout-os hook pre-tool` is wired under `hooks.PreToolUse` in `~/.claude/settings.json`).
- **Memory-index scaling warnings in `doctor`** (`packages/cli`) — `loadout-os doctor` now runs two
  configurable capacity checks: `memory-read-limit` (warns when `MEMORY.md` passes 60% of Claude Code's
  24.4 KB read limit = 14,640 bytes by default) and `subindex-entries` (warns when a sub-index marked
  `metadata.loadout_role: subindex` or `index-*.md` passes 60 entries by default). Both thresholds are
  configurable via `DoctorPaths`, `<store>/.loadout.json`, `MEMORY.md` frontmatter `metadata`, or CLI
  flags `--memory-warn-bytes <n>` and `--subindex-warn-entries <n>`.
- **Recursive nested sub-index expansion with cycle guard** (`packages/memories`) — `analyzeMemoryMd`,
  `syncSummaries`, and `placeOrMoveEntry` now recursively expand nested sub-indexes at arbitrary depth
  (propagating `defaultPriority` unless overridden, skipping duplicate expansion in diamond sub-index
  DAGs without false warnings, and emitting `SUBINDEX_CYCLE` only on true recursion cycles) and record
  per-sub-index entry counts in `analysis.subindexEntryCounts`.
- **Mechanical root-to-sub-index splitter (`loadout-os memories split --by <rules.json>`)**
  (`packages/memories`, `packages/cli`) — splits root `MEMORY.md` entries into `index-*.md` sub-indexes
  (`metadata.loadout_role: subindex`) according to `<rules.json>`, preserves every entry and its priority,
  writes nothing on `--dry-run`, and proves the entry count and per-entry priorities are unchanged in a
  staged verification pass under `basename(storeDir)` before committing (refusing with
  `ENTRY_COUNT_MISMATCH` / `PRIORITY_MISMATCH` if they differ).

### Changed

- **Generic profile-driven PreToolUse framework (`profiles.json` and `quote-gate`)** (`packages/cli`) —
  - Replaced workspace-specific profile names and built-in store slugs with generic `profile` resolution (`ProfileName`, `ProfileConfig`, `loadProfileConfig`, `resolveProfile`, `defaultProfilesPath`), reading `~/.ai-loadout/profiles.json` (`AI_LOADOUT_PROFILES_PATH`, `--profiles <path>`). The only built-in profile is `default`. Global `refresh` and `doctor` resolve the default store only from configuration (`--store` > `AI_LOADOUT_STORE` env > `profiles.json` `defaultStore`) and refuse with `DEFAULT_STORE_REQUIRED` when unset, never deriving from `process.cwd()`.
  - Removed all built-in per-profile actions, skill names, and memory IDs from `PRETOOL_RULES`; every rule message now states the rule in neutral terms, appends `(memory: <id>)` only when configured, and supports per-profile `action`, `memory`, and extra `note` lines (appended after the 5-line base cap), plus per-rule `skill`, from `profiles.json` (e.g., `docs` and `release` profiles).
  - Renamed the quote rule to `quote-gate` (`QUOTE_GATE_RULE`, `matchQuoteGate`) with `quoteGate.speakers` (speech-verb attribution subjects, defaulting to pronouns and generic role nouns: `He`, `She`, `They`, `the User`), separate `quoteGate.namedSpeakers` (defaulting to `[]` for P1 possessive-words, P1 first-name word-block, P2 possessive speech-noun, P2 line-start, and P2 dated attribution branches so generic `"the User"` never false-positives on `"the user's words"`, `"user: ..."`, or `"the user's reply: ..."`), configurable `quoteGate.allowlistSuffixes` (defaulting only to loadout-os's own rule and test files), and `ruleAliases` for rule lookups and `readDecisionLog` decision-log reading. P1 word-block matches only the first configured `namedSpeakers` entry (matching base behavior). Deliberately narrowed quote-gate matching with leading `\b` word boundaries on all six word-led branches — P1 named possessive-words, P1 first-name word-block, P2 speech-verb subject, P2 pronoun-possessive speech-noun, P2 named-possessive speech-noun, and P2 dated attribution — so words merely ending in a speaker or pronoun token (such as names ending in `she`, compounds ending in `user`, or words ending in `her`) no longer false-positive.

### Fixed

- **`doctor` store resolution precedence and `--profiles` isolation** (`packages/cli`) —
  `defaultDoctorPaths()` now leaves `store` empty instead of eagerly reading the ambient
  `~/.ai-loadout/profiles.json`; `runDoctor` resolves `--store` > `AI_LOADOUT_STORE` >
  `defaultStore` of the `profiles.json` actually in use (refusing with `DEFAULT_STORE_REQUIRED`
  when none is set), and `printDoctor` prints the resolved store path and source (`flag`,
  `env`, or `profiles`).
- **Warn-only rule clamping (`unreviewed-merge`, `release-reminder`)** (`packages/cli`) —
  `loadProfileConfig` and `resolveRuleAction` now clamp any configured `"block"` action on
  warn-only rules (`WARN_ONLY_RULE_IDS`) down to `"warn"` and record a `config_warning`
  (also surfaced by `doctor`'s `profiles-config` check); `"off"` remains allowed.
- **`AI_LOADOUT_STORE` included in pre-tool store scope** (`packages/cli`) — `collectStorePaths`
  now includes `AI_LOADOUT_STORE` so `memory-shell-write` and `future-stamp` protect stores set
  solely via `AI_LOADOUT_STORE`; removed the undocumented `AI_LOADOUT_STORE_PATHS` env var.
- **Platform-scoped MSYS path conversion in `normalizePreToolPath`** (`packages/cli`) —
  restricted `/<drive>/...` MSYS conversion to `platform === "win32"` (removing the `/AI/`
  path special case) and added an explicit `{ platform }` option to `normalizePreToolPath` and
  `resolveProfile`.
- **Published `@mcptoolshop/loadout-os` package docs and `--help` alignment** (`packages/cli`) —
  updated `packages/cli/CHANGELOG.md` and `packages/cli/README.md` with the current command
  surface (`memories split`, `hook pre-tool`, `--profiles`, `defaultStore` / `DEFAULT_STORE_REQUIRED`,
  `doctor` checks, and absolute GitHub links), removed the `SDK use` section (`packages/cli` has
  no `main` or `exports`), added `--allow-store-change` to `refresh --help`, and expanded
  `public-hygiene.test.ts` to scan `packages/cli/*.md`.
- **Matched topic entries reach the prompt hook again** (`apps/hook`) — within each layer, entries the prompt
  matched now come before `core` entries, which fill only the places left. Core entries score 1.0 on every
  prompt, so a store with several of them filled its whole share every time and a matched entry (scoring, say,
  0.53) never surfaced. Measured on a real two-layer setup: 9 of 11 sample prompts now surface their topic
  entry, against 2 of 11 before. With no match, the output is unchanged. New test `7b` in `hook.test.ts`.
- **Merge reminder wording** (`packages/cli`, `pretool-rules.ts`) — the `unreviewed-merge` reminder asks for
  a recorded review verdict matching the exact PR head commit rather than a legacy runner name.
- **Pre-tool hook enforce-readiness & issue #25** (`packages/cli`, closes #25) —
  - **Read-only pass-through & profile map hardening (P1.1–P1.3):** rejected `git -c <key>=<val>`
    and leading `VAR=val` environment variable prefixes on read-only pass-through segments;
    rejected `sed -n` scripts containing `w`/`W` write commands; added `worktrees` and
    `prefixes` arrays per profile in `profiles.json`.
  - **`memory-shell-write` coverage & false-positive fixes (P2.4–P2.9, FP-MSW-1..4):** expanded
    detection to `pwsh`/`powershell`, `bash -c`/`sh -c`, `env`/`command`/`nohup`/`nice`/`time`/`xargs`
    wrappers, and `find <store> -delete|-exec`; expanded Python/Node write APIs (`shutil.copy|move`,
    `os.replace|remove|unlink|rename`, `Path.unlink|rename|replace|write_bytes`,
    `fs.unlinkSync|copyFileSync|renameSync|rmSync`, nested `open(..., 'w')`, and script file
    invocations `python x.py <store>/...`); tracked `cd`/`pushd`/`popd` segments and resolved
    relative target paths against the active directory stack; added `restore`, `switch`, `apply`,
    `am`, `cherry-pick`, and `pull` to `GIT_STORE_WRITE_SUBCOMMANDS`; expanded `%USERPROFILE%`,
    `$USERPROFILE`, `$HOME`, quoted `~`, and doubled backslashes `\\`; and avoided false positives
    on `sed -i` substitution patterns on non-store files, inline Python/Node scripts that read from
    a store and write only to non-store literal paths, loadout CLIs (`claude-memories`, `cli.js`) and
    read-only inspection scripts, and PowerShell `Copy-Item` copying from a store to a non-store
    destination.
  - **`future-stamp` reconstruction, forms, and privacy (P3.10–P3.13, P4.14, FP-FS-1..3):**
    reconstructed edited lines from disk on `Edit`/`MultiEdit` so substring time replacements
    (`15:03 ET` → `23:59 ET`) are caught; matched non-bold `Last updated:` and time-only `~HH:MM`
    without a zone token; required a time component on heading `updated` stamps so date-only
    headings (`### Milestones — updated 2026-12-01 schedule`) pass; evaluated bare `YYYY-MM-DD`
    stamps at start-of-day (`00:00:00.000 ET`) so same-day bare dates pass; allowed earlier
    same-day time-only stamps (`~08:30 ET` edited at `21:30 ET`) while preserving midnight wrap
    within 6 hours after midnight (`~23:58 ET` at `00:02 ET`); stripped fenced code blocks and
    scoped frontmatter date keys (`created_at`, `modified`, `verified_at`) to the YAML frontmatter
    block; scoped `future-stamp` to memory store paths (`profiles.json` stores, `AI_LOADOUT_STORE`, and `~/.claude/projects/*/memory`); and hashed unparseable
    timestamp values in `notes` (`sha256:<hash12>(len=<n>)`) instead of logging raw prose.
  - **Per-profile memory IDs & per-profile `doctor` triad check (Ruling 1):** rule `memory` maps resolve
    per profile from `profiles.json`, rule messages cite the active profile's memory ID when configured,
    and `doctor`'s `triad-memories` check (`--profiles <p>`) validates each profile with a configured
    store against its own store/index and names the failing profile on mismatch.
  - **`unreviewed-merge` warn-only with `PASS at <head8>` suppression (Ruling 2):**
    `unreviewed-merge` is permanently `warn` across all profiles (never `block`) and suppresses its
    warning when `repliesDir` is explicitly configured (`profiles.json` or `AI_LOADOUT_REPLIES_DIR`,
    with no hardcoded path default) and a review reply's first line names the target repo, `#<pr>`,
    and `PASS at <head8>` matching `--match-head-commit <sha>`, `--head <sha>`, or
    `gatemerge <repo> <pr> <head8>`.
  - **Pre-tool latency tail under p99 ≤ 10 ms (Ruling 3):** fixed `extractHeredocs` quote-stack
    tracking inside `"$(cat <<'EOF' ... EOF)"` so multi-hundred-line PR bodies and commit
    messages strip heredocs on the first pass instead of spawning recursive backtick subshell
    parses and triple regex scans; added fast pre-checks, pre-compiled regexes in
    `findQuoteViolations`, pre-normalized store paths, and eliminated redundant input hashing
    and `existsSync` stat calls.
  - **`refresh --project` store resolution, `source_store` guard, and cross-store `.bak`
    preservation:** `loadout-os refresh --project <root>` without `--store` now resolves the
    project's store from `profiles.json` or refuses with `PROJECT_STORE_REQUIRED` instead of
    falling back to `DEFAULT_STORE`; stamps `source_store` in generated indexes and refuses
    cross-store overwrites with `STORE_MISMATCH` unless `--allow-store-change` is passed; and
    never overwrites an existing `<dest>.bak` whose `source_store` differs (preserving both
    backups).
- **Pre-tool rule memory IDs follow configured store entries** (`packages/cli`) — updated the rule
  table tests and `doctor`'s per-profile `triad-memories` check to verify configured rule memory IDs
  against each profile's store/index (including stores whose entry IDs use `idSource: name`).

## [1.1.1] - 2026-11-08

### Fixed

- **Nested frontmatter keys are read** (#19). Claude Code rewrites a memory file's frontmatter when its tools edit it,
  and can move top-level keys under `metadata:`. 1.1.0 read `priority` and `id` only at the top level, so a board
  marked `priority: core` that ended up as `metadata.priority: core` silently became a `domain` entry and stopped
  being injected at session start. Both keys are now read from `metadata:` when they are not at the top level; the
  top level wins when both are present.
- **Link bullets with an arrow in their hook text are indexed** (#20). A bullet such as
  `- [Title](file.md) — teach → apply → verify` went down the arrow-format branch, which took the word after the
  last arrow as a topic path and halted the refresh with `MISSING_TOPIC_FILE`. A bullet that starts with a link now
  uses the link branch; the arrow branch applies only to the backticked-target form. Link bullets with no dash or
  colon after the link (for example `- [Loop](loop.md) (11-08) teach loop`) are indexed as they were in 1.1.0.

Index output on existing stores is unchanged: three real stores (266, 168 and 577 entries) produce the same entries
and fields as 1.1.0.

## [1.1.0] - 2026-11-08

Per-project memory: a project layer in the hook, sub-indexes, a session-start board, and post-write checks. Entry ids are unchanged for existing stores.

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

### Fixed

- **Keyword punctuation stripping and stem patterns** (**F-04**) — punctuation (`:`, `(`, `)`,
  `,`, etc.) is stripped before stop-word filtering during keyword extraction, file-stem
  tokens are included, and stem/id tokens populate `patterns` so 1–2 exact technical words
  clear the hook's `0.5` score floor.
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
- **Entry ID source (`idSource: "title" | "name"`)** — when a topic
  file's frontmatter has no explicit `id:`, global / `--dest` stores now default to
  `idSource: "title"` (`nameToId(ref.name)` from the first bullet's title in `MEMORY.md`,
  preserving 100% of existing `v1.0.4` entry IDs on the global store and avoiding orphaned
  `usage.jsonl` history), while `--project` stores default to `idSource: "name"` (kebab-cased
  frontmatter `name:`). `idSource` can be configured per store in `<store>/.loadout.json`
  (`{ "idSource": "title" | "name" }`) or `MEMORY.md` frontmatter (`metadata.id_source:
  title | name`), or overridden per invocation via `--id-source title|name` on `refresh`
  and `memories` commands. An explicit frontmatter `id:` always wins over both sources.

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

## [1.0.0] - 2026-06-16

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
