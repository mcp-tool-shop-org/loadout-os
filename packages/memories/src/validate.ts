/**
 * Memory validator.
 *
 * Validates MEMORY.md + topic files for structural issues.
 * Uses ai-loadout's validateIndex for the dispatch table,
 * and adds memory-specific checks.
 */

import { validateIndex as validateLoadoutIndex } from "@mcptoolshop/ai-loadout";
import type { ValidationIssue } from "@mcptoolshop/ai-loadout";
import type { MemoryAnalysis, MemoryIndex } from "./types.js";

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

  return issues;
}

/**
 * Validate a generated memory index using ai-loadout's validator.
 */
export function validateMemoryIndex(index: MemoryIndex): ValidationIssue[] {
  return validateLoadoutIndex(index);
}
