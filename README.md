# memory-os

> **Prototype, 2026-06-10.** Consolidated Knowledge OS for the studio — folds `ai-loadout` (kernel) + `claude-memories` (MEMORY.md adapter) + `claude-rules` (CLAUDE.md adapter) + the runtime UserPromptSubmit pointer-injection hook into a single repo. Wired as npm workspaces (Phase 1 done — `npm install` + `npm run build`/`test`/`verify` work at root). Not yet published; no remote yet (a deliberate Phase-5 waiver — see `.claude/CLAUDE.md`).

## Pickers start here

- Read [`.claude/CLAUDE.md`](.claude/CLAUDE.md) — project instructions and source-of-truth rules
- Read [`ROADMAP.md`](ROADMAP.md) — five-phase consolidation plan, ~1–2 months of session work
- Then dive in

## Layout

```
memory-os/
├── packages/
│   ├── kernel/       # was @mcptoolshop/ai-loadout (npm 1.4.3 — only one published)
│   ├── memories/     # was @mcptoolshop/claude-memories (unpublished)
│   └── rules/        # was @mcptoolshop/claude-rules (unpublished)
├── apps/
│   └── hook/         # workspace member; mirrors ~/.claude/loadout-hook/ (the LIVE one)
├── .claude/
│   └── CLAUDE.md
├── ROADMAP.md
└── README.md
```

## Why consolidate

Decompose-by-secrets (Parnas 1972) was the clean answer for a team of N humans. The studio runs 1 human + LLM crew — multi-repo work fragments Claude context across sessions and lets unpublished adapters rot. One named umbrella repo serves the operator. Full reasoning: `memory/Feedback/feedback_consolidate_when_cant_juggle_repos.md` in the canonical memory store.

## License

MIT (matches all three upstream sources).
