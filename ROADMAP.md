# memory-os — ROADMAP

> Estimated horizon: **1–2 months** of session work to reach shippable.
> Picker: whoever opens the next session in this tree. Read `.claude/CLAUDE.md` first.

## Phase 0 — Initial bootstrap (DONE, this commit)

- [x] Clone in the three upstream sources (`ai-loadout`, `claude-memories`, `claude-rules`) under `packages/`
- [x] Clone in the runtime hook under `apps/hook/`
- [x] Drop CLAUDE.md and this ROADMAP for the next picker
- [x] `git init` + initial commit (no remote yet — that's Phase 5)

Out of scope for the bootstrap: no workspace wiring, no shared tests, no docs site, no remote, no publish.

## Phase 1 — Workspace wiring (1 session)

Goal: make the four trees install + build + test under one root.

- [ ] Root `package.json` with `workspaces: ["packages/*", "apps/*"]`
- [ ] One root `tsconfig.base.json` extended by each package
- [ ] Each package keeps its own `package.json`, but versions follow the root version
- [ ] `apps/hook` swaps its `@mcptoolshop/ai-loadout` dep for `"@memory-os/kernel": "workspace:*"`
- [ ] `npm ci` at the root produces a working install; `npm run build --workspaces` builds all four
- [ ] Each package's existing test suite still runs (`npm test --workspaces`)

Gate: green build at root, all existing tests pass, hook still injects when invoked with stdin JSON.

## Phase 2 — Unified CLI surface (1–2 sessions)

Goal: one `memory-os` binary that wraps the three CLI surfaces.

- [ ] New `packages/cli/` with `bin: { "memory-os": "..." }`
- [ ] Subcommands:
  - `memory-os memories <index|validate|stats|health>` — wraps `packages/memories/`
  - `memory-os rules <analyze|split|validate|stats>` — wraps `packages/rules/`
  - `memory-os resolve|explain|usage|dead|overlaps|budget|validate` — wraps `packages/kernel/`
  - `memory-os hook test` — drives `apps/hook` with a sample prompt
- [ ] Old binaries (`claude-memories`, `claude-rules`, `ai-loadout`) get thin shim binaries that delegate + emit a deprecation warning for one minor release
- [ ] `--help` is complete and accurate (Hard Gate C of shipcheck)

Gate: shipcheck `init` + `audit` runs cleanly on the new CLI; hard gates A–D green.

## Phase 3 — Docs + landing (1 session)

Goal: one Starlight handbook + one landing page covers the whole layer.

- [ ] `site/` at the root, Astro + Starlight (use the `handbook` skill)
- [ ] Sections: Kernel, Memories, Rules, Runtime hook, Migration from the three legacy packages
- [ ] Single landing page replaces the three separate `mcp-tool-shop-org.github.io/{ai-loadout,claude-memories,claude-rules}/` pages
- [ ] CNAME + GitHub Pages wiring (Phase 5 dependency — actual deploy after publish)

## Phase 4 — npm + GitHub bootstrap (1 session)

Goal: reserve the name on npm, set up Trusted Publishing, create the GitHub repo.

- [ ] Reserve `@mcptoolshop/memory-os` via the `npm-placeholder` skill (v0.0.0 placeholder + OIDC config)
- [ ] Create `mcp-tool-shop-org/memory-os` on GitHub (private at first; flip to public at Phase 5 publish)
- [ ] Add remote, push the initial bootstrap commit + Phases 1–3 commits
- [ ] CI workflow: lint + test on push (per workflow-standards.md — paths-gated, ubuntu-latest, concurrency block)

## Phase 5 — First real publish + upstream retirement (1 session)

Goal: ship `@mcptoolshop/memory-os@1.0.0`, retire the three upstream repos.

- [ ] Shipcheck full audit (`memory/shipcheck.md`)
- [ ] Run translations BEFORE publish (per the release-ordering rule in global CLAUDE.md)
- [ ] `npm publish` via Trusted Publishing
- [ ] `gh release create v1.0.0`
- [ ] Cut over `~/.claude/settings.json` hook command from `node ~/.claude/loadout-hook/loadout-hook.mjs` to `npx @mcptoolshop/memory-os hook` (or equivalent)
- [ ] Deprecate the three upstream npm names (only `ai-loadout` is published; npm-deprecate that one with a pointer to memory-os)
- [ ] Archive the three upstream local repos at `E:/AI/{ai-loadout,claude-memories,claude-rules}/` — move to `E:/DEEP_MEMORY/retired/` with a README explaining where they went
- [ ] Delete `~/.claude/loadout-hook/` once the npx-based hook is verified working

Gate: shipcheck 31/31, CI green, hook works through `npx @mcptoolshop/memory-os hook`, no broken pointer chains anywhere in the studio.

## Out of scope (for now)

- Replacing the kernel's matching algorithm with embeddings — separate research project; possibly a `memory-os/research/` tree later
- Multi-rig sync of `~/.ai-loadout/index.json` — out of scope until there's a second rig
- Web UI for browsing the dispatch table — nice-to-have, not in the critical path

## Open questions (for the director)

- Naming: keep `memory-os` or rebrand at Phase 4? (Sister names in the studio: Game Foundry OS, Research OS, Testing OS — pattern is consistent.)
- Should the kernel CLI surface (`ai-loadout resolve`, etc.) be preserved verbatim under `memory-os resolve`, or restructured? Verbatim = lower migration cost; restructured = chance to fix any ergonomics warts.
- License — three sources are all MIT, root stays MIT?

## When this is done

When all five phases pass, this file is the source-of-truth for "what shipped"; flip it to a CHANGELOG-style retrospective and start the next iteration.
