#!/usr/bin/env node

/**
 * loadout-os — the unified Knowledge OS CLI.
 *
 * One binary that wraps the three library packages (kernel = ai-loadout,
 * memories = claude-memories, rules = claude-rules) and absorbs the operational
 * rituals (doctor / report / hook / refresh).
 *
 * Command tree:
 *   loadout-os memories <index|validate|stats|health|sync-summaries|place|move> <MEMORY.md>
 *   loadout-os rules    <analyze|validate|stats|split> [CLAUDE.md]   (namespaced)
 *   loadout-os resolve|explain|usage|dead|overlaps|budget|validate   (flat → kernel)
 *   loadout-os doctor [--json]                                       (ritual, read-only)
 *   loadout-os report  [--jsonl <p>] [--index <p>] [--json]          (ritual, read-only)
 *   loadout-os hook <test|session-start|pre-compact> [...]           (runtime hooks)
 *   loadout-os refresh [--store <d>] [--dest <p>] [--project <r>] [--dry-run]
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
  memoriesSyncSummaries,
  memoriesPlace,
  memoriesMove,
  rulesAnalyze,
  rulesValidate,
  rulesStats,
  rulesSplit,
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
import {
  runHookTest,
  printHookTest,
  defaultHookPath,
  runSessionStart,
  runPostWrite,
  writeUtf8Stdout,
  readHookStdin,
} from "./hook.js";
import { dispatchRefresh } from "./refresh.js";
import { interceptHelp } from "./help.js";

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
  loadout-os memories <index|validate|stats|health|sync-summaries|place|move> <MEMORY.md>
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
  loadout-os hook session-start [--project <r>]    SessionStart board injection & stale warning
  loadout-os hook pre-compact [--project <r>]      PreCompact board staleness check
  loadout-os hook post-write [--project <r>]       PostToolUse Write/Edit validator & project refresh
  loadout-os refresh [--store <d>] [--dest <p>] [--project <r>] [--dry-run]   Index Freshness Ritual

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

  loadout-os memories index <MEMORY.md> [--id-source title|name] [--lazy] [--json]
  loadout-os memories validate <MEMORY.md> [--id-source title|name] [--max-lines <n>] [--max-bytes <n>] [--json]
  loadout-os memories stats <MEMORY.md> [--id-source title|name] [--json]
  loadout-os memories health [path] [--json]
  loadout-os memories sync-summaries <MEMORY.md> [--fix] [--json]
  loadout-os memories place <topic.md> <index> [--store <dir>] [--into <index>] [--json]
  loadout-os memories move <topic.md> <index> [--store <dir>] [--into <index>] [--json]
`;
}

function rulesHelp(): string {
  return `
${BOLD}loadout-os rules${RESET} — wraps @mcptoolshop/claude-rules

  loadout-os rules analyze <CLAUDE.md> [--rules-dir <dir>] [--json]
  loadout-os rules validate [--rules-dir <dir>] [--lazy] [--repo-root <dir>] [--json]
  loadout-os rules stats <CLAUDE.md> [--rules-dir <dir>] [--json]
  loadout-os rules split [CLAUDE.md] [--yes] [--dry-run]   (interactive — passes through to claude-rules)
`;
}

// ── Namespace dispatchers ─────────────────────────────────────
function dispatchMemories(args: string[]): void {
  const firstIsSub = args.length > 0 && !args[0].startsWith("-");
  if (args.length === 0 || (hasFlag(args, "help") && !firstIsSub)) {
    log(memoriesHelp());
    return;
  }
  const sub = args[0];
  const rest = args.slice(1);
  if (interceptHelp(`memories ${sub}`, rest)) return;
  switch (sub) {
    case "index":
      return memoriesIndex(rest);
    case "validate":
      return memoriesValidate(rest);
    case "stats":
      return memoriesStats(rest);
    case "health":
      return memoriesHealth(rest);
    case "sync-summaries":
      return memoriesSyncSummaries(rest);
    case "place":
      return memoriesPlace(rest);
    case "move":
      return memoriesMove(rest);
    default:
      throw new CliError(
        "UNKNOWN_COMMAND",
        `Unknown memories subcommand: ${sub}`,
        "Expected one of: index, validate, stats, health, sync-summaries, place, move. Run 'loadout-os memories --help'.",
      );
  }
}

function dispatchRules(args: string[]): void {
  const firstIsSub = args.length > 0 && !args[0].startsWith("-");
  if (args.length === 0 || (hasFlag(args, "help") && !firstIsSub)) {
    log(rulesHelp());
    return;
  }
  const sub = args[0];
  const rest = args.slice(1);
  if (interceptHelp(`rules ${sub}`, rest)) return;
  switch (sub) {
    case "analyze":
      return rulesAnalyze(rest);
    case "validate":
      return rulesValidate(rest);
    case "stats":
      return rulesStats(rest);
    case "split":
      return rulesSplit(rest);
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
  const rest = args.slice(1);
  if (sub && interceptHelp(`hook ${sub}`, rest)) return;
  if (interceptHelp("hook test", args)) return;

  switch (sub) {
    case "test": {
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
      return;
    }
    case "session-start":
    case "pre-compact": {
      const stdinRaw = readHookStdin();
      let payloadCwd: string | undefined;
      let isPromptSubmitPayload = false;
      if (stdinRaw.trim()) {
        try {
          const parsed = JSON.parse(stdinRaw) as Record<string, unknown>;
          if (typeof parsed.cwd === "string" && parsed.cwd) {
            payloadCwd = parsed.cwd;
          }
          if (parsed.hook_event_name === "UserPromptSubmit") {
            isPromptSubmitPayload = true;
          }
        } catch {
          // ignore non-JSON stdin
        }
      }
      const project = flagValue(rest, "project");
      const store = flagValue(rest, "store");
      const maxLinesRaw = flagValue(rest, "max-lines");
      const maxBytesRaw = flagValue(rest, "max-bytes");
      const staleMinRaw = flagValue(rest, "stale-after-min");
      const maxLines = maxLinesRaw !== undefined ? Number(maxLinesRaw) : undefined;
      const maxBytes = maxBytesRaw !== undefined ? Number(maxBytesRaw) : undefined;
      const staleAfterMin = staleMinRaw !== undefined ? Number(staleMinRaw) : undefined;

      const res = runSessionStart({
        project,
        store,
        cwd: payloadCwd,
        userPromptSubmit: hasFlag(rest, "user-prompt-submit") || isPromptSubmitPayload,
        preCompact: sub === "pre-compact",
        maxLines: Number.isFinite(maxLines) ? maxLines : undefined,
        maxBytes: Number.isFinite(maxBytes) ? maxBytes : undefined,
        staleAfterMin: Number.isFinite(staleAfterMin) ? staleAfterMin : undefined,
      });

      if (hasFlag(rest, "json")) {
        log(JSON.stringify(res, null, 2));
      } else if (res.output) {
        writeUtf8Stdout(res.output);
      }
      return;
    }
    case "post-write": {
      const stdinRaw = readHookStdin();
      const project = flagValue(rest, "project");
      const store = flagValue(rest, "store");
      const filePath = flagValue(rest, "file");
      const snapshotRepo = flagValue(rest, "snapshot-repo");
      const mirrorRepo = flagValue(rest, "mirror-repo");
      const timeoutRaw = flagValue(rest, "timeout-ms");
      const gitTimeoutMs = timeoutRaw !== undefined ? Number(timeoutRaw) : undefined;

      const res = runPostWrite({
        project,
        store,
        filePath,
        stdinJson: stdinRaw,
        fixSummaries: hasFlag(rest, "fix"),
        snapshotRepo,
        mirrorRepo,
        gitTimeoutMs: Number.isFinite(gitTimeoutMs) ? gitTimeoutMs : undefined,
      });

      if (res.exitCode !== 0) {
        if (res.stderr) {
          process.stderr.write(Buffer.from(res.stderr, "utf-8"));
        }
        process.exitCode = 2;
      }
      return;
    }
    default:
      throw new CliError(
        "UNKNOWN_COMMAND",
        `Unknown hook subcommand: ${sub ?? "(none)"}`,
        "Expected one of: test, session-start, pre-compact, post-write.",
      );
  }
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
    log(getVersion());
    return;
  }

  const firstIsCmd = args.length > 0 && !args[0].startsWith("-");
  if (args.length === 0 || (hasFlag(args, "help") && !firstIsCmd)) {
    log(topLevelHelp());
    return;
  }

  const cmd = args[0];
  const rest = args.slice(1);

  if (
    cmd !== "memories" &&
    cmd !== "rules" &&
    cmd !== "hook" &&
    interceptHelp(cmd, rest)
  ) {
    return;
  }

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
      return dispatchRefresh(rest);
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
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${RED}✗ [RUNTIME_FATAL]${RESET} ${message}`);
    process.exit(1);
  }
}
