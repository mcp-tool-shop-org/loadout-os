/**
 * Memory validator.
 *
 * Validates MEMORY.md + topic files for structural issues.
 * Uses ai-loadout's validateIndex for the dispatch table,
 * and adds memory-specific checks (including loader limits, sub-index links,
 * and summary drift against frontmatter descriptions).
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { validateIndex as validateLoadoutIndex, parseFrontmatter } from "@mcptoolshop/ai-loadout";
import type { ValidationIssue } from "@mcptoolshop/ai-loadout";
import type { MemoryAnalysis, MemoryIndex } from "./types.js";
import { nameToId } from "./index-gen.js";
import { resolveRefPath } from "./paths.js";

/** ROADMAP Phase 2 (MEM-004): derived ids longer than this are flagged. */
const MAX_ID_LENGTH = 60;

/**
 * Default MEMORY.md loader limits (Part B.3).
 * Claude Code truncates MEMORY.md past ~200 lines or ~25 KB
 * (measured 2026-11-08: a 242-line / 33 KB index was cut at line 194).
 */
export const DEFAULT_MAX_MEMORY_LINES = 180;
export const DEFAULT_MAX_MEMORY_BYTES = 24_000;

export interface ValidateMemoryOptions {
  /** Max allowed lines in MEMORY.md before emitting MEMORY_LIMIT_EXCEEDED error (default 180). */
  maxLines?: number;
  /** Max allowed UTF-8 bytes in MEMORY.md before emitting MEMORY_LIMIT_EXCEEDED error (default 24,000). */
  maxBytes?: number;
}

/**
 * Normalize a summary or frontmatter description for drift comparison.
 */
function normalizeSummaryText(s: string): string {
  return s.replace(/\s+/g, " ").trim().replace(/…|\.\.\.$/, "").trim();
}

/**
 * Check whether an index bullet's summary matches the topic file's frontmatter description
 * (allowing for clipping/truncation of the frontmatter description in the index bullet).
 */
export function summariesMatch(bulletDesc: string, frontmatterDesc: string): boolean {
  const b = normalizeSummaryText(bulletDesc);
  const f = normalizeSummaryText(frontmatterDesc);
  if (!b || !f) return true;
  if (b === f) return true;
  // An index bullet often clips the frontmatter description to ~120–140 chars with `…` or `...`
  if (f.startsWith(b) && b.length >= Math.min(20, f.length)) return true;
  if (b.startsWith(f)) return true;
  return false;
}

/**
 * Validate a memory analysis for structural issues.
 */
export function validateMemory(
  analysis: MemoryAnalysis,
  opts: ValidateMemoryOptions = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const maxLines = opts.maxLines ?? DEFAULT_MAX_MEMORY_LINES;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_MEMORY_BYTES;

  // Part B.3: Loader-limit check on MEMORY.md
  // Claude Code truncates MEMORY.md past 200 lines or ~25 KB
  // (measured 2026-11-08: a 242-line / 33 KB index was cut at line 194).
  try {
    const rawMemory = readFileSync(analysis.filePath, "utf-8");
    const rawLines = rawMemory.endsWith("\n")
      ? rawMemory.slice(0, -1).split("\n").length
      : rawMemory.split("\n").length;
    const rawBytes = Buffer.byteLength(rawMemory, "utf-8");

    if (rawLines > maxLines || rawBytes > maxBytes) {
      const reasons: string[] = [];
      if (rawLines > maxLines) {
        reasons.push(`${rawLines} lines > limit ${maxLines}`);
      }
      if (rawBytes > maxBytes) {
        reasons.push(`${rawBytes} bytes > limit ${maxBytes}`);
      }
      issues.push({
        severity: "error",
        code: "MEMORY_LIMIT_EXCEEDED",
        message: `MEMORY.md exceeds Claude Code auto-loader limits (${reasons.join("; ")}) — measured 2026-11-08: a 242-line / 33 KB index was cut at line 194`,
        hint: `Move domain entries into linked sub-index files (index-*.md) so MEMORY.md stays <= ${maxLines} lines and <= ${maxBytes} bytes`,
      });
    }
  } catch {
    // If filePath cannot be read, analyzeMemoryMd has already surfaced it.
  }

  // Missing referenced files
  for (const path of analysis.missingFiles) {
    issues.push({
      severity: "error",
      code: "MISSING_TOPIC_FILE",
      message: `Referenced topic file not found: ${path}`,
      hint: "Create the file or remove the reference from MEMORY.md",
    });
  }

  // Orphan files (exist on disk but not in MEMORY.md or any linked sub-index)
  for (const path of analysis.orphanFiles) {
    issues.push({
      severity: "warning",
      code: "ORPHAN_TOPIC_FILE",
      message: `Topic file not referenced in MEMORY.md: ${path}`,
      hint: "Add a reference in MEMORY.md or delete the file",
    });
  }

  // No references at all
  if (analysis.refs.length === 0 && (!analysis.subindexFiles || analysis.subindexFiles.length === 0)) {
    issues.push({
      severity: "warning",
      code: "NO_REFS",
      message: "MEMORY.md has no topic file references",
      hint: "Add references using the format: Name — description → `path`",
    });
  }

  // Duplicate paths
  const pathCounts = new Map<string, number>();
  for (const ref of analysis.refs) {
    pathCounts.set(ref.path, (pathCounts.get(ref.path) ?? 0) + 1);
  }
  for (const [path, count] of pathCounts) {
    if (count > 1) {
      issues.push({
        severity: "warning",
        code: "DUPLICATE_REF",
        message: `Topic file referenced ${count} times: ${path}`,
      });
    }
  }

  // Empty names
  for (const ref of analysis.refs) {
    if (!ref.name || ref.name.trim().length === 0) {
      issues.push({
        severity: "warning",
        code: "EMPTY_NAME",
        message: `Reference at line ${ref.line + 1} has no name`,
      });
    }
  }

  // Over-long ids (MEM-004 / MEM-B08) & summary drift check (F-02 / F-09: STALE_INDEX_SUMMARY)
  const fileDir = dirname(resolve(analysis.filePath));
  const parentDir = dirname(fileDir);
  for (const ref of analysis.refs) {
    let effectiveId = nameToId(ref.name);
    let source = "Derived";

    const resolved = resolveRefPath(ref.path, fileDir, parentDir);
    if (resolved) {
      try {
        const content = readFileSync(resolved, "utf-8");
        const { frontmatter } = parseFrontmatter(content);
        if (frontmatter && typeof frontmatter.id === "string" && frontmatter.id.length > 0) {
          effectiveId = frontmatter.id;
          source = "Frontmatter";
        }
        // F-02 / F-09: Check whether the index bullet summary differs from the topic file's frontmatter description
        if (
          frontmatter &&
          typeof frontmatter.description === "string" &&
          frontmatter.description.trim().length > 0 &&
          ref.description &&
          ref.description.trim().length > 0
        ) {
          if (!summariesMatch(ref.description, frontmatter.description)) {
            const indexLabel = ref.subindexPath ?? "MEMORY.md";
            issues.push({
              severity: "warning",
              code: "STALE_INDEX_SUMMARY",
              message: `Index bullet summary in ${indexLabel} (line ${ref.line + 1}) differs from frontmatter description in ${ref.path}`,
              hint: `Run 'loadout-os memories sync-summaries <MEMORY.md> --fix' to sync bullet summaries from frontmatter`,
              entryId: effectiveId,
            });
          }
        }
      } catch {
        // Unreadable topic file — already flagged via MISSING_TOPIC_FILE above.
      }
    }

    if (effectiveId.length > MAX_ID_LENGTH) {
      issues.push({
        severity: "warning",
        code: "ID_TOO_LONG",
        message: `${source} id at line ${ref.line + 1} is ${effectiveId.length} chars (max ${MAX_ID_LENGTH}): "${effectiveId}"`,
        hint:
          source === "Frontmatter"
            ? `Shorten the frontmatter id in ${ref.path} so it stays under ${MAX_ID_LENGTH} chars`
            : `Shorten the reference name so its kebab-case id stays under ${MAX_ID_LENGTH} chars`,
      });
    }
  }

  return issues;
}

/**
 * Validate a generated memory index using ai-loadout's validator.
 */
export function validateMemoryIndex(index: MemoryIndex): ValidationIssue[] {
  return validateLoadoutIndex(index);
}
