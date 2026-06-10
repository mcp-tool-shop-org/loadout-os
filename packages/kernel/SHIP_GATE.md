# Ship Gate

> No repo is "done" until every applicable line is checked.
> Copy this into your repo root. Check items off per-release.

**Tags:** `[all]` every repo · `[npm]` `[pypi]` `[vsix]` `[desktop]` `[container]` published artifacts · `[mcp]` MCP servers · `[cli]` CLI tools

---

## A. Security Baseline

- [x] `[all]` SECURITY.md exists (report email, supported versions, response timeline) (2026-03-06)
- [x] `[all]` README includes threat model paragraph (data touched, data NOT touched, permissions required) (2026-03-06)
- [x] `[all]` No secrets, tokens, or credentials in source or diagnostics output (2026-03-06)
- [x] `[all]` No telemetry by default — state it explicitly even if obvious (2026-03-06)

### Default safety posture

- [ ] `[cli|mcp|desktop]` SKIP: pure library — no actions to guard, no CLI/MCP/desktop interface
- [ ] `[cli|mcp|desktop]` SKIP: pure library — no file operations, all I/O is consumer's responsibility
- [ ] `[mcp]` SKIP: not an MCP server — pure data transformation library with no network access
- [ ] `[mcp]` SKIP: not an MCP server — no error serialization boundary, errors are typed objects

## B. Error Handling

- [x] `[all]` Errors follow the Structured Error Shape: `code`, `message`, `hint`, `cause?`, `retryable?` (2026-03-06)
- [ ] `[cli]` SKIP: not a CLI tool
- [ ] `[cli]` SKIP: not a CLI tool
- [ ] `[mcp]` SKIP: not an MCP server
- [ ] `[mcp]` SKIP: not an MCP server — stateless library
- [ ] `[desktop]` SKIP: not a desktop app
- [ ] `[vscode]` SKIP: not a VS Code extension

## C. Operator Docs

- [x] `[all]` README is current: what it does, install, usage, supported platforms + runtime versions (2026-03-06)
- [x] `[all]` CHANGELOG.md (Keep a Changelog format) (2026-03-06)
- [x] `[all]` LICENSE file present and repo states support status (2026-03-06)
- [ ] `[cli]` SKIP: not a CLI tool
- [ ] `[cli|mcp|desktop]` SKIP: pure library — no logging levels needed
- [ ] `[mcp]` SKIP: not an MCP server
- [ ] `[complex]` SKIP: simple library — 6 exported functions, no complex operations

## D. Shipping Hygiene

- [x] `[all]` `verify` script exists (test + build + smoke in one command) (2026-03-06)
- [x] `[all]` Version in manifest matches git tag (2026-03-06)
- [x] `[all]` Dependency scanning runs in CI (ecosystem-appropriate) (2026-03-06)
- [x] `[all]` Automated dependency update mechanism exists (2026-03-06)
- [x] `[npm]` `npm pack --dry-run` includes: dist/, README.md, CHANGELOG.md, LICENSE (2026-03-06)
- [x] `[npm]` `engines.node` set · `[pypi]` `python_requires` set (2026-03-06)
- [x] `[npm]` Lockfile committed · `[pypi]` Clean wheel + sdist build (2026-03-06)
- [ ] `[vsix]` SKIP: not a VS Code extension
- [ ] `[desktop]` SKIP: not a desktop app

## E. Identity (soft gate — does not block ship)

- [x] `[all]` Logo in README header (2026-03-06)
- [x] `[all]` Translations (polyglot-mcp, 8 languages) (2026-03-06)
- [x] `[org]` Landing page (@mcptoolshop/site-theme) (2026-03-06)
- [x] `[all]` GitHub repo metadata: description, homepage, topics (2026-03-06)

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
