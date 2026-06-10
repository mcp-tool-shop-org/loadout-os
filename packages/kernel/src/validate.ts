/**
 * Index validator.
 *
 * Validates the structural integrity of a LoadoutIndex.
 * Does NOT check the filesystem — that's the consumer's job
 * (e.g. claude-rules checks that files exist on disk).
 *
 * This validates the data model only:
 * - Required fields present
 * - IDs unique and kebab-case
 * - Summaries present and bounded
 * - Domain entries have keywords
 * - No empty arrays where content is expected
 * - Budget numbers are non-negative
 */

import type { LoadoutIndex, ValidationIssue } from "./types.js";

const KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const VALID_PRIORITIES = new Set(["core", "domain", "manual"]);

export function validateIndex(index: LoadoutIndex): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Version check
  if (!index.version) {
    issues.push({
      severity: "error",
      code: "MISSING_VERSION",
      message: "Index is missing a version field",
    });
  }

  // Generated timestamp
  if (!index.generated) {
    issues.push({
      severity: "warning",
      code: "MISSING_GENERATED",
      message: "Index is missing a generated timestamp",
    });
  }

  // Entries array
  if (!Array.isArray(index.entries)) {
    issues.push({
      severity: "error",
      code: "INVALID_ENTRIES",
      message: "Index entries must be an array",
    });
    return issues; // can't continue
  }

  // Per-entry validation
  const ids = new Set<string>();

  for (const entry of index.entries) {
    // ID required
    if (!entry.id) {
      issues.push({
        severity: "error",
        code: "MISSING_ID",
        message: "Entry is missing an id field",
        hint: "Every entry needs a unique kebab-case id",
      });
      continue;
    }

    // ID format
    if (!KEBAB_RE.test(entry.id)) {
      issues.push({
        severity: "warning",
        code: "BAD_ID_FORMAT",
        message: `ID "${entry.id}" is not kebab-case`,
        entryId: entry.id,
      });
    }

    // Duplicate ID
    if (ids.has(entry.id)) {
      issues.push({
        severity: "error",
        code: "DUPLICATE_ID",
        message: `Duplicate entry ID: "${entry.id}"`,
        entryId: entry.id,
      });
    }
    ids.add(entry.id);

    // Path required
    if (!entry.path) {
      issues.push({
        severity: "error",
        code: "MISSING_PATH",
        message: `Entry "${entry.id}" has no path`,
        hint: "Set path to the relative file location (e.g. .claude/rules/my-rule.md)",
        entryId: entry.id,
      });
    }

    // Priority valid
    if (!VALID_PRIORITIES.has(entry.priority)) {
      issues.push({
        severity: "error",
        code: "INVALID_PRIORITY",
        message: `Entry "${entry.id}" has invalid priority "${entry.priority}"`,
        entryId: entry.id,
      });
    }

    // Summary required and bounded
    if (!entry.summary || entry.summary.length === 0) {
      issues.push({
        severity: "error",
        code: "MISSING_SUMMARY",
        message: `Entry "${entry.id}" has no summary`,
        entryId: entry.id,
      });
    } else if (entry.summary.length > 120) {
      issues.push({
        severity: "warning",
        code: "LONG_SUMMARY",
        message: `Entry "${entry.id}" summary exceeds 120 chars (${entry.summary.length})`,
        entryId: entry.id,
      });
    }

    // Domain entries must have keywords
    if (entry.priority === "domain" && (!entry.keywords || entry.keywords.length === 0)) {
      issues.push({
        severity: "error",
        code: "EMPTY_KEYWORDS",
        message: `Domain entry "${entry.id}" has no keywords — cannot be routed`,
        hint: "Add keywords to frontmatter so the matcher can find this entry",
        entryId: entry.id,
      });
    }

    // Token estimate sanity
    if (typeof entry.tokens_est !== "number" || entry.tokens_est < 0) {
      issues.push({
        severity: "warning",
        code: "BAD_TOKEN_EST",
        message: `Entry "${entry.id}" has invalid token estimate: ${entry.tokens_est}`,
        entryId: entry.id,
      });
    }
  }

  // Budget validation
  if (index.budget) {
    if (index.budget.always_loaded_est < 0) {
      issues.push({
        severity: "warning",
        code: "NEGATIVE_BUDGET",
        message: "always_loaded_est is negative",
      });
    }
    if (index.budget.on_demand_total_est < 0) {
      issues.push({
        severity: "warning",
        code: "NEGATIVE_BUDGET",
        message: "on_demand_total_est is negative",
      });
    }
  }

  return issues;
}
