/**
 * Layer resolver for hierarchical loadouts.
 *
 * Discovers loadout indexes from canonical locations, loads them,
 * and merges them deterministically. Provides provenance and
 * per-entry explanation for debugging "why did this rule win?"
 *
 * Canonical layer stack (earlier → later, later wins):
 *   1. global   — ~/.ai-loadout/index.json
 *   2. org      — explicit path or $AI_LOADOUT_ORG
 *   3. project  — <cwd>/.claude/loadout/index.json
 *   4. session  — explicit path or $AI_LOADOUT_SESSION
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { homedir } from "node:os";
import type { LoadoutIndex, LoadoutEntry, MergedIndex, Priority } from "./types.js";
import { mergeIndexes } from "./merge.js";

// ── Types ────────────────────────────────────────────────────────

/** A layer that was discovered and loaded. */
export interface DiscoveredLayer {
  name: string;           // "global" | "org" | "project" | "session"
  path: string;           // absolute path to the index.json
  index: LoadoutIndex;
}

/** A layer search location and whether it was found. */
export interface SearchedLayer {
  name: string;
  path: string;
  found: boolean;
}

/** Result of resolving the full layer stack. */
export interface ResolvedLoadout {
  merged: MergedIndex;
  layers: DiscoveredLayer[];     // layers that were found and loaded
  searched: SearchedLayer[];     // all locations checked
}

/** One layer's definition of a specific entry. */
export interface EntryDefinition {
  layer: string;
  summary: string;
  priority: Priority;
  tokens: number;
  keywords: string[];
  path: string;
}

/** Explanation of how one entry was resolved across layers. */
export interface EntryExplanation {
  id: string;
  finalLayer: string;                   // which layer the winning version came from
  definitions: EntryDefinition[];       // every layer that defined this entry (in order)
  overrideChain: string[];              // layer names in override order
  isConflict: boolean;                  // defined in multiple layers
}

// ── Options ──────────────────────────────────────────────────────

export interface ResolveOptions {
  /** Override the project root (default: cwd). */
  projectRoot?: string;
  /** Override the global directory (default: ~/.ai-loadout). */
  globalDir?: string;
  /** Explicit org-level index path. Falls back to $AI_LOADOUT_ORG. */
  orgPath?: string;
  /** Explicit session overlay index path. Falls back to $AI_LOADOUT_SESSION. */
  sessionPath?: string;
}

// ── Discovery ────────────────────────────────────────────────────

/**
 * Discover canonical layer locations and load any that exist.
 *
 * Missing layers are normal — most setups only have project-level.
 * The resolver never guesses; it looks in fixed places in a fixed order.
 */
export function discoverLayers(opts?: ResolveOptions): {
  layers: DiscoveredLayer[];
  searched: SearchedLayer[];
} {
  const projectRoot = resolvePath(opts?.projectRoot ?? process.cwd());
  const globalDir = opts?.globalDir ?? join(homedir(), ".ai-loadout");
  const orgPath = opts?.orgPath ?? process.env.AI_LOADOUT_ORG ?? null;
  const sessionPath = opts?.sessionPath ?? process.env.AI_LOADOUT_SESSION ?? null;

  const candidates: { name: string; path: string }[] = [
    { name: "global", path: join(globalDir, "index.json") },
  ];

  if (orgPath) {
    candidates.push({ name: "org", path: resolvePath(orgPath) });
  }

  candidates.push({
    name: "project",
    path: join(projectRoot, ".claude", "loadout", "index.json"),
  });

  if (sessionPath) {
    candidates.push({ name: "session", path: resolvePath(sessionPath) });
  }

  const layers: DiscoveredLayer[] = [];
  const searched: SearchedLayer[] = [];

  for (const { name, path } of candidates) {
    const found = existsSync(path);
    searched.push({ name, path, found });

    if (found) {
      try {
        const raw = readFileSync(path, "utf-8");
        const index = JSON.parse(raw) as LoadoutIndex;
        layers.push({ name, path, index });
      } catch {
        // Malformed file — skip silently, same as missing
        searched[searched.length - 1].found = false;
      }
    }
  }

  return { layers, searched };
}

// ── Resolution ───────────────────────────────────────────────────

/**
 * Resolve the full loadout by discovering layers and merging them.
 *
 * Returns the merged index, the layers that contributed, and all
 * locations that were searched.
 */
export function resolveLoadout(opts?: ResolveOptions): ResolvedLoadout {
  const { layers, searched } = discoverLayers(opts);

  const merged = mergeIndexes(
    layers.map((l) => ({ name: l.name, index: l.index }))
  );

  return { merged, layers, searched };
}

// ── Explanation ──────────────────────────────────────────────────

/**
 * Explain how a specific entry was resolved across layers.
 *
 * Shows every layer that defined it, the override chain, and the
 * winning version. This answers "why did this rule win?"
 */
export function explainEntry(
  entryId: string,
  layers: DiscoveredLayer[]
): EntryExplanation | null {
  const definitions: EntryDefinition[] = [];
  const overrideChain: string[] = [];

  for (const layer of layers) {
    const entry = layer.index.entries.find((e) => e.id === entryId);
    if (entry) {
      definitions.push({
        layer: layer.name,
        summary: entry.summary,
        priority: entry.priority,
        tokens: entry.tokens_est,
        keywords: entry.keywords,
        path: entry.path,
      });
      overrideChain.push(layer.name);
    }
  }

  if (definitions.length === 0) {
    return null; // Entry not found in any layer
  }

  return {
    id: entryId,
    finalLayer: overrideChain[overrideChain.length - 1],
    definitions,
    overrideChain,
    isConflict: definitions.length > 1,
  };
}
