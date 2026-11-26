# Changelog — @mcptoolshop/loadout-os

All notable changes to the unified `loadout-os` CLI are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

> This is the published package's changelog. For the full monorepo history and
> detailed entries across all workspace packages, see the
> [root CHANGELOG](https://github.com/mcp-tool-shop-org/loadout-os/blob/main/CHANGELOG.md).

## [Unreleased]

### Added

- `loadout-os hook pre-tool` (`PreToolUse` Layer A/B guard and decision logger) driven by
  `~/.ai-loadout/profiles.json` (`AI_LOADOUT_PROFILES_PATH`, `--profiles <path>`), with the
  5-rule table (`unreviewed-merge`, `quote-gate`, `memory-shell-write`, `future-stamp`,
  `release-reminder`), read-only tool/Bash pass-through, `300 ms` timeout, and hashed
  decision logs (`~/.ai-loadout/hook-decisions.jsonl`, `AI_LOADOUT_DECISIONS_LOG`).
- `doctor` triad checks (`triad-memories`, `triad-skills`, `triad-pretool-hook`),
  `profiles-config` warnings, and capacity scaling checks (`memory-read-limit` defaulting to
  14,640 B and `subindex-entries` defaulting to 60 entries, configurable via `--memory-warn-bytes`
  and `--subindex-warn-entries`).
- `loadout-os memories split [<MEMORY.md>] --by <rules.json>` to split root entries into
  `index-*.md` sub-indexes while verifying entry counts and priorities before committing.

### Changed

- Removed hardcoded workspace defaults; global `refresh` and `doctor` now resolve the default
  store solely from `--store` > `AI_LOADOUT_STORE` > `profiles.json` `defaultStore` and refuse
  with `DEFAULT_STORE_REQUIRED` when unset.
- `refresh --project <root>` resolves project stores from `profiles.json` or refuses with
  `PROJECT_STORE_REQUIRED`, stamps `source_store`, guards cross-store overwrites with
  `STORE_MISMATCH` unless `--allow-store-change` is passed, and preserves distinct `<dest>.bak`
  backups.

### Fixed

- Hardened `hook pre-tool` read-only pass-through, `memory-shell-write` detection,
  `future-stamp` timestamp checks, and `unreviewed-merge` warn-only behavior (including
  clamping `"block"` overrides on warn-only rules to `"warn"` and including `AI_LOADOUT_STORE`
  in store-path protection while removing `AI_LOADOUT_STORE_PATHS`).
- Fixed `doctor` store resolution precedence (`--store` > `AI_LOADOUT_STORE` > active
  `profiles.json` `defaultStore`) and printed the resolved store and source in `printDoctor`.
- Scoped MSYS `/<drive>/...` conversion in `normalizePreToolPath` to `platform === "win32"`,
  added `--allow-store-change` to `refresh --help`, and removed the stale `SDK use` section
  from the package README.

## [1.1.1] - 2026-11-08

### Fixed

- Support nested `metadata.priority` and `metadata.id` frontmatter keys written when tools
  edit memory files.
- Route bullets starting with Markdown links cleanly even when link descriptions contain arrows.

## [1.1.0] - 2026-11-08

### Added

- Project-layer routing in the runtime hook, sub-index expansion (`index-*.md` /
  `metadata.loadout_role: subindex`), frontmatter summary authority, loader-limit checks,
  `memories sync-summaries` / `place` / `move`, `refresh --project` locking + git
  snapshot/mirror, and `hook session-start` / `pre-compact` / `post-write`.

### Fixed

- Improved keyword punctuation/stem extraction, possessive title slugification, non-blocking
  default `MEMORY_LIMIT_EXCEEDED` warning severity, `doctor` hook-drift bundle comparison,
  CLI/`--help` synopses, Windows path normalization in `post-write`, lock wait timeouts,
  atomic index writes, and configurable `idSource` (`title` vs `name`).

## [1.0.4] - 2026-10-07

### Fixed

- Parse Markdown-link bullets (`- [Title](file.md) — hook`) in `MEMORY.md` so entries are
  indexed rather than skipped as orphans.

## [1.0.3] - 2026-09-07

### Fixed

- Record resolved relative store paths instead of raw pointers in `generateIndex` so
  downstream absolute rewrites do not double `memory/`.
- Replace the hardcoded single-machine `DEFAULT_STORE` literal with `homedir()` resolution.

## [1.0.2] - 2026-06-16

### Fixed

- `refresh` no longer prints a stale closing note claiming "this scratch/CLI run … a LIVE
  run … is deferred to a coordinator-supervised step" after it has already written the
  live resolver index. The note is now contrastive and accurate: a default-dest run
  confirms "the change is live now"; a custom `--dest` run states the live index the hook
  reads was **not** modified. Behaviour was always correct — only the message was wrong.
  Adds a `printRefresh` regression test asserting the stale phrasing is gone in both paths.

## [1.0.1] - 2026-06-16

### Fixed

- npm README now renders the loadout-os logo (absolute raw-GitHub URL — npm does not
  resolve relative image paths). README + version only; the published bundle is
  unchanged from 1.0.0.

## [1.0.0] - 2026-06-16

### Added

- Unified `loadout-os` binary wrapping the kernel + memories + rules surfaces under one
  arg parser and one structured `CliError { code, message, hint }` shape.
- Namespaced adapter commands (`memories`, `rules`) and flat kernel verbs (`resolve`,
  `explain`, `usage`, `dead`, `overlaps`, `budget`, `validate`).
- Operational rituals: `doctor` (read-only health screen), `report` (read-only
  observability), and `refresh` (Index Freshness Ritual with andon halt + `.bak`
  compensator); plus `hook test`.
- Per-command `--help` (synopsis, arguments, flags, example, exit codes) for every leaf
  command.
