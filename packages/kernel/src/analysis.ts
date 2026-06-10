/**
 * Loadout analysis — dead entries, keyword overlaps, budget breakdown.
 *
 * Pure functions. No I/O. Takes an index and usage data, returns reports.
 */

import type { LoadoutIndex, LoadoutEntry, UsageEvent } from "./types.js";
import type { UsageSummary } from "./usage.js";

// ── Dead entries ─────────────────────────────────────────────

export interface DeadEntry {
  entry: LoadoutEntry;
  reason: string;
}

/**
 * Find entries that have never been loaded (dead payloads).
 * Compares index entries against usage events.
 */
export function findDeadEntries(
  index: LoadoutIndex,
  events: UsageEvent[],
): DeadEntry[] {
  const loadedIds = new Set(events.map((e) => e.entryId));
  const dead: DeadEntry[] = [];

  for (const entry of index.entries) {
    if (entry.priority === "core") continue; // core always loads, never "dead"
    if (!loadedIds.has(entry.id)) {
      dead.push({
        entry,
        reason: `Never loaded (${entry.tokens_est} tokens wasted in index)`,
      });
    }
  }

  // Sort by token cost descending (biggest waste first)
  dead.sort((a, b) => b.entry.tokens_est - a.entry.tokens_est);
  return dead;
}

// ── Keyword overlaps ─────────────────────────────────────────

export interface KeywordOverlap {
  keyword: string;
  entries: string[];  // entry IDs sharing this keyword
}

/**
 * Find keywords shared by multiple entries.
 * These are potential routing ambiguities.
 */
export function findKeywordOverlaps(index: LoadoutIndex): KeywordOverlap[] {
  const keywordMap = new Map<string, string[]>();

  for (const entry of index.entries) {
    for (const kw of entry.keywords) {
      const existing = keywordMap.get(kw) ?? [];
      existing.push(entry.id);
      keywordMap.set(kw, existing);
    }
  }

  const overlaps: KeywordOverlap[] = [];
  for (const [keyword, entries] of keywordMap) {
    if (entries.length > 1) {
      overlaps.push({ keyword, entries });
    }
  }

  // Sort by number of overlapping entries descending
  overlaps.sort((a, b) => b.entries.length - a.entries.length);
  return overlaps;
}

// ── Budget breakdown ─────────────────────────────────────────

export interface BudgetBreakdown {
  totalTokens: number;
  coreTokens: number;
  domainTokens: number;
  manualTokens: number;
  coreEntries: number;
  domainEntries: number;
  manualEntries: number;
  avgDomainSize: number;
  largestEntry: { id: string; tokens: number } | null;
  smallestEntry: { id: string; tokens: number } | null;
  observedAvg: number | null;  // from usage data
}

/**
 * Break down the token budget by priority tier.
 */
export function analyzeBudget(
  index: LoadoutIndex,
  usage?: UsageSummary[],
): BudgetBreakdown {
  const core = index.entries.filter((e) => e.priority === "core");
  const domain = index.entries.filter((e) => e.priority === "domain");
  const manual = index.entries.filter((e) => e.priority === "manual");

  const coreTokens = core.reduce((s, e) => s + e.tokens_est, 0);
  const domainTokens = domain.reduce((s, e) => s + e.tokens_est, 0);
  const manualTokens = manual.reduce((s, e) => s + e.tokens_est, 0);

  const allEntries = index.entries;
  const sorted = [...allEntries].sort((a, b) => b.tokens_est - a.tokens_est);

  // Calculate observed average from usage data
  let observedAvg: number | null = null;
  if (usage && usage.length > 0) {
    const totalObservedTokens = usage.reduce((s, u) => s + u.totalTokens, 0);
    const totalLoads = usage.reduce((s, u) => s + u.loadCount, 0);
    if (totalLoads > 0) {
      observedAvg = Math.round(totalObservedTokens / totalLoads);
    }
  }

  return {
    totalTokens: coreTokens + domainTokens + manualTokens,
    coreTokens,
    domainTokens,
    manualTokens,
    coreEntries: core.length,
    domainEntries: domain.length,
    manualEntries: manual.length,
    avgDomainSize: domain.length > 0
      ? Math.round(domainTokens / domain.length)
      : 0,
    largestEntry: sorted.length > 0
      ? { id: sorted[0].id, tokens: sorted[0].tokens_est }
      : null,
    smallestEntry: sorted.length > 0
      ? { id: sorted[sorted.length - 1].id, tokens: sorted[sorted.length - 1].tokens_est }
      : null,
    observedAvg,
  };
}
