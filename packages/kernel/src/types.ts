// ── Priority tiers ──────────────────────────────────────────────
// core:   always loaded — violating these would break the system
// domain: keyword-triggered — loaded when the task matches
// manual: never auto-loaded — deliberate lookup only
export type Priority = "core" | "domain" | "manual";

// ── Trigger phases ─────────────────────────────────────────────
// Controls WHEN a payload should be loaded relative to the agent loop.
export interface Triggers {
  task: boolean;   // load during task interpretation
  plan: boolean;   // load during plan formation
  edit: boolean;   // load before file edits
}

// ── A single entry in the dispatch table ───────────────────────
export interface LoadoutEntry {
  id: string;            // kebab-case, unique, stable once created
  path: string;          // relative to repo root
  keywords: string[];    // lowercase surface words for matching
  patterns: string[];    // named intents (e.g. "ci_pipeline"), not regex
  priority: Priority;
  summary: string;       // <120 chars, dense routing signal
  triggers: Triggers;
  tokens_est: number;    // estimated tokens (chars / 4)
  lines: number;         // line count of the payload file
}

// ── Budget model ───────────────────────────────────────────────
export interface Budget {
  always_loaded_est: number;       // tokens always in context
  on_demand_total_est: number;     // sum of all payload file tokens
  avg_task_load_est: number;       // estimated average per session
  avg_task_load_observed: number | null;  // from usage telemetry (future)
}

// ── Load mode ─────────────────────────────────────────────────
// Controls HOW a payload is loaded into agent context.
export type LoadMode = "eager" | "lazy" | "manual";

// ── The dispatch table (index.json) ────────────────────────────
export interface LoadoutIndex {
  version: string;
  generated: string;    // ISO 8601
  entries: LoadoutEntry[];
  budget: Budget;
  lazyLoad?: boolean;   // when true, payloads are not pre-loaded
}

// ── Frontmatter parsed from a payload file ─────────────────────
export interface Frontmatter {
  id: string;
  keywords: string[];
  patterns: string[];
  priority: Priority;
  triggers: Triggers;
}

// ── Match result from the matcher ──────────────────────────────
export interface MatchResult {
  entry: LoadoutEntry;
  score: number;         // 0-1, higher = stronger match
  matchedKeywords: string[];
  matchedPatterns: string[];
  reason: string;        // human-readable explanation of why this matched
  mode: LoadMode;        // how this entry should be loaded
}

// ── Usage event (append-only log) ─────────────────────────────
// One line per load event in .claude/loadout-usage.jsonl
export interface UsageEvent {
  timestamp: string;      // ISO 8601
  taskHash: string;       // session-local task identifier
  entryId: string;        // which payload was loaded
  trigger: string;        // which keyword/pattern caused the load
  mode: LoadMode;         // eager, lazy, or manual
  tokensEst: number;      // estimated token cost
  sourceLayer?: string;   // which hierarchy layer (future: global/org/project/task)
}

// ── Merge semantics ───────────────────────────────────────────
// For hierarchical loadouts: multiple indexes merged deterministically.
export interface MergeConflict {
  entryId: string;
  layers: string[];       // which layers define this entry
  resolution: "override" | "error";
}

export interface MergedIndex extends LoadoutIndex {
  provenance: Record<string, string>;  // entryId → source layer name
  conflicts: MergeConflict[];
}

// ── Validation issue ───────────────────────────────────────────
export type IssueSeverity = "error" | "warning";

export interface ValidationIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  hint?: string;
  entryId?: string;
}

// ── Defaults ───────────────────────────────────────────────────
export const DEFAULT_TRIGGERS: Triggers = {
  task: true,
  plan: true,
  edit: false,
};
