# memory-os — project instructions

## What this is

**memory-os is the Knowledge OS for the studio**, consolidated into one repo so it can evolve as a single surface. It folds together three previously-separate npm packages:

| Was | Now lives at | Role |
|---|---|---|
| `@mcptoolshop/ai-loadout` | `packages/kernel/` | Dispatch table, matching, resolver, runtime |
| `@mcptoolshop/claude-memories` | `packages/memories/` | MEMORY.md parser + index/validate/stats |
| `@mcptoolshop/claude-rules` | `packages/rules/` | CLAUDE.md parser + split/analyze/stats |

Plus the runtime pointer-injection hook earned in the 2026-06-10 session:

| Was | Now lives at | Role |
|---|---|---|
| `~/.claude/loadout-hook/` | `apps/hook/` | UserPromptSubmit hook — injects pointer lines to relevant memory entries |

## Status — PROTOTYPE (2026-06-10)

This is a **prototype consolidation**, not a finished product. Expect 1–2 months of work to reach shippable state. Pick up via `ROADMAP.md` at the repo root.

## Source-of-truth rule (load-bearing)

Until memory-os reaches first-shippable, the **upstream source-of-truth** still lives at:

- `E:/AI/ai-loadout/` (kernel — npm `@mcptoolshop/ai-loadout@1.4.3`, the only one published)
- `E:/AI/claude-memories/` (memories — local-only, README rewritten 2026-06-10 to admit not-on-npm)
- `E:/AI/claude-rules/` (rules — local-only, README rewritten 2026-06-10 to admit not-on-npm)
- `~/.claude/loadout-hook/` (hook — wired into `~/.claude/settings.json`, runs every UserPromptSubmit)

**Do not edit the three upstream source repos from inside memory-os.** Edits inside memory-os stay inside memory-os until the explicit retirement step in `ROADMAP.md` (Phase 5).

**The live hook** at `~/.claude/loadout-hook/` is what's actually running in every session. `apps/hook/` here is a mirror for refactor work. If you change the hook contract, update both — and the wired path in `~/.claude/settings.json`.

## Why this consolidation

The "three small packages, one kernel + two adapters" design is architecturally clean (decompose-by-secrets, Parnas 1972) but operationally broken for the studio's solo + LLM-crew shape. Multi-repo work fragments Claude context across sessions, lets unpublished adapters rot (only kernel was published), and forces serial advancement when one-repo work could be parallel-within-session. Full reasoning: `C:/Users/mikey/.claude/projects/F--AI/memory/Feedback/feedback_consolidate_when_cant_juggle_repos.md`.

## Working rules

- **Read `ROADMAP.md` first.** It's the dispatch table for this repo.
- **Read the global rules** at `C:/Users/mikey/.claude/CLAUDE.md` and the workspace rules at `E:/AI/.claude/CLAUDE.md` — they apply here too.
- **Read the canonical memory store** at `C:/Users/mikey/.claude/projects/F--AI/memory/MEMORY.md` before any Write/Edit (enforced by hook).
- The `loadout-hook` from session 2026-06-10 is live — it injects pointer lines on every prompt. Use them; don't paraphrase from the summaries.
- Workflow standards apply: any new pipeline/script/SKILL.md needs the six-standards compliance block (`workflow_standards.md`).

## Standards compliance — repo bootstrap

This repo is a prototype clone-in, not a workflow. The six-standards rule applies to workflows authored INSIDE this repo (CI pipelines, swarm dispatchers, multi-step builds), not to the bootstrap itself.

## Quick orientation

- `packages/kernel/` — published as `@mcptoolshop/ai-loadout@1.4.3`. Stable API surface (`matchLoadout`, `planLoad`, `resolveLoadout`, `recordLoad`). Don't break this.
- `packages/memories/` — CLI `claude-memories` (installed globally from this directory's upstream). Commands: `analyze`, `index`, `validate`, `stats`, `health`.
- `packages/rules/` — CLI `claude-rules` (installed globally from upstream). Commands: `analyze`, `split`, `validate`, `stats`, `init-signals`.
- `apps/hook/` — Node project, single mjs entrypoint, depends on `@mcptoolshop/ai-loadout` (npm). When Phase 1 lands, swap to a workspace dep on `packages/kernel`.
