# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 1.x     | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public issue
2. Email: 64996768+mcp-tool-shop@users.noreply.github.com
3. Include: description, reproduction steps, impact assessment
4. Expected response time: 48 hours

## Threat Model

| Threat | Mitigation |
|--------|------------|
| Malicious frontmatter injection | Parser validates field types; no code execution |
| Path traversal in topic references | Paths resolved relative to MEMORY.md; no absolute paths |
| Token estimation manipulation | Heuristic only (chars/4); not used for billing |
| Sensitive data in memory files | Tool is local-only; no network calls; user controls content |

## Design Principles

- **Local-only**: No network calls, no telemetry, no data exfiltration
- **Read-mostly**: Only writes index.json; never modifies source MEMORY.md
- **Deterministic**: Same inputs produce same outputs
- **Zero trust of file content**: Frontmatter parsed defensively
