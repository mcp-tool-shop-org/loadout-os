<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/claude-rules/readme.png" width="400" alt="claude-rules">
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/claude-rules/actions/workflows/ci.yml"><img src="https://github.com/mcp-tool-shop-org/claude-rules/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://codecov.io/gh/mcp-tool-shop-org/claude-rules"><img src="https://codecov.io/gh/mcp-tool-shop-org/claude-rules/graph/badge.svg" alt="Coverage"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>
  <a href="https://mcp-tool-shop-org.github.io/claude-rules/"><img src="https://img.shields.io/badge/Landing_Page-live-blue" alt="Landing Page"></a>
</p>

Put your CLAUDE.md on a diet.

`claude-rules` is a dispatch table generator and instruction-file optimizer for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). It splits bloated instruction files into a tiny routing index (always loaded) and topic-specific rule files (loaded on demand), saving context tokens every session.

## The Problem

CLAUDE.md files grow over time. Every line costs tokens every session — whether it matters or not. A 300-line instruction file quietly becomes a tax on every thought the model has.

## The Fix

Three layers, no ambiguity:

| Layer | File | Loaded |
|-------|------|--------|
| Operator console | `CLAUDE.md` | Always (lean index) |
| Dispatch table | `.claude/rules/index.json` | Always (machine-readable) |
| Rule payloads | `.claude/rules/*.md` | On demand |

Each rule file carries its own routing metadata as frontmatter:

```markdown
---
id: github-actions
keywords: [ci, workflow, runner, dependabot]
patterns: [ci_pipeline]
priority: domain
triggers:
  task: true
  plan: true
  edit: false
---

# GitHub Actions Rules
CI minutes are finite...
```

When the agent sees a task that mentions "CI" or "workflow", it reads the relevant rule file. The rest stay unloaded.

## Install

> **Not yet published to npm — install from source.**

```bash
git clone https://github.com/mcp-tool-shop-org/claude-rules.git
cd claude-rules
npm ci
npm run build
npm install -g .
```

This puts `claude-rules` on your PATH. Verify with `claude-rules --version`.

## Usage

### Analyze

Score your CLAUDE.md sections and see what can be extracted:

```bash
claude-rules analyze
claude-rules analyze .claude/CLAUDE.md
claude-rules analyze --memory          # also analyze MEMORY.md
claude-rules analyze --signals my.json # custom scoring signals
```

```
File: .claude/CLAUDE.md  (258 lines, ~2388 tokens)

Keep inline (core): 4 sections
✓ (preamble)  2 lines
✓ Role  9 lines
✓ Guardian Self-Check  4 lines
✓ Document Delight  8 lines

Proposed extractions: 8 sections
  1. "GitHub Actions Rules" (L92-149, 58 lines, ~330 tokens)
     → .claude/rules/github-actions.md
     keywords: [github, actions, workflow, runner]

Budget estimate:
  Always loaded:    ~208 tokens (23 lines)
  On-demand:        ~2180 tokens (225 lines)
  Savings:          91% per session
```

### Split

Interactive extraction — you approve each section before it's extracted:

```bash
claude-rules split              # interactive
claude-rules split --dry-run    # preview without writing
claude-rules split --yes        # accept all, no prompts (scriptable)
claude-rules split --memory     # also include MEMORY.md sections
```

Each proposed extraction shows a preview, suggested filename, keywords, and priority. You approve or skip each one. Use `--yes` for scripted/CI workflows. Writes are atomic — if anything fails, originals are untouched and CLAUDE.md is backed up to `.bak`.

### Validate

Lint your rules directory for health issues:

```bash
claude-rules validate
```

Checks for: missing file references, orphaned rule files, frontmatter drift, empty keywords on domain rules, duplicate IDs.

### Stats

See the physics of your system:

```bash
claude-rules stats
claude-rules stats --json            # machine-readable JSON output
```

```
claude-rules stats

  CLAUDE.md (always loaded)
    Lines: 42    Tokens (est): 320

  Rule files (on-demand)
    github-actions           56 lines    680 tokens  domain
    shipping                 38 lines    310 tokens  domain
    ownership                28 lines    210 tokens  domain
    ──────────────────────────────────────────────────────
    Total on-demand:        122 lines  1,200 tokens

  Budget
    Always loaded:         320 tokens
    On-demand total:     1,200 tokens
    Avg task load (est):   420 tokens  (keyword-weighted)
    Savings vs monolithic: 79%
```

### Init Signals

Generate a default `signals.json` to customize how sections are scored:

```bash
claude-rules init-signals
claude-rules init-signals --signals custom/path.json
```

The signals file controls three things: which words trigger domain classification (`domainSignals`), which words are filtered from keywords (`stopWords`), and which content patterns map to named intents (`patterns`). Edit the generated file to tune scoring for your project. When no signals file exists, built-in defaults are used.

## Priority Tiers

| Tier | Behavior | Example |
|------|----------|---------|
| `core` | Always inline in CLAUDE.md | "test is right until proven otherwise" |
| `domain` | Loaded when task keywords match | GitHub Actions rules when editing CI |
| `manual` | Never auto-loaded, deliberate lookup | Obscure platform gotchas |

## How Routing Works

The agent sees the dispatch table in CLAUDE.md and two signals nudge it to load a rule file:

1. **Semantic match** — the task mentions "publishing" or "CI"
2. **Explicit instruction** — CLAUDE.md says "read that rule file before planning or editing"

This is a hint system for the agent loop, not magic. The combination of keyword matching and explicit instruction makes it reliable.

## Invariants

- Every extracted section leaves a 1-line summary in CLAUDE.md
- Every `domain`/`manual` rule exists in `index.json`
- Every `core` rule stays inline (never extracted to file-only)
- Frontmatter is the source of truth; `index.json` is derived
- The parser only splits on ATX headings (`##`, `###`)

## Architecture

claude-rules is a **Layer 2 adapter** in the Knowledge OS stack:

| Layer | Package | Role |
|-------|---------|------|
| Kernel | `@mcptoolshop/ai-loadout` | Dispatch table, matching, resolver, agent runtime |
| Adapter | `@mcptoolshop/claude-rules` | CLAUDE.md optimization |
| Adapter | `@mcptoolshop/claude-memories` | MEMORY.md optimization |

The dispatch tables produced by `split` are compatible with the kernel's resolver (`ai-loadout resolve`) and agent runtime (`planLoad`).

## Security

This tool reads and writes local markdown and JSON files only. It does not make network requests, collect telemetry, or access any external services.

### Threat Model

| Threat | Mitigation |
|--------|------------|
| Data loss from bad split | Interactive approval + `--dry-run` + atomic writes with `.bak` backup |
| Malformed rule files | `validate` command catches all structural issues |
| Stale index | `validate` detects drift between frontmatter and index.json |
| Arbitrary file writes | Writes scoped to `.claude/rules/` (or `--rules-dir`) directory only |
| Partial write failure | Staging to temp dir; files copied only after all staging succeeds |

See [SECURITY.md](SECURITY.md) for the full security policy.

---

Built by [MCP Tool Shop](https://mcp-tool-shop.github.io/)
