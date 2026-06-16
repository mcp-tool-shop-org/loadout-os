/**
 * Memory validator.
 *
 * Validates MEMORY.md + topic files for structural issues.
 * Uses ai-loadout's validateIndex for the dispatch table,
 * and adds memory-specific checks.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { validateIndex as validateLoadoutIndex, parseFrontmatter } from "@mcptoolshop/ai-loadout";
import type { ValidationIssue } from "@mcptoolshop/ai-loadout";
import type { MemoryAnalysis, MemoryIndex } from "./types.js";
import { nameToId } from "./index-gen.js";

/** ROADMAP Phase 2 (MEM-004): derived ids longer than this are flagged. */
const MAX_ID_LENGTH = 60;

/**
 * Resolve a ref path against MEMORY.md's dir then its parent (the same
 * two-base strategy analyze/index-gen use), returning the first that exists.
 */
function resolveRefPath(refPath: string, fileDir: string, parentDir: string): string | null {
  for (const base of [fileDir, parentDir]) {
    const full = join(base, refPath);
    if (existsSync(full)) return full;
  }
  return null;
}

/**
 * Validate a memory analysis for structural issues.
 */
export function validateMemory(analysis: MemoryAnalysis): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Missing referenced files
  for (const path of analysis.missingFiles) {
    issues.push({
      severity: "error",
      code: "MISSING_TOPIC_FILE",
      message: `Referenced topic file not found: ${path}`,
      hint: "Create the file or remove the reference from MEMORY.md",
    });
  }

  // Orphan files (exist on disk but not in MEMORY.md)
  for (const path of analysis.orphanFiles) {
    issues.push({
      severity: "warning",
      code: "ORPHAN_TOPIC_FILE",
      message: `Topic file not referenced in MEMORY.md: ${path}`,
      hint: "Add a reference in MEMORY.md or delete the file",
    });
  }

  // No references at all
  if (analysis.refs.length === 0) {
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

  // Over-long ids (MEM-004 / ROADMAP Phase 2; MEM-B08).
  // The id that lands in the dispatch table is EITHER derived from the ref name
  // (nameToId, reused via MEM-009) OR, when the topic file carries frontmatter,
  // the frontmatter-supplied `id` (entryFromFrontmatter uses fm.id verbatim).
  // MEM-004 only checked the derived path, so an 80-char frontmatter id sailed
  // through validate and became an unwieldy key. MEM-B08: apply MAX_ID_LENGTH to
  // whichever id index-gen would actually use.
  const fileDir = dirname(resolve(analysis.filePath));
  const parentDir = dirname(fileDir);
  for (const ref of analysis.refs) {
    // The effective id: frontmatter id wins (matches entryFromFrontmatter),
    // else the derived kebab id (matches entryFromContent).
    let effectiveId = nameToId(ref.name);
    let source = "Derived";

    const resolved = resolveRefPath(ref.path, fileDir, parentDir);
    if (resolved) {
      try {
        const { frontmatter } = parseFrontmatter(readFileSync(resolved, "utf-8"));
        if (frontmatter && typeof frontmatter.id === "string" && frontmatter.id.length > 0) {
          effectiveId = frontmatter.id;
          source = "Frontmatter";
        }
      } catch {
        // Unreadable topic file — already flagged via MISSING_TOPIC_FILE above.
        // Fall back to the derived id for the length check.
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
