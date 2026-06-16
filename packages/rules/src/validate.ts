/**
 * Rules linter.
 *
 * Checks:
 * - All index.json entries point to existing files
 * - All rule files have valid frontmatter
 * - All rule files in the directory are referenced in index.json (no orphans)
 * - Index.json matches frontmatter (no drift)
 * - Summaries are present and <120 chars
 * - Keywords are non-empty for domain rules
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { parseFrontmatter } from "./parser.js";
import { log, ok, warn, info, fail, BOLD, DIM, RESET, RED, GREEN, YELLOW } from "./cli.js";
import { positionalArgs, flagValue, hasFlag } from "./cli.js";
import type { RuleIndex, RuleEntry, FsValidationIssue } from "./types.js";

// ── Fix hints per issue code (humanization — say which side is canonical) ──
// Frontmatter is the source of truth; index.json is regenerated from it. Drift
// hints always point the user back to the frontmatter (or to re-running split),
// so they know which side to edit instead of guessing.
const FIX_HINTS: Record<string, string> = {
  DRIFT_ID:
    "frontmatter is canonical; update index.json (or re-run `claude-rules split`)",
  DRIFT_PRIORITY:
    "frontmatter is canonical; update index.json (or re-run `claude-rules split`)",
  DRIFT_KEYWORDS:
    "frontmatter is canonical; update index.json (or re-run `claude-rules split`)",
  ORPHAN_FILE: "add it to index.json or delete the file",
  DUPLICATE_ID: "rename one rule's id",
};

// Find the 1-based line of a `<key>:` entry inside a file's frontmatter block.
// Cheap, best-effort: scans the leading `---` … `---` fence only. Returns
// undefined when the key isn't found (so we never attach a bogus line number).
function frontmatterKeyLine(
  content: string,
  key: string,
): number | undefined {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") return undefined;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") break; // end of frontmatter fence
    if (new RegExp(`^\\s*${key}\\s*:`).test(lines[i])) return i + 1;
  }
  return undefined;
}

// ── Core validation logic ──────────────────────────────────────
export function validateRules(
  rulesDir: string,
  repoRoot: string,
): FsValidationIssue[] {
  const issues: FsValidationIssue[] = [];
  const absRulesDir = resolve(repoRoot, rulesDir);
  const indexPath = join(absRulesDir, "index.json");

  // Check index.json exists
  if (!existsSync(indexPath)) {
    issues.push({
      severity: "error",
      code: "MISSING_INDEX",
      message: `index.json not found at ${rulesDir}/index.json`,
      file: indexPath,
    });
    return issues;
  }

  // Parse index.json
  let index: RuleIndex;
  try {
    index = JSON.parse(readFileSync(indexPath, "utf8")) as RuleIndex;
  } catch (e) {
    issues.push({
      severity: "error",
      code: "INVALID_INDEX",
      message: `Failed to parse index.json: ${(e as Error).message}`,
      file: indexPath,
    });
    return issues;
  }

  // Trust-boundary shape guard (RUL-B1): index.json is user data. JSON.parse
  // only proves it's valid JSON, not that it has the shape we dereference. A
  // valid-but-wrong-shape index (e.g. `{}` or `{"entries": "oops"}`) would
  // throw "not iterable" downstream and surface as the catch-all RUNTIME_FATAL
  // ("This is a bug. Please report it.") for what is really a user data error.
  // Validate the shape here and emit a structured, actionable INVALID_INDEX.
  if (!Array.isArray(index.entries)) {
    issues.push({
      severity: "error",
      code: "INVALID_INDEX",
      message:
        "index.json is missing an `entries` array — regenerate with `claude-rules split`",
      file: indexPath,
    });
    return issues;
  }
  if (index.budget === null || typeof index.budget !== "object") {
    issues.push({
      severity: "error",
      code: "INVALID_INDEX",
      message:
        "index.json is missing a `budget` object — regenerate with `claude-rules split`",
      file: indexPath,
    });
    return issues;
  }

  // Validate each rule entry
  const indexedFiles = new Set<string>();
  for (const rule of index.entries) {
    const absPath = resolve(repoRoot, rule.path);
    indexedFiles.add(rule.path);

    // Check file exists
    if (!existsSync(absPath)) {
      issues.push({
        severity: "error",
        code: "MISSING_REF",
        message: `Rule file not found: ${rule.path}`,
        file: absPath,
      });
      continue;
    }

    // Check frontmatter
    const content = readFileSync(absPath, "utf8");
    const { frontmatter } = parseFrontmatter(content);

    if (!frontmatter) {
      issues.push({
        severity: "error",
        code: "MISSING_FRONTMATTER",
        message: `Rule file has no valid frontmatter: ${rule.path}`,
        file: absPath,
      });
      continue;
    }

    // Check drift: frontmatter vs index
    if (frontmatter.id !== rule.id) {
      issues.push({
        severity: "error",
        code: "DRIFT_ID",
        message: `ID mismatch: index says "${rule.id}" but frontmatter says "${frontmatter.id}" in ${rule.path}`,
        file: absPath,
        line: frontmatterKeyLine(content, "id"),
        hint: FIX_HINTS.DRIFT_ID,
      });
    }

    if (frontmatter.priority !== rule.priority) {
      issues.push({
        severity: "warning",
        code: "DRIFT_PRIORITY",
        message: `Priority mismatch: index says "${rule.priority}" but frontmatter says "${frontmatter.priority}" in ${rule.path}`,
        file: absPath,
        line: frontmatterKeyLine(content, "priority"),
        hint: FIX_HINTS.DRIFT_PRIORITY,
      });
    }

    // Check keywords drift
    const indexKw = new Set(rule.keywords);
    const fmKw = new Set(frontmatter.keywords);
    if (
      indexKw.size !== fmKw.size ||
      ![...indexKw].every((k) => fmKw.has(k))
    ) {
      issues.push({
        severity: "warning",
        code: "DRIFT_KEYWORDS",
        message: `Keywords mismatch in ${rule.path}: index has [${rule.keywords.join(", ")}], frontmatter has [${frontmatter.keywords.join(", ")}]`,
        file: absPath,
        line: frontmatterKeyLine(content, "keywords"),
        hint: FIX_HINTS.DRIFT_KEYWORDS,
      });
    }

    // Check summary quality
    if (!rule.summary || rule.summary.length === 0) {
      issues.push({
        severity: "error",
        code: "MISSING_SUMMARY",
        message: `Rule "${rule.id}" has no summary`,
        file: absPath,
      });
    } else if (rule.summary.length > 120) {
      issues.push({
        severity: "warning",
        code: "LONG_SUMMARY",
        message: `Rule "${rule.id}" summary exceeds 120 chars (${rule.summary.length})`,
        file: absPath,
      });
    }

    // Check keywords non-empty for domain rules
    if (rule.priority === "domain" && rule.keywords.length === 0) {
      issues.push({
        severity: "error",
        code: "EMPTY_KEYWORDS",
        message: `Domain rule "${rule.id}" has no keywords — agent cannot route to it`,
        file: absPath,
      });
    }
  }

  // Check for orphaned rule files
  if (existsSync(absRulesDir)) {
    const files = readdirSync(absRulesDir);
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const relativePath = `${rulesDir}/${file}`;
      if (!indexedFiles.has(relativePath)) {
        issues.push({
          severity: "warning",
          code: "ORPHAN_FILE",
          message: `Rule file exists but not in index.json: ${relativePath}`,
          file: join(absRulesDir, file),
          hint: FIX_HINTS.ORPHAN_FILE,
        });
      }
    }
  }

  // Check for duplicate IDs
  const ids = index.entries.map((r) => r.id);
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      issues.push({
        severity: "error",
        code: "DUPLICATE_ID",
        message: `Duplicate rule ID: "${id}"`,
        hint: FIX_HINTS.DUPLICATE_ID,
      });
    }
    seen.add(id);
  }

  // Check for duplicate keywords across rules (warning only — sometimes valid)
  const kwMap = new Map<string, string[]>();
  for (const rule of index.entries) {
    for (const kw of rule.keywords) {
      const existing = kwMap.get(kw) ?? [];
      existing.push(rule.id);
      kwMap.set(kw, existing);
    }
  }
  for (const [kw, ruleIds] of kwMap) {
    if (ruleIds.length > 1) {
      issues.push({
        severity: "warning",
        code: "DUPLICATE_KEYWORD",
        message: `Keyword "${kw}" appears in multiple rules: ${ruleIds.join(", ")}`,
      });
    }
  }

  return issues;
}

// ── Format one issue line, with optional line ref + fix hint ───
function formatIssue(label: string, issue: FsValidationIssue): string {
  // Append a `:line` suffix when we resolved a frontmatter line number, so the
  // user can jump straight to the offending field.
  const where = issue.line !== undefined ? `${RESET}:${issue.line}` : "";
  let out = `${label} [${issue.code}] ${issue.message}${where}`;
  if (issue.hint) {
    out += `\n      ${DIM}fix: ${issue.hint}${RESET}`;
  }
  return out;
}

// ── CLI command: validate ──────────────────────────────────────
export async function cmdValidate(args: string[]): Promise<void> {
  const lazy = hasFlag(args, "--lazy");
  // RUL-B2: mirror split's --lazy default. split --lazy writes to
  // .claude/loadout; validate must look there too, otherwise the very
  // `claude-rules validate` the tool suggests after a lazy split reports a
  // false MISSING_INDEX against the wrong directory.
  const rulesDir =
    flagValue(args, "--rules-dir") ?? (lazy ? ".claude/loadout" : ".claude/rules");
  const repoRoot = process.cwd();

  if (hasFlag(args, "--dry-run")) {
    info("validate is read-only — no files are modified.");
  }
  info(`Validating ${rulesDir}/`);
  log("");

  const issues = validateRules(rulesDir, repoRoot);

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  if (issues.length === 0) {
    ok("All rules valid. No issues found.");
    return;
  }

  // Print errors
  for (const issue of errors) {
    log(formatIssue(`${RED}error${RESET}`, issue));
  }

  // Print warnings
  for (const issue of warnings) {
    log(formatIssue(`${YELLOW}warn${RESET} `, issue));
  }

  log("");
  log(
    `${errors.length > 0 ? RED : GREEN}${errors.length} error(s)${RESET}, ${warnings.length > 0 ? YELLOW : DIM}${warnings.length} warning(s)${RESET}`,
  );

  if (errors.length > 0) {
    process.exit(1);
  }
}
