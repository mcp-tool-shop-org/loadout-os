/**
 * Stats reporter for claude-memories.
 *
 * Token budget dashboard: shows always-loaded vs on-demand breakdown,
 * per-topic costs, and estimated savings from lazy loading.
 */

import type { MemoryAnalysis, MemoryIndex } from "./types.js";

export interface StatsReport {
  totalTokens: number;
  inlineTokens: number;
  topicTokens: number;
  entryCount: number;
  coreCount: number;
  domainCount: number;
  manualCount: number;
  alwaysLoadedEst: number;
  onDemandTotalEst: number;
  avgTaskLoadEst: number;
  savingsPercent: number;
  topEntries: Array<{ id: string; tokens: number; priority: string }>;
  orphanCount: number;
  missingCount: number;
}

/**
 * Generate a stats report from analysis and index.
 */
export function generateStats(
  analysis: MemoryAnalysis,
  index: MemoryIndex,
): StatsReport {
  const coreCount = index.entries.filter((e) => e.priority === "core").length;
  const domainCount = index.entries.filter((e) => e.priority === "domain").length;
  const manualCount = index.entries.filter((e) => e.priority === "manual").length;

  const savingsPercent = analysis.totalTokens > 0
    ? Math.round((index.budget.on_demand_total_est / analysis.totalTokens) * 100)
    : 0;

  const topEntries = [...index.entries]
    .sort((a, b) => b.tokens_est - a.tokens_est)
    .slice(0, 10)
    .map((e) => ({ id: e.id, tokens: e.tokens_est, priority: e.priority }));

  return {
    totalTokens: analysis.totalTokens,
    inlineTokens: analysis.inlineTokens,
    topicTokens: analysis.topicTokens,
    entryCount: index.entries.length,
    coreCount,
    domainCount,
    manualCount,
    alwaysLoadedEst: index.budget.always_loaded_est,
    onDemandTotalEst: index.budget.on_demand_total_est,
    avgTaskLoadEst: index.budget.avg_task_load_est,
    savingsPercent,
    topEntries,
    orphanCount: analysis.orphanFiles.length,
    missingCount: analysis.missingFiles.length,
  };
}

/**
 * Format stats report as a human-readable string.
 */
export function formatStats(stats: StatsReport): string {
  const lines: string[] = [];

  lines.push("╔══════════════════════════════════════════╗");
  lines.push("║        Memory Token Budget               ║");
  lines.push("╚══════════════════════════════════════════╝");
  lines.push("");
  lines.push(`  Total tokens:       ${stats.totalTokens.toLocaleString()}`);
  lines.push(`  MEMORY.md inline:   ${stats.inlineTokens.toLocaleString()}`);
  lines.push(`  Topic files:        ${stats.topicTokens.toLocaleString()}`);
  lines.push("");
  lines.push(`  Entries:            ${stats.entryCount}`);
  lines.push(`    Core:             ${stats.coreCount}`);
  lines.push(`    Domain:           ${stats.domainCount}`);
  lines.push(`    Manual:           ${stats.manualCount}`);
  lines.push("");
  lines.push(`  Always loaded:      ${stats.alwaysLoadedEst.toLocaleString()} tokens`);
  lines.push(`  On-demand total:    ${stats.onDemandTotalEst.toLocaleString()} tokens`);
  lines.push(`  Avg task load:      ${stats.avgTaskLoadEst.toLocaleString()} tokens`);
  lines.push(`  Savings (lazy):     ${stats.savingsPercent}%`);

  if (stats.topEntries.length > 0) {
    lines.push("");
    lines.push("  Top entries by token cost:");
    for (const e of stats.topEntries) {
      lines.push(`    ${e.id.padEnd(30)} ${String(e.tokens).padStart(6)} tokens  [${e.priority}]`);
    }
  }

  if (stats.orphanCount > 0 || stats.missingCount > 0) {
    lines.push("");
    if (stats.orphanCount > 0) lines.push(`  ⚠ ${stats.orphanCount} orphan files`);
    if (stats.missingCount > 0) lines.push(`  ✗ ${stats.missingCount} missing files`);
  }

  return lines.join("\n");
}
