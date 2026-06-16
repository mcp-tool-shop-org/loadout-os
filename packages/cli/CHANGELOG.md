# Changelog — @mcptoolshop/loadout-os

All notable changes to the unified `loadout-os` CLI are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

> This is the published package's changelog. For the full monorepo consolidation
> history (workspace wiring, the runtime hook, the adapters), see the
> [root CHANGELOG](../../CHANGELOG.md).

## [Unreleased]

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

<!-- ## [1.0.0] - YYYY-MM-DD -->
