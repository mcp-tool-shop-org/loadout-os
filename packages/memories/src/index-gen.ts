/**
 * Index generator for claude-memories.
 *
 * Takes a MemoryAnalysis and generates a LoadoutIndex (dispatch table)
 * from the parsed memory references and their topic files.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { estimateTokens, parseFrontmatter } from "@mcptoolshop/ai-loadout";
import type { LoadoutEntry, Budget, Frontmatter } from "@mcptoolshop/ai-loadout";
import { DEFAULT_TRIGGERS } from "@mcptoolshop/ai-loadout";
import type { MemoryAnalysis, MemoryIndex, MemoryRef } from "./types.js";
import { extractKeywords } from "./analyze.js";
import { resolveRefPath } from "./paths.js";

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
    if (!fullPath) {
      // MEM-002: don't drop unresolved refs silently. A ref whose path
      // doesn't resolve (a non-existent file, a glob like `memory/*.md`,
      // or an absolute path) used to vanish here with zero trace — that's
      // exactly how parser junk slipped through undetected. Surface it.
      //
      // MEM-B03: surface it through DATA, not console.warn. This is a library
      // export consumed by SDK callers — writing to stderr here spammed every
      // consumer and rendered inconsistently across index/analyze/stats. The
      // unresolved path already lands in analysis.missingFiles; that is the
      // observability channel. The CLI (cmdIndex) reads missingFiles and prints
      // a one-line summary; the library stays quiet.
      //
      // FT-MR3: also record the structured diagnostic so SDK callers get
      // severity + code + line + hint, not just a bare string. missingFiles
      // stays a derived view kept in lockstep for back-compat.
      if (!analysis.missingFiles.includes(ref.path)) {
        analysis.missingFiles.push(ref.path);
      }
      if (!analysis.diagnostics.some(
        (d) => d.code === "UNRESOLVED_REF" && d.refPath === ref.path,
      )) {
        analysis.diagnostics.push({
          severity: "error",
          code: "UNRESOLVED_REF",
          message: `Reference could not be resolved to a file on disk: ${ref.path}`,
          refPath: ref.path,
          line: ref.line,
          hint: "Create the file, fix the path, or remove the reference from MEMORY.md",
        });
      }
      continue;
    }

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

/** Max summary length — keep entry summaries compact in the dispatch table. */
const MAX_SUMMARY = 120;

/** Truncate a summary to MAX_SUMMARY chars. Shared by both entry builders. */
function truncateSummary(summary: string): string {
  return summary.slice(0, MAX_SUMMARY);
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
    // MEM-007: truncate here too — entryFromContent already truncated to
    // 120, this branch did not, so a long summary survived asymmetrically.
    summary: truncateSummary(ref.description || `Memory: ${ref.name}`),
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
      ? truncateSummary(ref.description)
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
 *
 * Exported (MEM-009) so the parser and validator can reuse the exact
 * same derivation — the kebab id is the contract shared between
 * ref-parsing (MEM-001 junk-id rejection) and validate (MEM-004
 * ID_TOO_LONG length check).
 */
export function nameToId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}
