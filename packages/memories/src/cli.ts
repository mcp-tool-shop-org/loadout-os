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

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
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
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  const next = args[idx + 1];
  // MEM-B05: a flag's value must be an actual value, not the next flag.
  // `index --out --lazy` used to silently take "--lazy" as the --out path and
  // write a file literally named "--lazy". If the next token is itself a flag,
  // the user forgot the value — bail loudly with an actionable hint rather than
  // doing something surprising and destructive on disk.
  if (next.startsWith("--")) {
    fail(
      "MISSING_FLAG_VALUE",
      `--${flag} is missing its value`,
      `--${flag} needs a path, e.g. --${flag} memory/index.json`,
    );
  }
  return next;
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

/**
 * Is `p` an existing regular file?
 *
 * MEM-B02: existsSync() is true for directories too, so a matched directory
 * sailed straight into readFileSync() and blew up with a raw EISDIR. Resolution
 * must confirm the path is a *file* before handing it downstream.
 */
function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function resolveMemoryMd(args: string[]): string {
  const positional = positionalArgs(args);
  if (positional.length > 0) {
    const p = resolve(positional[0]);
    if (!existsSync(p)) {
      fail("FILE_NOT_FOUND", `File not found: ${positional[0]}`);
    }
    // MEM-B02: an explicit path that points at a directory is a user mistake we
    // can name precisely — far kinder than a downstream EISDIR stack trace.
    if (!isFile(p)) {
      fail(
        "NOT_A_FILE",
        `Not a file: ${positional[0]}`,
        "point at a MEMORY.md file, not a directory",
      );
    }
    return p;
  }

  // Auto-detect common locations. Note the ~/.claude/projects candidate is a
  // directory — MEM-B02: it must be skipped as a candidate (isFile guard),
  // never returned, or auto-detect would feed a directory into readFileSync.
  const candidates = [
    "MEMORY.md",
    ".claude/MEMORY.md",
    join(process.env.HOME ?? process.env.USERPROFILE ?? "", ".claude", "projects"),
  ];

  for (const c of candidates) {
    const p = resolve(c);
    if (isFile(p)) return p;
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

  // MEM-B03: render the unresolved-ref summary HERE (the CLI), not in the
  // library. generateIndex records every skipped ref in analysis.missingFiles
  // (data, not stderr noise), so a single human-readable line belongs at the
  // command boundary. Detail (which files, which lines) lives in `validate`.
  if (analysis.missingFiles.length > 0) {
    const n = analysis.missingFiles.length;
    warn(`${n} unresolved ref${n === 1 ? "" : "s"} skipped — run \`validate\` for detail`);
  }

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

/**
 * Classify a thrown error into a structured (code, hint) pair.
 *
 * MEM-B01: command handlers (and the libraries they call, e.g. analyzeMemoryMd
 * throwing "Cannot read MEMORY.md at …") can throw a plain Error. Without this,
 * the throw escaped `main` as an unhandled rejection and the user saw a raw V8
 * stack trace — a Gate-B violation. We map known failure shapes to a real code
 * + actionable hint and exit cleanly via the existing structured `fail`.
 */
function classifyError(err: unknown): { code: string; message: string; hint?: string } {
  const message = err instanceof Error ? err.message : String(err);
  // Read failures surface from analyzeMemoryMd ("Cannot read MEMORY.md at …")
  // and from any readFileSync on a topic file. EISDIR means a directory slipped
  // through as a path despite the resolve guard.
  if (/EISDIR/.test(message) || /Cannot read MEMORY\.md/.test(message)) {
    return {
      code: "READ_FAILED",
      message,
      hint: "check the path exists, is a file, and is readable",
    };
  }
  if (/EACCES|EPERM|ENOENT/.test(message)) {
    // Could be either read or write depending on the op; bias to the command.
    const isWrite = cmd === "index";
    return isWrite
      ? { code: "WRITE_FAILED", message, hint: "check the output directory is writable" }
      : { code: "READ_FAILED", message, hint: "check the path exists and is readable" };
  }
  if (cmd === "index") {
    return { code: "WRITE_FAILED", message, hint: "check the output path and directory permissions" };
  }
  return { code: "READ_FAILED", message, hint: "check the input file and try again" };
}

/**
 * Run a command handler, routing any escaping error through structured `fail`.
 * MEM-B01: this single wrapper guarantees no command throws a raw stack.
 */
async function runCommand(fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
  } catch (err) {
    const { code, message, hint } = classifyError(err);
    fail(code, message, hint);
  }
}

switch (cmd) {
  case "analyze":
    await runCommand(() => cmdAnalyze(cmdArgs));
    break;
  case "index":
    await runCommand(() => cmdIndex(cmdArgs));
    break;
  case "validate":
    await runCommand(() => cmdValidate(cmdArgs));
    break;
  case "stats":
    await runCommand(() => cmdStats(cmdArgs));
    break;
  case "health":
    await runCommand(() => cmdHealth());
    break;
  default:
    fail("UNKNOWN_COMMAND", `Unknown command: ${cmd}`, "Run claude-memories --help for usage");
}
