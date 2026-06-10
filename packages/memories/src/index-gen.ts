/**
 * Index generator for claude-memories.
 *
 * Takes a MemoryAnalysis and generates a LoadoutIndex (dispatch table)
 * from the parsed memory references and their topic files.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { estimateTokens, parseFrontmatter } from "@mcptoolshop/ai-loadout";
import type { LoadoutEntry, Budget, Frontmatter } from "@mcptoolshop/ai-loadout";
import { DEFAULT_TRIGGERS } from "@mcptoolshop/ai-loadout";
import type { MemoryAnalysis, MemoryIndex, MemoryRef } from "./types.js";
import { extractKeywords } from "./analyze.js";

function resolveRefPath(refPath: string, ...baseDirs: string[]): string | null {
  for (const base of baseDirs) {
    const full = join(base, refPath);
    if (existsSync(full)) return full;
  }
  return null;
}

/**
 * Generate a memory dispatch index from analysis results.
 *
 * For each referenced topic file:
 * 1. If it has frontmatter, use that (source of truth)
 * 2. Otherwise, auto-generate entry from name + content keywords
 */
export function generateIndex(
  analysis: MemoryAnalysis,
  opts: { lazyLoad?: boolean } = {},
): MemoryIndex {
  const fileDir = dirname(resolve(analysis.filePath));
  const parentDir = dirname(fileDir);
  const entries: LoadoutEntry[] = [];

  for (const ref of analysis.refs) {
    // Try relative to MEMORY.md, then relative to parent
    const fullPath = resolveRefPath(ref.path, fileDir, parentDir);
    if (!fullPath) continue;

    const content = readFileSync(fullPath, "utf-8");
    const { frontmatter } = parseFrontmatter(content);

    if (frontmatter) {
      // Frontmatter is source of truth
      entries.push(entryFromFrontmatter(frontmatter, ref, content));
    } else {
      // Auto-generate from name + content
      entries.push(entryFromContent(ref, content));
    }
  }

  // Calculate budget
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
    always_loaded_est: analysis.inlineTokens + coreTokens,
    on_demand_total_est: onDemandTokens,
    avg_task_load_est: avgTaskLoad,
    avg_task_load_observed: null,
  };

  return {
    version: "1.0.0",
    generated: new Date().toISOString(),
    source: analysis.filePath,
    entries,
    budget,
    ...(opts.lazyLoad ? { lazyLoad: true } : {}),
  };
}

function entryFromFrontmatter(
  fm: Frontmatter,
  ref: MemoryRef,
  content: string,
): LoadoutEntry {
  const lines = content.split("\n").length;
  return {
    id: fm.id,
    path: ref.path,
    keywords: fm.keywords,
    patterns: fm.patterns,
    priority: fm.priority,
    summary: ref.description || `Memory: ${ref.name}`,
    triggers: fm.triggers,
    tokens_est: estimateTokens(content),
    lines,
  };
}

function entryFromContent(ref: MemoryRef, content: string): LoadoutEntry {
  const id = nameToId(ref.name);
  const keywords = extractKeywords(ref.name, content);
  const lines = content.split("\n").length;

  return {
    id,
    path: ref.path,
    keywords,
    patterns: [],
    priority: "domain",
    summary: ref.description
      ? ref.description.slice(0, 120)
      : `Memory: ${ref.name}`,
    triggers: { ...DEFAULT_TRIGGERS },
    tokens_est: estimateTokens(content),
    lines,
  };
}

/**
 * Convert a display name to kebab-case ID.
 * "AI Loadout" → "ai-loadout"
 * "Claude Guardian" → "claude-guardian"
 */
function nameToId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}
