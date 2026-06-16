# Changelog — @mcptoolshop/loadout-os

All notable changes to the unified `loadout-os` CLI are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

> This is the published package's changelog. For the full monorepo consolidation
> history (workspace wiring, the runtime hook, the adapters), see the
> [root CHANGELOG](../../CHANGELOG.md).

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
