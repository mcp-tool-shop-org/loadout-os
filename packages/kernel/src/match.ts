/**
 * Loadout matcher.
 *
 * Given a task description and a loadout index, returns which payload
 * entries should be loaded, ranked by match strength.
 *
 * Matching is deterministic:
 * - Tokenizes the task into lowercase words
 * - Scores each entry by keyword and pattern overlap
 * - Returns entries above a minimum score threshold
 * - Core entries are always included (score 1.0)
 * - Manual entries are never auto-included (require explicit lookup)
 */

import type { LoadoutIndex, LoadoutEntry, MatchResult, LoadMode } from "./types.js";

const MIN_SCORE = 0.1;  // minimum score to include a domain entry

// ── Tokenize a task description into matchable words ───────────
function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1),
  );
}

// ── Score a single entry against task tokens ───────────────────
function scoreEntry(
  entry: LoadoutEntry,
  taskTokens: Set<string>,
): { score: number; matchedKeywords: string[]; matchedPatterns: string[] } {
  // Core entries always match
  if (entry.priority === "core") {
    return { score: 1.0, matchedKeywords: [], matchedPatterns: [] };
  }

  // Manual entries never auto-match
  if (entry.priority === "manual") {
    return { score: 0, matchedKeywords: [], matchedPatterns: [] };
  }

  // Domain entries: score by keyword and pattern overlap
  const matchedKeywords: string[] = [];
  const matchedPatterns: string[] = [];

  // Keyword matching: each keyword hit contributes to the score
  for (const kw of entry.keywords) {
    // Multi-word keywords: check if all words are present
    const kwWords = kw.split(/[\s-]+/);
    if (kwWords.every((w) => taskTokens.has(w))) {
      matchedKeywords.push(kw);
    }
  }

  // Pattern matching: check if any pattern name words appear in the task
  for (const pattern of entry.patterns) {
    const patternWords = pattern.split("_");
    if (patternWords.some((w) => taskTokens.has(w))) {
      matchedPatterns.push(pattern);
    }
  }

  // Score: proportion of keywords matched + pattern bonus
  const keywordScore =
    entry.keywords.length > 0
      ? matchedKeywords.length / entry.keywords.length
      : 0;

  const patternBonus =
    entry.patterns.length > 0 && matchedPatterns.length > 0
      ? 0.2
      : 0;

  const score = Math.min(1.0, keywordScore + patternBonus);

  return { score, matchedKeywords, matchedPatterns };
}

// ── Match a task against a loadout index ────────────────────────
// Returns entries that should be loaded, sorted by score (highest first).
export function matchLoadout(
  task: string,
  index: LoadoutIndex,
): MatchResult[] {
  const taskTokens = tokenize(task);
  const results: MatchResult[] = [];

  for (const entry of index.entries) {
    const { score, matchedKeywords, matchedPatterns } = scoreEntry(
      entry,
      taskTokens,
    );

    if (score >= MIN_SCORE) {
      const mode: LoadMode = entry.priority === "manual"
        ? "manual"
        : entry.priority === "core"
          ? "eager"
          : "lazy";

      const reason = entry.priority === "core"
        ? "core: always loaded"
        : matchedKeywords.length > 0 && matchedPatterns.length > 0
          ? `keywords [${matchedKeywords.join(", ")}] + patterns [${matchedPatterns.join(", ")}]`
          : matchedKeywords.length > 0
            ? `keywords [${matchedKeywords.join(", ")}]`
            : `patterns [${matchedPatterns.join(", ")}]`;

      results.push({ entry, score, matchedKeywords, matchedPatterns, reason, mode });
    }
  }

  // Sort by score descending, then by token cost ascending (prefer cheaper)
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.entry.tokens_est - b.entry.tokens_est;
  });

  return results;
}

// ── Look up a specific entry by ID ─────────────────────────────
// For manual entries or explicit lookup.
export function lookupEntry(
  id: string,
  index: LoadoutIndex,
): LoadoutEntry | undefined {
  return index.entries.find((e) => e.id === id);
}
