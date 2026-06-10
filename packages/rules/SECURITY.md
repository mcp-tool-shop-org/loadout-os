# Security Policy

## Attack Surface

`@mcptoolshop/claude-rules` is a **local CLI tool** that reads and writes markdown and JSON files in your repository. It has:

- **No network access** — makes no HTTP requests, opens no sockets
- **No code execution** — no `eval`, `Function()`, or dynamic imports
- **No telemetry** — collects and transmits nothing
- **Scoped file access** — writes only to `.claude/rules/` and the CLAUDE.md file itself
- **Interactive approval** — every extraction requires user confirmation before writing

## Input Validation

The tool parses CLAUDE.md using ATX heading detection (simple string matching). Frontmatter parsing uses a hand-rolled parser with no `eval` or YAML library — just string splitting on known delimiters.

All file writes go through the interactive `split` command, which shows a diff preview and requires explicit approval for each file. The `--dry-run` flag prevents any writes entirely.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | Yes       |

## Reporting a Vulnerability

If you discover a security issue, please email **64996768+mcp-tool-shop@users.noreply.github.com** with:

- Description of the vulnerability
- Steps to reproduce
- Impact assessment

We will respond within 7 days and aim to release a fix within 14 days for confirmed issues.
