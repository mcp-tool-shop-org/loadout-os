/**
 * Types for claude-memories.
 *
 * Re-exports kernel types from ai-loadout and defines
 * memory-specific types for MEMORY.md analysis.
 */

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
} from "@mcptoolshop/ai-loadout";

export { DEFAULT_TRIGGERS } from "@mcptoolshop/ai-loadout";

// ── Memory-specific types ──────────────────────────────────────

/** A detected section in MEMORY.md */
export interface MemorySection {
  heading: string;       // e.g. "Active", "Products", "Workflows"
  level: number;         // heading level (1-6)
  entries: MemoryRef[];  // parsed references within this section
  startLine: number;
  endLine: number;
}

/** A single reference parsed from MEMORY.md */
export interface MemoryRef {
  name: string;          // e.g. "AI Loadout"
  description: string;   // e.g. "routing core for agent knowledge packs (v1.0.3)"
  path: string;          // e.g. "memory/ai-loadout.md"
  line: number;          // source line in MEMORY.md
}

/** Analysis report for a MEMORY.md file */
export interface MemoryAnalysis {
  filePath: string;
  sections: MemorySection[];
  refs: MemoryRef[];
  orphanFiles: string[];     // topic files not referenced in MEMORY.md
  missingFiles: string[];    // referenced paths that don't exist on disk
  totalTokens: number;
  inlineTokens: number;      // tokens in MEMORY.md itself
  topicTokens: number;       // sum of all referenced topic file tokens
}

/** Memory index — extends LoadoutIndex with memory-specific metadata */
export interface MemoryIndex {
  version: string;
  generated: string;
  source: string;            // path to MEMORY.md
  entries: import("@mcptoolshop/ai-loadout").LoadoutEntry[];
  budget: import("@mcptoolshop/ai-loadout").Budget;
  lazyLoad?: boolean;
}
