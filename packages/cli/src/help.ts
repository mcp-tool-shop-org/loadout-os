/**
 * Per-command --help (shipcheck Hard Gate C: "--help accurate").
 *
 * The top-level / per-namespace help (cli.ts) lists the command TREE. This
 * module adds COMMAND-SPECIFIC help: synopsis, positional args with their
 * roles (esp. the `dead <index> <jsonl>` ordering foot-gun), flags, an example,
 * and exit codes — one entry per leaf command. The dispatcher calls
 * `interceptHelp(key, args)` before executing each command; when --help/-h is
 * present it prints the matching block and signals "handled" so the command
 * never runs.
 *
 * Keys are the fully-qualified command path: flat verbs are bare ("resolve"),
 * namespaced commands are "<ns> <cmd>" ("memories index"), rituals are bare
 * ("doctor", "refresh"), and hook is "hook test".
 */

import { BOLD, DIM, RESET, hasFlag, log } from "./console.js";

/** True if -h or --help appears anywhere in the command's args. */
export function wantsHelp(args: string[]): boolean {
  return hasFlag(args, "help") || args.includes("-h");
}

interface HelpEntry {
  synopsis: string;
  /** [name, role] pairs for positional args (order matters). */
  args?: [string, string][];
  /** [flag, role] pairs. */
  flags?: [string, string][];
  example: string;
  /** [code, meaning] pairs. */
  exits: [string, string][];
  /** Optional extra note (e.g. the dead-ordering foot-gun). */
  note?: string;
}

/**
 * The per-command registry. Every leaf command the CLI dispatches has an entry
 * so `<cmd> --help` is accurate (Hard Gate C). Adding a command without adding
 * its help block here is caught by the `every dispatched command has help`
 * test.
 */
export const COMMAND_HELP: Record<string, HelpEntry> = {
  // ── memories namespace ───────────────────────────────────────
  "memories index": {
    synopsis: "loadout-os memories index <MEMORY.md> [--lazy] [--json]",
    args: [["<MEMORY.md>", "path to the store's MEMORY.md (required, first)"]],
    flags: [
      ["--lazy", "generate a lazy-load index (on-demand topic loading)"],
      ["--json", "machine-readable output"],
    ],
    example: "loadout-os memories index ~/.claude/projects/F--AI/memory/MEMORY.md",
    exits: [["0", "index generated"], ["1", "MEMORY.md missing / unreadable"]],
  },
  "memories validate": {
    synopsis: "loadout-os memories validate <MEMORY.md> [--json]",
    args: [["<MEMORY.md>", "path to MEMORY.md to lint (required, first)"]],
    flags: [["--json", "machine-readable output"]],
    example: "loadout-os memories validate ./MEMORY.md",
    exits: [["0", "no errors (warnings allowed)"], ["1", "≥1 error-severity issue"]],
  },
  "memories stats": {
    synopsis: "loadout-os memories stats <MEMORY.md> [--json]",
    args: [["<MEMORY.md>", "path to MEMORY.md (required, first)"]],
    flags: [["--json", "machine-readable output"]],
    example: "loadout-os memories stats ./MEMORY.md --json",
    exits: [["0", "stats printed"], ["1", "MEMORY.md missing"]],
  },
  "memories health": {
    synopsis: "loadout-os memories health [path] [--json]",
    args: [["[path]", "optional MEMORY.md path to probe (else auto-detects)"]],
    flags: [["--json", "machine-readable output"]],
    example: "loadout-os memories health",
    exits: [["0", "Node OK"], ["1", "Node < 20"]],
  },

  // ── rules namespace ──────────────────────────────────────────
  "rules analyze": {
    synopsis: "loadout-os rules analyze <CLAUDE.md> [--rules-dir <dir>] [--json]",
    args: [["<CLAUDE.md>", "instruction file to analyze (required, first)"]],
    flags: [
      ["--rules-dir <dir>", "rules directory (default .claude/rules)"],
      ["--json", "machine-readable output"],
    ],
    example: "loadout-os rules analyze .claude/CLAUDE.md",
    exits: [["0", "analysis printed"], ["1", "CLAUDE.md missing"]],
  },
  "rules validate": {
    synopsis: "loadout-os rules validate [--rules-dir <dir>] [--lazy] [--repo-root <dir>] [--json]",
    flags: [
      ["--rules-dir <dir>", "rules directory (default .claude/rules, or .claude/loadout with --lazy)"],
      ["--lazy", "validate a lazy-load layout"],
      ["--repo-root <dir>", "repo root the rule paths resolve against (default cwd)"],
      ["--json", "machine-readable output"],
    ],
    example: "loadout-os rules validate --rules-dir .claude/rules",
    exits: [["0", "no errors"], ["1", "≥1 error-severity issue"]],
  },
  "rules stats": {
    synopsis: "loadout-os rules stats <CLAUDE.md> [--rules-dir <dir>] [--json]",
    args: [["<CLAUDE.md>", "instruction file (required, first)"]],
    flags: [
      ["--rules-dir <dir>", "rules directory (default .claude/rules)"],
      ["--json", "machine-readable output"],
    ],
    example: "loadout-os rules stats .claude/CLAUDE.md",
    exits: [["0", "stats printed"], ["1", "CLAUDE.md missing"]],
  },
  "rules split": {
    synopsis: "loadout-os rules split [CLAUDE.md] [--yes] [--dry-run] [...]",
    args: [["[CLAUDE.md]", "instruction file to split (default .claude/CLAUDE.md)"]],
    flags: [
      ["--dry-run", "show the proposed split without writing"],
      ["--yes", "extract all proposed sections without prompting"],
    ],
    example: "loadout-os rules split .claude/CLAUDE.md --dry-run",
    note: "Interactive: this passes through to the `claude-rules split` bin with inherited stdio so the readline prompt works. All args/flags are forwarded verbatim.",
    exits: [["0", "split completed (or dry-run printed)"], ["≠0", "forwarded from the claude-rules bin"]],
  },

  // ── flat kernel verbs ────────────────────────────────────────
  resolve: {
    synopsis: "loadout-os resolve [--project <dir>] [--global <dir>] [--org <p>] [--session <p>] [--json]",
    flags: [
      ["--project <dir>", "project root to discover .claude layers under"],
      ["--global <dir>", "global resolver dir (default ~/.ai-loadout)"],
      ["--org <p>", "org-level index path"],
      ["--session <p>", "session-level index path"],
      ["--json", "machine-readable output"],
    ],
    example: "loadout-os resolve --json",
    exits: [["0", "layers resolved (even if none found)"]],
  },
  explain: {
    synopsis: "loadout-os explain <entry-id> [--project <dir>] [--global <dir>] [--json]",
    args: [["<entry-id>", "the entry id to trace across layers (required, first)"]],
    flags: [["--json", "machine-readable output"]],
    example: "loadout-os explain shipcheck",
    exits: [["0", "explanation printed"], ["1", "entry id not found in any layer"]],
  },
  usage: {
    synopsis: "loadout-os usage <jsonl> [--json]",
    args: [["<jsonl>", "path to a usage.jsonl event log (required, first)"]],
    flags: [["--json", "machine-readable output"]],
    example: "loadout-os usage ~/.ai-loadout/usage.jsonl",
    exits: [["0", "summary printed (empty log allowed)"], ["1", "missing arg"]],
  },
  dead: {
    synopsis: "loadout-os dead <index> <jsonl> [--json]",
    args: [
      ["<index>", "the loadout index (FIRST positional)"],
      ["<jsonl>", "the usage.jsonl event log (SECOND positional)"],
    ],
    flags: [["--json", "machine-readable output"]],
    note: "Order matters: <index> comes BEFORE <jsonl>. Swapping them ('dead usage.jsonl index.json') makes the kernel try to read the index as an event log and the log as an index — a quiet foot-gun, so the order is fixed and documented here.",
    example: "loadout-os dead ~/.ai-loadout/index.json ~/.ai-loadout/usage.jsonl",
    exits: [["0", "dead-entry report printed"], ["1", "missing arg / bad index"]],
  },
  overlaps: {
    synopsis: "loadout-os overlaps <index> [--json]",
    args: [["<index>", "the loadout index to scan for keyword overlaps (required, first)"]],
    flags: [["--json", "machine-readable output"]],
    example: "loadout-os overlaps ~/.ai-loadout/index.json",
    exits: [["0", "overlaps printed (none = unambiguous routing)"], ["1", "bad index"]],
  },
  budget: {
    synopsis: "loadout-os budget <index> [jsonl] [--json]",
    args: [
      ["<index>", "the loadout index (required, FIRST)"],
      ["[jsonl]", "optional usage.jsonl to fold in observed averages (SECOND)"],
    ],
    flags: [["--json", "machine-readable output"]],
    example: "loadout-os budget ~/.ai-loadout/index.json ~/.ai-loadout/usage.jsonl",
    exits: [["0", "budget printed"], ["1", "bad index"]],
  },
  validate: {
    synopsis: "loadout-os validate <index> [--json]",
    args: [["<index>", "the loadout index to STRUCTURE-validate via the kernel (required, first)"]],
    flags: [["--json", "machine-readable output"]],
    note: "This is the KERNEL index-structure validator. For linting a MEMORY.md or rules dir use 'memories validate' / 'rules validate' instead — that flat-vs-namespaced split is how the name collision is resolved.",
    example: "loadout-os validate ~/.ai-loadout/index.json",
    exits: [["0", "no structural errors"], ["1", "≥1 error-severity issue"]],
  },

  // ── rituals ──────────────────────────────────────────────────
  doctor: {
    synopsis: "loadout-os doctor [--store <dir>] [--index <p>] [--settings <p>] [--usage <p>] [--repo-root <dir>] [--json]",
    flags: [
      ["--store <dir>", "memory store dir (default canonical store)"],
      ["--index <p>", "global resolver index (default ~/.ai-loadout/index.json)"],
      ["--settings <p>", "Claude Code settings.json (default ~/.claude/settings.json)"],
      ["--usage <p>", "usage.jsonl path (default ~/.ai-loadout/usage.jsonl)"],
      ["--repo-root <dir>", "repo root for the hook-drift check (default cwd)"],
      ["--json", "machine-readable output"],
    ],
    note: "Read-only: doctor NEVER writes. Every check delegates to a library validator.",
    example: "loadout-os doctor",
    exits: [["0", "healthy (no fail checks)"], ["1", "≥1 fail check"]],
  },
  report: {
    synopsis: "loadout-os report [--index <p>] [--jsonl <p>] [--json]",
    flags: [
      ["--index <p>", "global index (default ~/.ai-loadout/index.json)"],
      ["--jsonl <p>", "usage log (default ~/.ai-loadout/usage.jsonl)"],
      ["--json", "machine-readable output"],
    ],
    note: "Read-only observability over usage.jsonl.",
    example: "loadout-os report --json",
    exits: [["0", "report printed"], ["2", "a required input (index/usage) is missing"]],
  },
  "hook test": {
    synopsis: 'loadout-os hook test [--prompt "<text>"] [--repo-root <dir>] [--json]',
    flags: [
      ["--prompt \"<text>\"", "prompt to drive the hook with (default a sample)"],
      ["--repo-root <dir>", "repo root holding apps/hook/loadout-hook.mjs (default cwd)"],
      ["--json", "machine-readable output"],
    ],
    note: "Runs in an isolated HOME so the live usage.jsonl is never written.",
    example: 'loadout-os hook test --prompt "scaffold a new game"',
    exits: [["0", "hook ran"], ["1", "hook binary not found"]],
  },
  refresh: {
    synopsis: "loadout-os refresh [--store <dir>] [--dest <path>] [--dry-run]",
    flags: [
      ["--store <dir>", "memory store dir (default canonical store)"],
      ["--dest <path>", "global index to write (default ~/.ai-loadout/index.json)"],
      ["--dry-run", "compute everything, write NOTHING, print what WOULD change"],
    ],
    note: "Folds the Index Freshness Ritual (index → validate → copy) into one command. ANDON HALT: any validation error writes nothing. COMPENSATOR: an existing --dest is backed up to <dest>.bak before overwrite and restored on write failure.",
    example: "loadout-os refresh --dry-run",
    exits: [
      ["0", "index written (or dry-run printed)"],
      ["1", "validation error (andon) or write failure"],
      ["2", "store / MEMORY.md missing"],
    ],
  },
};

/** Render a single per-command help block. */
export function renderCommandHelp(key: string): string {
  const e = COMMAND_HELP[key];
  if (!e) {
    // Should be unreachable (the test enforces coverage); fail soft to the key.
    return `\n${BOLD}loadout-os ${key}${RESET}\n  (no per-command help registered)\n`;
  }
  const lines: string[] = [];
  lines.push("");
  lines.push(`${BOLD}loadout-os ${key}${RESET}`);
  lines.push("");
  lines.push(`${BOLD}Synopsis:${RESET}`);
  lines.push(`  ${e.synopsis}`);
  if (e.args && e.args.length > 0) {
    lines.push("");
    lines.push(`${BOLD}Arguments:${RESET}`);
    for (const [name, role] of e.args) lines.push(`  ${name.padEnd(14)} ${DIM}${role}${RESET}`);
  }
  if (e.flags && e.flags.length > 0) {
    lines.push("");
    lines.push(`${BOLD}Flags:${RESET}`);
    for (const [flag, role] of e.flags) lines.push(`  ${flag.padEnd(22)} ${DIM}${role}${RESET}`);
  }
  if (e.note) {
    lines.push("");
    lines.push(`  ${DIM}${e.note}${RESET}`);
  }
  lines.push("");
  lines.push(`${BOLD}Example:${RESET}`);
  lines.push(`  ${e.example}`);
  lines.push("");
  lines.push(`${BOLD}Exit codes:${RESET}`);
  for (const [code, meaning] of e.exits) lines.push(`  ${code.padEnd(4)} ${DIM}${meaning}${RESET}`);
  lines.push("");
  return lines.join("\n");
}

/**
 * If `args` requests help for command `key`, print the per-command help and
 * return true (the caller must then NOT execute the command). Returns false
 * when no help was requested.
 *
 * Only fires for keys present in COMMAND_HELP — an unknown key is treated as
 * "no per-command help", letting the namespace/top-level help handle it.
 */
export function interceptHelp(key: string, args: string[]): boolean {
  if (!wantsHelp(args)) return false;
  if (!(key in COMMAND_HELP)) return false;
  log(renderCommandHelp(key));
  return true;
}
