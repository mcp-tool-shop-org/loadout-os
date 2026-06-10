# Changelog

## 1.0.3 — 2026-03-25

- `health` command: version, Node.js compatibility, platform, MEMORY.md detection
- 2 new tests (35 total)

## 1.0.2 — 2026-03-06

- Update architecture table: kernel role reflects resolver + agent runtime
- Landing page with Starlight handbook

## 1.0.1 — 2026-03-06

- Shipcheck audit: all hard gates A-D pass (22/22 items checked)
- SHIP_GATE.md and SCORECARD.md added
- GitHub repo metadata: description, topics
- SCORECARD: 46/50

## 1.0.0 — 2026-03-06

Initial release.

- `parseMemoryMd()` — parse MEMORY.md structure and references
- `analyzeMemoryMd()` — analyze topic files, detect orphans/missing
- `generateIndex()` — dispatch table from MEMORY.md + topic files
- `validateMemory()` — lint memory files for structural issues
- `generateStats()` / `formatStats()` — token budget dashboard
- `extractKeywords()` — keyword extraction from names and content
- CLI commands: `analyze`, `index`, `validate`, `stats`
- Multi-base path resolution (handles MEMORY.md inside memory/ dir)
- Lazy loading support (`--lazy` flag)
- Built on `@mcptoolshop/ai-loadout` v1.1.0
- Zero external CLI dependencies
- 31 tests
