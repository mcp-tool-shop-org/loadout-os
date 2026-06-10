<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/claude-memories/readme.png" width="400" alt="claude-memories" />
</p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
  <a href="https://mcp-tool-shop-org.github.io/claude-memories/"><img src="https://img.shields.io/badge/Landing_Page-live-blue" alt="Landing Page" /></a>
</p>

> MEMORY.md optimizer and dispatch table generator for Claude Code.

Put your MEMORY.md on a diet. claude-memories analyzes your memory files, generates a machine-readable dispatch table, and shows you where your context budget goes.

## The Problem

Claude Code's auto-memory grows into a giant MEMORY.md that eats context window. Every session loads 40K+ tokens of memories — most irrelevant to the current task.

## The Solution

claude-memories indexes your memory files into a dispatch table. An agent can route to the right memory topic on demand instead of loading everything.

```
MEMORY.md (669 tokens)  →  dispatch table  →  topic files (42K tokens)
     always loaded            routing            loaded on match
```

**98% savings** on a real 31-topic memory workspace.

## Install

> **Not yet published to npm — install from source.**

```bash
git clone https://github.com/mcp-tool-shop-org/claude-memories.git
cd claude-memories
npm ci
npm run build
npm install -g .
```

This puts `claude-memories` on your PATH. Verify with `claude-memories --version`.

## Commands

### analyze

Analyze MEMORY.md structure, references, and token costs.

```bash
claude-memories analyze MEMORY.md
```

### index

Generate a dispatch table (index.json) from your memory files.

```bash
claude-memories index MEMORY.md
claude-memories index MEMORY.md --lazy
claude-memories index MEMORY.md --out .claude/memory-index.json
```

The default output path is `memory/index.json` relative to the MEMORY.md directory.

### validate

Lint memory files for structural issues.

```bash
claude-memories validate MEMORY.md
```

Checks for: missing topic files, orphan files, duplicate references, empty names.

Exit code 1 if any errors are found (warnings alone do not fail).

### stats

Token budget dashboard.

```bash
claude-memories stats MEMORY.md
```

Shows total tokens, per-priority breakdown (core/domain/manual), always-loaded vs on-demand budget, and the top 10 entries by token cost.

### health

Check installation and auto-detect MEMORY.md locations.

```bash
claude-memories health
```

Reports Node.js version, platform, and scans common locations (`MEMORY.md`, `.claude/MEMORY.md`, `~/.claude/projects`) for existing memory files.

## How It Works

1. Parses MEMORY.md for topic references (arrow format: `Name → path`)
2. Reads each topic file, extracts keywords from headings and content
3. Generates a LoadoutIndex (dispatch table) compatible with ai-loadout
4. Validates structural integrity (missing files, orphans, duplicates)

### Reference Format

MEMORY.md entries follow this format:

```
Topic Name — description → `memory/topic-file.md`
```

Both bulleted and non-bulleted formats are supported. The em-dash (`—`) or double-hyphen (`--`) separates the name from the description:

```
- AI Loadout — routing core for agents → `memory/ai-loadout.md`
Claude Rules — CLAUDE.md optimizer → `memory/claude-rules.md`
```

### Frontmatter (Optional)

Topic files can include frontmatter for fine-grained control:

```markdown
---
id: ai-loadout
keywords: [loadout, routing, dispatch, kernel]
patterns: [knowledge_routing]
priority: domain
triggers:
  task: true
  plan: true
  edit: false
---

# AI Loadout
...
```

Without frontmatter, keywords are auto-extracted from the topic name and headings.

## Architecture

claude-memories is a **Layer 2 adapter** in the Knowledge OS stack:

| Layer | Package | Role |
|-------|---------|------|
| Kernel | `@mcptoolshop/ai-loadout` | Dispatch table, matching, resolver, agent runtime |
| Adapter | `@mcptoolshop/claude-rules` | CLAUDE.md optimization |
| Adapter | `@mcptoolshop/claude-memories` | MEMORY.md optimization |

Same kernel, different document types. Both produce compatible dispatch tables that the kernel's resolver and runtime (`planLoad`) can consume.

## Security

- **Local-only**: No network calls, no telemetry
- **Read-mostly**: Only writes index.json; never modifies MEMORY.md
- **Deterministic**: Same inputs produce the same outputs
- **Minimal dependencies**: Single runtime dependency (ai-loadout kernel)

See [SECURITY.md](SECURITY.md) for threat model.

## License

MIT

---

Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
