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
      });
    }

    if (frontmatter.priority !== rule.priority) {
      issues.push({
        severity: "warning",
        code: "DRIFT_PRIORITY",
        message: `Priority mismatch: index says "${rule.priority}" but frontmatter says "${frontmatter.priority}" in ${rule.path}`,
        file: absPath,
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

// ── CLI command: validate ──────────────────────────────────────
export async function cmdValidate(args: string[]): Promise<void> {
  const rulesDir = flagValue(args, "--rules-dir") ?? ".claude/rules";
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
    log(`${RED}error${RESET} [${issue.code}] ${issue.message}`);
  }

  // Print warnings
  for (const issue of warnings) {
    log(`${YELLOW}warn${RESET}  [${issue.code}] ${issue.message}`);
  }

  log("");
  log(
    `${errors.length > 0 ? RED : GREEN}${errors.length} error(s)${RESET}, ${warnings.length > 0 ? YELLOW : DIM}${warnings.length} warning(s)${RESET}`,
  );

  if (errors.length > 0) {
    process.exit(1);
  }
}
