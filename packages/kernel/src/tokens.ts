/**
 * Token estimation.
 *
 * Rough heuristic: 1 token ≈ 4 characters for English text.
 * Good enough for budget dashboards; not meant for billing.
 */

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
