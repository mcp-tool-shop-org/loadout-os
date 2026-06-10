# Repo Map — @mcptoolshop/ai-loadout

## Stack

- TypeScript (Node.js), zero runtime dependencies
- 12 source modules, ~2,800 lines
- Node built-in test runner (8 test files)
- Single entry: CLI (`bin/ai-loadout`)
- Library exports for programmatic use

## Module architecture

| Layer | Modules | Purpose | I/O? |
|-------|---------|---------|------|
| Types | `types.ts` | LoadoutEntry, LoadoutIndex, MatchResult, MergedIndex, Budget, etc. | No |
| Parsing | `frontmatter.ts` | YAML-like frontmatter extraction from markdown payloads | No |
| Validation | `validate.ts` | Structural validation of indexes (duplicate IDs, missing fields, budget) | No |
| Matching | `match.ts` | Deterministic keyword/pattern scoring against task descriptions | No |
| Merging | `merge.ts` | Deterministic layer merge with conflict tracking and provenance | No |
| Tokens | `tokens.ts` | Token estimation (chars / 4 heuristic) | No |
| Analysis | `analysis.ts` | Dead entry detection, keyword overlap, budget breakdown | No |
| Resolution | `resolve.ts` | Layer discovery (4 canonical locations), file loading, merge orchestration | Yes (reads) |
| Runtime | `runtime.ts` | Agent API: planLoad, recordLoad, manualLookup | Yes (reads + appends) |
| Usage | `usage.ts` | Append-only JSONL event logging, usage summarization | Yes (reads + appends) |
| CLI | `cli.ts` | Command router (resolve, explain, usage, dead, overlaps, budget) | Yes |
| Exports | `index.ts` | Public API surface | No |

**Key architectural property:** All core logic (match, merge, validate, analysis) is pure functions. No filesystem, no network, no side effects. I/O is isolated to resolve/runtime/usage/cli layers.

## Primary seam: Knowledge dispatch correctness

### Dispatch decision flow

```
planLoad(task)
  ├─ resolveLoadout()
  │   ├─ discoverLayers(): check global, org, project, session in fixed order
  │   │   └─ missing/malformed layers: silently skipped, recorded in searched[]
  │   └─ mergeIndexes(): later layer overrides earlier for same entry ID
  │       └─ all overrides tracked as conflicts with resolution: "override"
  │
  ├─ matchLoadout(task, merged.index)
  │   ├─ tokenize(task): lowercase, strip non-alphanum, split, discard ≤1 char
  │   ├─ scoreEntry() per entry:
  │   │   ├─ core: score=1.0 (always included)
  │   │   ├─ manual: score=0 (never auto-included)
  │   │   └─ domain: (matchedKeywords/totalKeywords) + patternBonus(0.2)
  │   ├─ filter: score ≥ MIN_SCORE (0.1)
  │   └─ sort: score desc, then tokens_est asc
  │
  └─ separate into: preload (core) / onDemand (domain ≥ 0.1) / manual (rest)
```

### Contract surfaces that must stay synchronized

| Surface | Location | What it governs |
|---------|----------|-----------------|
| MIN_SCORE threshold | `match.ts:17` | Hard boundary: domain entries below 0.1 are excluded |
| Scoring formula | `match.ts:66-77` | keyword ratio + pattern bonus (0.2), capped at 1.0 |
| Layer order | `resolve.ts:93-108` | global → org → project → session, fixed |
| Override rule | `merge.ts` | Later layer wins for same entry ID, always |
| Reason strings | `match.ts:104-110` | Machine-readable match explanation per entry |
| Provenance | `merge.ts` → `runtime.ts` | Entry ID → source layer name mapping |
| Conflict tracking | `merge.ts` | Every override recorded with layers and resolution |

### Liar-path surfaces (where wrong dispatch could look right)

| Risk | Where | Observable? |
|------|-------|-------------|
| Ambiguous keywords → wrong entry loads | `match.ts` scoring | Yes: `overlaps` command detects shared keywords |
| Correct entry excluded by threshold | `match.ts:97` MIN_SCORE filter | No recovery — intentional hard filter |
| Layer override silently replaces better version | `merge.ts` override logic | Yes: `explain` command shows full override chain |
| Malformed layer silently skipped | `resolve.ts:122-125` catch block | Partially: marked as not found in searched[], but not distinguishable from genuinely missing |
| Stale index routes to outdated payloads | Outside system scope | Yes: `dead` + `usage` commands detect drift over time |
| Token estimate wildly off | `tokens.ts` chars/4 heuristic | Yes: `budget` command compares estimated vs observed |

## Validation

- `npm test` — 8 test files via Node `--test`
- `npm run build` — TypeScript compilation
- Key tests: `match.test.ts` (scoring determinism, threshold enforcement), `resolve.test.ts` (layer discovery, merge, conflict tracking)
