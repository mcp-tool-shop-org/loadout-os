# Scorecard

> Reflects the ACTUAL SHIP_GATE.md state after the 2026-06-16 treatment-prep pass, not estimates.

**Repo:** loadout-os (`@mcptoolshop/loadout-os`)
**Date:** 2026-06-16
**Type tags:** `[all]` `[npm]` `[cli]`

## Gate state (actual)

Counts are: **checked** (evidence-backed `[x]`) / **applicable** (items that are not `SKIP`). SKIPs are not-applicable items (MCP/pypi/vsix/desktop/vscode) or explicit studio-policy skips.

| Category | Checked / Applicable | SKIP | Coordinator / publish-time | Status |
|----------|----------------------|------|----------------------------|--------|
| A. Security | 6 / 6 | 2 (`[mcp]` egress, `[mcp]` stack traces) | — | PASS |
| B. Error Handling | 3 / 3 | 4 (`[mcp]`×2, `[desktop]`, `[vscode]`) | — | PASS |
| C. Operator Docs | 6 / 6 | 1 (`[mcp]` tool docs) | — | PASS |
| D. Shipping Hygiene | 6 / 6 | 3 (D4 dependabot policy, `[vsix]`, `[desktop]`) | — | PASS |
| E. Identity (soft) | 2 / 4 | — | 2 (translations, GitHub metadata) | partial (soft) |

**Hard gates A–D: all applicable items checked or SKIPped honestly → PASS.**

## Key gaps closed this pass

1. **Root SECURITY.md** was a template — now a real per-surface threat model (pure core, read-only rituals, write path with andon halt + `.bak` compensator, fail-silent hook; no network/telemetry/secrets; matcher uses plain-string lookups, no user regex → no ReDoS, no eval).
2. **README threat model** — added a "Trust model" section (data touched / not touched / permissions).
3. **Root CHANGELOG.md** — was a template stub; now Keep-a-Changelog with an `[Unreleased]` consolidation summary (workspace wiring, unified CLI + doctor/report/refresh, matcher recall fix, docs).
4. **D5 npm pack** — `packages/cli` tarball was missing CHANGELOG.md; added `packages/cli/CHANGELOG.md` and `CHANGELOG.md` to the cli `files` field. Verified the tarball now ships dist/ + README.md + CHANGELOG.md + LICENSE.

## Remaining (coordinator / publish-time)

| Item | Owner | When |
|------|-------|------|
| E2 Translations (polyglot-mcp, 8 languages) | Coordinator | BEFORE npm publish + GitHub release |
| E4 GitHub repo metadata (description, homepage, topics) | Coordinator (`gh repo edit`) | Publish time |
| D2 actual version-matches-tag | Coordinator | Phase-6 bump to 1.0.0 + tag `v1.0.0` (enforcement gate already in release.yml) |

## Notes

- Version is the placeholder `0.0.0` in both `package.json` and `packages/cli/package.json`; the coordinator bumps to `1.0.0` at Phase 6 (per shipcheck product standards: pre-1.0 promotes straight to 1.0.0). The `release.yml` tag-vs-version check enforces the match at tag time.
- The first real `npm publish` is blocked until the workspace deps (`@mcptoolshop/claude-memories`, `@mcptoolshop/claude-rules`) are published or bundled — see the NOTE in `release.yml:65-69` and the multi-repo-publish-sequencing protocol. This is a release-sequencing concern, not a SHIP_GATE item.
