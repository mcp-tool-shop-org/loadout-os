#!/usr/bin/env node

/**
 * loadout-os — the unified Knowledge OS CLI.
 *
 * One binary that wraps the three library packages (kernel = ai-loadout,
 * memories = claude-memories, rules = claude-rules) and absorbs the operational
 * rituals (doctor / report / hook test; refresh is stubbed this wave).
 *
 * Command tree:
 *   loadout-os memories <index|validate|stats|health> <MEMORY.md>   (namespaced)
 *   loadout-os rules    <analyze|validate|stats|split> [CLAUDE.md]   (namespaced)
 *   loadout-os resolve|explain|usage|dead|overlaps|budget|validate   (flat → kernel)
 *   loadout-os doctor [--json]                                       (ritual, read-only)
 *   loadout-os report  [--jsonl <p>] [--index <p>] [--json]          (ritual, read-only)
 *   loadout-os hook test [--prompt "<text>"]                         (read-only)
 *   loadout-os refresh                                               (STUB this wave)
 *   loadout-os --help | --version
 *
 * The flat `validate <index>` is the KERNEL index-structure validator; the
 * namespaced `memories validate` / `rules validate` are the store/rules linters
 * — flat-vs-namespaced is exactly how the name collision is resolved.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

import {
  BOLD,
  DIM,
  RESET,
  RED,
  YELLOW,
  log,
  hasFlag,
  flagValue,
  CliError,
} from "./console.js";

import {
  memoriesIndex,
  memoriesValidate,
  memoriesStats,
  memoriesHealth,
  rulesAnalyze,
  rulesValidate,
  rulesStats,
  rulesSplitNotice,
  kernelResolve,
  kernelExplain,
  kernelUsage,
  kernelDead,
  kernelOverlaps,
  kernelBudget,
  kernelValidate,
} from "./commands.js";

import { runDoctor, printDoctor, defaultDoctorPaths } from "./doctor.js";
import { buildReport, printReport } from "./report.js";
import { runHookTest, printHookTest, defaultHookPath } from "./hook.js";

// ── Version ───────────────────────────────────────────────────
export function getVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf-8"));
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

// ── Help ──────────────────────────────────────────────────────
export function topLevelHelp(): string {
  return `
${BOLD}loadout-os${RESET} v${getVersion()} — unified Knowledge OS CLI

${BOLD}Namespaces (wrapped library surfaces):${RESET}
  loadout-os memories <index|validate|stats|health> <MEMORY.md>
  loadout-os rules    <analyze|validate|stats|split> [CLAUDE.md]

${BOLD}Flat verbs (knowledge router / kernel):${RESET}
  loadout-os resolve                 Resolve layered loadouts (global → org → project → session)
  loadout-os explain <entry-id>      Explain how an entry resolved across layers
  loadout-os usage <jsonl>           Usage summary from the event log
  loadout-os dead <index> <jsonl>    Entries never loaded
  loadout-os overlaps <index>        Keyword routing ambiguities
  loadout-os budget <index> [jsonl]  Token budget breakdown
  loadout-os validate <index>        Validate index STRUCTURE (kernel)

${BOLD}Rituals:${RESET}
  loadout-os doctor [--json]                       Read-only health screen
  loadout-os report [--index <p>] [--jsonl <p>]    Observability over usage.jsonl
  loadout-os hook test [--prompt "<text>"]         Drive the runtime hook on a sample prompt
  loadout-os refresh                               (not yet implemented — use the Index Freshness Ritual)

${BOLD}Options:${RESET}
  --json       Machine-readable output (doctor/report/most verbs)
  --help       Show this help (or per-namespace: 'loadout-os memories --help')
  --version    Show version

${BOLD}Examples:${RESET}
  loadout-os memories validate ~/.claude/projects/F--AI/memory/MEMORY.md
  loadout-os rules analyze .claude/CLAUDE.md
  loadout-os validate ~/.ai-loadout/index.json
  loadout-os doctor
  loadout-os report --json
  loadout-os hook test --prompt "scaffold a new game"
`;
}

function memoriesHelp(): string {
  return `
${BOLD}loadout-os memories${RESET} — wraps @mcptoolshop/claude-memories

  loadout-os memories index <MEMORY.md> [--lazy] [--json]
  loadout-os memories validate <MEMORY.md> [--json]
  loadout-os memories stats <MEMORY.md> [--json]
  loadout-os memories health [path] [--json]
`;
}

function rulesHelp(): string {
  return `
${BOLD}loadout-os rules${RESET} — wraps @mcptoolshop/claude-rules

  loadout-os rules analyze <CLAUDE.md> [--rules-dir <dir>] [--json]
  loadout-os rules validate [--rules-dir <dir>] [--lazy] [--repo-root <dir>] [--json]
  loadout-os rules stats <CLAUDE.md> [--rules-dir <dir>] [--json]
  loadout-os rules split    (interactive — not wrapped; use the claude-rules bin)
`;
}

// ── Namespace dispatchers ─────────────────────────────────────
function dispatchMemories(args: string[]): void {
  if (hasFlag(args, "help") || args.length === 0) {
    log(memoriesHelp());
    return;
  }
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case "index":
      return memoriesIndex(rest);
    case "validate":
      return memoriesValidate(rest);
    case "stats":
      return memoriesStats(rest);
    case "health":
      return memoriesHealth(rest);
    default:
      throw new CliError(
        "UNKNOWN_COMMAND",
        `Unknown memories subcommand: ${sub}`,
        "Expected one of: index, validate, stats, health. Run 'loadout-os memories --help'.",
      );
  }
}

function dispatchRules(args: string[]): void {
  if (hasFlag(args, "help") || args.length === 0) {
    log(rulesHelp());
    return;
  }
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case "analyze":
      return rulesAnalyze(rest);
    case "validate":
      return rulesValidate(rest);
    case "stats":
      return rulesStats(rest);
    case "split":
      return rulesSplitNotice();
    default:
      throw new CliError(
        "UNKNOWN_COMMAND",
        `Unknown rules subcommand: ${sub}`,
        "Expected one of: analyze, validate, stats, split. Run 'loadout-os rules --help'.",
      );
  }
}

// ── Rituals ───────────────────────────────────────────────────
function dispatchDoctor(args: string[]): void {
  const repoRoot = flagValue(args, "repo-root") ?? process.cwd();
  const paths = defaultDoctorPaths(resolve(repoRoot));
  // Per-path overrides (all read-only).
  const store = flagValue(args, "store");
  const index = flagValue(args, "index");
  const settings = flagValue(args, "settings");
  const usage = flagValue(args, "usage");
  if (store) paths.store = resolve(store);
  if (index) paths.index = resolve(index);
  if (settings) paths.settings = resolve(settings);
  if (usage) paths.usage = resolve(usage);

  const result = runDoctor(paths);
  if (hasFlag(args, "json")) {
    log(JSON.stringify(result, null, 2));
  } else {
    printDoctor(result, paths);
  }
  if (!result.ok) {
    process.exitCode = 1;
  }
}

function dispatchReport(args: string[]): void {
  const home = homedir();
  const indexPath = resolve(flagValue(args, "index") ?? join(home, ".ai-loadout", "index.json"));
  const usagePath = resolve(flagValue(args, "jsonl") ?? join(home, ".ai-loadout", "usage.jsonl"));
  const result = buildReport(indexPath, usagePath);

  if (hasFlag(args, "json")) {
    log(JSON.stringify(result, null, 2));
  } else if (!result.ok && result.error) {
    log();
    log(`  ${RED}✗ [${result.error.code}]${RESET} ${result.error.message}`);
    log();
  } else {
    printReport(result);
  }
  if (!result.ok) {
    process.exitCode = 2; // inputs missing
  }
}

function dispatchHook(args: string[]): void {
  const sub = args[0];
  if (sub !== "test") {
    throw new CliError(
      "UNKNOWN_COMMAND",
      `Unknown hook subcommand: ${sub ?? "(none)"}`,
      "Only 'loadout-os hook test' is available.",
    );
  }
  const rest = args.slice(1);
  const prompt = flagValue(rest, "prompt") ?? "";
  const repoRoot = flagValue(rest, "repo-root") ?? process.cwd();
  const result = runHookTest({
    prompt,
    hookPath: defaultHookPath(resolve(repoRoot)),
  });
  if (hasFlag(rest, "json")) {
    log(JSON.stringify(result, null, 2));
  } else {
    printHookTest(prompt || "(default sample prompt)", result);
  }
  if (!result.ran) {
    process.exitCode = 1;
  }
}

function refreshStub(): void {
  log();
  log(`  ${YELLOW}!${RESET} ${BOLD}loadout-os refresh${RESET} is not yet implemented.`);
  log(`  ${DIM}It writes the live global index and needs a named compensator; deferred to a later wave.${RESET}`);
  log(`  ${DIM}For now, run the Index Freshness Ritual (claude-memories index → validate → copy to ~/.ai-loadout/index.json).${RESET}`);
  log();
}

// ── Main dispatch ─────────────────────────────────────────────
const FLAT_KERNEL = new Set([
  "resolve",
  "explain",
  "usage",
  "dead",
  "overlaps",
  "budget",
  "validate",
]);

/**
 * Pure dispatcher: routes argv (minus node/script) to the right handler.
 * Exported so tests can drive routing without spawning a process. Throws
 * CliError on failure; the process boundary catches + renders + exits.
 */
export function dispatch(args: string[]): void {
  if (hasFlag(args, "version") && args[0] !== "memories" && args[0] !== "rules") {
    // top-level --version only (a namespace --version would be ambiguous;
    // we treat it as top-level too for convenience)
    log(getVersion());
    return;
  }

  if (args.length === 0 || (hasFlag(args, "help") && !["memories", "rules"].includes(args[0]))) {
    log(topLevelHelp());
    return;
  }

  const cmd = args[0];
  const rest = args.slice(1);

  switch (cmd) {
    case "memories":
      return dispatchMemories(rest);
    case "rules":
      return dispatchRules(rest);
    case "doctor":
      return dispatchDoctor(rest);
    case "report":
      return dispatchReport(rest);
    case "hook":
      return dispatchHook(rest);
    case "refresh":
      return refreshStub();
    case "resolve":
      return kernelResolve(rest);
    case "explain":
      return kernelExplain(rest);
    case "usage":
      return kernelUsage(rest);
    case "dead":
      return kernelDead(rest);
    case "overlaps":
      return kernelOverlaps(rest);
    case "budget":
      return kernelBudget(rest);
    case "validate":
      return kernelValidate(rest);
    default:
      if (FLAT_KERNEL.has(cmd)) {
        // unreachable — kept for clarity if the set and switch ever diverge
        throw new CliError("INTERNAL", `Unrouted flat verb: ${cmd}`);
      }
      throw new CliError(
        "UNKNOWN_COMMAND",
        `Unknown command: ${cmd}`,
        "Run 'loadout-os --help' for the command tree.",
      );
  }
}

// ── Process boundary ──────────────────────────────────────────
function isEntrypoint(): boolean {
  try {
    return process.argv[1] === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  try {
    dispatch(process.argv.slice(2));
  } catch (err) {
    if (err instanceof CliError) {
      console.error(`${RED}✗ [${err.code}]${RESET} ${err.message}`);
      if (err.hint) console.error(`  ${DIM}${err.hint}${RESET}`);
      process.exit(err.exitCode);
    }
    // Unexpected — surface a structured shape, not a raw stack.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${RED}✗ [RUNTIME_FATAL]${RESET} ${message}`);
    process.exit(1);
  }
}
