// ── Types ──────────────────────────────────────────────────────
export type {
  IdSource,
  MemorySection,
  MemoryRef,
  MemoryAnalysis,
  MemoryIndex,
  Diagnostic,
} from "./types.js";

// Re-export kernel types
export type {
  Priority,
  Triggers,
  LoadMode,
  LoadoutEntry,
  Budget,
  LoadoutIndex,
  Frontmatter,
  MatchResult,
  ValidationIssue,
  IssueSeverity,
} from "./types.js";

export { DEFAULT_TRIGGERS } from "./types.js";

// ── Parser ────────────────────────────────────────────────────
export { parseMemoryMd } from "./parser.js";

// ── Analyzer ──────────────────────────────────────────────────
export { analyzeMemoryMd, extractKeywords, detectSubindex } from "./analyze.js";

// ── Index Generator ───────────────────────────────────────────
export {
  generateIndex,
  extractKeywordsFromTitle,
  nameToId,
  hasExplicitId,
  hasExplicitPriority,
  resolveStoreIdSource,
} from "./index-gen.js";
export type { GenerateIndexOptions } from "./index-gen.js";

// ── Validator ─────────────────────────────────────────────────
export {
  validateMemory,
  validateMemoryIndex,
  summariesMatch,
  DEFAULT_MAX_MEMORY_LINES,
  DEFAULT_MAX_MEMORY_BYTES,
} from "./validate.js";
export type { ValidateMemoryOptions } from "./validate.js";

// ── Sync & Placement ──────────────────────────────────────────
export {
  syncSummaries,
  placeOrMoveEntry,
  resolveTargetIndexFile,
} from "./sync.js";
export type { SyncChange, SyncSummariesResult, PlaceMoveResult } from "./sync.js";

// ── Path resolution ───────────────────────────────────────────
export { resolveRefPath } from "./paths.js";

// ── Stats ─────────────────────────────────────────────────────
export { generateStats, formatStats } from "./stats.js";
export type { StatsReport } from "./stats.js";
