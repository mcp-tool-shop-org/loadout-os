/**
 * Thin print layers over the three wrapped libraries.
 *
 * loadout-os OWNS this rendering (the wrapped packages expose pure functions;
 * their own CLIs keep their own formatting). We deliberately do NOT shell out to
 * the legacy bins — we call the library exports directly so the unified surface
 * is one process, one arg parser, one error shape.
 *
 * Namespaced surfaces (memories/rules) wrap a package; flat verbs wrap the
 * kernel. The flat `validate <index>` is the KERNEL validator (index-structure)
 * — distinct from `memories validate` / `rules validate`, which is exactly why
 * the kernel one is flat and the others are namespaced.
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

// memories
import {
  analyzeMemoryMd,
  generateIndex as generateMemoryIndex,
  validateMemory,
  validateMemoryIndex,
  generateStats,
  formatStats,
} from "@mcptoolshop/claude-memories";

// rules
import { analyzeFile, validateRules } from "@mcptoolshop/claude-rules";

// kernel
import {
  validateIndex,
  resolveLoadout,
  explainEntry,
  readUsage,
  readUsageWithStats,
  summarizeUsage,
  summaryToJSON,
  findDeadEntries,
  findKeywordOverlaps,
  analyzeBudget,
  type LoadoutIndex,
} from "@mcptoolshop/ai-loadout";

import {
  BOLD,
  DIM,
  RESET,
  GREEN,
  RED,
  YELLOW,
  CYAN,
  log,
  ok,
  warn,
  info,
  fail,
  hasFlag,
  flagValue as flag,
  positionalArgs,
} from "./console.js";

// ── Shared loaders ─────────────────────────────────────────────

function requireFile(path: string, what: string): string {
  const abs = resolve(path);
  if (!existsSync(abs)) {
    fail("FILE_NOT_FOUND", `${what} not found: ${path}`);
  }
  try {
    if (!statSync(abs).isFile()) {
      fail("NOT_A_FILE", `Not a file: ${path}`, `Point at a ${what} file, not a directory.`);
    }
  } catch {
    fail("FILE_NOT_FOUND", `${what} not found: ${path}`);
  }
  return abs;
}

function loadKernelIndex(path: string): LoadoutIndex {
  const abs = requireFile(path, "index");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(abs, "utf-8"));
  } catch (e) {
    fail("PARSE_ERROR", `Failed to parse index: ${path}`, (e as Error).message);
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as LoadoutIndex).entries)
  ) {
    fail(
      "INVALID_INDEX",
      `File is valid JSON but not a loadout index: ${path}`,
      "Expected an object with an 'entries' array. Run 'loadout-os validate <index>' for details.",
    );
  }
  return parsed as LoadoutIndex;
}

// ══════════════════════════════════════════════════════════════
// memories <index|validate|stats|health>
// ══════════════════════════════════════════════════════════════

function memoriesPath(args: string[]): string {
  const pos = positionalArgs(args);
  if (pos.length === 0) {
    fail(
      "MISSING_ARG",
      "A path to MEMORY.md is required",
      "Usage: loadout-os memories <index|validate|stats|health> <MEMORY.md>",
    );
  }
  return requireFile(pos[0], "MEMORY.md");
}

export function memoriesIndex(args: string[]): void {
  const file = memoriesPath(args);
  const json = hasFlag(args, "json");
  const lazyLoad = hasFlag(args, "lazy");

  const analysis = analyzeMemoryMd(file);
  const index = generateMemoryIndex(analysis, { lazyLoad });
  const issues = validateMemoryIndex(index);

  if (json) {
    log(JSON.stringify({ index, issues, missingFiles: analysis.missingFiles }, null, 2));
    return;
  }

  log(`\n${BOLD}Memory index${RESET} from ${file}\n`);
  ok(`${index.entries.length} entries`);
  if (analysis.missingFiles.length > 0) {
    warn(`${analysis.missingFiles.length} unresolved ref(s) skipped — run \`memories validate\` for detail`);
  }
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  for (const i of errors) warn(`[${i.code}] ${i.message}`);
  for (const i of warnings) info(`[${i.code}] ${i.message}`);
  log(`\n${BOLD}Budget:${RESET}`);
  log(`  Always loaded:   ${index.budget.always_loaded_est.toLocaleString()} tokens`);
  log(`  On-demand total: ${index.budget.on_demand_total_est.toLocaleString()} tokens`);
  log(`  Avg task load:   ${index.budget.avg_task_load_est.toLocaleString()} tokens`);
  if (lazyLoad) info("Lazy loading enabled");
  log("");
}

export function memoriesValidate(args: string[]): void {
  const file = memoriesPath(args);
  const json = hasFlag(args, "json");

  const analysis = analyzeMemoryMd(file);
  const memoryIssues = validateMemory(analysis);
  const index = generateMemoryIndex(analysis);
  const indexIssues = validateMemoryIndex(index);
  const all = [...memoryIssues, ...indexIssues];
  const errors = all.filter((i) => i.severity === "error");
  const warnings = all.filter((i) => i.severity === "warning");

  if (json) {
    log(
      JSON.stringify(
        { valid: errors.length === 0, errors: errors.length, warnings: warnings.length, issues: all },
        null,
        2,
      ),
    );
    if (errors.length > 0) fail("VALIDATION_FAILED", `${errors.length} error(s)`, undefined, 1);
    return;
  }

  log(`\n${BOLD}Validating${RESET} ${file}\n`);
  if (errors.length > 0) {
    log(`${RED}${BOLD}Errors:${RESET}`);
    for (const i of errors) {
      log(`  ${RED}✗${RESET} [${i.code}] ${i.message}`);
      if (i.hint) log(`    ${DIM}${i.hint}${RESET}`);
    }
  }
  if (warnings.length > 0) {
    log(`${YELLOW}${BOLD}Warnings:${RESET}`);
    for (const i of warnings) {
      log(`  ${YELLOW}!${RESET} [${i.code}] ${i.message}`);
      if (i.hint) log(`    ${DIM}${i.hint}${RESET}`);
    }
  }
  if (all.length === 0) ok("No issues found");
  log(`\n  ${errors.length} errors, ${warnings.length} warnings\n`);
  if (errors.length > 0) fail("VALIDATION_FAILED", `${errors.length} error(s)`, undefined, 1);
}

export function memoriesStats(args: string[]): void {
  const file = memoriesPath(args);
  const json = hasFlag(args, "json");
  const analysis = analyzeMemoryMd(file);
  const index = generateMemoryIndex(analysis);
  const stats = generateStats(analysis, index);
  if (json) {
    log(JSON.stringify(stats, null, 2));
    return;
  }
  log("");
  log(formatStats(stats));
  log("");
}

export function memoriesHealth(args: string[]): void {
  const json = hasFlag(args, "json");
  const nodeMajor = parseInt(process.version.slice(1), 10);
  const nodeOk = nodeMajor >= 20;
  const pos = positionalArgs(args);

  const checked: { label: string; path: string; found: boolean }[] = [];
  if (pos.length > 0) {
    const abs = resolve(pos[0]);
    checked.push({ label: "given path", path: abs, found: existsSync(abs) });
  } else {
    for (const c of ["MEMORY.md", ".claude/MEMORY.md"]) {
      const abs = resolve(c);
      checked.push({ label: c, path: abs, found: existsSync(abs) });
    }
  }
  const found = checked.some((c) => c.found);

  if (json) {
    log(JSON.stringify({ nodeVersion: process.version, nodeOk, checked, found }, null, 2));
    if (!nodeOk) fail("NODE_TOO_OLD", `Node ${process.version} < 20`, undefined, 1);
    return;
  }

  log(`\n${BOLD}loadout-os memories health${RESET}`);
  log(`  Node.js: ${process.version} ${nodeOk ? `${GREEN}(OK)${RESET}` : `${RED}(requires >=20)${RESET}`}`);
  log(`  Platform: ${process.platform} ${process.arch}`);
  log(`\n${BOLD}MEMORY.md detection:${RESET}`);
  for (const c of checked) {
    if (c.found) ok(`${c.label} → ${c.path}`);
    else info(`${c.label} — not found`);
  }
  if (!found) warn("No MEMORY.md detected. Provide a path when running commands.");
  log("");
  if (!nodeOk) fail("NODE_TOO_OLD", `Node ${process.version} < 20`, undefined, 1);
}

// ══════════════════════════════════════════════════════════════
// rules <analyze|validate|stats>   (split → deferred notice)
// ══════════════════════════════════════════════════════════════

export function rulesAnalyze(args: string[]): void {
  const pos = positionalArgs(args);
  if (pos.length === 0) {
    fail(
      "MISSING_ARG",
      "A path to CLAUDE.md is required",
      "Usage: loadout-os rules analyze <CLAUDE.md> [--rules-dir <dir>]",
    );
  }
  const file = requireFile(pos[0], "CLAUDE.md");
  const rulesDir = flag(args, "rules-dir") ?? ".claude/rules";
  const json = hasFlag(args, "json");

  const report = analyzeFile(file, rulesDir);

  if (json) {
    log(JSON.stringify(report, null, 2));
    return;
  }

  log(`\n${BOLD}Analyzing${RESET} ${file} ${DIM}(${report.totalLines} lines, ~${report.totalTokens} tokens)${RESET}\n`);
  log(`${BOLD}Sections:${RESET} ${report.sections.length}`);
  log(`${BOLD}Keep inline (core):${RESET} ${report.coreCandidate.length}`);
  log(`${BOLD}Proposed extractions:${RESET} ${report.proposals.length}`);
  for (const p of report.proposals) {
    log(`  ${CYAN}${p.suggestedId}${RESET} → ${p.suggestedPath} ${DIM}[${p.suggestedPriority}]${RESET}`);
    log(`    ${DIM}${p.reason}${RESET}`);
  }
  log("");
}

export function rulesValidate(args: string[]): void {
  const json = hasFlag(args, "json");
  const lazy = hasFlag(args, "lazy");
  const rulesDir = flag(args, "rules-dir") ?? (lazy ? ".claude/loadout" : ".claude/rules");
  const repoRoot = flag(args, "repo-root") ?? process.cwd();

  const issues = validateRules(rulesDir, resolve(repoRoot));
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  if (json) {
    log(
      JSON.stringify(
        { valid: errors.length === 0, errors: errors.length, warnings: warnings.length, issues },
        null,
        2,
      ),
    );
    if (errors.length > 0) fail("VALIDATION_FAILED", `${errors.length} error(s)`, undefined, 1);
    return;
  }

  log(`\n${BOLD}Validating${RESET} ${rulesDir}/\n`);
  if (issues.length === 0) {
    ok("All rules valid. No issues found.");
    log("");
    return;
  }
  for (const i of errors) {
    log(`  ${RED}error${RESET} [${i.code}] ${i.message}`);
    if (i.hint) log(`      ${DIM}fix: ${i.hint}${RESET}`);
  }
  for (const i of warnings) {
    log(`  ${YELLOW}warn${RESET}  [${i.code}] ${i.message}`);
    if (i.hint) log(`      ${DIM}fix: ${i.hint}${RESET}`);
  }
  log(`\n  ${errors.length} error(s), ${warnings.length} warning(s)\n`);
  if (errors.length > 0) fail("VALIDATION_FAILED", `${errors.length} error(s)`, undefined, 1);
}

export function rulesStats(args: string[]): void {
  const pos = positionalArgs(args);
  if (pos.length === 0) {
    fail(
      "MISSING_ARG",
      "A path to CLAUDE.md is required",
      "Usage: loadout-os rules stats <CLAUDE.md> [--rules-dir <dir>]",
    );
  }
  const file = requireFile(pos[0], "CLAUDE.md");
  const rulesDir = flag(args, "rules-dir") ?? ".claude/rules";
  const json = hasFlag(args, "json");

  const report = analyzeFile(file, rulesDir);
  const coreTokens = report.coreCandidate.reduce((s, c) => s + c.tokens_est, 0);
  const extractTokens = report.proposals.reduce((s, p) => s + p.section.tokens_est, 0);
  const savingsPct = report.totalTokens > 0 ? Math.round((extractTokens / report.totalTokens) * 100) : 0;

  const stats = {
    file: report.filePath,
    totalLines: report.totalLines,
    totalTokens: report.totalTokens,
    sections: report.sections.length,
    coreSections: report.coreCandidate.length,
    proposedExtractions: report.proposals.length,
    alwaysLoadedTokens: coreTokens,
    onDemandTokens: extractTokens,
    savingsPercent: savingsPct,
  };

  if (json) {
    log(JSON.stringify(stats, null, 2));
    return;
  }

  log(`\n${BOLD}Rules budget${RESET} for ${report.filePath}\n`);
  log(`  Sections:        ${stats.sections} (${stats.coreSections} core, ${stats.proposedExtractions} extractable)`);
  log(`  Total:           ${stats.totalLines} lines, ~${stats.totalTokens} tokens`);
  log(`  Always loaded:   ~${coreTokens} tokens`);
  log(`  On-demand:       ~${extractTokens} tokens`);
  log(`  ${BOLD}Savings:         ${savingsPct}% per session${RESET}`);
  log("");
}

export function rulesSplitNotice(): void {
  warn("`rules split` is interactive and not yet wrapped by loadout-os.");
  info("Use the `claude-rules split` bin directly for the interactive extraction workflow.");
}

// ══════════════════════════════════════════════════════════════
// Flat kernel verbs: resolve | explain | usage | dead | overlaps | budget | validate
// ══════════════════════════════════════════════════════════════

export function kernelResolve(args: string[]): void {
  const json = hasFlag(args, "json");
  const result = resolveLoadout({
    projectRoot: flag(args, "project"),
    globalDir: flag(args, "global"),
    orgPath: flag(args, "org"),
    sessionPath: flag(args, "session"),
  });

  if (json) {
    log(
      JSON.stringify(
        {
          layers: result.searched,
          entries: result.merged.entries.map((e) => ({
            id: e.id,
            priority: e.priority,
            tokens: e.tokens_est,
            source: result.merged.provenance[e.id],
          })),
          conflicts: result.merged.conflicts,
          budget: result.merged.budget,
        },
        null,
        2,
      ),
    );
    return;
  }

  log(`\n${BOLD}Layer Discovery${RESET}\n`);
  for (const s of result.searched) {
    if (s.found) ok(`${s.name.padEnd(10)} ${DIM}${s.path}${RESET}`);
    else if (s.malformed) warn(`${s.name.padEnd(10)} ${DIM}${s.path}${RESET} ${YELLOW}(malformed JSON — skipped)${RESET}`);
    else log(`  ${DIM}—${RESET} ${s.name.padEnd(10)} ${DIM}${s.path} (not found)${RESET}`);
  }
  if (result.layers.length === 0) {
    log(`\n  ${YELLOW}No loadout indexes found.${RESET}\n`);
    return;
  }
  log(`\n${BOLD}Resolved Entries${RESET} (${result.merged.entries.length} from ${result.layers.length} layer(s))\n`);
  for (const e of result.merged.entries) {
    const src = result.merged.provenance[e.id] ?? "?";
    log(`  ${e.id.padEnd(30)} ${e.priority.padEnd(8)} ${String(e.tokens_est).padStart(6)}  ${src}`);
  }
  log("");
}

export function kernelExplain(args: string[]): void {
  const pos = positionalArgs(args);
  if (pos.length === 0) {
    fail("MISSING_ARG", "Usage: loadout-os explain <entry-id>", "Run 'loadout-os resolve' to see entries.");
  }
  const entryId = pos[0];
  const json = hasFlag(args, "json");
  const { layers } = resolveLoadout({
    projectRoot: flag(args, "project"),
    globalDir: flag(args, "global"),
    orgPath: flag(args, "org"),
    sessionPath: flag(args, "session"),
  });
  const explanation = explainEntry(entryId, layers);
  if (!explanation) {
    if (json) {
      log(JSON.stringify({ error: "NOT_FOUND", entryId }, null, 2));
      fail("NOT_FOUND", `Entry "${entryId}" not found in any layer`, undefined, 1);
    }
    fail("NOT_FOUND", `Entry "${entryId}" not found in any layer`, "Run 'loadout-os resolve' to see entries.");
  }
  if (json) {
    log(JSON.stringify(explanation, null, 2));
    return;
  }
  log(`\n${BOLD}Entry Explanation: ${CYAN}${explanation.id}${RESET}\n`);
  log(`  Final layer: ${GREEN}${explanation.finalLayer}${RESET}`);
  log(`  Override chain: ${explanation.overrideChain.join(" → ")}`);
  for (const def of explanation.definitions) {
    log(`  ${def.layer}: ${def.priority}, ${def.tokens} tokens — ${def.summary}`);
  }
  log("");
}

export function kernelUsage(args: string[]): void {
  const pos = positionalArgs(args);
  if (pos.length < 1) fail("MISSING_ARG", "Usage: loadout-os usage <jsonl>");
  const jsonl = resolve(pos[0]);
  const json = hasFlag(args, "json");
  const { events, skipped } = readUsageWithStats(jsonl);
  if (events.length === 0) {
    if (json) { log("[]"); return; }
    info("No usage events found");
    return;
  }
  const summary = summarizeUsage(events);
  if (json) {
    log(JSON.stringify(summary.map(summaryToJSON), null, 2));
    return;
  }
  if (skipped > 0) warn(`Skipped ${skipped} malformed line(s)`);
  log(`\n${BOLD}Usage Summary${RESET} (${events.length} events)\n`);
  log(`  ${"Entry".padEnd(30)} ${"Loads".padStart(6)} ${"Tokens".padStart(8)}`);
  for (const s of summary) {
    log(`  ${s.entryId.padEnd(30)} ${String(s.loadCount).padStart(6)} ${String(s.totalTokens).padStart(8)}`);
  }
  log("");
}

export function kernelDead(args: string[]): void {
  const pos = positionalArgs(args);
  if (pos.length < 2) fail("MISSING_ARG", "Usage: loadout-os dead <index> <jsonl>");
  const index = loadKernelIndex(pos[0]);
  const events = readUsage(resolve(pos[1]));
  const dead = findDeadEntries(index, events);
  const json = hasFlag(args, "json");
  if (json) {
    log(JSON.stringify(dead.map((d) => ({ id: d.entry.id, tokens: d.entry.tokens_est, reason: d.reason })), null, 2));
    return;
  }
  if (dead.length === 0) {
    ok("No dead entries — all entries loaded at least once");
    return;
  }
  log(`\n${BOLD}Dead Entries${RESET} (${dead.length} never loaded)\n`);
  let wasted = 0;
  for (const d of dead) {
    warn(`${d.entry.id} (${d.entry.tokens_est} tokens)`);
    wasted += d.entry.tokens_est;
  }
  log(`\n  ${RED}${wasted.toLocaleString()} tokens${RESET} in entries never loaded\n`);
}

export function kernelOverlaps(args: string[]): void {
  const pos = positionalArgs(args);
  if (pos.length < 1) fail("MISSING_ARG", "Usage: loadout-os overlaps <index>");
  const index = loadKernelIndex(pos[0]);
  const overlaps = findKeywordOverlaps(index);
  const json = hasFlag(args, "json");
  if (json) {
    log(JSON.stringify(overlaps, null, 2));
    return;
  }
  if (overlaps.length === 0) {
    ok("No keyword overlaps — routing is unambiguous");
    return;
  }
  log(`\n${BOLD}Keyword Overlaps${RESET} (${overlaps.length})\n`);
  for (const o of overlaps) log(`  ${YELLOW}${o.keyword}${RESET} → ${o.entries.join(", ")}`);
  log("");
}

export function kernelBudget(args: string[]): void {
  const pos = positionalArgs(args);
  if (pos.length < 1) fail("MISSING_ARG", "Usage: loadout-os budget <index> [jsonl]");
  const index = loadKernelIndex(pos[0]);
  const usage = pos.length >= 2 ? summarizeUsage(readUsage(resolve(pos[1]))) : undefined;
  const breakdown = analyzeBudget(index, usage);
  const json = hasFlag(args, "json");
  if (json) {
    log(JSON.stringify(breakdown, null, 2));
    return;
  }
  log(`\n${BOLD}Token Budget Breakdown${RESET}\n`);
  log(`  Total:  ${breakdown.totalTokens.toLocaleString()} tokens`);
  log(`  Core:   ${breakdown.coreTokens.toLocaleString()} (${breakdown.coreEntries}) · Domain: ${breakdown.domainTokens.toLocaleString()} (${breakdown.domainEntries}) · Manual: ${breakdown.manualTokens.toLocaleString()} (${breakdown.manualEntries})`);
  if (breakdown.observedAvg !== null) log(`  ${GREEN}Observed avg load:${RESET} ${breakdown.observedAvg.toLocaleString()} tokens/load`);
  log("");
}

export function kernelValidate(args: string[]): void {
  const pos = positionalArgs(args);
  if (pos.length < 1) fail("MISSING_ARG", "Usage: loadout-os validate <index>");
  const index = loadKernelIndex(pos[0]);
  const issues = validateIndex(index);
  const json = hasFlag(args, "json");
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  if (json) {
    log(JSON.stringify({ valid: errors.length === 0, errors: errors.length, warnings: warnings.length, issues }, null, 2));
    if (errors.length > 0) fail("VALIDATION_FAILED", `${errors.length} error(s)`, undefined, 1);
    return;
  }
  if (issues.length === 0) {
    ok(`Index is valid (${index.entries.length} entries)`);
    return;
  }
  log(`\n${BOLD}Validation Results${RESET}\n`);
  for (const i of errors) {
    log(`  ${RED}✗ [${i.code}]${RESET} ${i.message}`);
    if (i.hint) log(`    ${DIM}${i.hint}${RESET}`);
  }
  for (const i of warnings) warn(`[${i.code}] ${i.message}`);
  log(`\n  ${errors.length} error(s), ${warnings.length} warning(s)`);
  if (errors.length > 0) fail("VALIDATION_FAILED", `${errors.length} error(s)`, undefined, 1);
}
