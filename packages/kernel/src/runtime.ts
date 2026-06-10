/**
 * Agent runtime contract.
 *
 * This module defines the canonical way any agent consumes a resolved
 * loadout. It wraps the full sequence:
 *
 *   resolve layers → match task → decide what to load → record usage
 *
 * Agents integrate against two functions:
 *   planLoad(task, opts?)   — "what should I load for this task?"
 *   recordLoad(decision, entryId, trigger, opts?) — "I loaded this entry"
 *
 * Everything else (resolve, merge, match, explain) is machinery that
 * the runtime abstracts over.
 */

import type {
  LoadoutEntry,
  MatchResult,
  Budget,
  LoadMode,
  MergeConflict,
} from "./types.js";
import { resolveLoadout } from "./resolve.js";
import type { ResolveOptions, DiscoveredLayer } from "./resolve.js";
import { matchLoadout, lookupEntry } from "./match.js";
import { recordUsage } from "./usage.js";

// ── Types ────────────────────────────────────────────────────────

/** Options for the agent runtime. */
export interface RuntimeOptions extends ResolveOptions {
  /** Path to the usage JSONL file. When set, recordLoad() appends events. */
  usagePath?: string;
  /** Session-local task identifier for usage tracking. */
  taskHash?: string;
}

/** The load plan: what an agent should preload, what's available on-demand. */
export interface LoadPlan {
  /** Eager entries — load these into context immediately. */
  preload: MatchResult[];
  /** Lazy entries — available when the task matches, load on demand. */
  onDemand: MatchResult[];
  /** Manual entries — never auto-loaded, available via explicit lookup. */
  manual: LoadoutEntry[];
  /** Which layer each entry came from. */
  provenance: Record<string, string>;
  /** Token budget for the resolved index. */
  budget: Budget;
  /** Entries that were overridden across layers. */
  conflicts: MergeConflict[];
  /** Which layers contributed to this plan. */
  layerNames: string[];
  /** Total token cost of preloaded entries. */
  preloadTokens: number;
  /** Total token cost of on-demand entries. */
  onDemandTokens: number;
}

// ── Plan ─────────────────────────────────────────────────────────

/**
 * Plan what to load for a given task.
 *
 * This is the primary agent-facing API. It:
 * 1. Resolves all loadout layers (global → org → project → session)
 * 2. Matches the task description against the merged index
 * 3. Separates entries into preload / on-demand / manual
 * 4. Returns a LoadPlan with provenance, budget, and token costs
 *
 * Agents should:
 * - Immediately load entries in `preload` (core entries, always needed)
 * - Load entries in `onDemand` when the task context warrants it
 * - Only load `manual` entries via explicit user/agent request
 */
export function planLoad(task: string, opts?: RuntimeOptions): LoadPlan {
  const { merged, layers } = resolveLoadout(opts);
  const matches = matchLoadout(task, merged);

  const preload: MatchResult[] = [];
  const onDemand: MatchResult[] = [];

  for (const match of matches) {
    if (match.mode === "eager") {
      preload.push(match);
    } else {
      onDemand.push(match);
    }
  }

  // Manual entries are everything NOT matched
  const matchedIds = new Set(matches.map((m) => m.entry.id));
  const manual = merged.entries.filter(
    (e) => e.priority === "manual" || !matchedIds.has(e.id)
  );

  const preloadTokens = preload.reduce((sum, m) => sum + m.entry.tokens_est, 0);
  const onDemandTokens = onDemand.reduce((sum, m) => sum + m.entry.tokens_est, 0);

  return {
    preload,
    onDemand,
    manual,
    provenance: merged.provenance,
    budget: merged.budget,
    conflicts: merged.conflicts,
    layerNames: layers.map((l) => l.name),
    preloadTokens,
    onDemandTokens,
  };
}

// ── Record ───────────────────────────────────────────────────────

/**
 * Record that an agent loaded an entry.
 *
 * Call this after loading a payload into context. If `usagePath` is set
 * in the plan options, the event is appended to the JSONL log.
 *
 * This is optional but enables the observability layer:
 * - Dead entry detection (findDeadEntries)
 * - Budget drift analysis (analyzeBudget with observed data)
 * - Usage frequency tracking (summarizeUsage)
 */
export function recordLoad(
  entryId: string,
  trigger: string,
  mode: LoadMode,
  tokensEst: number,
  opts?: RuntimeOptions,
): void {
  if (!opts?.usagePath) return;

  recordUsage(
    {
      timestamp: new Date().toISOString(),
      taskHash: opts.taskHash ?? "unknown",
      entryId,
      trigger,
      mode,
      tokensEst,
    },
    opts.usagePath,
  );
}

// ── Lookup ───────────────────────────────────────────────────────

/**
 * Explicitly load a manual entry by ID.
 *
 * For entries that are never auto-matched. Returns the entry if found
 * in the resolved index, or undefined.
 */
export function manualLookup(
  id: string,
  opts?: RuntimeOptions,
): LoadoutEntry | undefined {
  const { merged } = resolveLoadout(opts);
  return lookupEntry(id, merged);
}
