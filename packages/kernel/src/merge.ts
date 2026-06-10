/**
 * Index merge for hierarchical loadouts.
 *
 * Deterministic merge: later layers override earlier ones.
 * Same-ID entries from a later layer replace the earlier version.
 * Conflicts (same keyword, different payload, same priority) are reported.
 */

import type { LoadoutIndex, LoadoutEntry, MergedIndex, MergeConflict, Budget } from "./types.js";
import { estimateTokens } from "./tokens.js";

interface LayeredIndex {
  name: string;     // e.g. "global", "org", "project", "task"
  index: LoadoutIndex;
}

/**
 * Merge multiple loadout indexes in order (earlier → later, later wins).
 *
 * Returns a MergedIndex with provenance tracking and conflict reports.
 */
export function mergeIndexes(layers: LayeredIndex[]): MergedIndex {
  const entryMap = new Map<string, { entry: LoadoutEntry; layer: string }>();
  const provenance: Record<string, string> = {};
  const conflicts: MergeConflict[] = [];

  // Track which layers define each ID for conflict detection
  const idLayers = new Map<string, string[]>();

  for (const { name, index } of layers) {
    for (const entry of index.entries) {
      // Track all layers that define this ID
      const existing = idLayers.get(entry.id) ?? [];
      existing.push(name);
      idLayers.set(entry.id, existing);

      // Later layer overrides earlier
      entryMap.set(entry.id, { entry, layer: name });
      provenance[entry.id] = name;
    }
  }

  // Report entries defined in multiple layers
  for (const [id, layerNames] of idLayers) {
    if (layerNames.length > 1) {
      conflicts.push({
        entryId: id,
        layers: layerNames,
        resolution: "override",
      });
    }
  }

  const entries = [...entryMap.values()].map((v) => v.entry);

  // Recalculate budget from merged entries
  const coreTokens = entries
    .filter((e) => e.priority === "core")
    .reduce((sum, e) => sum + e.tokens_est, 0);
  const onDemandTokens = entries
    .filter((e) => e.priority !== "core")
    .reduce((sum, e) => sum + e.tokens_est, 0);
  const domainEntries = entries.filter((e) => e.priority === "domain");
  const avgTaskLoad = domainEntries.length > 0
    ? Math.round(onDemandTokens / domainEntries.length)
    : 0;

  const budget: Budget = {
    always_loaded_est: coreTokens,
    on_demand_total_est: onDemandTokens,
    avg_task_load_est: avgTaskLoad,
    avg_task_load_observed: null,
  };

  return {
    version: "1.0.0",
    generated: new Date().toISOString(),
    entries,
    budget,
    provenance,
    conflicts,
  };
}
