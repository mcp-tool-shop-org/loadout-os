#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cmdAnalyze } from "./analyze.js";
import { cmdSplit } from "./split.js";
import { cmdValidate } from "./validate.js";
import { cmdStats } from "./stats.js";
import { cmdInitSignals } from "./signals.js";

// ── Package metadata ───────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");
const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8"));
const VERSION: string = pkg.version;

// ── Colors ─────────────────────────────────────────────────────
export const BOLD = "\x1b[1m";
export const GREEN = "\x1b[32m";
export const YELLOW = "\x1b[33m";
export const RED = "\x1b[31m";
export const CYAN = "\x1b[36m";
export const DIM = "\x1b[2m";
export const RESET = "\x1b[0m";

export function log(msg: string): void {
  console.log(msg);
}
export function ok(msg: string): void {
  log(`${GREEN}✓${RESET} ${msg}`);
}
export function warn(msg: string): void {
  log(`${YELLOW}!${RESET} ${msg}`);
}
export function skip(msg: string): void {
  log(`${DIM}  skip${RESET} ${msg}`);
}
export function info(msg: string): void {
  log(`${CYAN}i${RESET} ${msg}`);
}

// ── Structured error + exit ────────────────────────────────────
export function fail(
  code: string,
  message: string,
  hint: string,
  exitCode = 1,
): never {
  console.error(`${RED}Error [${code}]:${RESET} ${message}`);
  console.error(`${DIM}Hint: ${hint}${RESET}`);
  process.exit(exitCode);
}

// ── Flag parsing helpers ───────────────────────────────────────
export function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

export function flagValue(
  args: string[],
  flag: string,
): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

// Every flag in the CLI surface that consumes the following argument as its
// value. Kept here as the single source of truth so positionalArgs can always
// skip a value-flag's argument even if a caller forgets to list it — otherwise
// `--rules-dir foo path` would mis-parse `foo` as a positional.
const VALUE_FLAGS = ["--rules-dir", "--signals"];
// Boolean flags take no argument.
const BOOL_FLAGS = ["--memory", "--dry-run", "--help", "-h", "--yes", "--lazy", "--json"];

export function positionalArgs(
  args: string[],
  flags: string[],
): string[] {
  const flagIndices = new Set<number>();
  // Union of the caller-supplied value-flags and the known CLI value-flags,
  // so a value-flag's argument can never be mis-parsed as a positional.
  const valueFlags = new Set([...flags, ...VALUE_FLAGS]);
  for (let i = 0; i < args.length; i++) {
    if (valueFlags.has(args[i])) {
      flagIndices.add(i);
      flagIndices.add(i + 1); // skip the flag's value (if present)
    } else if (BOOL_FLAGS.includes(args[i])) {
      flagIndices.add(i);
    }
  }
  return args.filter((_, i) => !flagIndices.has(i) && !args[i].startsWith("--"));
}

// ── Help text ──────────────────────────────────────────────────
function helpCommand(): void {
  log(`
${BOLD}claude-rules${RESET} v${VERSION}
Dispatch table generator and instruction-file optimizer for Claude Code.

${BOLD}Usage:${RESET}
  claude-rules <command> [options]

${BOLD}Commands:${RESET}
  analyze [path]    Score sections, propose splits, show token budget
  split [path]      Interactive extraction → rule files + index.json
  validate [path]   Lint rules: refs, orphans, drift, invariants
  stats [path]      Token budget dashboard with savings %
  init-signals      Generate a default signals.json for customizing scoring
  help              Show this help message

${BOLD}Options:${RESET}
  --memory          Also process MEMORY.md (analyze, split)
  --dry-run         Show what would be generated without writing (split)
  --yes             Accept all proposals without prompting (split)
  --lazy            Lazy-load rules: store in .claude/loadout/ (not auto-loaded)
  --json            Machine-readable JSON output (stats)
  --signals <path>  Custom signals config path (default: .claude/signals.json)
  --rules-dir <p>   Custom rules directory (default: .claude/rules/)
  --version         Show version

${BOLD}Examples:${RESET}
  claude-rules analyze
  claude-rules analyze .claude/CLAUDE.md
  claude-rules split --dry-run
  claude-rules split --yes
  claude-rules split --lazy
  claude-rules init-signals
  claude-rules validate
  claude-rules stats

${DIM}https://github.com/mcp-tool-shop-org/claude-rules${RESET}
`);
}

// ── Main dispatch ──────────────────────────────────────────────
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    helpCommand();
    return;
  }

  if (cmd === "--version" || cmd === "-V") {
    log(`claude-rules ${VERSION}`);
    return;
  }

  const cmdArgs = args.slice(1);

  switch (cmd) {
    case "analyze":
      await cmdAnalyze(cmdArgs);
      break;
    case "split":
      await cmdSplit(cmdArgs);
      break;
    case "validate":
      await cmdValidate(cmdArgs);
      break;
    case "stats":
      await cmdStats(cmdArgs);
      break;
    case "init-signals":
      await cmdInitSignals(cmdArgs);
      break;
    default:
      fail(
        "INPUT_UNKNOWN_COMMAND",
        `Unknown command: ${cmd}`,
        "Run 'claude-rules help' to see available commands",
      );
  }
}

main().catch((err: Error) => {
  fail("RUNTIME_FATAL", err.message, "This is a bug. Please report it.", 2);
});
