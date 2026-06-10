# AI Loadout

Context-aware knowledge router for AI agents.

## Architecture
- Dispatch table (index.json)
- Frontmatter spec for payload files
- Keyword matcher with scoring
- Token estimator (chars/4)

## Key Types
- LoadoutEntry, LoadoutIndex, Budget
- MatchResult, ValidationIssue
- MergedIndex, MergeConflict
