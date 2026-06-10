// ── Types ──────────────────────────────────────────────────────
export type {
  Priority,
  Triggers,
  LoadMode,
  LoadoutEntry,
  Budget,
  LoadoutIndex,
  Frontmatter,
  MatchResult,
  UsageEvent,
  MergeConflict,
  MergedIndex,
  IssueSeverity,
  ValidationIssue,
} from "./types.js";

export { DEFAULT_TRIGGERS } from "./types.js";

// ── Frontmatter ────────────────────────────────────────────────
export { parseFrontmatter, serializeFrontmatter } from "./frontmatter.js";

// ── Tokens ─────────────────────────────────────────────────────
export { estimateTokens } from "./tokens.js";

// ── Matcher ────────────────────────────────────────────────────
export { matchLoadout, lookupEntry } from "./match.js";

// ── Validator ──────────────────────────────────────────────────
export { validateIndex } from "./validate.js";

// ── Merge ─────────────────────────────────────────────────────
export { mergeIndexes } from "./merge.js";

// ── Usage ─────────────────────────────────────────────────────
export { recordUsage, readUsage, summarizeUsage } from "./usage.js";
export type { UsageSummary } from "./usage.js";

// ── Analysis ──────────────────────────────────────────────────
export { findDeadEntries, findKeywordOverlaps, analyzeBudget } from "./analysis.js";
export type { DeadEntry, KeywordOverlap, BudgetBreakdown } from "./analysis.js";

// ── Resolver ─────────────────────────────────────────────────
export { discoverLayers, resolveLoadout, explainEntry } from "./resolve.js";
export type {
  DiscoveredLayer,
  SearchedLayer,
  ResolvedLoadout,
  EntryDefinition,
  EntryExplanation,
  ResolveOptions,
} from "./resolve.js";

// ── Runtime (Agent Contract) ─────────────────────────────────
export { planLoad, recordLoad, manualLookup } from "./runtime.js";
export type { RuntimeOptions, LoadPlan } from "./runtime.js";
