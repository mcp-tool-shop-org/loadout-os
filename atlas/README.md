# loadout-os: how it works

Mapped at 2026-09-23 from commit 741a092.

## What this is

9 parts. Work enters through 2 doors; the busiest is CI, which reaches 4 parts.

## What changed since the last map

This is the first map.

## What comes in

1. **CI.** On a pull request touching 8 paths; on a push to main touching 8 paths; or by hand. Runs packages/cli/src/, packages/kernel/src/, packages/memories/src/ and 1 more.
2. **Release.** When a tag matching `v*` is pushed. Runs packages/cli/esbuild.config.mjs, packages/cli/src/, packages/kernel/src/ and 2 more.

## What happens through CI

1. The workflow runs packages/cli/src/ in cli, packages/kernel/src/ in kernel, packages/memories/src/ in memories and packages/rules/src/ in rules.
2. It writes to .claude/.
3. It deploys the site.

## Who reads the results

- **.claude/** is read by packages/rules/src/analyze.ts and packages/rules/src/stats.ts.

## The other doors

**Release** runs packages/cli/esbuild.config.mjs, packages/cli/src/, packages/kernel/src/ and 2 more, writes to .claude/, publishes to npm, and creates a GitHub release.

## What breaks what

- **kernel** is imported by 4 parts (cli, hook, memories, rules) and sits on the path of 2 doors.
- **memories** is imported by 1 part (cli) and sits on the path of 2 doors.
- **rules** is imported by 1 part (cli) and sits on the path of 2 doors.
- **cli** is imported by no other part and sits on the path of 2 doors.
- **.claude/** is written by cli and rules, and read by cli and rules; a hand edit reaches every reader.

## What tends to change together

No two source files changed together often enough to name.

Window: 180 days; a pair counts from 3 shared commits.

## What no test touches

- **hook** is imported by no test.
- **site** is imported by no test.

## Written but never read

Every written place has a reader.

## Helpers that look duplicated

These are candidates from names and call order, not a judgement.

- **extractKeywords** is exported by packages/memories/src/analyze.ts (memories) and packages/rules/src/analyze.ts (rules); the two look alike.
- **fail** is exported by packages/cli/src/console.ts (cli) and packages/rules/src/console.ts (rules); the two look alike.
- **flagValue** is exported by packages/cli/src/console.ts (cli) and packages/rules/src/console.ts (rules); the two look alike.
- **hasFlag** is exported by packages/cli/src/console.ts (cli) and packages/rules/src/console.ts (rules); the two look alike.
- **info** is exported by packages/cli/src/console.ts (cli) and packages/rules/src/console.ts (rules); the two look alike.

And 4 more pairs.

## Generated, never hand-edited

- **.claude/** is written by packages/cli/src/refresh.ts and packages/rules/src/signals.ts.

## Hand-authored

People write .github/, packages/kernel/, packages/memories/, packages/rules/ and the repository root. Nothing in this repository writes to them.

## Where to start

.github/workflows/ci.yml → packages/kernel/src/ → .claude/ → packages/rules/src/analyze.ts

Read those in order to follow one pull request end to end.

## What this map cannot see

- 7 writes and 59 reads use paths built at run time and are not named here.
- Statistics confidence is low: fewer than 20 source files reach 10 revisions in the window.

Regenerate with `npx --yes @dogfood-lab/atlas map`.
