# memory-os — project instructions

## What this is

**memory-os is the Knowledge OS for the studio**, consolidated into one repo so it can evolve as a single surface. It folds together three previously-separate npm packages plus the live runtime hook:

| Was | Now lives at | Role |
|---|---|---|
| `@mcptoolshop/ai-loadout` (npm 1.4.3 — only one published) | `packages/kernel/` | Dispatch table, matching, resolver, runtime (`matchLoadout`, `planLoad`, `resolveLoadout`, `recordLoad`) |
| `@mcptoolshop/claude-memories` (unpublished) | `packages/memories/` | MEMORY.md parser + `index`/`validate`/`stats`/`health` |
| `@mcptoolshop/claude-rules` (unpublished) | `packages/rules/` | CLAUDE.md parser + `analyze`/`split`/`validate`/`stats` |
| `~/.claude/loadout-hook/` (LIVE) | `apps/hook/` | UserPromptSubmit hook — injects pointer lines to relevant memory entries |

## The live system (do not break this)

The production data flow, running on this rig right now:

```
canonical store  C:/Users/mikey/.claude/projects/F--AI/memory/   (~330 .md files + MEMORY.md)
      │  claude-memories index + validate           ← "Index Freshness Ritual" in global CLAUDE.md
      ▼
store dispatch table  <store>/index.json
      │  ~/.ai-loadout/refresh.ps1  (absolute-path rewrite + copy)
      ▼
global layer  ~/.ai-loadout/index.json   (~319 entries)
      │  read on EVERY UserPromptSubmit
      ▼
hook  ~/.claude/loadout-hook/loadout-hook.mjs   (wired in ~/.claude/settings.json)
      │  matchLoadout(prompt) → ≤5 pointer lines, ≤200 tokens, pointers NOT payloads
      ▼
injected additionalContext  +  usage events → ~/.ai-loadout/usage.jsonl
```

Operational consequences:

- **The live hook is `~/.claude/loadout-hook/`** — `apps/hook/` here is a mirror for refactor work. If you change hook behavior: update BOTH copies, run `apps/hook/smoke-test.ps1`, and keep the command path in `~/.claude/settings.json` pointing at the live copy. Off-switch for testing: `AI_LOADOUT_HOOK=off`.
- **Never edit `~/.claude/settings.json` hook wiring casually** — a broken hook fires on every prompt of every session.
- Index changes only take effect after the ritual (index → validate → refresh). The hook reads the GLOBAL copy, not the store copy.

## Status — PROTOTYPE (bootstrapped 2026-06-10)

Phase 0 of 6 done. Pick up via `ROADMAP.md` (six phases: wiring → runtime quality → unified CLI → docs → npm/GitHub bootstrap → publish + retirement).

## Source-of-truth rule (load-bearing)

Until Phase 6 retirement, **upstream source-of-truth stays at**:

- `E:/AI/ai-loadout/` (kernel), `E:/AI/claude-memories/`, `E:/AI/claude-rules/` — the globally-installed CLIs come from these dirs
- `~/.claude/loadout-hook/` — the running hook

**Do not edit the three upstream repos from inside memory-os sessions.** Edits here stay here until the explicit Phase 6 cutover. The one exception is the hook's both-copies rule above.

## Repo-first waiver (deliberate — do not "fix")

This repo intentionally has **no GitHub remote yet**, which violates the workspace Repo-First Hard Rule. The waiver is director-approved (2026-06-10): it's a local prototype consolidating already-pushed upstream sources; nothing here is unrecoverable. The remote lands at Phase 5. Do not create the remote early or halt over the rule.

## Why this consolidation

Decompose-by-secrets (Parnas 1972) is right for N humans, operationally broken for solo + LLM-crew: multi-repo work fragments Claude context, unpublished adapters rot (only the kernel ever shipped), and advancement serializes across repos. Full reasoning: `memory/Feedback/feedback_consolidate_when_cant_juggle_repos.md` in the canonical store.

## Working rules

- **Read `ROADMAP.md` first** — it's the dispatch table for this repo, and each phase has a gate that halts on failure.
- Global rules (`C:/Users/mikey/.claude/CLAUDE.md`) and workspace rules (`E:/AI/.claude/CLAUDE.md`) apply here.
- **Cost discipline:** no agent fleets, no Workflow orchestration without explicit pricing + director approval. This layer's work is deterministic-first: scripts, validators, hand edits.
- The loadout-hook injects pointer lines on prompts — open the pointed file before acting; don't paraphrase from the summary line.
- Any new pipeline/script/SKILL.md authored here needs the six-standards compliance block (`workflow_standards.md`). Phase 6 (publish/deprecate/cutover) additionally requires a compensators table — no skip allowed.
- If the session touches the canonical memory store, end with the Index Freshness Ritual (global CLAUDE.md, Non-Negotiable).

## Verification

- Per-package (until Phase 1 wires the root): `npm test` inside `packages/{kernel,memories,rules}` — all three have real suites.
- Hook: `apps/hook/smoke-test.ps1` (drives the hook with sample stdin JSON; also run it against the live copy after any hook change).
- System: `claude-memories validate <store>/MEMORY.md` (expect 0 errors) and `ai-loadout validate <store>/index.json` / `~/.ai-loadout/index.json`.
- This is a CLI/library repo — never use preview/browser tools here.

## Known issues (field evidence, 2026-06-10 — Phase 2 owns these)

1. **Hook has no score threshold.** Design said below-threshold → silence; implementation injects top-5 regardless (observed: irrelevant claude-guardian/duel-system pointers on a memory-os prompt).
2. **Junk index entries** derived from prose lines: `memory-files`, `full-frame`, `see-also-…` (100+-char id). Root cause is in `packages/memories` parsing/index-gen, not the data.
3. **Weak keyword matching** on auto-extracted keywords; `ai-loadout overlaps` shows routing ambiguities. Hand-curated frontmatter keywords is the cheap fix.
4. One LONG_SUMMARY warning left in the store index (`newsletter-publishing-…`).

## Quick orientation

- `packages/kernel/` — published API surface; **don't break it**, and don't rename the package before Phase 5's naming decision.
- `packages/memories/` — the parser quirks to know: one ref parsed per line (first backtick path wins), wildcard paths error, any backticked `*.md` token in prose is treated as a ref.
- `packages/rules/` — frontmatter is source-of-truth; `validate` flags drift against `.claude/rules/index.json`.
- `apps/hook/` — single-file mjs, fail-silent by design (every error path exits 0 so a broken hook can never block a prompt).
