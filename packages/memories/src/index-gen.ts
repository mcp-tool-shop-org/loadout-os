/**
 * Index generator for claude-memories.
 *
 * Takes a MemoryAnalysis and generates a LoadoutIndex (dispatch table)
 * from the parsed memory references and their topic files.
 */

import { readFileSync } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { estimateTokens, parseFrontmatter } from "@mcptoolshop/ai-loadout";
import type { LoadoutEntry, Budget, Frontmatter, Priority } from "@mcptoolshop/ai-loadout";
import { DEFAULT_TRIGGERS } from "@mcptoolshop/ai-loadout";
import type { MemoryAnalysis, MemoryIndex, MemoryRef } from "./types.js";
import { extractKeywords, detectSubindex } from "./analyze.js";
import { resolveRefPath } from "./paths.js";

/**
 * Extract clean `[a-z0-9]{3,}` keywords from a reference title and optional file path.
 * F-04: Strips punctuation (`[^a-z0-9\s-]`) before splitting and includes file-stem tokens.
 */
export function extractKeywordsFromTitle(title: string, filePath?: string): string[] {
  return extractKeywords(title, "", filePath);
}

/**
 * Check if the raw YAML frontmatter block explicitly declared a `priority:` line.
 */
function hasExplicitPriority(content: string): boolean {
  const normalized = content.startsWith("\ufeff") ? content.slice(1) : content;
  const lines = normalized.split("\n");
  if (lines[0]?.trim() !== "---") return false;
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === "---") break;
    if (/^priority\s*:/.test(t)) return true;
  }
  return false;
}

/**
 * Generate a memory dispatch index from analysis results.
 *
 * For each referenced topic file:
 * 1. If it is a sub-index (`index-*.md` or `metadata.loadout_role: subindex`), skip emitting it as an entry.
 * 2. If it has frontmatter, use that (source of truth; summary from `fm.description` when present — F-02).
 * 3. Otherwise, auto-generate entry from name + content keywords + file-stem tokens.
 */
export function generateIndex(
  analysis: MemoryAnalysis,
  opts: { lazyLoad?: boolean } = {},
): MemoryIndex {
  const fileDir = dirname(resolve(analysis.filePath));
  const parentDir = dirname(fileDir);
  const entries: LoadoutEntry[] = [];
  const seenStorePaths = new Set<string>();

  for (const ref of analysis.refs) {
    // Try relative to MEMORY.md, then relative to parent
    const fullPath = resolveRefPath(ref.path, fileDir, parentDir);
    if (!fullPath) {
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

    const storePath = toStoreRelative(fileDir, fullPath);
    const storePathKey = process.platform === "win32" ? storePath.toLowerCase() : storePath;

    // Q5-1(a): Collapse duplicate bullets pointing to the same resolved topic file
    // into ONE entry at the first bullet's position.
    if (seenStorePaths.has(storePathKey)) {
      continue;
    }
    seenStorePaths.add(storePathKey);

    const content = readFileSync(fullPath, "utf-8");

    // Never emit a sub-index file itself as an entry in index.json
    if (detectSubindex(ref.path, content).isSubindex) {
      continue;
    }

    const { frontmatter } = parseFrontmatter(content);

    if (frontmatter) {
      // Frontmatter is source of truth
      entries.push(entryFromFrontmatter(frontmatter, ref, content, storePath));
    } else {
      // Auto-generate from name + content + file-stem
      entries.push(entryFromContent(ref, content, storePath));
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

/**
 * FT-MR11: record the path that ACTUALLY resolved, expressed relative to the
 * store root (the directory holding MEMORY.md) with POSIX separators.
 */
function toStoreRelative(storeRoot: string, fullPath: string): string {
  return relative(storeRoot, fullPath).split(sep).join("/");
}

/** Max summary length — keep entry summaries compact in the dispatch table. */
const MAX_SUMMARY = 120;

/** Truncate a summary to MAX_SUMMARY chars. Shared by both entry builders. */
function truncateSummary(summary: string): string {
  return summary.slice(0, MAX_SUMMARY);
}

function toUnderscorePattern(text: string): string {
  const parts: string[] = [];
  let current = "";
  const lower = text.toLowerCase();
  for (let i = 0; i < lower.length; i++) {
    const code = lower.charCodeAt(i);
    const isAlphaNum = (code >= 97 && code <= 122) || (code >= 48 && code <= 57);
    if (isAlphaNum) {
      current += lower[i];
    } else if (current.length > 0) {
      parts.push(current);
      current = "";
    }
  }
  if (current.length > 0) {
    parts.push(current);
  }
  return parts.join("_");
}

/**
 * Build distinct patterns from the file stem and entry id so 1–2 exact technical
 * tokens (e.g. "udlab", "whea", "buttondown") gain patternBonus (+0.2) and clear
 * the hook's 0.5 score floor on keyword-rich entries (F-04).
 */
function deriveStemPatterns(id: string, storePath: string, existingPatterns: string[]): string[] {
  if (existingPatterns.length > 0) return existingPatterns;
  const stem = basename(storePath).replace(/\.md$/i, "");
  const stemPattern = toUnderscorePattern(stem);
  const idPattern = toUnderscorePattern(id);
  const out = new Set<string>();
  if (stemPattern && stemPattern.length > 2) out.add(stemPattern);
  if (idPattern && idPattern.length > 2) out.add(idPattern);
  return [...out];
}

function entryFromFrontmatter(
  fm: Frontmatter,
  ref: MemoryRef,
  content: string,
  storePath: string,
): LoadoutEntry {
  const lines = content.split("\n").length;

  // F-03 / F-04: when frontmatter has no explicit `keywords:` (such as Claude Code
  // memory files with `name:` and `description:`), extract keywords from the title,
  // content headings, and file stem, plus cleaned tokens from `fm.name`.
  const keywords = fm.keywords.length > 0
    ? fm.keywords
    : extractKeywords(fm.name ? `${ref.name} ${fm.name}` : ref.name, content, storePath);

  const patterns = fm.patterns.length > 0
    ? fm.patterns
    : deriveStemPatterns(fm.id, storePath, fm.patterns);

  // Amendment 4 (Archive = manual): entries listed in a sub-index whose frontmatter
  // sets `metadata.loadout_default_priority: manual` get `priority: "manual"` unless
  // the topic file's own frontmatter explicitly sets `priority:`.
  let priority: Priority = fm.priority;
  if (ref.defaultPriority && !hasExplicitPriority(content)) {
    priority = ref.defaultPriority;
  }

  // F-02: The entry `summary` comes from the file's frontmatter `description`,
  // falling back to the index bullet `ref.description` only when `fm.description` is absent.
  const rawSummary = fm.description || ref.description || `Memory: ${ref.name}`;

  return {
    id: fm.id,
    path: storePath,
    keywords,
    patterns,
    priority,
    summary: truncateSummary(rawSummary),
    triggers: fm.triggers,
    tokens_est: estimateTokens(content),
    lines,
    ...(fm.metadata && Object.keys(fm.metadata).length > 0 ? { metadata: fm.metadata } : {}),
    ...(ref.subindex ? { subindex: true } : {}),
  };
}

function entryFromContent(
  ref: MemoryRef,
  content: string,
  storePath: string,
): LoadoutEntry {
  const id = nameToId(ref.name);
  const keywords = extractKeywords(ref.name, content, storePath);
  const patterns = deriveStemPatterns(id, storePath, []);
  const lines = content.split("\n").length;
  const priority: Priority = ref.defaultPriority ?? "domain";

  return {
    id,
    path: storePath,
    keywords,
    patterns,
    priority,
    summary: ref.description
      ? truncateSummary(ref.description)
      : `Memory: ${ref.name}`,
    triggers: { ...DEFAULT_TRIGGERS },
    tokens_est: estimateTokens(content),
    lines,
    ...(ref.subindex ? { subindex: true } : {}),
  };
}

/**
 * Convert a display name to kebab-case ID.
 * "AI Loadout" → "ai-loadout"
 * "Claude Guardian" → "claude-guardian"
 */
export function nameToId(name: string): string {
  return name
    .toLowerCase()
    .replace(/['\u2018\u2019]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}
