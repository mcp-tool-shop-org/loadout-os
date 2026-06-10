// ── Types ──────────────────────────────────────────────────────
export type {
  MemorySection,
  MemoryRef,
  MemoryAnalysis,
  MemoryIndex,
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

// ── Stats ─────────────────────────────────────────────────────
export { generateStats, formatStats } from "./stats.js";
export type { StatsReport } from "./stats.js";
