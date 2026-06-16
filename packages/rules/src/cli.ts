#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cmdAnalyze } from "./analyze.js";
import { cmdSplit } from "./split.js";
import { cmdValidate } from "./validate.js";
import { cmdStats } from "./stats.js";
import { cmdInitSignals } from "./signals.js";
import { log, fail, BOLD, DIM, RESET } from "./console.js";

// ── Package metadata ───────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");
const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8"));
const VERSION: string = pkg.version;

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
  --lazy            Lazy-load rules: use .claude/loadout/ (split, validate, stats)
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

// ── Entrypoint guard ───────────────────────────────────────────
// Only run the CLI when this module is executed directly as a binary
// (`claude-rules ...` / `node dist/cli.js ...`), NOT when imported. The library
// barrel (src/index.ts) re-exports the pure logic modules, which import shared
// helpers from ./console.js — but the dispatch chain still reaches cli.ts via
// the bin. Without this guard, `import "@mcptoolshop/claude-rules"` would parse
// argv and run a command as an import side effect.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((err: Error) => {
    fail("RUNTIME_FATAL", err.message, "This is a bug. Please report it.", 2);
  });
}
