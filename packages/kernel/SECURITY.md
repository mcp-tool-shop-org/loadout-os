# Security Policy

## Attack Surface

`@mcptoolshop/ai-loadout` is a small, locally-scoped library. Its surface breaks into three parts:

- **Pure core** — matching, merging, validation, token estimation, and frontmatter
  parsing/serialization are pure functions with no side effects. They only transform
  data structures in memory.
- **Resolver** — `discoverLayers()` / `resolveLoadout()` / the `resolve` CLI command
  perform **local-only filesystem reads** to discover layer index files in fixed,
  canonical locations (`~/.ai-loadout/index.json`, `<project>/.claude/loadout/index.json`,
  and explicit org/session paths). It reads `index.json` files with `readFileSync` and
  probes for their existence with `existsSync`. It never writes, never walks arbitrary
  trees, and never follows network locations.
- **Usage tracking** — `recordUsage()` / `readUsage()` perform **append-only local
  JSONL writes** (`appendFileSync`) and reads (`readFileSync`) to a path supplied by the
  caller. Events are appended one line at a time; nothing is ever transmitted.

Across all three parts:

- **No network access** — makes no HTTP requests, opens no sockets.
- **No code execution** — no `eval`, `Function()`, or dynamic imports.
- **No telemetry / exfiltration** — usage data stays on the local disk path the caller
  chooses; nothing is collected centrally or sent anywhere.
- **No secrets** — the library handles loadout metadata only; it reads no credentials,
  environment secrets, or tokens.
- **No native dependencies** — pure TypeScript, zero production deps.

Filesystem access is confined to: reading the caller-specified index files the resolver
discovers, and reading/appending the caller-specified usage JSONL log. The library never
writes outside the path the caller hands it.

## Input Validation

The `parseFrontmatter()` function processes untrusted text input. It uses simple string splitting — no YAML parser, no regex-based evaluation, no prototype pollution vectors.

The `validateIndex()` function checks structural integrity of index objects. It does not execute or interpret any field values.

The resolver and usage reader treat on-disk files as untrusted: malformed `index.json`
layers are skipped silently (the layer is reported as not found), and malformed JSONL
usage lines are skipped without throwing. No file content is ever executed or evaluated.

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
