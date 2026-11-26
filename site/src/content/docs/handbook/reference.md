---
title: Command Reference
description: The full loadout-os command surface — memories and rules namespaces, flat kernel verbs, and the hook, with synopses, positional ordering, and exit codes.
sidebar:
  order: 3
---

The complete `loadout-os` surface. Every leaf command also has a per-command help block — run `loadout-os <command> --help` for its synopsis, arguments, flags, an example, and exit codes. The rituals (`doctor`, `report`, `refresh`) have their own page: [Rituals](../rituals/).

## A note on the two kinds of `validate`

There are two validators, and which one you want depends on what you are validating:

- **`loadout-os validate <index>`** — a *flat* verb. This is the **kernel** index-structure validator. It checks a dispatch table's structure (required fields, unique kebab-case ids, summary bounds, valid priorities, non-negative budgets).
- **`loadout-os memories validate <MEMORY.md>`** / **`loadout-os rules validate`** — *namespaced* verbs. These lint a memory store or a rules directory (missing files, orphans, frontmatter drift).

The flat-vs-namespaced split is exactly how the name collision is resolved — all three `validate`s coexist because only one is flat. Don't reach for `validate <index>` when you meant to lint a `MEMORY.md`.

## `memories` namespace

Wraps the MEMORY.md adapter.

```
loadout-os memories index    <MEMORY.md> [--lazy] [--json]
loadout-os memories validate <MEMORY.md> [--json]
loadout-os memories stats    <MEMORY.md> [--json]
loadout-os memories health   [path] [--json]
```

| Command | Synopsis | Exit codes |
|---------|----------|------------|
| `index` | `memories index <MEMORY.md> [--lazy] [--json]` — generate a dispatch table from the store. `--lazy` generates an on-demand (lazy-load) index. | `0` index generated · `1` MEMORY.md missing/unreadable |
| `validate` | `memories validate <MEMORY.md> [--json]` — lint the store. | `0` no errors (warnings allowed) · `1` ≥1 error-severity issue |
| `stats` | `memories stats <MEMORY.md> [--json]` — token budget dashboard. | `0` stats printed · `1` MEMORY.md missing |
| `health` | `memories health [path] [--json]` — installation check; auto-detects MEMORY.md locations when no path given. | `0` Node OK · `1` Node < 20 |

`<MEMORY.md>` is the required first positional for `index`, `validate`, and `stats`; for `health` the path is optional.

## `rules` namespace

Wraps the CLAUDE.md adapter.

```
loadout-os rules analyze  <CLAUDE.md> [--rules-dir <dir>] [--json]
loadout-os rules validate [--rules-dir <dir>] [--lazy] [--repo-root <dir>] [--json]
loadout-os rules stats    <CLAUDE.md> [--rules-dir <dir>] [--json]
loadout-os rules split    [CLAUDE.md] [--yes] [--dry-run]
```

| Command | Synopsis | Exit codes |
|---------|----------|------------|
| `analyze` | `rules analyze <CLAUDE.md> [--rules-dir <dir>] [--json]` — score sections and show proposed extractions. | `0` analysis printed · `1` CLAUDE.md missing |
| `validate` | `rules validate [--rules-dir <dir>] [--lazy] [--repo-root <dir>] [--json]` — lint the rules directory. `--rules-dir` defaults to `.claude/rules` (or `.claude/loadout` with `--lazy`); `--repo-root` is the root the rule paths resolve against (default cwd). | `0` no errors · `1` ≥1 error-severity issue |
| `stats` | `rules stats <CLAUDE.md> [--rules-dir <dir>] [--json]` — the physics of the system: always-loaded vs on-demand budget. | `0` stats printed · `1` CLAUDE.md missing |
| `split` | `rules split [CLAUDE.md] [--yes] [--dry-run]` — interactive extraction. `[CLAUDE.md]` defaults to `.claude/CLAUDE.md`; `--dry-run` previews without writing; `--yes` accepts all without prompting. | `0` split completed (or dry-run printed) · `≠0` forwarded from the claude-rules bin |

`rules split` is interactive: it passes through to the `claude-rules split` bin with inherited stdio so the readline prompt works (all args and flags are forwarded verbatim). `--help` is intercepted before the prompt is ever spawned.

## Flat kernel verbs

The knowledge router. All accept `--json`; the resolver verbs also accept `--project`, `--global`, `--org`, and `--session`.

```
loadout-os resolve                  # resolve layered loadouts (global → org → project → session)
loadout-os explain <entry-id>       # how an entry resolved across layers
loadout-os usage <jsonl>            # usage summary from the event log
loadout-os dead <index> <jsonl>     # entries never loaded
loadout-os overlaps <index>         # keyword routing ambiguities
loadout-os budget <index> [jsonl]   # token budget breakdown
loadout-os validate <index>         # validate index STRUCTURE (kernel)
```

| Command | Synopsis | Exit codes |
|---------|----------|------------|
| `resolve` | `resolve [--project <dir>] [--global <dir>] [--org <p>] [--session <p>] [--json]` | `0` layers resolved (even if none found) |
| `explain` | `explain <entry-id> [--project <dir>] [--global <dir>] [--org <p>] [--session <p>] [--json]` | `0` explanation printed · `1` entry id not found |
| `usage` | `usage <jsonl> [--json]` | `0` summary printed (empty log allowed) · `1` missing arg |
| `dead` | `dead <index> <jsonl> [--json]` | `0` report printed · `1` missing arg / bad index |
| `overlaps` | `overlaps <index> [--json]` | `0` overlaps printed (none = unambiguous routing) · `1` bad index |
| `budget` | `budget <index> [jsonl] [--json]` | `0` budget printed · `1` bad index |
| `validate` | `validate <index> [--json]` — kernel index-structure validator | `0` no structural errors · `1` ≥1 error-severity issue |

### Positional ordering matters: `dead <index> <jsonl>`

`dead` takes two positionals and the order is fixed: the **index comes first**, the **usage log second**.

```bash
loadout-os dead ~/.ai-loadout/index.json ~/.ai-loadout/usage.jsonl
```

Swapping them — `dead usage.jsonl index.json` — makes the kernel try to read the index as an event log and the log as an index. It's a quiet foot-gun, which is why the order is fixed and documented in the command's `--help`. The same first-positional-is-the-index convention holds for `budget <index> [jsonl]`, where the usage log is the optional second positional (folding observed averages into the estimate).

## Hook

```
loadout-os hook test [--prompt "<text>"] [--repo-root <dir>] [--json]
loadout-os hook session-start [--project <root>] [--store <dir>] [--user-prompt-submit]
loadout-os hook pre-compact   [--project <root>] [--store <dir>] [--stale-after-min <n>]
loadout-os hook post-write    [--project <root>] [--store <dir>] [--fix]
loadout-os hook pre-tool      [--mode enforce|log-only] [--profiles <path>] [--log <path>] [--timeout-ms <ms>]
```

- `hook test` drives the `UserPromptSubmit` runtime hook against a sample prompt in an isolated HOME so the live `usage.jsonl` is never written. Exit `0` when the hook ran, `1` when the hook binary is not found.
- `hook session-start`, `hook pre-compact`, and `hook post-write` manage project-layer board injection and automatic index refreshes.
- `hook pre-tool` evaluates the Layer A/B rule table against `PreToolUse` payloads using `~/.ai-loadout/profiles.json` (`AI_LOADOUT_PROFILES_PATH`), failing open before a block match and exiting `2` with stderr only when blocked in `enforce` mode. Global `refresh` and `doctor` resolve their default memory store with precedence `--store <dir>` > `AI_LOADOUT_STORE` > `profiles.json` `defaultStore` (refusing with `DEFAULT_STORE_REQUIRED` if unset).

```bash
loadout-os hook test --prompt "scaffold a new game"
loadout-os hook pre-tool --mode enforce
```
