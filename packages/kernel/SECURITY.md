# Security Policy

## Attack Surface

`@mcptoolshop/ai-loadout` is a **pure data library**. It has:

- **No filesystem access** — does not read or write files
- **No network access** — makes no HTTP requests, opens no sockets
- **No code execution** — no `eval`, `Function()`, or dynamic imports
- **No telemetry** — collects and transmits nothing
- **No native dependencies** — pure TypeScript, zero production deps

All I/O is the consumer's responsibility. This package only transforms data structures in memory.

## Input Validation

The `parseFrontmatter()` function processes untrusted text input. It uses simple string splitting — no YAML parser, no regex-based evaluation, no prototype pollution vectors.

The `validateIndex()` function checks structural integrity of index objects. It does not execute or interpret any field values.

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
