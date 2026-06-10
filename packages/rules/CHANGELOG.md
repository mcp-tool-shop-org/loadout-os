# Changelog

## 1.2.2 — 2026-03-25

### Added
- `--json` flag for `stats` command — machine-readable output for CI integration
- `-V` short flag for `--version`
- CLI flag tests (4 new tests, 75 total)

### Fixed
- `--version` now prints tool name prefix (`claude-rules 1.2.2`)
- Added `coverage/` to `.gitignore`

## 1.2.1 — 2026-03-06

- Add Architecture section to README showing Knowledge OS stack position
- Document compatibility with ai-loadout resolver and agent runtime

## 1.2.0 — 2026-03-06

- Lazy loading toggle: `--lazy` flag on `split` stores rule files in `.claude/loadout/` instead of `.claude/rules/`
- Lazy rule files are not auto-loaded by Claude Code — agent reads them on demand via dispatch table
- `index.json` gains optional `lazyLoad: boolean` field
- Generated CLAUDE.md instruction text adapts for eager vs lazy mode

## 1.0.3 — 2026-03-06

- Brand logo URL (mcp-tool-shop-org/brand)
- Code coverage via c8 + Codecov badge
- Translations re-done via polyglot-mcp (TranslateGemma 12B)
- SHIP_GATE.md and SCORECARD.md (shipcheck audit: 100% pass)
- dependabot.yml (monthly, grouped)
- .gitignore: site/.astro/, site/dist/, .polyglot-cache.json

## 1.0.2 — 2026-03-06

- Shipcheck gates added (SHIP_GATE.md, SCORECARD.md)
- dependabot.yml

## 1.0.1 — 2026-03-06

- Refactor: routing types and frontmatter moved to `@mcptoolshop/ai-loadout`
- Fix: validate test fixtures updated for `entries` field (was `rules`)
- Add SECURITY.md with security policy
- Add logo
- Fix README logo reference
- Include SECURITY.md and logo.png in npm package

## 1.0.0 — 2026-03-06

Initial release.

- `analyze` — score sections, propose splits, show token budget
- `split` — interactive extraction with approval workflow
- `validate` — lint rules directory for refs, orphans, drift
- `stats` — token budget dashboard with savings %
- Frontmatter-based routing metadata (keywords, patterns, priority, triggers)
- Dispatch table generation (`index.json`)
- Three-tier priority system: core / domain / manual
- Depends on `@mcptoolshop/ai-loadout` for routing types and matching
