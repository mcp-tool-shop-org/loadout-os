# Scorecard

> Score a repo before remediation. Fill this out first, then use SHIP_GATE.md to fix.

**Repo:** mcp-tool-shop-org/claude-memories
**Date:** 2026-03-06
**Type tags:** [npm] [cli]

## Pre-Remediation Assessment

| Category | Score | Notes |
|----------|-------|-------|
| A. Security | 10/10 | SECURITY.md with threat model, no secrets/telemetry |
| B. Error Handling | 9/10 | Structured errors (code/message/hint), exit codes 0/1 |
| C. Operator Docs | 10/10 | README, CHANGELOG, LICENSE, --help accurate |
| D. Shipping Hygiene | 9/10 | verify script, engines.node, lockfile, npm pack clean |
| E. Identity (soft) | 6/10 | Logo present, translations + landing page pending |
| **Overall** | **44/50** | |

## Key Gaps

1. No translations (soft gate E)
2. No landing page on marketing site (soft gate E)
3. No CI workflow (org Actions budget constraint — SKIP)

## Remediation Priority

| Priority | Item | Estimated effort |
|----------|------|-----------------|
| 1 | Translations (polyglot-mcp) | 5 min |
| 2 | Landing page | deferred to site sync |
| 3 | CI workflow | deferred (Actions budget) |

## Post-Remediation

| Category | Before | After |
|----------|--------|-------|
| A. Security | 10/10 | 10/10 |
| B. Error Handling | 9/10 | 9/10 |
| C. Operator Docs | 10/10 | 10/10 |
| D. Shipping Hygiene | 9/10 | 9/10 |
| E. Identity (soft) | 6/10 | 8/10 |
| **Overall** | 44/50 | 46/50 |
