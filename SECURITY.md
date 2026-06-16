# Security Policy

## Supported Versions

`loadout-os` is the consolidated Knowledge OS (kernel + memories + rules adapters + the runtime hook) shipped as `@mcptoolshop/loadout-os`.

| Version | Supported |
|---------|-----------|
| 1.x     | Yes       |
| < 1.0   | No (pre-release consolidation builds) |

## Reporting a Vulnerability

If you discover a security issue, please report it responsibly:

1. **Do not** open a public issue.
2. Email: **64996768+mcp-tool-shop@users.noreply.github.com**
3. Include: a description of the vulnerability, steps to reproduce, the version affected, and an impact assessment.

### Response timeline

| Action | Target |
|--------|--------|
| Acknowledge report | 48 hours |
| Assess severity | 7 days |
| Release fix | 30 days |

## Attack Surface

`loadout-os` is a **local-only CLI** (`@mcptoolshop/loadout-os`) plus a `UserPromptSubmit` runtime hook. It unifies three previously-separate library surfaces and absorbs the operational rituals. The surface breaks into four parts:

- **Pure core (kernel).** Matching, merging, validation, token estimation, and frontmatter parsing are pure functions with no side effects — they only transform data structures in memory. The matcher (`packages/kernel/src/match.ts`) scores entries with plain-string keyword/token lookups (`Set.has`, `split`, `every`/`some` — `match.ts:105-119`). There is **no user-supplied regex** in the matching path, so there is no ReDoS vector; the only `RegExp` use is a fixed `[^a-z0-9\s]` tokenizer (`match.ts:73`).
- **Read-only rituals (`doctor`, `report`).** Both are pure reads — they never write (`doctor.ts` header + `runDoctor` comment "Pure read — no writes, ever", `doctor.ts:128-131`; `report.ts` header "Pure read; never writes"). They read the canonical memory store, the global resolver index, `settings.json`, and `usage.jsonl` from fixed, well-known locations, and delegate every check to a library validator rather than self-grading.
- **Write path (`refresh`, `memories index`, `rules split`).** The only writes are **local files in expected locations**: the store `index.json` (next to `MEMORY.md`), the global resolver index (`~/.ai-loadout/index.json`), and — for `rules split` — `.claude/rules/` plus the `CLAUDE.md` file itself. Destructive operations have safety rails:
  - **`refresh`** is the one ritual that performs an irreversible write (the live global index the hook reads on every prompt). It has an **andon halt** — any error-severity validation issue exits `1` and writes nothing downstream (`refresh.ts:211-219`) — and a **named compensator** — an existing destination is backed up to `<dest>.bak` before overwrite and restored on any write failure (`refresh.ts:253-287`). `--dry-run` computes everything and writes nothing.
  - **`rules split`** is interactive: it passes through to the `claude-rules` bin with inherited stdio, requires per-extraction confirmation, supports `--dry-run`, and writes a `.bak` backup before editing. loadout-os spawns it with `spawnSync` and forwards the user's args verbatim (`commands.ts:411-433`) — this is the only subprocess spawn and it targets a fixed, resolved local bin, never an arbitrary command.
- **Runtime hook (`apps/hook/loadout-hook.mjs`).** A `UserPromptSubmit` hook that reads the global index, matches the prompt, and injects ≤5 pointer lines (≤200 tokens). It is **fail-silent by design**: every error path exits `0` (`safeExit(0)` on missing index, non-JSON stdin, empty prompt, malformed index, import failure, or a matcher throw — `loadout-hook.mjs:72-95`), so a broken hook can never block a prompt. Its only write is an append-only `usage.jsonl` event, wrapped in a `try/catch` that swallows failures (`loadout-hook.mjs:120-141`).

## Across all surfaces

- **No network access** — makes no HTTP requests, opens no sockets, follows no remote locations.
- **No telemetry** — nothing is collected centrally or transmitted. Usage data stays in the local `~/.ai-loadout/usage.jsonl` the operator owns.
- **No secrets handling** — reads no credentials, environment secrets, or tokens; the tool handles loadout metadata only. No tokens or credentials appear in source or in any diagnostic output.
- **No code execution from data** — no `eval`, no `Function()`, no dynamic execution of file content. On-disk index/usage files are treated as untrusted: malformed JSON layers and malformed JSONL lines are skipped rather than executed or thrown on.
- **Scoped filesystem access** — writes are confined to the store `index.json`, the global resolver index, `.claude/rules/` + `CLAUDE.md` (via the interactive split), and the append-only usage log. The tool never walks arbitrary trees or writes outside the paths described above.

## Input Validation

- Frontmatter and `MEMORY.md`/`CLAUDE.md` parsing uses hand-rolled string splitting — no YAML parser, no regex-based evaluation, no prototype-pollution vector (inherited from the kernel/memories/rules adapters; see their per-package `SECURITY.md`).
- `validateIndex()` / `validateMemory()` check structural integrity only; they do not execute or interpret field values.
- The shared CLI arg parser fails loudly on a swallowed flag value (`--out --json`) rather than silently creating a file named `--json` (`console.ts:76-93`).
