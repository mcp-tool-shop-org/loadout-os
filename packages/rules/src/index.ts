/**
 * Library entry point for @mcptoolshop/claude-rules.
 *
 * Re-exports the PURE logic + types for programmatic consumers (e.g. the
 * unified loadout-os CLI). The `cmdX` CLI wrappers, `main`, and the bin
 * entrypoint (cli.ts) are intentionally NOT exported — importing this barrel
 * is side-effect-free (no argv parsing, no command execution).
 */

// ── Types ──────────────────────────────────────────────────────
export type {
  // Re-exported routing types (sourced from @mcptoolshop/ai-loadout)
  Priority,
  Triggers,
  LoadoutEntry,
  LoadoutIndex,
  Budget,
  Frontmatter,
  IssueSeverity,
  ValidationIssue,
  // claude-rules aliases
  RuleEntry,
  RuleIndex,
  // CLAUDE.md document types
  Section,
  SplitProposal,
  AnalysisReport,
  FsValidationIssue,
  SignalsConfig,
} from "./types.js";

export { DEFAULT_TRIGGERS } from "./types.js";

// ── Parser ─────────────────────────────────────────────────────
export { parseSections, estimateTokens, headingToId } from "./parser.js";

// ── Analyzer ───────────────────────────────────────────────────
export {
  analyzeFile,
  classifyPriority,
  extractKeywords,
  generateSummary,
  suggestPatterns,
} from "./analyze.js";

// ── Split file generators ──────────────────────────────────────
export { generateRuleFile, generateIndex, generateClaudeMd } from "./split.js";

// ── Validator ──────────────────────────────────────────────────
export { validateRules } from "./validate.js";

// ── Signals ────────────────────────────────────────────────────
export { loadSignals, DEFAULT_SIGNALS } from "./signals.js";
