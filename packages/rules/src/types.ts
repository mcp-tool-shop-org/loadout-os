/**
 * claude-rules types.
 *
 * Core routing types (LoadoutEntry, LoadoutIndex, Frontmatter, etc.)
 * come from @mcptoolshop/ai-loadout. This file defines only the
 * CLAUDE.md-specific types: sections, split proposals, analysis reports.
 */

// Re-export routing types so consumers don't need to import ai-loadout directly
export type {
  Priority,
  Triggers,
  LoadoutEntry,
  LoadoutIndex,
  Budget,
  Frontmatter,
  IssueSeverity,
  ValidationIssue,
} from "@mcptoolshop/ai-loadout";

export { DEFAULT_TRIGGERS } from "@mcptoolshop/ai-loadout";

// ── Local imports for use in this file's interfaces ────────────
import type { Priority } from "@mcptoolshop/ai-loadout";

// ── Aliases for backward compatibility ─────────────────────────
// claude-rules originally used "RuleEntry" / "RuleIndex" naming.
// These aliases keep internal code readable in the CLAUDE.md context.
import type { LoadoutEntry, LoadoutIndex } from "@mcptoolshop/ai-loadout";
export type RuleEntry = LoadoutEntry;
export interface RuleIndex extends LoadoutIndex {
  lazyLoad?: boolean;
}

// ── A section detected by the parser ───────────────────────────
export interface Section {
  heading: string;       // the heading text (without # prefix)
  level: number;         // heading depth (2 for ##, 3 for ###)
  startLine: number;     // 0-indexed line where heading appears
  endLine: number;       // 0-indexed line where section ends (exclusive)
  content: string;       // full text including heading
  lines: number;         // line count
  tokens_est: number;    // estimated tokens
}

// ── A split proposal shown to the user ─────────────────────────
export interface SplitProposal {
  section: Section;
  suggestedId: string;       // kebab-case derived from heading
  suggestedPath: string;     // e.g. ".claude/rules/github-actions.md"
  suggestedKeywords: string[];
  suggestedPatterns: string[];
  suggestedPriority: Priority;
  suggestedSummary: string;
  reason: string;            // why this section should be extracted
}

// ── Analysis report ────────────────────────────────────────────
export interface AnalysisReport {
  filePath: string;
  totalLines: number;
  totalTokens: number;
  sections: Section[];
  proposals: SplitProposal[];
  unsplittable: Section[];      // sections that can't be cleanly split
  coreCandidate: Section[];     // sections that should stay inline
}

// ── Filesystem validation issue (extends ai-loadout's) ─────────
// ai-loadout validates index structure; claude-rules adds filesystem checks.
export interface FsValidationIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  file?: string;
  line?: number;
}

// ── Signals configuration (configurable scoring) ─────────────
export interface SignalsConfig {
  domainSignals: string[];
  stopWords: string[];
  patterns: Record<string, string[]>;
}
