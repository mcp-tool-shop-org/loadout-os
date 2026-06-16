---
title: Rituals
description: The three loadout-os rituals — refresh, doctor, and report — that keep the knowledge OS in sync, healthy, and observable. When to run each.
sidebar:
  order: 4
---

The rituals are the consolidation payoff. Before loadout-os, keeping the knowledge OS healthy meant a multi-step manual sequence run by hand. Now there are three commands: **`refresh`** keeps the system in sync, **`doctor`** tells you whether it's healthy, and **`report`** tells you whether it's earning its keep. Two of the three never write anything.

## `refresh` — keep the index in sync

```
loadout-os refresh [--store <dir>] [--dest <path>] [--dry-run]
```

`refresh` folds the entire Index Freshness Ritual into one command. It (a) regenerates the store index from `MEMORY.md`, (b) validates it with an **andon halt** on any error-severity issue, (c) rewrites relative entry paths to absolute paths under the store root and writes the global resolver index the runtime hook reads (`~/.ai-loadout/index.json` by default), then (d) re-validates what it wrote.

Two safety properties matter here, because this is the one ritual that performs an irreversible write:

- **Andon halt.** If validation surfaces any error-severity issue, `refresh` prints the issues and exits `1`, writing nothing downstream. A bad index never reaches the live global path the hook reads on every prompt.
- **Named compensator.** Before overwriting an existing destination, `refresh` copies it to `<dest>.bak`. On any write failure it restores the destination from that backup and re-throws, so a half-written or failed write never leaves the live index corrupt. The undo line is printed for the operator (`undo: copy <dest>.bak back over <dest>`).

Run `--dry-run` first when you're unsure — it computes everything, writes nothing, and prints the entries and paths that *would* change:

```bash
loadout-os refresh --dry-run     # see what would change
loadout-os refresh               # publish for real
```

Exit codes: `0` index written (or dry-run printed) · `1` validation error (andon) or write failure · `2` store / MEMORY.md missing.

**When to run it:** after any edit to your `MEMORY.md` store or its topic files. The hook reads the global copy, not the store, so changes don't take effect until you `refresh`.

## `doctor` — is the system healthy?

```
loadout-os doctor [--store <dir>] [--index <p>] [--settings <p>] [--usage <p>] [--repo-root <dir>] [--json]
```

`doctor` is a read-only health screen — it **never writes**. It runs eight checks across the whole live system, each delegating to a library validator rather than self-grading:

1. **store-validates** — the store's `MEMORY.md` validates with 0 errors.
2. **index-parse** — the global index parses and passes the kernel's structure validator.
3. **hook-drift** — the installed runtime-hook mirror matches the repo source (a SHA-256 comparison).
4. **layers-malformed** — no resolver layer is present-but-malformed.
5. **core-entries** — at least one `core` (always-loaded) entry exists.
6. **observability-loop** — the observed average task-load is recorded (not still null).
7. **hook-wired** — the `UserPromptSubmit` hook is wired in `settings.json`.
8. **usage-growing** — `usage.jsonl` exists, is non-empty, and was written recently.

Each check reports `pass`, `warn`, or `fail`, and failing/warning checks print a hint. The command exits `0` when there are no failures (warnings don't flip it) and `1` on any failure. `--json` emits `{ checks: [{ id, status, message, hint }], ok }`.

**When to run it:** at the start of a working session, and any time the hook seems to be misbehaving — drift and wiring problems show up here immediately.

## `report` — is the index earning its keep?

```
loadout-os report [--index <p>] [--jsonl <p>] [--json]
```

`report` is the observability loop. It composes the kernel's usage, dead-entry, and budget analysers over `usage.jsonl` and the global index into one report:

- **Usage summary** — which entries loaded, and how often.
- **Dead entries** — entries that have never loaded. Dead weight is a signal to fix the entry's keywords or remove it.
- **Token budget** — the always-loaded vs on-demand breakdown, with observed averages compared against the estimate.
- **Score distribution** — when usage events carry a `score`, a histogram that tells you whether the hook's score floor is calibrated (too many low-score injections, or too few).

`report` is read-only. It exits `0` when the report prints and `2` when a required input (the index or usage log) is missing.

**When to run it:** monthly, or after enough usage has accumulated to be meaningful. The output feeds back into the system — dead entries and routing ambiguities point you at the keywords to hand-curate, and the score distribution tells you whether to adjust the hook's floor.

## How the three fit together

`refresh` is the write path; `doctor` and `report` are the read paths. A healthy cadence: `doctor` at session start to confirm nothing has drifted, `refresh` whenever you change the store, and `report` periodically to tune keywords and the score floor from real usage. See [Architecture](../architecture/) for where each ritual sits in the data flow.
