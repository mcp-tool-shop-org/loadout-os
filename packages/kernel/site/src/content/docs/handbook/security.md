---
title: Security
description: Attack surface analysis and threat model for AI Loadout.
sidebar:
  order: 4
---

## Attack Surface

AI Loadout has a minimal attack surface:

- **Limited filesystem access** — the usage module appends to a local JSONL log and the resolver reads index files from canonical layer paths; no arbitrary file access
- **No network access** — makes no HTTP requests, opens no sockets
- **No code execution** — no `eval`, `Function()`, or dynamic imports
- **No telemetry** — collects and transmits nothing
- **No native dependencies** — pure TypeScript, zero production deps

The core matching, merging, and validation modules are pure functions with no side effects.

## Threat Model

| Threat | Mitigation |
|--------|------------|
| Malformed frontmatter input | `parseFrontmatter()` returns `null` on invalid input — no exceptions, no eval |
| Prototype pollution | Hand-rolled parser uses plain object literals, no recursive merge |
| Index with bad data | `validateIndex()` catches structural issues with hints before they propagate |
| Regex DoS | No user-supplied regex — patterns are matched as plain string lookups |

## Reporting a Vulnerability

If you discover a security issue, please email **64996768+mcp-tool-shop@users.noreply.github.com** with:

- Description of the vulnerability
- Steps to reproduce
- Impact assessment

We will respond within 7 days and aim to release a fix within 14 days for confirmed issues.
