/**
 * loadout-os hook pre-tool — Claude Code PreToolUse framework (Parts 1 & 2).
 *
 * Implements:
 *   1. PreToolUse stdin schema reader (`tool_name`, `tool_input`, `cwd`, `session_id`)
 *   2. Seat resolution from `~/.ai-loadout/seats.json` (longest matching prefix of `cwd`,
 *      case- and slash-normalised on Windows; `default` when unmatched; env override
 *      `AI_LOADOUT_SEATS_PATH`)
 *   3. Cheap read-only pass-through for read-only tools (`Read`, `Glob`, `Grep`, etc.)
 *      and read-only Bash commands (`git status|diff|log|show`, `gh … view|list`, `ls`,
 *      `cat`, `head`, `tail`, `grep`, `rg`, `sed -n`, `sha256sum`, `wc`,
 *      `find` without `-delete`/`-exec`, `loadout-os … --dry-run`), checking every
 *      segment across pipes, `&&`, `||`, `;`, `&`, newlines, subshells, and command
 *      substitutions
 *   4. Typed rule table (`PreToolRule`) with per-seat actions (`block`, `warn`, `off`),
 *      triad metadata (`memory`, `skill`), and <= 5-line messages
 *   5. Append-only JSONL decision log at `~/.ai-loadout/hook-decisions.jsonl`
 *      (env override `AI_LOADOUT_DECISIONS_LOG`), recording `input_hash` (SHA-256)
 *      and never logging raw command or payload text
 *   6. Modes: `--mode enforce` (default) and `--mode log-only`
 *   7. Failure policy:
 *      - Fail open (`error_open`, exit 0) on any error before a block rule matches
 *        (unreadable stdin, bad seat map, parser crash) and on the warn layer
 *      - Fail closed (`error_closed`, exit 2) once a block rule has matched, even if a
 *        later step errors
 *      - Never emit JSON `permissionDecision: "deny"` together with exit 2 (exit 2 +
 *        stderr only)
 *      - Hard internal timeout (default 300 ms) that fails open and logs `timeout`
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { performance } from "node:perf_hooks";

import { PRETOOL_RULES } from "./pretool-rules.js";

// ── Types ─────────────────────────────────────────────────────

export type RuleLayer = "A" | "B";
export type RuleAction = "block" | "warn" | "off";
export type SeatName = "rnd" | "publisher" | "default" | string;
export type HookMode = "enforce" | "log-only";
export type DecisionOutcome =
  | "allow"
  | "warn"
  | "block"
  | "error_open"
  | "error_closed"
  | "timeout";

export interface PreToolStdinPayload {
  tool_name: string;
  tool_input: Record<string, unknown>;
  cwd?: string;
  session_id?: string;
  hook_event_name?: string;
  tool_use_id?: string;
}

export interface SeatConfig {
  /** Raw prefix -> seat name mapping from seats.json. */
  seats: Record<string, string>;
  /** Additional memory store paths configured in seats.json or env. */
  storePaths: string[];
}

export interface CommandRedirection {
  op: string;
  target: string;
}

export interface CommandSegment {
  /** Unquoted command and argument tokens (after stripping leading VAR=val assignments and redirections). */
  tokens: string[];
  /** Raw token strings before unquoting. */
  rawTokens: string[];
  /** Leading environment variable assignments (`VAR=val`). */
  envAssignments: string[];
  /** Redirections present in this segment (`>`, `>>`, `<`, `<<`, etc.). */
  redirections: CommandRedirection[];
  /** Raw text of this segment. */
  raw: string;
  /** True when extracted from a subshell `(...)`, `{ ...; }`, `$(...)`, or backticks. */
  inSubshell: boolean;
}

/**
 * Parsed Bash command structure.
 *
 * Parser limits (documented per Part 1.3):
 *   - Splits pipelines (`|`, `|&`), logical lists (`&&`, `||`), sequential lists (`;`, `&`, `\n`),
 *     subshells `(...)`, brace groups `{ ...; }`, command substitutions `$(...)` and `` `...` ``,
 *     and process substitutions `<(...)` / `>(...)` into separate `CommandSegment` entries.
 *   - For read-only pass-through, EVERY segment (including subshells and command substitutions)
 *     must match the read-only allowlist, and ANY non-read-only segment, output redirection
 *     (`>`, `>>`, `&>`, etc.), heredoc (`<<`), or unclosed quote disables the pass-through.
 *   - Does not expand shell variables/globs or evaluate `eval` / aliases; dynamic constructs
 *     outside the explicit read-only allowlist never pass through silently.
 */
export interface ParsedBashCommand {
  raw: string;
  segments: CommandSegment[];
  hasOutputRedirection: boolean;
  hasHeredoc: boolean;
  hasUnclosedQuote: boolean;
  heredocBodies: string[];
}

export interface WriteEditItem {
  old_string?: string;
  new_string: string;
}

export interface WritePayload {
  filePath?: string;
  content?: string;
  new_string?: string;
  old_string?: string;
  edits?: WriteEditItem[];
  /** All prose/text fragments written by this tool call (`content`, `new_string`, `edits[].new_string`). */
  texts: string[];
}

export interface RuleMatchInput {
  toolName: string;
  toolInput: Record<string, unknown>;
  cwd: string;
  seat: SeatName;
  parsedCommand?: ParsedBashCommand;
  writePayload?: WritePayload;
  storePaths: string[];
  nowMs: number;
  recordNote: (note: string) => void;
}

export interface RuleMatchResult {
  matched: boolean;
  detail?: string;
}

export interface PreToolRule {
  id: string;
  layer: RuleLayer;
  tools: readonly string[];
  action: {
    default: RuleAction;
    rnd?: RuleAction;
    publisher?: RuleAction;
    [seat: string]: RuleAction | undefined;
  };
  memory: string;
  skill: string;
  /** Required when `skill === "none"`: explains why no skill applies. */
  skillNoneReason?: string;
  /** <= 5-line message string or formatter. */
  message: string | ((res: RuleMatchResult, ctx: RuleMatchInput) => string);
  match: (ctx: RuleMatchInput) => boolean | RuleMatchResult;
}

export interface MatchedRuleRecord {
  id: string;
  layer: RuleLayer;
  action: RuleAction;
}

export interface DecisionLogEntry {
  ts: string;
  seat: string;
  session: string;
  tool: string;
  mode: HookMode;
  evaluated: string[];
  matched: MatchedRuleRecord[];
  outcome: DecisionOutcome;
  latency_ms: number;
  input_hash: string;
  notes?: string[];
}

export interface PreToolOptions {
  /** Raw stdin JSON string. */
  stdinJson?: string;
  /** Mode: `"enforce"` (default) or `"log-only"`. */
  mode?: string;
  /** Override path to `seats.json` (defaults to `AI_LOADOUT_SEATS_PATH` or `~/.ai-loadout/seats.json`). */
  seatsPath?: string;
  /** Override path to `hook-decisions.jsonl` (defaults to `AI_LOADOUT_DECISIONS_LOG` or `~/.ai-loadout/hook-decisions.jsonl`). */
  logPath?: string;
  /** Additional store paths (merged with default `~/.claude/projects/<project>/memory` and seat map stores). */
  storePaths?: string[];
  /** Custom rule table override for tests (defaults to `PRETOOL_RULES`). */
  rules?: readonly PreToolRule[];
  /** Hard internal timeout in milliseconds (default 300 ms). */
  timeoutMs?: number;
  /** Deterministic clock override in epoch ms. */
  nowMs?: number;
  /** Test hook: custom bash parser to simulate parser crashes. */
  bashParser?: (cmd: string) => ParsedBashCommand;
  /** Test hook: custom log writer to simulate post-match log errors. */
  logWriter?: (logPath: string, entry: DecisionLogEntry) => void;
  /** Test hook: simulate wall-clock elapsed ms per step to trigger internal timeout deterministically. */
  simulatedElapsedMs?: number;
}

export interface PreToolResult {
  exitCode: 0 | 2;
  stdout: string;
  stderr: string;
  passThrough: boolean;
  seat: string;
  outcome: DecisionOutcome | "pass_through";
  logEntry?: DecisionLogEntry;
}

// ── Constants ─────────────────────────────────────────────────

export const DEFAULT_PRETOOL_TIMEOUT_MS = 300;

export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "Read",
  "Glob",
  "Grep",
  "LS",
  "ToolSearch",
  "WebSearch",
  "WebFetch",
  "TodoRead",
  "ListMcpResources",
  "ReadMcpResource",
  "ReadMcpResourceDir",
  "TaskList",
  "TaskGet",
  "TaskOutput",
  "CronList",
]);

const READ_ONLY_GIT_SUBCOMMANDS = new Set(["status", "diff", "log", "show"]);
const READ_ONLY_GH_VERBS = new Set(["view", "list"]);
const READ_ONLY_BARE_COMMANDS = new Set([
  "ls",
  "cat",
  "head",
  "tail",
  "grep",
  "rg",
  "sha256sum",
  "wc",
]);
const FORBIDDEN_FIND_FLAGS = new Set([
  "-delete",
  "-exec",
  "-execdir",
  "-ok",
  "-okdir",
  "-fprint",
  "-fprint0",
  "-fls",
  "-fprintf",
]);

const OUTPUT_REDIRECT_OPS = new Set([
  ">",
  ">>",
  ">|",
  "&>",
  "&>>",
  "<>",
  "1>",
  "1>>",
  "2>",
  "2>>",
  ">&",
]);

// ── Default Paths ─────────────────────────────────────────────

export function defaultSeatsPath(): string {
  const envPath = process.env.AI_LOADOUT_SEATS_PATH?.trim();
  if (envPath) return resolve(envPath);
  return join(homedir(), ".ai-loadout", "seats.json");
}

export function defaultDecisionLogPath(): string {
  const envPath = process.env.AI_LOADOUT_DECISIONS_LOG?.trim();
  if (envPath) return resolve(envPath);
  return join(homedir(), ".ai-loadout", "hook-decisions.jsonl");
}

// ── Path Normalization & Seat Resolution ──────────────────────

/**
 * Normalize a path for prefix comparison:
 * - Converts `\` to `/`
 * - Strips Windows extended-length prefixes (`\\?\`, `//?/`)
 * - Expands leading `~`
 * - Converts MSYS `/e/...` drive prefixes to `e:/...`
 * - Folds case to lowercase on Windows or whenever a drive-letter prefix is present
 * - Strips trailing slashes (keeping `"/"` for POSIX root)
 */
export function normalizePreToolPath(rawPath: string): string {
  let p = rawPath.trim().replace(/\\/g, "/");
  if (!p) return "";

  if (p.startsWith("//?/") || p.startsWith("//./")) {
    const rest = p.slice(4);
    p = /^UNC\//i.test(rest) ? "//" + rest.slice(4) : rest;
  }

  if (p === "~") {
    p = homedir().replace(/\\/g, "/");
  } else if (p.startsWith("~/")) {
    p = join(homedir(), p.slice(2)).replace(/\\/g, "/");
  }

  const msysMatch = p.match(/^\/([a-zA-Z])(\/.*|$)/);
  if (msysMatch && (process.platform === "win32" || msysMatch[2].startsWith("/AI/"))) {
    const drive = msysMatch[1].toLowerCase();
    const tail = msysMatch[2] || "/";
    p = `${drive}:${tail}`;
  }

  // Case-fold on Windows or for Windows drive-letter paths so cross-platform tests behave identically.
  if (process.platform === "win32" || /^[a-zA-Z]:/.test(p)) {
    p = p.toLowerCase();
  }

  while (p.length > 1 && p.endsWith("/")) {
    p = p.slice(0, -1);
  }
  return p;
}

/**
 * Load and validate `~/.ai-loadout/seats.json`.
 * - If the default file does not exist and no explicit override was set, returns an empty map.
 * - If an explicit override path is missing, or the file is unreadable or malformed JSON,
 *   throws an Error so the caller fails open and logs `error_open`.
 */
export function loadSeatConfig(seatsPath?: string): SeatConfig {
  const explicitOverride = Boolean(
    seatsPath || process.env.AI_LOADOUT_SEATS_PATH?.trim(),
  );
  const resolvedPath = seatsPath ? resolve(seatsPath) : defaultSeatsPath();

  if (!existsSync(resolvedPath)) {
    if (explicitOverride) {
      throw new Error(`Seat map not found at explicit path: ${resolvedPath}`);
    }
    return { seats: {}, storePaths: [] };
  }

  const raw = readFileSync(resolvedPath, "utf-8");
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Seat map at ${resolvedPath} must be a JSON object`);
  }

  const obj = parsed as Record<string, unknown>;
  const seats: Record<string, string> = {};
  const storePaths: string[] = [];

  const parseSeatEntries = (mapObj: Record<string, unknown>) => {
    for (const [key, val] of Object.entries(mapObj)) {
      if (key === "stores" && Array.isArray(val)) {
        for (const item of val) {
          if (typeof item === "string" && item.trim()) {
            storePaths.push(item.trim());
          } else {
            throw new Error(`Invalid store path in seats.json stores array`);
          }
        }
        continue;
      }
      if (typeof val === "string" && val.trim()) {
        seats[key] = val.trim();
      } else if (val && typeof val === "object" && !Array.isArray(val)) {
        const rec = val as Record<string, unknown>;
        if (typeof rec.seat !== "string" || !rec.seat.trim()) {
          throw new Error(`Seat entry for '${key}' is missing a non-empty 'seat' string`);
        }
        seats[key] = rec.seat.trim();
        if (typeof rec.store === "string" && rec.store.trim()) {
          storePaths.push(rec.store.trim());
        }
        if (Array.isArray(rec.stores)) {
          for (const s of rec.stores) {
            if (typeof s === "string" && s.trim()) {
              storePaths.push(s.trim());
            }
          }
        }
      } else {
        throw new Error(`Invalid seat map value for prefix '${key}'`);
      }
    }
  };

  if (obj.seats && typeof obj.seats === "object" && !Array.isArray(obj.seats)) {
    if (Array.isArray(obj.stores)) {
      for (const s of obj.stores) {
        if (typeof s === "string" && s.trim()) storePaths.push(s.trim());
      }
    }
    parseSeatEntries(obj.seats as Record<string, unknown>);
  } else {
    parseSeatEntries(obj);
  }

  return { seats, storePaths };
}

/**
 * Resolve the active seat from `cwd` and a loaded `SeatConfig`.
 * The longest matching path-boundary prefix wins; returns `"default"` when no prefix matches.
 */
export function resolveSeat(cwd: string, config: SeatConfig): SeatName {
  const normCwd = normalizePreToolPath(cwd);
  if (!normCwd) return "default";

  let bestSeat: SeatName = "default";
  let bestLen = -1;

  for (const [rawPrefix, seat] of Object.entries(config.seats)) {
    const normPrefix = normalizePreToolPath(rawPrefix);
    if (!normPrefix) continue;

    // Compare case-insensitively if either side is case-folded
    const cwdCmp = normCwd.toLowerCase();
    const prefixCmp = normPrefix.toLowerCase();

    const matches =
      cwdCmp === prefixCmp ||
      cwdCmp.startsWith(prefixCmp + "/") ||
      (prefixCmp === "/" && cwdCmp.startsWith("/"));

    if (matches && prefixCmp.length > bestLen) {
      bestLen = prefixCmp.length;
      bestSeat = seat;
    }
  }

  return bestSeat;
}

// ── Stdin Schema & Hash ───────────────────────────────────────

/**
 * Parse and validate a Claude Code 2.1.197 `PreToolUse` stdin payload.
 * Requires a JSON object with a non-empty string `tool_name` and an object `tool_input`.
 */
export function parsePreToolStdin(rawStdin: string): PreToolStdinPayload {
  if (!rawStdin || !rawStdin.trim()) {
    throw new Error("Empty PreToolUse stdin payload");
  }
  const parsed: unknown = JSON.parse(rawStdin);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("PreToolUse stdin payload is not a JSON object");
  }
  const rec = parsed as Record<string, unknown>;
  if (typeof rec.tool_name !== "string" || !rec.tool_name.trim()) {
    throw new Error("PreToolUse stdin payload missing string 'tool_name'");
  }
  const toolInput =
    rec.tool_input === undefined || rec.tool_input === null
      ? {}
      : rec.tool_input;
  if (typeof toolInput !== "object" || Array.isArray(toolInput)) {
    throw new Error("PreToolUse stdin payload 'tool_input' must be an object");
  }

  return {
    tool_name: rec.tool_name.trim(),
    tool_input: toolInput as Record<string, unknown>,
    cwd: typeof rec.cwd === "string" ? rec.cwd : undefined,
    session_id: typeof rec.session_id === "string" ? rec.session_id : undefined,
    hook_event_name:
      typeof rec.hook_event_name === "string" ? rec.hook_event_name : undefined,
    tool_use_id:
      typeof rec.tool_use_id === "string" ? rec.tool_use_id : undefined,
  };
}

/**
 * Compute a SHA-256 hex digest of the input so the decision log never stores
 * raw commands or payload text.
 */
export function hashToolInput(rawInput: string | Record<string, unknown>): string {
  const serialized =
    typeof rawInput === "string" ? rawInput : JSON.stringify(rawInput);
  return createHash("sha256").update(serialized, "utf-8").digest("hex");
}

// ── Write Payload Extraction ──────────────────────────────────

export function extractWritePayload(
  toolName: string,
  toolInput: Record<string, unknown>,
): WritePayload | undefined {
  if (toolName !== "Write" && toolName !== "Edit" && toolName !== "MultiEdit") {
    return undefined;
  }
  const filePath =
    typeof toolInput.file_path === "string"
      ? toolInput.file_path
      : typeof toolInput.path === "string"
        ? toolInput.path
        : undefined;
  const content =
    typeof toolInput.content === "string" ? toolInput.content : undefined;
  const new_string =
    typeof toolInput.new_string === "string" ? toolInput.new_string : undefined;
  const old_string =
    typeof toolInput.old_string === "string" ? toolInput.old_string : undefined;

  let edits: WriteEditItem[] | undefined;
  if (Array.isArray(toolInput.edits)) {
    edits = [];
    for (const item of toolInput.edits) {
      if (item && typeof item === "object") {
        const e = item as Record<string, unknown>;
        if (typeof e.new_string === "string") {
          edits.push({
            old_string: typeof e.old_string === "string" ? e.old_string : undefined,
            new_string: e.new_string,
          });
        }
      }
    }
  }

  const texts: string[] = [];
  if (content !== undefined) texts.push(content);
  if (new_string !== undefined) texts.push(new_string);
  if (edits) {
    for (const e of edits) texts.push(e.new_string);
  }

  return { filePath, content, new_string, old_string, edits, texts };
}

// ── Bash Command Parser & Read-Only Pass-Through ──────────────

function unquoteToken(raw: string): string {
  let out = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inSingle) {
      if (ch === "'") inSingle = false;
      else out += ch;
      continue;
    }
    if (inDouble) {
      if (ch === '"') {
        inDouble = false;
      } else if (ch === "\\" && i + 1 < raw.length) {
        const next = raw[i + 1];
        if (next === '"' || next === "\\" || next === "$" || next === "`") {
          out += next;
          i++;
        } else {
          out += ch;
        }
      } else {
        out += ch;
      }
      continue;
    }
    if (ch === "'") {
      inSingle = true;
    } else if (ch === '"') {
      inDouble = true;
    } else if (ch === "\\" && i + 1 < raw.length) {
      out += raw[++i];
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Strip heredoc bodies (`<<EOF ... EOF`, `<<'EOF'`, `<<-EOF`) from a command string
 * while recording their bodies and preserving the first command line.
 */
function extractHeredocs(raw: string): {
  strippedCommand: string;
  heredocBodies: string[];
  hasHeredoc: boolean;
} {
  const lines = raw.split(/\r?\n/);
  const keptLines: string[] = [];
  const heredocBodies: string[] = [];
  let hasHeredoc = false;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    keptLines.push(line);

    // Detect `<<` (but not `<<<` here-string) outside single/double quotes on `line`
    const delims: string[] = [];
    let inSingle = false;
    let inDouble = false;
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === "\\" && !inSingle && c + 1 < line.length) {
        c++;
        continue;
      }
      if (ch === "'" && !inDouble) {
        inSingle = !inSingle;
        continue;
      }
      if (ch === '"' && !inSingle) {
        inDouble = !inDouble;
        continue;
      }
      if (!inSingle && !inDouble && ch === "<" && line[c + 1] === "<") {
        if (line[c + 2] === "<") {
          // `<<<` here-string, still mark as input/heredoc construct
          hasHeredoc = true;
          c += 2;
          continue;
        }
        hasHeredoc = true;
        let rest = line.slice(c + 2);
        if (rest.startsWith("-")) rest = rest.slice(1);
        rest = rest.trimStart();
        const m = rest.match(/^(?:'([^']+)'|"([^"]+)"|([A-Za-z0-9_\\-]+))/);
        if (m) {
          const rawDelim = (m[1] ?? m[2] ?? m[3] ?? "").replace(/\\/g, "");
          if (rawDelim) delims.push(rawDelim);
        }
        c += 1;
      }
    }

    i++;
    for (const delim of delims) {
      const bodyLines: string[] = [];
      while (i < lines.length) {
        const bodyLine = lines[i];
        i++;
        if (bodyLine.trim() === delim) {
          break;
        }
        bodyLines.push(bodyLine);
      }
      heredocBodies.push(bodyLines.join("\n"));
    }
  }

  return {
    strippedCommand: keptLines.join("\n"),
    heredocBodies,
    hasHeredoc,
  };
}

/**
 * Find the matching closing `)` for a `$(` or `<(` or `(` starting after the `(`.
 */
function findMatchingParen(src: string, startAfterOpen: number): number {
  let depth = 1;
  let inSingle = false;
  let inDouble = false;
  for (let i = startAfterOpen; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\\" && !inSingle && i + 1 < src.length) {
      i++;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble) {
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) return i;
      }
    }
  }
  return -1;
}

/**
 * Parse a single command segment into tokens, envAssignments, and redirections.
 */
function buildCommandSegment(
  rawSegment: string,
  rawTokens: string[],
  inSubshell: boolean,
): CommandSegment {
  const tokens: string[] = [];
  const envAssignments: string[] = [];
  const redirections: CommandRedirection[] = [];

  let i = 0;
  while (i < rawTokens.length) {
    const rt = rawTokens[i];

    // Standalone redirection operator token
    if (
      OUTPUT_REDIRECT_OPS.has(rt) ||
      rt === "<" ||
      rt === "<<" ||
      rt === "<<-" ||
      rt === "<<<" ||
      rt === "<&"
    ) {
      const targetRaw = i + 1 < rawTokens.length ? rawTokens[i + 1] : "";
      redirections.push({ op: rt, target: unquoteToken(targetRaw) });
      i += targetRaw ? 2 : 1;
      continue;
    }

    // Attached redirection token, e.g. `>file`, `>>file`, `2>file`, `2>&1`, `<file`
    const attachedMatch = rt.match(/^([12]?>{1,2}|&>{1,2}|[12]?>&|<|<<-?|<<<)(.+)$/);
    if (attachedMatch) {
      redirections.push({
        op: attachedMatch[1],
        target: unquoteToken(attachedMatch[2]),
      });
      i++;
      continue;
    }

    const unquoted = unquoteToken(rt);

    // Leading ENV=val before command name
    if (
      tokens.length === 0 &&
      /^[A-Za-z_][A-Za-z0-9_]*=/.test(unquoted) &&
      !rt.startsWith("'") &&
      !rt.startsWith('"')
    ) {
      envAssignments.push(unquoted);
      i++;
      continue;
    }

    tokens.push(unquoted);
    i++;
  }

  return {
    tokens,
    rawTokens,
    envAssignments,
    redirections,
    raw: rawSegment.trim(),
    inSubshell,
  };
}

/**
 * Parse a Bash command string into segments, tokens, redirections, subshells, and heredocs.
 */
export function parseBashCommand(
  rawCommand: string,
  inSubshell: boolean = false,
): ParsedBashCommand {
  if (typeof rawCommand !== "string") {
    throw new Error("Bash command must be a string");
  }

  const { strippedCommand, heredocBodies, hasHeredoc } = extractHeredocs(rawCommand);
  const segments: CommandSegment[] = [];
  const subCommandsToParse: string[] = [];

  let currentTokens: string[] = [];
  let currentToken = "";
  let segStart = 0;
  let inSingle = false;
  let inDouble = false;
  let subshellDepth = 0;
  let hasUnclosedQuote = false;
  let hasOutputRedirection = false;

  const flushToken = () => {
    if (currentToken.length > 0) {
      currentTokens.push(currentToken);
      currentToken = "";
    }
  };

  const flushSegment = (endIdx: number, segSubshell: boolean) => {
    flushToken();
    const rawSeg = strippedCommand.slice(segStart, endIdx);
    if (currentTokens.length > 0) {
      const seg = buildCommandSegment(
        rawSeg,
        currentTokens,
        inSubshell || segSubshell || subshellDepth > 0,
      );
      for (const r of seg.redirections) {
        if (OUTPUT_REDIRECT_OPS.has(r.op) || r.op.includes(">")) {
          hasOutputRedirection = true;
        }
      }
      segments.push(seg);
      currentTokens = [];
    }
    segStart = endIdx;
  };

  const s = strippedCommand;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];

    if (inSingle) {
      currentToken += ch;
      if (ch === "'") inSingle = false;
      i++;
      continue;
    }

    if (inDouble) {
      if (ch === "\\" && i + 1 < s.length) {
        currentToken += ch + s[i + 1];
        i += 2;
        continue;
      }
      if (ch === "$" && s[i + 1] === "(") {
        const closeIdx = findMatchingParen(s, i + 2);
        if (closeIdx === -1) {
          hasUnclosedQuote = true;
          currentToken += ch;
          i++;
          continue;
        }
        const inner = s.slice(i + 2, closeIdx);
        subCommandsToParse.push(inner);
        currentToken += s.slice(i, closeIdx + 1);
        i = closeIdx + 1;
        continue;
      }
      if (ch === "`") {
        const closeBacktick = s.indexOf("`", i + 1);
        if (closeBacktick === -1) {
          hasUnclosedQuote = true;
          currentToken += ch;
          i++;
          continue;
        }
        const inner = s.slice(i + 1, closeBacktick);
        subCommandsToParse.push(inner);
        currentToken += s.slice(i, closeBacktick + 1);
        i = closeBacktick + 1;
        continue;
      }
      currentToken += ch;
      if (ch === '"') inDouble = false;
      i++;
      continue;
    }

    // Outside quotes:
    if (ch === "\\") {
      if (i + 1 < s.length) {
        if (s[i + 1] === "\n") {
          i += 2;
          continue;
        }
        currentToken += ch + s[i + 1];
        i += 2;
        continue;
      }
      currentToken += ch;
      i++;
      continue;
    }

    // Comment `#` at start of token
    if (ch === "#" && currentToken.length === 0) {
      const nlIdx = s.indexOf("\n", i);
      if (nlIdx === -1) break;
      i = nlIdx;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      currentToken += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inDouble = true;
      currentToken += ch;
      i++;
      continue;
    }

    // Command substitution `$(...)` or process substitution `<(...)` / `>(...)`
    if (
      (ch === "$" || ch === "<" || ch === ">") &&
      s[i + 1] === "(" &&
      (ch === "$" || currentToken.length === 0)
    ) {
      const closeIdx = findMatchingParen(s, i + 2);
      if (closeIdx === -1) {
        hasUnclosedQuote = true;
        currentToken += ch;
        i++;
        continue;
      }
      const inner = s.slice(i + 2, closeIdx);
      subCommandsToParse.push(inner);
      currentToken += s.slice(i, closeIdx + 1);
      i = closeIdx + 1;
      continue;
    }

    // Backtick command substitution `` `...` ``
    if (ch === "`") {
      const closeBacktick = s.indexOf("`", i + 1);
      if (closeBacktick === -1) {
        hasUnclosedQuote = true;
        currentToken += ch;
        i++;
        continue;
      }
      const inner = s.slice(i + 1, closeBacktick);
      subCommandsToParse.push(inner);
      currentToken += s.slice(i, closeBacktick + 1);
      i = closeBacktick + 1;
      continue;
    }

    // Whitespace (excluding newline)
    if (ch === " " || ch === "\t" || ch === "\r") {
      flushToken();
      i++;
      continue;
    }

    // Segment separators: `;`, `\n`
    if (ch === ";" || ch === "\n") {
      flushSegment(i, false);
      segStart = i + 1;
      i++;
      continue;
    }

    // Subshell `(` and `)`
    if (ch === "(") {
      flushSegment(i, false);
      subshellDepth++;
      segStart = i + 1;
      i++;
      continue;
    }
    if (ch === ")") {
      flushSegment(i, true);
      if (subshellDepth > 0) subshellDepth--;
      segStart = i + 1;
      i++;
      continue;
    }

    // Brace group `{` and `}` when standalone token
    if ((ch === "{" || ch === "}") && currentToken.length === 0) {
      const nextCh = s[i + 1];
      if (!nextCh || /\s|;|\n|\)/.test(nextCh)) {
        flushSegment(i, ch === "}");
        if (ch === "{") subshellDepth++;
        else if (subshellDepth > 0) subshellDepth--;
        segStart = i + 1;
        i++;
        continue;
      }
    }

    // Pipe `|`, `||`, `|&`
    if (ch === "|") {
      flushSegment(i, false);
      if (s[i + 1] === "|" || s[i + 1] === "&") {
        i += 2;
      } else {
        i += 1;
      }
      segStart = i;
      continue;
    }

    // `&`, `&&`, `&>`, `&>>`
    if (ch === "&") {
      if (s[i + 1] === "&") {
        flushSegment(i, false);
        i += 2;
        segStart = i;
        continue;
      }
      if (s[i + 1] === ">") {
        flushToken();
        if (s[i + 2] === ">") {
          currentTokens.push("&>>");
          i += 3;
        } else {
          currentTokens.push("&>");
          i += 2;
        }
        continue;
      }
      // Single background `&`
      flushSegment(i, false);
      i += 1;
      segStart = i;
      continue;
    }

    // Redirection operators `>`, `>>`, `>|`, `>&`, `<`, `<<`, `<<<`, `<&`, `<>`
    if (ch === ">" || ch === "<") {
      // Check if currentToken is purely a file descriptor `"1"` or `"2"`
      let fdPrefix = "";
      if ((currentToken === "1" || currentToken === "2") && ch === ">") {
        fdPrefix = currentToken;
        currentToken = "";
      } else {
        flushToken();
      }

      if (ch === ">") {
        if (s[i + 1] === ">") {
          currentTokens.push(`${fdPrefix}>>`);
          i += 2;
        } else if (s[i + 1] === "|") {
          currentTokens.push(`${fdPrefix}>|`);
          i += 2;
        } else if (s[i + 1] === "&") {
          // e.g. `2>&1` or `>&2`
          let targetFd = "";
          let j = i + 2;
          while (j < s.length && /[0-9-]/.test(s[j])) {
            targetFd += s[j];
            j++;
          }
          currentTokens.push(`${fdPrefix}>&`);
          if (targetFd) currentTokens.push(targetFd);
          i = j;
        } else {
          currentTokens.push(`${fdPrefix}>`);
          i += 1;
        }
        continue;
      } else {
        // ch === "<"
        if (s[i + 1] === "<" && s[i + 2] === "<") {
          currentTokens.push("<<<");
          i += 3;
        } else if (s[i + 1] === "<" && s[i + 2] === "-") {
          currentTokens.push("<<-");
          i += 3;
        } else if (s[i + 1] === "<") {
          currentTokens.push("<<");
          i += 2;
        } else if (s[i + 1] === ">") {
          currentTokens.push("<>");
          i += 2;
        } else if (s[i + 1] === "&") {
          currentTokens.push("<&");
          i += 2;
        } else {
          currentTokens.push("<");
          i += 1;
        }
        continue;
      }
    }

    currentToken += ch;
    i++;
  }

  flushSegment(s.length, false);

  if (inSingle || inDouble || subshellDepth !== 0) {
    hasUnclosedQuote = true;
  }

  for (const sub of subCommandsToParse) {
    const subParsed = parseBashCommand(sub, true);
    if (subParsed.hasOutputRedirection) hasOutputRedirection = true;
    if (subParsed.hasHeredoc) {
      heredocBodies.push(...subParsed.heredocBodies);
    }
    if (subParsed.hasUnclosedQuote) hasUnclosedQuote = true;
    if (subParsed.segments.length === 0) {
      // Empty command substitution `$( )` is not a valid read-only segment
      segments.push({
        tokens: [],
        rawTokens: [],
        envAssignments: [],
        redirections: [],
        raw: sub,
        inSubshell: true,
      });
    } else {
      segments.push(...subParsed.segments);
    }
  }

  return {
    raw: rawCommand,
    segments,
    hasOutputRedirection,
    hasHeredoc: hasHeredoc || heredocBodies.length > 0,
    hasUnclosedQuote,
    heredocBodies,
  };
}

/**
 * Check whether a single parsed command segment is strictly read-only per Part 1.3:
 *   - `git status|diff|log|show`
 *   - `gh … view|list`
 *   - `ls`, `cat`, `head`, `tail`, `grep`, `rg`, `sed -n`, `sha256sum`, `wc`
 *   - `find` without `-delete`/`-exec`
 *   - `loadout-os … --dry-run`
 */
export function isSegmentReadOnly(seg: CommandSegment): boolean {
  if (seg.tokens.length === 0) return false;
  if (seg.redirections.length > 0) return false;

  const cmd = seg.tokens[0];
  const args = seg.tokens.slice(1);

  // Disallow path-qualified executables (e.g. `/tmp/evil/ls`) for read-only pass-through
  if (cmd.includes("/") || cmd.includes("\\")) {
    return false;
  }

  if (cmd === "git") {
    let idx = 0;
    while (idx < args.length) {
      const a = args[idx];
      if (a === "-C" || a === "-c") {
        if (idx + 1 >= args.length) return false;
        idx += 2;
      } else if (
        a === "--no-pager" ||
        a === "--paginate" ||
        a === "-p" ||
        a === "--bare" ||
        a.startsWith("--git-dir=") ||
        a.startsWith("--work-tree=")
      ) {
        idx += 1;
      } else {
        break;
      }
    }
    const sub = args[idx];
    if (!sub || !READ_ONLY_GIT_SUBCOMMANDS.has(sub)) return false;
    const rest = args.slice(idx + 1);
    for (const r of rest) {
      if (r === "--output" || r.startsWith("--output=") || r === "--ext-diff") {
        return false;
      }
    }
    return true;
  }

  if (cmd === "gh") {
    let idx = 0;
    while (idx < args.length) {
      const a = args[idx];
      if (a === "-R" || a === "--repo") {
        if (idx + 1 >= args.length) return false;
        idx += 2;
      } else if (a.startsWith("--repo=")) {
        idx += 1;
      } else {
        break;
      }
    }
    const noun = args[idx];
    const verb = args[idx + 1];
    if (!noun || !verb) return false;
    if (noun === "api" || noun === "auth" || noun.startsWith("-")) return false;
    return READ_ONLY_GH_VERBS.has(verb);
  }

  if (READ_ONLY_BARE_COMMANDS.has(cmd)) {
    if (cmd === "rg") {
      for (const a of args) {
        if (a === "--pre" || a.startsWith("--pre=")) return false;
      }
    }
    return true;
  }

  if (cmd === "sed") {
    let hasQuiet = false;
    for (const a of args) {
      if (a === "-n" || a === "--quiet" || a === "--silent") {
        hasQuiet = true;
      } else if (a.startsWith("-") && !a.startsWith("--")) {
        const flags = a.slice(1);
        if (flags.includes("i") || flags.includes("f")) return false;
        if (flags.includes("n")) hasQuiet = true;
      } else if (
        a === "-i" ||
        a.startsWith("-i") ||
        a === "--in-place" ||
        a.startsWith("--in-place=") ||
        a === "-f" ||
        a === "--file" ||
        a.startsWith("--file=")
      ) {
        return false;
      }
    }
    return hasQuiet;
  }

  if (cmd === "find") {
    for (const a of args) {
      if (FORBIDDEN_FIND_FLAGS.has(a)) return false;
    }
    return true;
  }

  if (cmd === "loadout-os") {
    return args.includes("--dry-run");
  }

  return false;
}

/**
 * Returns true iff the entire parsed Bash command is read-only across all segments.
 */
export function isBashCommandReadOnly(parsed: ParsedBashCommand): boolean {
  if (
    parsed.hasUnclosedQuote ||
    parsed.hasOutputRedirection ||
    parsed.hasHeredoc ||
    parsed.segments.length === 0
  ) {
    return false;
  }
  return parsed.segments.every(isSegmentReadOnly);
}

/**
 * Decide cheap read-only pass-through for a PreToolUse call.
 */
export function isReadOnlyPassThrough(
  toolName: string,
  parsedCommand?: ParsedBashCommand,
): boolean {
  if (READ_ONLY_TOOLS.has(toolName)) {
    return true;
  }
  if (toolName === "Bash" && parsedCommand) {
    return isBashCommandReadOnly(parsedCommand);
  }
  return false;
}

// ── Rule Evaluation Helpers ───────────────────────────────────

export function resolveRuleAction(rule: PreToolRule, seat: SeatName): RuleAction {
  const seatAction = rule.action[seat];
  if (seatAction === "block" || seatAction === "warn" || seatAction === "off") {
    return seatAction;
  }
  return rule.action.default;
}

/**
 * Enforce the `<= 5`-line message cap on every rule message (Part 1.4 / §2.3).
 */
export function capRuleMessage(rawMessage: string): string {
  const normalized = rawMessage.replace(/\r\n/g, "\n").trim();
  const lines = normalized.split("\n");
  if (lines.length <= 5) return normalized;
  return lines.slice(0, 5).join("\n");
}

// ── Decision Log ──────────────────────────────────────────────

export function appendDecisionLog(logPath: string, entry: DecisionLogEntry): void {
  const dir = dirname(logPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf-8");
}

// ── Pre-Tool Hook Execution (Parts 1 & 2) ─────────────────────

export function collectStorePaths(
  seatConfig: SeatConfig,
  extraStorePaths?: string[],
): string[] {
  const out = new Set<string>();
  const home = homedir().replace(/\\/g, "/");
  out.add(`${home}/.claude/projects/*/memory`);

  for (const p of seatConfig.storePaths) {
    if (p.trim()) out.add(p.trim());
  }
  const envStores = process.env.AI_LOADOUT_STORE_PATHS?.trim();
  if (envStores) {
    for (const part of envStores.split(/[;,]/)) {
      if (part.trim()) out.add(part.trim());
    }
  }
  if (extraStorePaths) {
    for (const p of extraStorePaths) {
      if (p.trim()) out.add(p.trim());
    }
  }
  return [...out];
}

/**
 * Execute the PreToolUse hook pipeline in-process.
 *
 * Failure policy (Part 2):
 *   - Fail open (`error_open`, exit 0) on any error before a block rule matches
 *     (unreadable stdin, bad seat map, crash in parser) and on the warn layer.
 *   - Fail closed (`error_closed`, exit 2) once a block rule has matched, even if a
 *     later step errors.
 *   - Never emit a JSON `permissionDecision: "deny"` together with exit 2.
 *   - Hard internal timeout (default 300 ms) that fails open and logs `timeout`.
 */
export function runPreTool(opts: PreToolOptions = {}): PreToolResult {
  const startPerf = performance.now();
  const nowMs = opts.nowMs ?? Date.now();
  const ts = new Date(nowMs).toISOString();
  const logPath = opts.logPath ? resolve(opts.logPath) : defaultDecisionLogPath();
  const writeLog = opts.logWriter ?? appendDecisionLog;

  const envTimeout = Number(process.env.AI_LOADOUT_PRETOOL_TIMEOUT_MS);
  const timeoutMs =
    opts.timeoutMs ??
    (Number.isFinite(envTimeout) && envTimeout > 0
      ? envTimeout
      : DEFAULT_PRETOOL_TIMEOUT_MS);

  const rawStdin = opts.stdinJson ?? "";
  let inputHash = hashToolInput(rawStdin);
  let seat: SeatName = "default";
  let session = "";
  let toolName = "unknown";
  let mode: HookMode = "enforce";
  const evaluated: string[] = [];
  const matched: MatchedRuleRecord[] = [];
  const notes: string[] = [];

  const elapsedMs = (stepMultiplier = 1): number => {
    const realElapsed = performance.now() - startPerf;
    const simulated = (opts.simulatedElapsedMs ?? 0) * stepMultiplier;
    return Math.round((realElapsed + simulated) * 100) / 100;
  };

  const safeWriteLog = (
    outcome: DecisionOutcome,
    latency: number,
  ): { entry: DecisionLogEntry; logFailed: boolean } => {
    const entry: DecisionLogEntry = {
      ts,
      seat,
      session,
      tool: toolName,
      mode,
      evaluated,
      matched,
      outcome,
      latency_ms: latency,
      input_hash: inputHash,
      ...(notes.length > 0 ? { notes } : {}),
    };
    try {
      writeLog(logPath, entry);
      return { entry, logFailed: false };
    } catch {
      return { entry, logFailed: true };
    }
  };

  // ── 1. Validate mode & parse stdin + seat map (Pre-match: fail open) ──
  let payload: PreToolStdinPayload;
  let seatConfig: SeatConfig;
  let parsedCommand: ParsedBashCommand | undefined;
  let writePayload: WritePayload | undefined;
  let cwd = process.cwd();

  try {
    const rawMode = (opts.mode ?? "enforce").trim().toLowerCase();
    if (rawMode !== "enforce" && rawMode !== "log-only") {
      notes.push("invalid_mode");
      throw new Error(`Invalid mode: ${rawMode}`);
    }
    mode = rawMode;

    payload = parsePreToolStdin(rawStdin);
    toolName = payload.tool_name;
    session = payload.session_id ?? "";
    cwd = payload.cwd && payload.cwd.trim() ? payload.cwd.trim() : process.cwd();

    // ── 2. Read-only tool pass-through (zero disk I/O, before Bash parsing) ──
    if (READ_ONLY_TOOLS.has(toolName)) {
      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
        passThrough: true,
        seat,
        outcome: "pass_through",
      };
    }

    // ── 3. Parse Bash command (and pass through read-only Bash with zero disk I/O) or extract Write/Edit payload ──
    if (toolName === "Bash") {
      const rawCmd =
        typeof payload.tool_input.command === "string"
          ? payload.tool_input.command
          : "";
      const parser = opts.bashParser ?? parseBashCommand;
      parsedCommand = parser(rawCmd);

      if (isBashCommandReadOnly(parsedCommand)) {
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          passThrough: true,
          seat,
          outcome: "pass_through",
        };
      }
    } else {
      writePayload = extractWritePayload(toolName, payload.tool_input);
    }

    inputHash = hashToolInput(payload.tool_input);
    seatConfig = loadSeatConfig(opts.seatsPath);
    seat = resolveSeat(cwd, seatConfig);

    // Check internal timeout before matching
    if (elapsedMs(1) > timeoutMs) {
      const { entry } = safeWriteLog("timeout", elapsedMs(1));
      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
        passThrough: false,
        seat,
        outcome: "timeout",
        logEntry: entry,
      };
    }
  } catch {
    notes.push("pre_match_error");
    const { entry } = safeWriteLog("error_open", elapsedMs(1));
    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
      passThrough: false,
      seat,
      outcome: "error_open",
      logEntry: entry,
    };
  }

  // ── 4. Evaluate rule table ──────────────────────────────────
  const rules = opts.rules ?? PRETOOL_RULES;
  const storePaths = collectStorePaths(seatConfig, opts.storePaths);
  const matchInput: RuleMatchInput = {
    toolName,
    toolInput: payload.tool_input,
    cwd,
    seat,
    parsedCommand,
    writePayload,
    storePaths,
    nowMs,
    recordNote: (n: string) => {
      notes.push(n);
    },
  };

  let blockMatched = false;
  let hadPostBlockError = false;
  let hadPreBlockError = false;
  let hadWarnError = false;
  const blockMessages: string[] = [];
  const warnMessages: string[] = [];

  for (let idx = 0; idx < rules.length; idx++) {
    const rule = rules[idx];
    if (!rule.tools.includes(toolName)) continue;

    const action = resolveRuleAction(rule, seat);
    if (action === "off") continue;

    // Hard internal timeout check before evaluating each rule (unless a block rule already matched)
    if (!blockMatched && elapsedMs(idx + 2) > timeoutMs) {
      const { entry } = safeWriteLog("timeout", elapsedMs(idx + 2));
      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
        passThrough: false,
        seat,
        outcome: "timeout",
        logEntry: entry,
      };
    }

    evaluated.push(rule.id);

    try {
      const rawRes = rule.match(matchInput);
      const res: RuleMatchResult =
        typeof rawRes === "boolean" ? { matched: rawRes } : rawRes;

      if (res.matched) {
        matched.push({ id: rule.id, layer: rule.layer, action });
        const rawMsg =
          typeof rule.message === "function"
            ? rule.message(res, matchInput)
            : rule.message;
        const msg = capRuleMessage(rawMsg);

        if (action === "block") {
          blockMatched = true;
          blockMessages.push(msg);
        } else if (action === "warn") {
          warnMessages.push(msg);
        }
      }
    } catch {
      notes.push(`rule_error:${rule.id}`);
      if (blockMatched) {
        // Fail closed: a block rule has already matched, so a later error becomes error_closed
        hadPostBlockError = true;
      } else if (action === "warn" || rule.layer === "B") {
        // Fail open on the warn layer
        hadWarnError = true;
      } else {
        // Error before any block rule matched: fail open
        hadPreBlockError = true;
        break;
      }
    }
  }

  // Final timeout check if no block rule matched
  if (!blockMatched && elapsedMs(rules.length + 2) > timeoutMs) {
    const { entry } = safeWriteLog("timeout", elapsedMs(rules.length + 2));
    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
      passThrough: false,
      seat,
      outcome: "timeout",
      logEntry: entry,
    };
  }

  let outcome: DecisionOutcome;
  if (blockMatched) {
    outcome = hadPostBlockError ? "error_closed" : "block";
  } else if (hadPreBlockError || hadWarnError) {
    outcome = "error_open";
  } else if (warnMessages.length > 0) {
    outcome = "warn";
  } else {
    outcome = "allow";
  }

  const finalLatency = elapsedMs(rules.length + 2);
  const { entry, logFailed } = safeWriteLog(outcome, finalLatency);

  if (logFailed) {
    if (blockMatched) {
      // Fail closed: even if logging fails after a block rule matched, exit 2
      outcome = "error_closed";
      entry.outcome = "error_closed";
    } else {
      // Fail open: logging failed on allow/warn -> error_open, exit 0
      outcome = "error_open";
      entry.outcome = "error_open";
    }
  }

  // ── 5. Mode enforcement & output formatting ─────────────────
  if (mode === "log-only") {
    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
      passThrough: false,
      seat,
      outcome,
      logEntry: entry,
    };
  }

  if (blockMatched) {
    // Part 2.3: NEVER emit a JSON permissionDecision: "deny" together with exit 2.
    // Emit only exit 2 + stderr message.
    const stderrText =
      (blockMessages.join("\n\n") || "[loadout-os pre-tool] Blocked by policy.") +
      "\n";
    return {
      exitCode: 2,
      stdout: "",
      stderr: stderrText,
      passThrough: false,
      seat,
      outcome,
      logEntry: entry,
    };
  }

  if (outcome === "warn" && warnMessages.length > 0) {
    const stdoutJson = JSON.stringify({
      suppressOutput: true,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: warnMessages.join("\n\n"),
      },
    });
    return {
      exitCode: 0,
      stdout: stdoutJson,
      stderr: "",
      passThrough: false,
      seat,
      outcome: "warn",
      logEntry: entry,
    };
  }

  return {
    exitCode: 0,
    stdout: "",
    stderr: "",
    passThrough: false,
    seat,
    outcome,
    logEntry: entry,
  };
}
