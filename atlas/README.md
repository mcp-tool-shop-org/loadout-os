# loadout-os: how it works

Mapped at 2026-11-08 from commit fa95b53 by Atlas 1.24.0.

## What this is

9 parts, mostly Markdown (236 files); code in TypeScript (85), CSS (8), JavaScript (7), Astro (4) and PowerShell (1). Work enters through 6 doors; the busiest is CI, which reaches 6 parts. It publishes @mcptoolshop/loadout-os to npm. It deploys a site to GitHub Pages. People run ai-loadout, claude-memories, claude-rules and loadout-os.

## What changed since 2026-11-08 (6ddc377)

Nothing structural changed since 2026-11-08; 1 file changed content.

## What comes in

1. **CI.** On a pull request touching 9 paths; on a push to main touching 9 paths; or by hand. Runs apps/hook/esbuild.config.mjs, packages/cli/src/tests/console.test.ts, packages/cli/src/tests/dispatch.test.ts and 32 more; builds packages/cli/src/, packages/kernel/src/, packages/memories/src/ and 17 more. On a push to main, it also runs site/astro.config.mjs and site/src/.
2. **Release.** When a tag matching `v*` is pushed. Runs apps/hook/esbuild.config.mjs, packages/cli/esbuild.config.mjs, packages/cli/src/tests/console.test.ts and 33 more; builds packages/cli/src/, packages/kernel/src/, packages/memories/src/ and 17 more.
3. **claude-memories** (a command people run). Runs packages/memories/src/cli.ts.
4. **claude-rules** (a command people run). Runs packages/rules/src/cli.ts.
5. **ai-loadout** (a command people run). Runs packages/kernel/src/cli.ts.
6. **loadout-os** (a command people run). Runs packages/cli/dist/loadout-os.js, built from a source this map cannot place.

## What happens through CI

1. The workflow runs 9 files in cli, apps/hook/esbuild.config.mjs in hook, packages/kernel/src/tests/ in kernel, packages/memories/src/tests/ in memories, and packages/rules/src/tests/ in rules; it builds packages/cli/src/ in cli, packages/kernel/src/ in kernel, packages/memories/src/ in memories and packages/rules/src/ in rules.
2. On a push to main, it also runs site/astro.config.mjs and site/src/.
3. It writes to .claude/loadout/, which is not tracked.
4. It uploads coverage to Codecov.
5. It deploys the site on a push to main.

## Who reads the results

CI writes only to .claude/loadout/, which is not tracked.

## The other doors

**Release** runs apps/hook/esbuild.config.mjs, packages/cli/esbuild.config.mjs, packages/cli/src/tests/console.test.ts and 33 more, builds packages/cli/src/, packages/kernel/src/, packages/memories/src/ and 17 more, writes to .claude/loadout/, which is not tracked, publishes @mcptoolshop/loadout-os to npm, and creates a GitHub release.

**claude-memories** (a command people run) runs packages/memories/src/cli.ts and reaches kernel.

**claude-rules** (a command people run) runs packages/rules/src/cli.ts and reaches kernel.

**ai-loadout** (a command people run) runs packages/kernel/src/cli.ts.

**loadout-os** (a command people run) runs packages/cli/dist/loadout-os.js, built from a source this map cannot place.

## What breaks what

- **kernel** is imported by 4 parts (cli, hook, memories, rules) and sits on the path of 5 doors.
- **memories** is imported by 1 part (cli) and sits on the path of 3 doors.
- **rules** is imported by 1 part (cli) and sits on the path of 3 doors.
- **cli** is imported by no other part and sits on the path of 2 doors.
- **hook** is imported by no other part and sits on the path of 2 doors.

## What tends to change together

- **packages/cli/src/cli.ts** and **packages/cli/src/help.ts** changed together in 5 of 7 commits, inside the cli part.
- **packages/cli/src/cli.ts** and **packages/cli/src/tests/help.test.ts** changed together in 5 of 7 commits, inside the cli part.
- **packages/memories/src/index-gen.ts** and **packages/memories/src/validate.ts** changed together in 5 of 7 commits, inside the memories part.
- **packages/memories/src/tests/index-gen.test.ts** and **packages/memories/src/validate.ts** changed together in 4 of 7 commits, inside the memories part.

4 files changed together with their own tests, as expected.

Confidence is low: fewer than 25 source files reach 10 revisions in the window.

Window: 180 days; a pair counts from 3 shared commits, since 0 source files reach 10 revisions; the floor rises to 10 when 25 do.

## What no test touches

- **hook** is imported by no test.
- **site** is imported by no test.

## Written but never read

No place this map can see is written, so none goes unread.

## Helpers that look duplicated

These are candidates from names and call order, not a judgement.

- **extractKeywords** is exported by packages/memories/src/analyze.ts (memories) and packages/rules/src/analyze.ts (rules); the two look alike.
- **fail** is exported by packages/cli/src/console.ts (cli) and packages/rules/src/console.ts (rules); the two look alike.
- **flagValue** is exported by packages/cli/src/console.ts (cli) and packages/rules/src/console.ts (rules); the two look alike.
- **hasFlag** is exported by packages/cli/src/console.ts (cli) and packages/rules/src/console.ts (rules); the two look alike.
- **info** is exported by packages/cli/src/console.ts (cli) and packages/rules/src/console.ts (rules); the two look alike.

And 4 more pairs.

## Generated, never hand-edited

Nothing in this repository writes to a tracked place this map can see.

## Hand-authored

People write .claude/, .github/, packages/kernel/, packages/memories/, packages/rules/ and the repository root; 6 writes with paths built at run time may land here.

## Where to start

.github/workflows/ci.yml → packages/kernel/src/index.ts → packages/kernel/src/frontmatter.ts → packages/kernel/src/types.ts

Read those in order to follow one pull request end to end.

## What this map cannot see

- 6 writes and 23 reads use paths built at run time and are not named here.
- 1 write goes to places this repository does not track, so it is not listed as generated.
- 5 writes and 54 reads go to a path their caller passes, not to this repository.
- 2 writes and 26 reads go to the directory the command is run in, not to this repository.
- 7 writes and 13 reads go to the home directory (.ai-loadout/ and .claude/) or a path their caller passes, not to this repository.
- 6 writes and 1 read go to a temporary directory, not to this repository.
- 5 reads go to the directory the command is run in (.claude/ and MEMORY.md/) or the home directory (.claude/), not to this repository.
- 1 write and 2 reads go to the directory the command is run in (.claude/, MEMORY.md/ and memory/), the home directory (.claude/) or a path their caller passes, not to this repository.
- 2 writes and 1 read go to the home directory (.ai-loadout/), not to this repository.
- 1 write goes to the directory the command is run in (.claude/ and memory/) or a path its caller passes, not to this repository.
- 6 commands are built at run time and not followed, 5 of them in tests.
- Statistics confidence is low: fewer than 25 source files reach 10 revisions in the window.

Regenerate with `npx --yes @dogfood-lab/atlas map`.
