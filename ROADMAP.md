# loadout-os — ROADMAP

> Estimated horizon: **1–2 months** of session work to reach shippable.
> Picker: whoever opens the next session in this tree. Read `.claude/CLAUDE.md` first — it has the live-system map and the source-of-truth rule.
> Phases are sequential; each ends with a gate. A failed gate halts the phase (andon) — fix before proceeding.

## Phase 0 — Initial bootstrap (DONE 2026-06-10, commit `76ad388`)

- [x] Clone in the three upstream sources (`ai-loadout`, `claude-memories`, `claude-rules`) under `packages/`
- [x] Clone in the runtime hook under `apps/hook/`
- [x] Drop CLAUDE.md and this ROADMAP for the next picker
- [x] `git init` + initial commit (no remote yet — deliberate; see the repo-first waiver in CLAUDE.md)

## Phase 1 — Workspace wiring (DONE 2026-06-16, commit `ab8aad8`)

Goal: make the four trees install + build + test under one root.

- [x] Root `package.json` with `workspaces: ["packages/*", "apps/*"]` — **npm workspaces** (studio standard; not pnpm/yarn — `workspace:*` protocol is NOT valid npm, depend by package name and let the workspace resolve it) — commit `ab8aad8`
- [x] One root `tsconfig.base.json` extended by each package — commit `ab8aad8`
- [ ] **Package names do not change in this phase.** `packages/kernel` keeps `@mcptoolshop/ai-loadout` (it is published under that name; renaming is a Phase 5 decision). `apps/hook`'s existing `"@mcptoolshop/ai-loadout"` dependency then resolves to the workspace copy automatically.
- [ ] Each package keeps its own `package.json`; versions follow the root version from Phase 5 onward
- [x] `npm ci` at root → working install; root `build`/`test`/`verify` scripts run the three TS packages in order, all green (203 baseline → 228 after Stage A) — commit `ab8aad8`
- [ ] Sync check: `git diff --no-index apps/hook ~/.claude/loadout-hook` shows no drift (run `apps/hook/smoke-test.ps1` after any hook change)

Gate: green root build, all existing suites pass, hook still injects when driven with stdin JSON, mirror-vs-live diff clean.

## Phase 2 — Runtime quality pass (1 session) — NEW, evidence-driven

The hook went live 2026-06-10 and immediately produced field evidence. Fix the known defects before building more surface on top of them.

- [x] **Score threshold in the hook.** (DONE — commit `43155a8`, HOK-01.) `apps/hook/loadout-hook.mjs` now applies a `HOOK_MIN_SCORE=0.3` floor alongside the `manual`-entry filter, so below-threshold matches emit nothing. Resolves the observed off-topic claude-guardian/duel-system pointers. (Calibration against accumulated `usage.jsonl` can still tune the floor later.)
- [ ] **Index hygiene at the source.** The generated index contains junk entries derived from prose lines that aren't topic refs — confirmed examples: `memory-files` (from a "- Memory files:" line), `full-frame` (from "Full frame: …"), `see-also-…` (a 100+-char id from a "See also:" line). Fix in `packages/memories`' parser/index-gen: skip refs whose derived name is empty/generic, and add a `validate` rule flagging ids > 60 chars. Then regenerate the store index + global copy and confirm the junk is gone.
- [ ] **Fix the 1 remaining LONG_SUMMARY entry** (`newsletter-publishing-…`, 159-char summary) — shorten its MEMORY.md line.
- [ ] **Keyword quality pass.** Weak matches come from generic auto-extracted keywords. Use `ai-loadout overlaps` to find routing ambiguities; hand-curate keywords (via frontmatter) for the worst offenders.
- [ ] **First observability report** (only if ~2 weeks of usage.jsonl has accumulated by this session; otherwise defer to Phase 3's `report` command): `ai-loadout usage` / `dead` / `budget` over the log → list never-loaded entries and wrongly-loaded entries; feed fixes back into keywords.

Gate: hook is silent on a deliberately off-topic prompt; junk entries absent from a regenerated index; `claude-memories validate` 0 errors; `ai-loadout validate` 0 warnings.

## Phase 3 — Unified CLI surface (DONE 2026-06-16)

Goal: one `loadout-os` binary that wraps the three CLI surfaces AND absorbs the operational rituals. **Built this session** — `packages/cli/` (`@mcptoolshop/loadout-os`, bin `loadout-os`): namespaced memories/rules wraps + flat kernel verbs + `doctor`/`report`/`refresh` rituals + `hook test`; 78 tests. `refresh` is built with a NAMED_COMPENSATOR but not yet run live; old-bin deprecating shims deferred to Phase 6.

- [ ] New `packages/cli/` with `bin: { "loadout-os": "..." }`
- [ ] Wrapping subcommands:
  - `loadout-os memories <index|validate|stats|health>` — wraps `packages/memories/`
  - `loadout-os rules <analyze|split|validate|stats>` — wraps `packages/rules/`
  - `loadout-os resolve|explain|usage|dead|overlaps|budget|validate` — wraps `packages/kernel/`
  - `loadout-os hook test` — drives `apps/hook` with a sample prompt
- [ ] **Ritual subcommands** (this is the consolidation payoff — one command instead of a 3-step ritual):
  - `loadout-os refresh` — store index → validate (halt on errors) → copy/rewrite to `~/.ai-loadout/index.json`. Replaces `~/.ai-loadout/refresh.ps1`; update the Index Freshness Ritual text in the global CLAUDE.md when this lands.
  - `loadout-os doctor` — one health screen: store validates, index `generated` newer than newest store .md mtime, global copy matches store copy, hook wired in `~/.claude/settings.json`, usage.jsonl growing.
  - `loadout-os report` — usage/dead-entry/budget summary over usage.jsonl (the observability loop, run monthly).
- [ ] Old binaries (`claude-memories`, `claude-rules`, `ai-loadout`) get thin shims that delegate + deprecation-warn for one minor release
- [ ] `--help` complete and accurate (Hard Gate C of shipcheck)

Gate: shipcheck `init` + `audit` cleanly on the new CLI; hard gates A–D green; `loadout-os refresh` produces a byte-identical result to the manual ritual.

## Phase 4 — Docs + landing (1 session)

Goal: one Starlight handbook + one landing page covers the whole layer.

- [ ] `site/` at the root, Astro + Starlight (use the `handbook` skill)
- [ ] Sections: Kernel, Memories, Rules, Runtime hook, Rituals (`refresh`/`doctor`/`report`), Migration from the three legacy packages
- [ ] Single landing page replaces the three separate `mcp-tool-shop-org.github.io/{ai-loadout,claude-memories,claude-rules}/` pages
- [ ] CNAME + GitHub Pages wiring (deploy itself waits for Phase 6)

## Phase 5 — npm + GitHub bootstrap (1 session)

Goal: reserve the name, set up Trusted Publishing, create the GitHub repo.

- [x] **Naming — RESOLVED 2026-06-16: `loadout-os`** (rebrand from `memory-os`; director call). Matches the `*-os` sister pattern (game-foundry-os, research-os) and keeps continuity with `@mcptoolshop/ai-loadout` + `~/.ai-loadout/`.
- [ ] Reserve `@mcptoolshop/loadout-os` — **deferred to the Phase 6 real publish**: the `@mcptoolshop` scope already protects the name (no squat risk on a scoped package), and the don't-default-to-empty-placeholder rule favors publishing the real treatment-complete package over a 0.0.0 placeholder. Wire OIDC/Trusted Publishing in the root `publish.yml`.
- [ ] Create `mcp-tool-shop-org/loadout-os` on GitHub (private at first; public at Phase 6 publish) — this closes the repo-first waiver
- [ ] Add remote, push everything to date
- [ ] CI workflow per `github-actions.md` rules: paths-gated, ubuntu-latest only, concurrency block, max 2 workflow files
  - Remove `packages/*/.github/` (8 inert workflow files + 2 dependabot.yml) BEFORE adding the remote; author a single root CI per github-actions.md (max 2 workflows, paths-gated, one pages deploy).

## Phase 6 — First real publish + upstream retirement (1 session)

Goal: ship `@mcptoolshop/loadout-os@1.0.0`, retire the three upstream repos. **Irreversible actions live here — author the six-standards compliance block + compensators table (publish, release, deprecate, settings cutover) in the session dispatch before executing.**

Pre-step — **consumer inventory** (do this BEFORE any cutover; pointer-chain breakage is this workspace's known failure mode):
- [ ] Grep `E:\AI` for `@mcptoolshop/ai-loadout` imports (known: `apps/hook`; suspected: none — verify)
- [ ] List global installs to replace: `ai-loadout` (npm), `claude-memories` + `claude-rules` (installed from local upstream dirs)
- [ ] List config/doc references to update: global CLAUDE.md Index Freshness Ritual text, `~/.ai-loadout/refresh.ps1`, `~/.claude/settings.json` hook command, canonical memory entries (`loadout-os-prototype.md`, `ai-loadout.md`, knowledge-os entries)

Ship:
- [ ] Shipcheck full audit (31/31; v1.0.0 minimum rule satisfied by 1.0.0)
- [ ] Translations BEFORE `npm publish` and `gh release create` (release-ordering rule, global CLAUDE.md)
- [ ] `npm publish` via Trusted Publishing; `gh release create v1.0.0`

Cut over + retire:
- [ ] `~/.claude/settings.json` hook command → the loadout-os-installed hook entrypoint; verify with a live prompt; keep `~/.claude/loadout-hook/` until verified, then delete
- [ ] Replace global CLI installs; update ritual text + refresh script references
- [ ] `npm deprecate @mcptoolshop/ai-loadout` with a pointer to loadout-os (the only published upstream)
- [ ] Archive upstream repos on GitHub (`gh repo archive` for ai-loadout / claude-memories / claude-rules) and move the local dirs `E:/AI/{ai-loadout,claude-memories,claude-rules}/` → `E:/DEEP_MEMORY/retired/` with a README pointing here
- [ ] Update canonical memory: `loadout-os-prototype.md` → shipped entry; MEMORY.md one-liner; run the Index Freshness Ritual

Gate: shipcheck 31/31, CI green, hook works through the published package on a live prompt, consumer-inventory list fully checked off, no broken pointer chains.

## Out of scope (for now)

- Embedding-based matching to replace keyword scoring — the 2026-06-10 weak-match evidence motivates it, but it's a research project; Phase 2's threshold + keyword curation is the cheap 80%. Revisit after a month of usage.jsonl data.
- Multi-rig sync of `~/.ai-loadout/index.json` — no second rig exists.
- Web UI for browsing the dispatch table — nice-to-have, not critical path.

## Open questions (for the director)

- ~~Naming: keep or rebrand?~~ **RESOLVED 2026-06-16 → `loadout-os`** (see Phase 5).
- Kernel CLI surface preserved verbatim under `loadout-os …` (lower migration cost) or restructured (fix ergonomics warts)? Default: verbatim, restructure later behind the same bin.
- License: three sources are MIT; root stays MIT? (Default yes.)

Resolved 2026-06-10: package manager = **npm workspaces** (matches every other studio monorepo; `workspace:*` in the original draft was pnpm syntax and would fail under npm).

## When this is done

When all six phases pass, flip this file to a CHANGELOG-style retrospective and start the next iteration. The canonical memory entry (`loadout-os-prototype.md`) gets rewritten as a shipped-product entry at the same time.
