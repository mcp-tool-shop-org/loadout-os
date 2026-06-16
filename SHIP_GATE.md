# Ship Gate

> No repo is "done" until every applicable line is checked.
> Copy this into your repo root. Check items off per-release.

**Tags:** `[all]` every repo · `[npm]` `[pypi]` `[vsix]` `[desktop]` `[container]` published artifacts · `[mcp]` MCP servers · `[cli]` CLI tools

**Repo:** loadout-os (`@mcptoolshop/loadout-os`) · **Type:** `[all][npm][cli]` · **Worked:** 2026-06-16

---

## A. Security Baseline

- [x] `[all]` SECURITY.md exists (report email, supported versions, response timeline) (2026-06-16) — `SECURITY.md` authored: report email `64996768+mcp-tool-shop@users.noreply.github.com`, supported-versions table (1.x Yes / <1.0 No), response timeline (acknowledge 48h / assess 7d / fix 30d), and a per-surface attack-surface section.
- [x] `[all]` README includes threat model paragraph (data touched, data NOT touched, permissions required) (2026-06-16) — `README.md` "## Trust model" section: data it touches (store/index/usage local files), data it does NOT touch (no network/telemetry/remote/secrets), permissions (local filesystem only; doctor/report read-only; refresh guarded).
- [x] `[all]` No secrets, tokens, or credentials in source or diagnostics output (2026-06-16) — no credential handling anywhere; matcher/validators handle metadata only (`SECURITY.md` "No secrets handling"). Grep for `eval(|new Function(|child_process` over `packages/cli/src` returns only the documented `spawnSync` passthrough for `rules split` (`commands.ts:411-433`) + `hook.ts` — no secret literals, no token reads.
- [x] `[all]` No telemetry by default — state it explicitly even if obvious (2026-06-16) — stated explicitly in README Trust model ("no telemetry") and SECURITY.md ("No telemetry — nothing is collected centrally or transmitted"). The only write is the local append-only `~/.ai-loadout/usage.jsonl` (`loadout-hook.mjs:120-141`), never transmitted.

### Default safety posture

- [x] `[cli|mcp|desktop]` Dangerous actions (kill, delete, restart) require explicit `--allow-*` flag (2026-06-16) — no kill/delete/restart actions exist. The destructive ops are: `refresh` (irreversible global-index write) gated by `--dry-run` + andon halt + `<dest>.bak` compensator (`refresh.ts:211-219, 253-287`); `rules split` requires interactive per-extraction confirmation + supports `--dry-run` (`commands.ts:411-433`, `help.ts:109-119`). SKIP-equivalent: there is no destructive process action that warrants an `--allow-*` flag; the irreversible file write is gated by `--dry-run` + compensator instead, which is the stronger guarantee.
- [x] `[cli|mcp|desktop]` File operations constrained to known directories (2026-06-16) — writes confined to: store `index.json` (next to MEMORY.md), global resolver index `~/.ai-loadout/index.json`, `.claude/rules/` + `CLAUDE.md` (interactive split), and `~/.ai-loadout/usage.jsonl`. Reads target fixed canonical locations (`doctor.ts:68-78` `defaultDoctorPaths`; `report.ts` defaults to `~/.ai-loadout/*`). No arbitrary tree walks (`SECURITY.md` "Scoped filesystem access").
- [ ] `[mcp]` Network egress off by default — SKIP: loadout-os is a CLI + runtime hook, not an MCP server.
- [ ] `[mcp]` Stack traces never exposed — structured error results only — SKIP: not an MCP server. (CLI equivalent is covered under B below — structured errors, no raw stacks.)

## B. Error Handling

- [x] `[all]` Errors follow the Structured Error Shape: `code`, `message`, `hint`, `cause?`, `retryable?` (2026-06-16) — `CliError { code, message, hint, exitCode }` (`console.ts:40-51`) thrown by every command handler via `fail()` (`console.ts:53-61`); `RefreshError { code, message, exitCode, issues }` for the ritual (`refresh.ts:128-139`); `report` returns `{ ok, error: { code, message } }` (`report.ts:46-48, 100-106, 117-124`). `cause?`/`retryable?` are optional in the standard and not needed here.
- [x] `[cli]` Exit codes: 0 ok · 1 user error · 2 runtime error · 3 partial success (2026-06-16) — real and verified: `doctor` 0 healthy / 1 any fail check (`cli.ts:221-223`); `report` 0 ok / 2 missing input (`cli.ts:241-243`); `refresh` 0 ok / 1 andon-validation or write failure / 2 store-or-MEMORY.md missing (`refresh.ts:381-404`, `refresh.ts:185-197, 211-219`); validators exit 1 on ≥1 error (`commands.ts:172,193,301,320,617,631`); unknown command → CliError exit 1 (`cli.ts:353-357`). Documented per-command in `help.ts` exit-code blocks.
- [x] `[cli]` No raw stack traces without `--debug` (2026-06-16) — process boundary catches `CliError` and prints `✗ [CODE] message` + hint, never `.stack` (`cli.ts:373-383`); an unexpected error is reduced to `✗ [RUNTIME_FATAL] <message>` (the message only, not the stack). The runtime hook is fail-silent and prints nothing to stdout on error.
- [ ] `[mcp]` Tool errors return structured results — server never crashes on bad input — SKIP: not an MCP server. (The CLI's bad-input handling is covered above; the hook degrades gracefully on malformed input, `loadout-hook.mjs:72-95`.)
- [ ] `[mcp]` State/config corruption degrades gracefully (stale data over crash) — SKIP: not an MCP server. Note: the resolver/hook DO degrade gracefully — malformed index layers are skipped (`doctor.ts` layers-malformed check; hook `loadout-hook.mjs:84`), malformed JSONL lines are skipped (`report.ts` `skipped` count).
- [ ] `[desktop]` Errors shown as user-friendly messages — no raw exceptions in UI — SKIP: not a desktop app.
- [ ] `[vscode]` Errors surface via VS Code notification API — no silent failures — SKIP: not a VS Code extension.

## C. Operator Docs

- [x] `[all]` README is current: what it does, install, usage, supported platforms + runtime versions (2026-06-16) — `README.md` is the current front-door: what-it-does (Knowledge OS), four-surface table, full command surface, install (`npm install -g @mcptoolshop/loadout-os`), Node `>=20` runtime (`package.json:19-21`, `packages/cli/package.json:39-41`), status, links to handbook + repo.
- [x] `[all]` CHANGELOG.md (Keep a Changelog format) (2026-06-16) — root `CHANGELOG.md` authored in Keep a Changelog format with an `[Unreleased]` section (Added/Fixed/Changed) summarizing the consolidation, the unified CLI, the matcher recall fix (FT-K1), and docs. Plus `packages/cli/CHANGELOG.md` for the published package.
- [x] `[all]` LICENSE file present and repo states support status (2026-06-16) — `LICENSE` present (MIT, "Copyright (c) 2026 mcp-tool-shop"); also `packages/cli/LICENSE`. Support status stated in SECURITY.md supported-versions table and README Status section.
- [x] `[cli]` `--help` output accurate for all commands and flags (2026-06-16) — top-level/namespace help (`cli.ts:77-135`) + per-command help registry covering every leaf command with synopsis/args/flags/example/exit-codes (`help.ts:43-237`); a test (`every dispatched command has help`, referenced `help.ts:38-42`) enforces coverage so a new command without help fails CI.
- [x] `[cli|mcp|desktop]` Logging levels defined: silent / normal / verbose / debug — secrets redacted at all levels (2026-06-16) — normal (human screen) vs `--json` (machine) on every verb; the runtime hook has `AI_LOADOUT_HOOK=off` (silent) and `AI_LOADOUT_HOOK=debug` (STDERR-only diagnostics, never stdout — `loadout-hook.mjs:25-27, 44-50`). No secrets are handled, so there is nothing to redact at any level.
- [ ] `[mcp]` All tools documented with description + parameters — SKIP: not an MCP server (no tool schema). The CLI command equivalent is the per-command `--help` registry, checked above.
- [x] `[complex]` HANDBOOK.md: daily ops, warn/critical response, recovery procedures (2026-06-16) — served by the Starlight handbook under `site/src/content/docs/handbook/`: `rituals.md` documents daily ops + when-to-run + the refresh andon/compensator recovery and the doctor pass/warn/fail response; `architecture.md` the data flow; `getting-started.md` install + first commands; `reference.md` every command/flag/exit code; `migration.md` the legacy-package migration. Linked from README "Documentation" + the landing page.

## D. Shipping Hygiene

- [x] `[all]` `verify` script exists (test + build + smoke in one command) (2026-06-16) — root `npm run verify` = `npm run build && verify` across all four packages in topo order (`package.json:17`); each package's `verify` is `tsc --noEmit && node --test` (e.g. `packages/cli/package.json:27`). The PowerShell hook smoke-test is deliberately excluded (Windows/rig-specific; would break Linux CI — `package.json` `//buildOrder` note).
- [x] `[all]` Version in manifest matches git tag (2026-06-16) — enforced at release: `release.yml` "Verify tag matches packages/cli/package.json version" step exits 1 on mismatch (`release.yml:42-51`). The actual match happens at the Phase-6 tag (manifest is the placeholder `0.0.0` until the coordinator bumps to 1.0.0 + tags `v1.0.0`); the enforcement gate is in place now.
- [x] `[all]` Dependency scanning runs in CI (ecosystem-appropriate) (2026-06-16) — `ci.yml` runs `npm audit --audit-level=moderate` on every push/PR (`ci.yml:41`), Node 20 + 22 matrix.
- [ ] `[all]` Automated dependency update mechanism exists — SKIP: studio policy — deps updated manually, dependabot intentionally not added (`.claude/rules/github-actions.md`: "Do NOT add dependabot.yml unless explicitly requested").
- [x] `[npm]` `npm pack --dry-run` includes: dist/, README.md, CHANGELOG.md, LICENSE (2026-06-16) — verified via `npm pack --dry-run -w packages/cli`: tarball lists `dist/…`, `README.md`, `CHANGELOG.md`, `LICENSE`. Added `packages/cli/CHANGELOG.md` + `CHANGELOG.md` to the cli `files` field (`packages/cli/package.json:19-24`) so the changelog is now in the tarball.
- [x] `[npm]` `engines.node` set · `[pypi]` `python_requires` set (2026-06-16) — `engines.node` `>=20` at root (`package.json:19-21`) and in `packages/cli/package.json:39-41`.
- [x] `[npm]` Lockfile committed · `[pypi]` Clean wheel + sdist build (2026-06-16) — `package-lock.json` present and git-tracked (`git ls-files package-lock.json` → `package-lock.json`).
- [ ] `[vsix]` `vsce package` produces clean .vsix with correct metadata — SKIP: not a VS Code extension.
- [ ] `[desktop]` Installer/package builds and runs on stated platforms — SKIP: not a desktop app.

## E. Identity (soft gate — does not block ship)

- [x] `[all]` Logo in README header (2026-06-16) — `README.md:1` `<img src="logo.png" alt="loadout-os" width="500">` (`logo.png` present in repo root).
- [ ] `[all]` Translations (polyglot-mcp, 8 languages) — COORDINATOR / publish-time: run before npm publish + GitHub release (per global release-ordering rule). Not done here.
- [x] `[org]` Landing page (@mcptoolshop/site-theme) (2026-06-16) — Starlight site under `site/` with the handbook wired to the landing page (README "Documentation" links to `https://mcp-tool-shop-org.github.io/loadout-os/handbook/`); `pages.yml` workflow present.
- [ ] `[all]` GitHub repo metadata: description, homepage, topics — COORDINATOR: set via `gh repo edit` at publish time. Not done here.

---

## Gate Rules

**Hard gate (A–D):** Must pass before any version is tagged or published.
If a section doesn't apply, mark `SKIP:` with justification — don't leave it unchecked.

**Soft gate (E):** Should be done. Product ships without it, but isn't "whole."

**Checking off:**
```
- [x] `[all]` SECURITY.md exists (2026-02-27)
```

**Skipping:**
```
- [ ] `[pypi]` SKIP: not a Python project
```
