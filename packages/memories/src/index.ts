// ── Types ──────────────────────────────────────────────────────
export type {
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
export { analyzeMemoryMd, extractKeywords } from "./analyze.js";

// ── Index Generator ───────────────────────────────────────────
export { generateIndex } from "./index-gen.js";

// ── Validator ─────────────────────────────────────────────────
export { validateMemory, validateMemoryIndex } from "./validate.js";

// ── Path resolution ───────────────────────────────────────────
// FT-MR10: the single shared ref-path resolver, so the unified loadout-os CLI
// (and any SDK consumer) resolves topic refs identically to analyze/index-gen/
// validate.
export { resolveRefPath } from "./paths.js";

// ── Stats ─────────────────────────────────────────────────────
export { generateStats, formatStats } from "./stats.js";
export type { StatsReport } from "./stats.js";
