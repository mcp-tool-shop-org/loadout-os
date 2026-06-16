/**
 * Loadout matcher.
 *
 * Given a task description and a loadout index, returns which payload
 * entries should be loaded, ranked by match strength.
 *
 * Matching is deterministic:
 * - Tokenizes the task into lowercase words
 * - Scores each entry by keyword and pattern overlap (recall-aware)
 * - Returns entries above a minimum score threshold
 * - Core entries are always included (score 1.0)
 * - Manual entries are never auto-included (require explicit lookup)
 */

import type {
  LoadoutIndex,
  LoadoutEntry,
  MatchResult,
  LoadMode,
  ScoreComponents,
} from "./types.js";

// Minimum score to include a domain entry. Exported so callers can see
// (and override via matchLoadout opts) the inclusion threshold.
export const DEFAULT_MIN_SCORE = 0.1;

/**
 * Recall-aware absolute-hit denominator (FT-K1).
 *
 * The original matcher scored domain entries by pure coverage
 * (matched / entry.keywords.length). On the live index, entries average
 * 30.8 keywords each (median 21, p90 71), so a genuine 2-3 keyword
 * topical match on a keyword-rich entry scored ~0.07-0.10 — below the
 * 0.1 inclusion floor and effectively unreachable — while the noise we
 * actually wanted to filter (single incidental hits) sat at 0.1-0.25.
 *
 * Pure coverage punishes keyword-rich entries for being thorough. The
 * fix blends coverage with an *absolute* recall signal: matched / 5.
 * ABSOLUTE_K = 5 means "5 matched keywords is a full-confidence match
 * regardless of how many keywords the entry declares." The blended base
 * is max(coverage, absolute), so:
 *
 *   - A keyword-rich entry can no longer be starved by its own breadth
 *     (a real 2-3 kw match becomes reachable).
 *   - A tiny entry still benefits from high coverage (max() keeps the
 *     stronger of the two signals).
 *
 * Why 5 (not 3 or 10): with a 0.3 practical "genuine match" expectation
 * and the existing 0.1 inclusion floor, ABSOLUTE_K = 5 places the
 * thresholds where we want them:
 *
 *   - 1 incidental hit  → absolute 0.20 → stays below a 0.3 floor (noise filtered)
 *   - 2 genuine hits     → absolute 0.40 → comfortably reachable
 *   - 3 genuine hits     → absolute 0.60 → clearly a match
 *   - 5 genuine hits     → absolute 1.00 → full confidence
 *
 * A larger K (e.g. 10) would push 2-3 kw matches back below the floor;
 * a smaller K (e.g. 3) would let single incidental hits (0.33) cross a
 * 0.3 noise threshold. 5 is the value that keeps genuine multi-keyword
 * matches reachable while single incidental hits stay quiet.
 */
const ABSOLUTE_K = 5;

// ── Options for matchLoadout (FT-K3, additive) ─────────────────
export interface MatchOptions {
  minScore?: number;  // inclusion threshold for domain entries (default DEFAULT_MIN_SCORE)
}

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
): {
  score: number;
  matchedKeywords: string[];
  matchedPatterns: string[];
  scoreComponents?: ScoreComponents;
} {
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

  // FT-K1: recall-aware blend.
  // coverage = the old pure metric (matched / declared keyword count).
  // absolute = recall signal (matched / ABSOLUTE_K) — independent of how
  //            many keywords the entry declares.
  // base     = max(coverage, absolute) — keeps the stronger of the two,
  //            so keyword-rich entries are not starved by their breadth
  //            and tiny entries still benefit from high coverage.
  const matched = matchedKeywords.length;
  const coverage =
    entry.keywords.length > 0 ? matched / entry.keywords.length : 0;
  const absolute = matched / ABSOLUTE_K;
  const base = Math.max(coverage, absolute);

  const patternBonus =
    entry.patterns.length > 0 && matchedPatterns.length > 0 ? 0.2 : 0;

  const score = Math.min(1.0, base + patternBonus);

  const scoreComponents: ScoreComponents = {
    matched,
    coverage,
    absolute,
    base,
    patternBonus,
  };

  return { score, matchedKeywords, matchedPatterns, scoreComponents };
}

// ── Match a task against a loadout index ────────────────────────
// Returns entries that should be loaded, sorted by score (highest first).
//
// FT-K3: `opts.minScore` overrides the inclusion threshold; the 2-arg
// call form is unchanged and defaults to DEFAULT_MIN_SCORE.
export function matchLoadout(
  task: string,
  index: LoadoutIndex,
  opts?: MatchOptions,
): MatchResult[] {
  const minScore = opts?.minScore ?? DEFAULT_MIN_SCORE;
  const taskTokens = tokenize(task);
  const results: MatchResult[] = [];

  for (const entry of index.entries) {
    const { score, matchedKeywords, matchedPatterns, scoreComponents } =
      scoreEntry(entry, taskTokens);

    if (score >= minScore) {
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

      const result: MatchResult = {
        entry,
        score,
        matchedKeywords,
        matchedPatterns,
        reason,
        mode,
      };
      // Additive: only domain entries produce a component breakdown.
      if (scoreComponents) result.scoreComponents = scoreComponents;

      results.push(result);
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
