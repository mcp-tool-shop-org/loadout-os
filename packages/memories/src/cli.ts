#!/usr/bin/env node

/**
 * claude-memories CLI.
 *
 * Commands:
 *   analyze   — Analyze MEMORY.md structure and references
 *   index     — Generate dispatch table from MEMORY.md
 *   validate  — Lint memory files for issues
 *   stats     — Token budget dashboard
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeMemoryMd } from "./analyze.js";
import { generateIndex } from "./index-gen.js";
import { validateMemory, validateMemoryIndex } from "./validate.js";
import { generateStats, formatStats } from "./stats.js";

// ── Colors ────────────────────────────────────────────────────
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function log(msg: string) { console.log(msg); }
function ok(msg: string) { log(`  ${GREEN}✓${RESET} ${msg}`); }
function warn(msg: string) { log(`  ${YELLOW}!${RESET} ${msg}`); }
function info(msg: string) { log(`  ${CYAN}i${RESET} ${msg}`); }

function fail(code: string, message: string, hint?: string): never {
  console.error(`${RED}✗ [${code}]${RESET} ${message}`);
  if (hint) console.error(`  ${DIM}${hint}${RESET}`);
  process.exit(1);
}

// ── Flag parsing ──────────────────────────────────────────────
function hasFlag(args: string[], flag: string): boolean {
  return args.includes(`--${flag}`);
}

function flagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(`--${flag}`);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function positionalArgs(args: string[]): string[] {
  return args.filter((a) => !a.startsWith("--"));
}

// ── Version ───────────────────────────────────────────────────
function getVersion(): string {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));
    return pkg.version;
  } catch {
    return "unknown";
  }
}

// ── Help ──────────────────────────────────────────────────────
function printHelp() {
  log(`
${BOLD}claude-memories${RESET} v${getVersion()} — MEMORY.md optimizer for Claude Code

${BOLD}Usage:${RESET}
  claude-memories analyze [path]     Analyze MEMORY.md structure
  claude-memories index [path]       Generate dispatch table
  claude-memories validate [path]    Lint memory files
  claude-memories stats [path]       Token budget dashboard
  claude-memories health              Check installation and detect MEMORY.md

${BOLD}Options:${RESET}
  --lazy          Mark index for lazy loading
  --out <path>    Output path for index.json (default: memory/index.json)
  --help          Show this help
  --version       Show version

${BOLD}Examples:${RESET}
  claude-memories analyze MEMORY.md
  claude-memories index MEMORY.md --lazy
  claude-memories validate MEMORY.md
  claude-memories stats MEMORY.md
`);
}

// ── Resolve MEMORY.md ─────────────────────────────────────────
function resolveMemoryMd(args: string[]): string {
  const positional = positionalArgs(args);
  if (positional.length > 0) {
    const p = resolve(positional[0]);
    if (existsSync(p)) return p;
    fail("FILE_NOT_FOUND", `File not found: ${positional[0]}`);
  }

  // Auto-detect common locations
  const candidates = [
    "MEMORY.md",
    ".claude/MEMORY.md",
    join(process.env.HOME ?? process.env.USERPROFILE ?? "", ".claude", "projects"),
  ];

  for (const c of candidates) {
    const p = resolve(c);
    if (existsSync(p)) return p;
  }

  fail(
    "NO_MEMORY_MD",
    "Could not find MEMORY.md",
    "Provide a path: claude-memories analyze <path>",
  );
}

// ── Commands ──────────────────────────────────────────────────

async function cmdAnalyze(args: string[]) {
  const filePath = resolveMemoryMd(args);
  log(`\n${BOLD}Analyzing${RESET} ${filePath}\n`);

  const analysis = analyzeMemoryMd(filePath);

  log(`${BOLD}Sections:${RESET} ${analysis.sections.length}`);
  for (const section of analysis.sections) {
    log(`  ${"#".repeat(section.level)} ${section.heading} (${section.entries.length} refs)`);
  }

  log(`\n${BOLD}References:${RESET} ${analysis.refs.length}`);
  for (const ref of analysis.refs) {
    ok(`${ref.name} → ${ref.path}`);
  }

  if (analysis.missingFiles.length > 0) {
    log(`\n${BOLD}Missing files:${RESET}`);
    for (const f of analysis.missingFiles) {
      warn(`${f}`);
    }
  }

  if (analysis.orphanFiles.length > 0) {
    log(`\n${BOLD}Orphan files:${RESET} (not in MEMORY.md)`);
    for (const f of analysis.orphanFiles) {
      info(`${f}`);
    }
  }

  log(`\n${BOLD}Tokens:${RESET}`);
  log(`  MEMORY.md inline:  ${analysis.inlineTokens.toLocaleString()}`);
  log(`  Topic files total: ${analysis.topicTokens.toLocaleString()}`);
  log(`  Combined:          ${analysis.totalTokens.toLocaleString()}`);
  log("");
}

async function cmdIndex(args: string[]) {
  const filePath = resolveMemoryMd(args);
  const lazyLoad = hasFlag(args, "lazy");
  const outPath = flagValue(args, "out") ?? join(dirname(filePath), "memory", "index.json");

  log(`\n${BOLD}Generating index${RESET} from ${filePath}\n`);

  const analysis = analyzeMemoryMd(filePath);
  const index = generateIndex(analysis, { lazyLoad });

  // Write index
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(index, null, 2) + "\n");
  ok(`Index written: ${outPath} (${index.entries.length} entries)`);

  // Validate
  const issues = validateMemoryIndex(index);
  if (issues.length > 0) {
    log("");
    for (const issue of issues) {
      if (issue.severity === "error") {
        warn(`[${issue.code}] ${issue.message}`);
      } else {
        info(`[${issue.code}] ${issue.message}`);
      }
    }
  }

  log(`\n${BOLD}Budget:${RESET}`);
  log(`  Always loaded:   ${index.budget.always_loaded_est.toLocaleString()} tokens`);
  log(`  On-demand total: ${index.budget.on_demand_total_est.toLocaleString()} tokens`);
  log(`  Avg task load:   ${index.budget.avg_task_load_est.toLocaleString()} tokens`);
  if (lazyLoad) info("Lazy loading enabled");
  log("");
}

async function cmdValidate(args: string[]) {
  const filePath = resolveMemoryMd(args);

  log(`\n${BOLD}Validating${RESET} ${filePath}\n`);

  const analysis = analyzeMemoryMd(filePath);
  const memoryIssues = validateMemory(analysis);

  // Also generate and validate the index
  const index = generateIndex(analysis);
  const indexIssues = validateMemoryIndex(index);

  const allIssues = [...memoryIssues, ...indexIssues];
  const errors = allIssues.filter((i) => i.severity === "error");
  const warnings = allIssues.filter((i) => i.severity === "warning");

  if (errors.length > 0) {
    log(`${RED}${BOLD}Errors:${RESET}`);
    for (const issue of errors) {
      log(`  ${RED}✗${RESET} [${issue.code}] ${issue.message}`);
      if (issue.hint) log(`    ${DIM}${issue.hint}${RESET}`);
    }
  }

  if (warnings.length > 0) {
    log(`${YELLOW}${BOLD}Warnings:${RESET}`);
    for (const issue of warnings) {
      log(`  ${YELLOW}!${RESET} [${issue.code}] ${issue.message}`);
      if (issue.hint) log(`    ${DIM}${issue.hint}${RESET}`);
    }
  }

  if (allIssues.length === 0) {
    ok("No issues found");
  }

  log(`\n  ${errors.length} errors, ${warnings.length} warnings\n`);

  if (errors.length > 0) process.exit(1);
}

async function cmdStats(args: string[]) {
  const filePath = resolveMemoryMd(args);

  const analysis = analyzeMemoryMd(filePath);
  const index = generateIndex(analysis);
  const stats = generateStats(analysis, index);

  log("");
  log(formatStats(stats));
  log("");
}

async function cmdHealth() {
  const version = getVersion();
  const nodeMajor = parseInt(process.version.slice(1), 10);
  const nodeOk = nodeMajor >= 20;

  log(`\n${BOLD}claude-memories${RESET} v${version}`);
  log(`  Node.js: ${process.version} ${nodeOk ? `${GREEN}(OK)${RESET}` : `${RED}(requires >=20)${RESET}`}`);
  log(`  Platform: ${process.platform} ${process.arch}`);

  // Check for MEMORY.md in common locations
  const locations = [
    { label: "cwd/MEMORY.md", path: resolve("MEMORY.md") },
    { label: ".claude/MEMORY.md", path: resolve(".claude", "MEMORY.md") },
  ];

  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (home) {
    locations.push({
      label: "~/.claude/projects",
      path: join(home, ".claude", "projects"),
    });
  }

  log(`\n${BOLD}MEMORY.md detection:${RESET}`);
  let found = false;
  for (const loc of locations) {
    if (existsSync(loc.path)) {
      ok(`${loc.label} → ${loc.path}`);
      found = true;
    } else {
      info(`${loc.label} — not found`);
    }
  }
  if (!found) {
    warn("No MEMORY.md detected. Provide a path when running commands.");
  }

  log(`\n${BOLD}Available commands:${RESET} analyze, index, validate, stats, health\n`);

  if (!nodeOk) process.exit(1);
}

// ── Main ──────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (hasFlag(args, "version")) {
  log(getVersion());
  process.exit(0);
}

if (hasFlag(args, "help") || args.length === 0) {
  printHelp();
  process.exit(0);
}

const cmd = args[0];
const cmdArgs = args.slice(1);

switch (cmd) {
  case "analyze":
    await cmdAnalyze(cmdArgs);
    break;
  case "index":
    await cmdIndex(cmdArgs);
    break;
  case "validate":
    await cmdValidate(cmdArgs);
    break;
  case "stats":
    await cmdStats(cmdArgs);
    break;
  case "health":
    await cmdHealth();
    break;
  default:
    fail("UNKNOWN_COMMAND", `Unknown command: ${cmd}`, "Run claude-memories --help for usage");
}
