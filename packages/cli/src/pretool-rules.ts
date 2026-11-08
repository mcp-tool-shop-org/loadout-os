/**
 * Pre-tool rule table — Part 3 (Layer A hard blocks and Layer B soft reminders).
 *
 * Rules in this PR (Part 3 & Part 4.3):
 *   1. unreviewed-merge   | Layer A | memory: publisher-merges                 | skill: remote-argon
 *   2. director-quote     | Layer A | memory: never-quote-director-in-public   | skill: none (with reason)
 *   3. memory-shell-write | Layer A | memory: build-in-studio-tools-not-side-scripts | skill: loadout-os
 *   4. future-stamp       | Layer A | memory: rnd-memory-system                | skill: loadout-os
 *   5. release-reminder   | Layer B | memory: publisher-approves-every-publish | skill: full-treatment
 */

import {
  normalizePreToolPath,
  type CommandSegment,
  type PreToolRule,
  type RuleMatchInput,
  type RuleMatchResult,
} from "./pretool.js";

// ════════════════════════════════════════════════════════════════
// Rule 1: unreviewed-merge (Layer A)
// ════════════════════════════════════════════════════════════════

function isExecutableNamed(token: string, expectedName: string): boolean {
  const norm = token.replace(/\\/g, "/").toLowerCase();
  const base = norm.slice(norm.lastIndexOf("/") + 1);
  const stripped = base.replace(/\.(?:ps1|sh|cmd|bat|exe|mjs|cjs|js|py)$/i, "");
  return stripped === expectedName.toLowerCase();
}

function segmentMatchesUnreviewedMerge(seg: CommandSegment): string | null {
  if (seg.tokens.length === 0) return null;

  // Check if any token invokes `gatemerge` (directly or via pwsh/bash/sh/node wrapper)
  for (const tok of seg.tokens) {
    if (isExecutableNamed(tok, "gatemerge")) {
      return seg.raw || tok;
    }
  }

  // Check `gh [flags] pr merge ...`
  if (isExecutableNamed(seg.tokens[0], "gh")) {
    const args = seg.tokens.slice(1);
    let idx = 0;
    while (idx < args.length) {
      const a = args[idx];
      if (a === "-R" || a === "--repo" || a === "--hostname") {
        idx += 2;
      } else if (a.startsWith("-")) {
        idx += 1;
      } else {
        break;
      }
    }
    if (args[idx] === "pr" && args[idx + 1] === "merge") {
      return seg.raw || "gh pr merge";
    }
  }

  return null;
}

export function matchUnreviewedMerge(ctx: RuleMatchInput): RuleMatchResult {
  const segments = ctx.parsedCommand?.segments ?? [];
  for (const seg of segments) {
    const hit = segmentMatchesUnreviewedMerge(seg);
    if (hit) {
      return { matched: true, detail: hit };
    }
  }

  const rawCmd =
    typeof ctx.toolInput.command === "string" ? ctx.toolInput.command : "";
  if (
    /\bgh\s+(?:-[^\s]+\s+)*pr\s+merge\b/i.test(rawCmd) ||
    /(?:^|[\s/\\'"`])gatemerge(?:\.[a-z0-9]+)?\b/i.test(rawCmd)
  ) {
    return { matched: true, detail: rawCmd.trim().slice(0, 120) };
  }

  return { matched: false };
}

export const UNREVIEWED_MERGE_RULE: PreToolRule = {
  id: "unreviewed-merge",
  layer: "A",
  tools: ["Bash"],
  action: {
    default: "warn",
    rnd: "block",
    publisher: "warn",
  },
  memory: "publisher-merges",
  skill: "remote-argon",
  message: (_res, ctx) => {
    if (ctx.seat === "rnd") {
      return [
        "[unreviewed-merge] BLOCKED: R&D never merges PRs (memory: publisher-merges).",
        "Hand the branch and PR back to the Publisher after review (skill: remote-argon).",
      ].join("\n");
    }
    return [
      "[unreviewed-merge] REMINDER: Merge only with an Argon-verdict sha (memory: publisher-merges, skill: remote-argon).",
      "Note: automated verdict-sha verification arrives with the commitment ledger in step 2.",
    ].join("\n");
  },
  match: matchUnreviewedMerge,
};

// ════════════════════════════════════════════════════════════════
// Rule 2: director-quote (Layer A — port of quote-gate.py af95dd4e)
// ════════════════════════════════════════════════════════════════

/**
 * Files that legitimately contain the patterns because they document or test them
 * (ported from `quote-gate.py:58-61`).
 */
export const QUOTE_GATE_ALLOWLIST_SUFFIXES: readonly string[] = [
  "feedback/feedback_never_quote_the_director.md",
  ".claude/hooks/quote-gate.py",
];

const PUBLISHING_CMD =
  /\bgit\s+(commit|tag|notes)\b|\bgh\s+(pr|issue|release|gist)\b/i;

const SUBJECT = String.raw`(?:the\s+)?(?:Director|Mike|He|She|They|User)`;

// P1 - the void practice markers (`quote-gate.py:72-77`)
const P1_SOURCE =
  String.raw`\b(?:his|her|their)\s+words` +
  String.raw`|(?:Director|Mike)'s\s+words` +
  String.raw`|Director'?s?-word\s+block`;

// Negation in the 70-char run-up (`quote-gate.py:80-84`)
const NEGATION = new RegExp(
  String.raw`\b(?:never|not|no|don'?t|do\s+not|forbid\w*|void|stop|without|instead\s+of` +
    String.raw`|rather\s+than|avoid\w*|quoting|quote|paraphrase\w*)\b`,
  "i",
);

// P2 - past-tense attribution, possessive speech-noun, bare "Mike:", or dated attribution (`quote-gate.py:87-107`)
const ATTRIBUTION_SOURCE =
  SUBJECT +
  String.raw`\s+(?:said|replied|answered|asked|corrected|ruled|objected` +
  String.raw`|challenged|directed|wrote|added|noted|told|put\s+it` +
  String.raw`|cut\s+it\s+off|pushed\s+back|framed\s+it|called\s+it)` +
  String.raw`|(?:Director|Mike|His|Her|Their)'?s?\s+` +
  String.raw`(?:words|reply|answer|verdict|correction|phrasing|directive` +
  String.raw`|live\s+word|own\s+rule|point|question)\s*[:\u2014-]` +
  String.raw`|(?:^|\n)\s*(?:\*\*)?(?:The\s+)?(?:Director|Mike)(?:\*\*)?\s*:` +
  String.raw`|\(?\s*(?:\*\*)?(?:The\s+)?(?:Director|Mike)\s*[,(]?\s*` +
  String.raw`(?:20\d\d-\d\d-\d\d|\d\d-\d\d)\b[^\"\u201c\n:]{0,40}?\)?(?:\*\*)?\s*[:\u2014-]?` +
  String.raw`\s*(?:\*{1,2})?\s*(?=[\"\u201c][^\s\"\u201d])`;

// P3 - emphasised markdown block quote (`quote-gate.py:110`)
const P3_SOURCE = String.raw`^\s*>\s*\*{1,2}[\"\u201c]`;

const FIRST_PERSON =
  /\b(?:I|I'?m|I'?ve|I'?ll|I'?d|my|me|myself|mine|we|we'?re|we'?ve|our|us|let'?s)\b/i;

const OPEN_QUOTE = /[\"\u201c]/;
const CLOSE_QUOTE = /[\"\u201c\u201d]/;

export interface QuoteViolation {
  rule: "P1" | "P2" | "P3";
  line: string;
}

export function quotedSpanAfter(
  text: string,
  pos: number,
  window: number = 80,
): string | null {
  const seg = text.slice(pos, pos + window);
  const m = OPEN_QUOTE.exec(seg);
  if (!m) return null;
  const start = pos + m.index + m[0].length;
  const rest = text.slice(start);
  const close = CLOSE_QUOTE.exec(rest);
  if (!close) return null;
  return rest.slice(0, close.index);
}

export function isSpeechSpan(span: string): boolean {
  if (FIRST_PERSON.test(span)) return true;
  const words = span.trim().split(/\s+/).filter(Boolean);
  return words.length > 6;
}

function lineOf(text: string, pos: number): string {
  const start = text.slice(0, pos).lastIndexOf("\n") + 1;
  const end = text.indexOf("\n", pos);
  return text
    .slice(start, end !== -1 ? end : text.length)
    .trim()
    .slice(0, 150);
}

export function findQuoteViolations(text: string): QuoteViolation[] {
  if (!text) return [];
  const hits: QuoteViolation[] = [];

  const p1Re = new RegExp(P1_SOURCE, "gi");
  for (const m of text.matchAll(p1Re)) {
    const start = m.index ?? 0;
    const runUp = text.slice(Math.max(0, start - 70), start);
    if (NEGATION.test(runUp)) continue;
    hits.push({ rule: "P1", line: lineOf(text, start) });
  }

  const attrRe = new RegExp(ATTRIBUTION_SOURCE, "gim");
  for (const m of text.matchAll(attrRe)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const span = quotedSpanAfter(text, end);
    if (span && isSpeechSpan(span)) {
      hits.push({ rule: "P2", line: lineOf(text, start) });
    }
  }

  const p3Re = new RegExp(P3_SOURCE, "gm");
  for (const m of text.matchAll(p3Re)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const span = quotedSpanAfter(text, end - 1);
    if (span && FIRST_PERSON.test(span)) {
      hits.push({ rule: "P3", line: lineOf(text, start) });
    }
  }

  const seen = new Set<string>();
  const out: QuoteViolation[] = [];
  for (const h of hits) {
    if (seen.has(h.line)) continue;
    seen.add(h.line);
    out.push(h);
  }
  return out;
}

export function isQuoteGateAllowlisted(filePath?: string): boolean {
  if (!filePath) return false;
  const norm = filePath.replace(/\\/g, "/").toLowerCase();
  return QUOTE_GATE_ALLOWLIST_SUFFIXES.some((s) => norm.endsWith(s));
}

export function bashTargetsQuoteGateAllowlisted(cmd: string): boolean {
  const norm = cmd.replace(/\\/g, "/").toLowerCase();
  return QUOTE_GATE_ALLOWLIST_SUFFIXES.some((s) => norm.includes(s));
}

export function quoteTextsFromTool(
  toolName: string,
  toolInput: Record<string, unknown>,
): string[] {
  if (toolName === "Write") {
    return [typeof toolInput.content === "string" ? toolInput.content : ""];
  }
  if (toolName === "Edit") {
    return [typeof toolInput.new_string === "string" ? toolInput.new_string : ""];
  }
  if (toolName === "MultiEdit") {
    const edits = Array.isArray(toolInput.edits) ? toolInput.edits : [];
    const out: string[] = [];
    for (const item of edits) {
      if (item && typeof item === "object") {
        const ns = (item as Record<string, unknown>).new_string;
        if (typeof ns === "string") out.push(ns);
      }
    }
    return out;
  }
  if (toolName === "Bash") {
    const cmd = typeof toolInput.command === "string" ? toolInput.command : "";
    if (!PUBLISHING_CMD.test(cmd) || bashTargetsQuoteGateAllowlisted(cmd)) {
      return [];
    }
    // Unescape `\"` inside `git commit -m "... \"...\" ..."` (`quote-gate.py:210`)
    return [cmd.replace(/\\"/g, '"')];
  }
  return [];
}

export function matchDirectorQuote(ctx: RuleMatchInput): RuleMatchResult {
  const filePath =
    ctx.writePayload?.filePath ??
    (typeof ctx.toolInput.file_path === "string" ? ctx.toolInput.file_path : undefined);
  if (isQuoteGateAllowlisted(filePath)) {
    return { matched: false };
  }

  const texts = quoteTextsFromTool(ctx.toolName, ctx.toolInput);
  const violations: QuoteViolation[] = [];
  for (const t of texts) {
    violations.push(...findQuoteViolations(t));
  }

  if (violations.length === 0) {
    return { matched: false };
  }

  const first = violations[0];
  return {
    matched: true,
    detail: `[${first.rule}] ${first.line}`,
  };
}

export const DIRECTOR_QUOTE_RULE: PreToolRule = {
  id: "director-quote",
  layer: "A",
  tools: ["Write", "Edit", "MultiEdit", "Bash"],
  action: {
    default: "block",
    rnd: "block",
    publisher: "block",
  },
  memory: "never-quote-director-in-public",
  skill: "none",
  skillNoneReason:
    "Inward/outward speech prohibition enforced at write/commit time; no procedural skill workflow applies.",
  message: (res) =>
    [
      "[director-quote] BLOCKED: Never reproduce the Director's words verbatim in any artifact (memory: never-quote-director-in-public).",
      `  ${res.detail ?? "[P1/P2/P3] quote violation"}`,
      'THE FIX: Write the decision or ruling ("He chose X because Y"), never the utterance.',
      "Carve-outs: present-tense trigger phrases (<=6 words), labelled Director-authored specs, plain non-emphasised block quotes.",
    ].join("\n"),
  match: matchDirectorQuote,
};

// ════════════════════════════════════════════════════════════════
// Rule 3: memory-shell-write (Layer A)
// ════════════════════════════════════════════════════════════════

const CLAUDE_PROJECT_MEMORY_RE =
  /(?:^|[\s'"`=:(/\\~])(?:\.claude\/projects\/[^/\s'"]+\/memory)(?:$|\/|[\s'"`):;])/i;

function normalizeStoreList(storePaths: string[]): string[] {
  const out: string[] = [];
  for (const sp of storePaths) {
    if (!sp || sp.includes("*")) continue;
    const norm = normalizePreToolPath(sp).toLowerCase();
    if (norm) out.push(norm);
  }
  return out;
}

/**
 * True if `candidatePath` is inside `~/.claude/projects/<slug>/memory/**`
 * or inside any configured store path from `seats.json` / `storePaths`.
 */
export function isMemoryStorePath(
  candidatePath: string,
  storePaths: string[],
): boolean {
  if (!candidatePath || !candidatePath.trim()) return false;
  const rawNorm = candidatePath.trim().replace(/\\/g, "/");
  if (CLAUDE_PROJECT_MEMORY_RE.test(rawNorm)) {
    return true;
  }

  const normCandidate = normalizePreToolPath(candidatePath).toLowerCase();
  if (!normCandidate) return false;
  if (/\/\.claude\/projects\/[^/]+\/memory(?:$|\/)/i.test(normCandidate)) {
    return true;
  }

  for (const normStore of normalizeStoreList(storePaths)) {
    if (
      normCandidate === normStore ||
      normCandidate.startsWith(normStore + "/")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * True if arbitrary script text (e.g. a `python -c` or heredoc body) mentions
 * a memory store path.
 */
export function textMentionsMemoryStorePath(
  text: string,
  storePaths: string[],
): boolean {
  if (!text) return false;
  const slashText = text.replace(/\\/g, "/");
  if (CLAUDE_PROJECT_MEMORY_RE.test(slashText)) {
    return true;
  }
  const lowerText = slashText.toLowerCase();
  for (const normStore of normalizeStoreList(storePaths)) {
    if (normStore.length >= 4 && lowerText.includes(normStore)) {
      return true;
    }
    // Also match MSYS form `/e/...` if normStore is `e:/...`
    if (/^[a-z]:\//.test(normStore)) {
      const msysStore = `/${normStore[0]}/${normStore.slice(3)}`;
      if (lowerText.includes(msysStore)) return true;
    }
  }
  return false;
}

const INLINE_SCRIPT_WRITE_CALL_RE =
  /\bopen\s*\([^)]*,\s*(?:mode\s*=\s*)?['"][wax+][b+]*['"]|\bwrite_text\s*\(|\bwrite_bytes\s*\(|\b(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream)\s*\(/i;

const GIT_STORE_WRITE_SUBCOMMANDS = new Set([
  "commit",
  "checkout",
  "reset",
  "revert",
  "clean",
  "rm",
  "mv",
  "merge",
  "rebase",
  "stash",
]);

function checkSegmentMemoryShellWrite(
  seg: CommandSegment,
  fullRawCommand: string,
  heredocBodies: string[],
  storePaths: string[],
): string | null {
  // 1. Check output redirections `>` / `>>` / `&>` / `>|` on any segment
  for (const r of seg.redirections) {
    if (r.op.includes(">") && isMemoryStorePath(r.target, storePaths)) {
      return `redirection ${r.op} ${r.target}`;
    }
  }

  if (seg.tokens.length === 0) return null;

  const cmd0 = seg.tokens[0];
  const args = seg.tokens.slice(1);

  // Allowed: any `loadout-os ...` command (without output redirection to store)
  if (
    isExecutableNamed(cmd0, "loadout-os") ||
    (isExecutableNamed(cmd0, "node") &&
      args[0] &&
      args[0].replace(/\\/g, "/").endsWith("loadout-os.js"))
  ) {
    return null;
  }

  // 2. `tee` targeting a memory store path
  if (isExecutableNamed(cmd0, "tee")) {
    for (const a of args) {
      if (!a.startsWith("-") && isMemoryStorePath(a, storePaths)) {
        return `tee ${a}`;
      }
    }
  }

  // 3. `sed -i` / `--in-place` targeting a memory store path
  if (isExecutableNamed(cmd0, "sed")) {
    const hasInPlace = args.some(
      (a) =>
        a === "-i" ||
        a.startsWith("-i") ||
        a === "--in-place" ||
        a.startsWith("--in-place=") ||
        (a.startsWith("-") && !a.startsWith("--") && a.slice(1).includes("i")),
    );
    if (hasInPlace) {
      for (const a of args) {
        if (!a.startsWith("-") && isMemoryStorePath(a, storePaths)) {
          return `sed -i ${a}`;
        }
      }
    }
  }

  // 4. `rm`, `touch`, `mv`, `cp` targeting a memory store path
  if (
    isExecutableNamed(cmd0, "rm") ||
    isExecutableNamed(cmd0, "touch") ||
    isExecutableNamed(cmd0, "mv")
  ) {
    for (const a of args) {
      if (!a.startsWith("-") && isMemoryStorePath(a, storePaths)) {
        return `${cmd0} ${a}`;
      }
    }
  }

  if (isExecutableNamed(cmd0, "cp")) {
    const positional: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === "-t" || a === "--target-directory") {
        const targetDir = args[i + 1];
        if (targetDir && isMemoryStorePath(targetDir, storePaths)) {
          return `cp -t ${targetDir}`;
        }
        i++;
        continue;
      }
      if (a.startsWith("--target-directory=")) {
        const targetDir = a.slice("--target-directory=".length);
        if (isMemoryStorePath(targetDir, storePaths)) {
          return `cp ${a}`;
        }
        continue;
      }
      if (!a.startsWith("-")) {
        positional.push(a);
      }
    }
    if (positional.length >= 2) {
      const dest = positional[positional.length - 1];
      if (isMemoryStorePath(dest, storePaths)) {
        return `cp -> ${dest}`;
      }
    }
  }

  // 5. `git -C <store> commit|checkout|reset`
  if (isExecutableNamed(cmd0, "git")) {
    let idx = 0;
    const gitDirs: string[] = [];
    while (idx < args.length) {
      const a = args[idx];
      if (a === "-C" || a === "--git-dir" || a === "--work-tree") {
        if (args[idx + 1]) gitDirs.push(args[idx + 1]);
        idx += 2;
      } else if (a.startsWith("--git-dir=")) {
        gitDirs.push(a.slice("--git-dir=".length));
        idx += 1;
      } else if (a.startsWith("--work-tree=")) {
        gitDirs.push(a.slice("--work-tree=".length));
        idx += 1;
      } else if (a === "-c") {
        idx += 2;
      } else if (a.startsWith("-")) {
        idx += 1;
      } else {
        break;
      }
    }
    const sub = args[idx];
    if (
      sub &&
      GIT_STORE_WRITE_SUBCOMMANDS.has(sub) &&
      gitDirs.some((d) => isMemoryStorePath(d, storePaths))
    ) {
      return `git -C <store> ${sub}`;
    }
  }

  // 6. `python` / `python3` / `py` / `node` with `-c` / `-e` or heredoc naming store + write call
  if (
    isExecutableNamed(cmd0, "python") ||
    isExecutableNamed(cmd0, "python3") ||
    isExecutableNamed(cmd0, "py") ||
    isExecutableNamed(cmd0, "node")
  ) {
    const combinedScript = [
      seg.raw,
      ...seg.tokens,
      ...heredocBodies,
      fullRawCommand,
    ].join("\n");
    if (
      textMentionsMemoryStorePath(combinedScript, storePaths) &&
      INLINE_SCRIPT_WRITE_CALL_RE.test(combinedScript)
    ) {
      return `${cmd0} inline/heredoc write to memory store`;
    }
  }

  return null;
}

export function matchMemoryShellWrite(ctx: RuleMatchInput): RuleMatchResult {
  const parsed = ctx.parsedCommand;
  const rawCmd =
    typeof ctx.toolInput.command === "string" ? ctx.toolInput.command : "";
  const heredocBodies = parsed?.heredocBodies ?? [];

  if (parsed) {
    for (const seg of parsed.segments) {
      const hit = checkSegmentMemoryShellWrite(
        seg,
        rawCmd,
        heredocBodies,
        ctx.storePaths,
      );
      if (hit) {
        return { matched: true, detail: hit };
      }
    }
  }

  return { matched: false };
}

export const MEMORY_SHELL_WRITE_RULE: PreToolRule = {
  id: "memory-shell-write",
  layer: "A",
  tools: ["Bash"],
  action: {
    default: "block",
    rnd: "block",
    publisher: "block",
  },
  memory: "build-in-studio-tools-not-side-scripts",
  skill: "loadout-os",
  message: (res) =>
    [
      "[memory-shell-write] BLOCKED: Direct shell write into a memory store path is forbidden (memory: build-in-studio-tools-not-side-scripts).",
      `  Matched: ${res.detail ?? "shell write targeting memory store"}`,
      "Use `loadout-os memories place|move|sync-summaries` or Claude Code's Write/Edit tools instead (skill: loadout-os).",
    ].join("\n"),
  match: matchMemoryShellWrite,
};

// ════════════════════════════════════════════════════════════════
// Rule 4: future-stamp (Layer A)
// ════════════════════════════════════════════════════════════════

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export function isStoreOrBoardFile(
  filePath: string | undefined,
  storePaths: string[],
): boolean {
  if (!filePath || !filePath.trim()) return false;
  if (isMemoryStorePath(filePath, storePaths)) return true;
  const norm = filePath.replace(/\\/g, "/");
  const base = norm.slice(norm.lastIndexOf("/") + 1);
  return /^(?:board|.*[-_]board)\.md$/i.test(base);
}

/**
 * Parse a tool-stamped timestamp string (`2026-11-08 15:03 ET`, `~15:05 ET`, or ISO 8601)
 * into epoch milliseconds relative to the local timezone of `nowMs`.
 * Returns `null` if the string cannot be parsed.
 */
export function parseToolStampedTime(
  rawValue: string,
  nowMs: number,
): number | null {
  let s = rawValue.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  if (!s) return null;

  // Form 1: `2026-11-08 15:03 ET` / `2026-11-08 ~15:03 ET` / `2026-11-08 15:03:00 ET`
  const dateTimeEt = s.match(
    /^~?\s*(\d{4})-(\d{2})-(\d{2})\s+~?(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(?:ET|EST|EDT))?(?:\s*(?:[(;\u2014-].*)?)$/i,
  );
  if (dateTimeEt) {
    const year = Number(dateTimeEt[1]);
    const month = Number(dateTimeEt[2]);
    const day = Number(dateTimeEt[3]);
    const hour = Number(dateTimeEt[4]);
    const minute = Number(dateTimeEt[5]);
    const second = dateTimeEt[6] !== undefined ? Number(dateTimeEt[6]) : 0;
    if (
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31 &&
      hour >= 0 &&
      hour <= 23 &&
      minute >= 0 &&
      minute <= 59 &&
      second >= 0 &&
      second <= 59
    ) {
      return new Date(year, month - 1, day, hour, minute, second, 0).getTime();
    }
    return null;
  }

  // Form 2: `~15:05 ET` / `15:05 ET` (anchored to local calendar date of `nowMs`)
  const timeOnlyEt = s.match(
    /^~?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:ET|EST|EDT)(?:\s*(?:[(;\u2014-].*)?)$/i,
  );
  if (timeOnlyEt) {
    const hour = Number(timeOnlyEt[1]);
    const minute = Number(timeOnlyEt[2]);
    const second = timeOnlyEt[3] !== undefined ? Number(timeOnlyEt[3]) : 0;
    if (
      hour >= 0 &&
      hour <= 23 &&
      minute >= 0 &&
      minute <= 59 &&
      second >= 0 &&
      second <= 59
    ) {
      const ref = new Date(nowMs);
      return new Date(
        ref.getFullYear(),
        ref.getMonth(),
        ref.getDate(),
        hour,
        minute,
        second,
        0,
      ).getTime();
    }
    return null;
  }

  // Form 3a: ISO 8601 date-time (`2026-11-08T15:03:00Z`, `2026-11-08T15:03:00-05:00`, `2026-11-08T15:03`)
  if (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/i.test(
      s,
    )
  ) {
    const ms = Date.parse(s);
    return Number.isFinite(ms) ? ms : null;
  }

  // Form 3b: ISO 8601 date-only (`2026-11-08`) -> local start of day
  const isoDateOnly = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateOnly) {
    const year = Number(isoDateOnly[1]);
    const month = Number(isoDateOnly[2]);
    const day = Number(isoDateOnly[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
    }
    return null;
  }

  return null;
}

interface ExtractedStampField {
  field: string;
  rawValue: string;
}

export function extractToolStampedFields(text: string): ExtractedStampField[] {
  const out: ExtractedStampField[] = [];
  if (!text) return out;

  // `**Last updated:** <value>` or `**Last updated**: <value>`
  const lastUpdatedRe = /^\s*\*\*Last updated(?::\*\*|\*\*:)\s*(.+?)\s*$/gim;
  for (const m of text.matchAll(lastUpdatedRe)) {
    const val = (m[1] ?? "").trim();
    if (val) {
      out.push({ field: "Last updated", rawValue: val });
    }
  }

  // Frontmatter keys `created_at`, `modified`, `verified_at`
  const fmFieldRe = /^\s*(created_at|modified|verified_at)\s*:\s*(.+?)\s*$/gm;
  for (const m of text.matchAll(fmFieldRe)) {
    const key = m[1];
    const val = (m[2] ?? "").trim();
    if (key && val) {
      out.push({ field: key, rawValue: val });
    }
  }

  return out;
}

export function matchFutureStamp(ctx: RuleMatchInput): RuleMatchResult {
  const wp = ctx.writePayload;
  const filePath =
    wp?.filePath ??
    (typeof ctx.toolInput.file_path === "string"
      ? ctx.toolInput.file_path
      : undefined);

  if (!isStoreOrBoardFile(filePath, ctx.storePaths)) {
    return { matched: false };
  }

  const texts = wp?.texts ?? [];
  const maxAllowedMs = ctx.nowMs + FIVE_MINUTES_MS;

  for (const text of texts) {
    const fields = extractToolStampedFields(text);
    for (const item of fields) {
      const parsedMs = parseToolStampedTime(item.rawValue, ctx.nowMs);
      if (parsedMs === null) {
        ctx.recordNote(
          `unparseable_timestamp:${item.field}=${item.rawValue.slice(0, 40)}`,
        );
        continue;
      }
      if (parsedMs > maxAllowedMs) {
        return {
          matched: true,
          detail: `${item.field}: ${item.rawValue}`,
        };
      }
    }
  }

  return { matched: false };
}

export const FUTURE_STAMP_RULE: PreToolRule = {
  id: "future-stamp",
  layer: "A",
  tools: ["Write", "Edit", "MultiEdit"],
  action: {
    default: "block",
    rnd: "block",
    publisher: "block",
  },
  memory: "rnd-memory-system",
  skill: "loadout-os",
  message: (res) =>
    [
      "[future-stamp] BLOCKED: Tool-stamped field is more than 5 minutes ahead of the OS clock (memory: rnd-memory-system).",
      `  Field: ${res.detail ?? "future timestamp"}`,
      "Stamp times from the real OS clock or let `loadout-os` stamp them (skill: loadout-os).",
    ].join("\n"),
  match: matchFutureStamp,
};

// ════════════════════════════════════════════════════════════════
// Rule 5: release-reminder (Layer B — soft warn only)
// ════════════════════════════════════════════════════════════════

function segmentMatchesReleaseReminder(seg: CommandSegment): string | null {
  if (seg.tokens.length === 0) return null;
  const cmd0 = seg.tokens[0];
  const args = seg.tokens.slice(1);

  // `npm publish` (excluding `--dry-run`)
  if (isExecutableNamed(cmd0, "npm")) {
    if (args.includes("publish") && !args.includes("--dry-run")) {
      return seg.raw || "npm publish";
    }
  }

  // `gh release create`
  if (isExecutableNamed(cmd0, "gh")) {
    let idx = 0;
    while (idx < args.length) {
      const a = args[idx];
      if (a === "-R" || a === "--repo" || a === "--hostname") {
        idx += 2;
      } else if (a.startsWith("-")) {
        idx += 1;
      } else {
        break;
      }
    }
    if (args[idx] === "release" && args[idx + 1] === "create") {
      return seg.raw || "gh release create";
    }
  }

  // `git push --tags` (or `git push <remote> --tags`)
  if (isExecutableNamed(cmd0, "git")) {
    let idx = 0;
    while (idx < args.length) {
      const a = args[idx];
      if (a === "-C" || a === "-c" || a === "--git-dir" || a === "--work-tree") {
        idx += 2;
      } else if (a.startsWith("-")) {
        idx += 1;
      } else {
        break;
      }
    }
    if (
      args[idx] === "push" &&
      args.slice(idx + 1).includes("--tags") &&
      !args.includes("--dry-run") &&
      !args.includes("-n")
    ) {
      return seg.raw || "git push --tags";
    }
  }

  return null;
}

export function matchReleaseReminder(ctx: RuleMatchInput): RuleMatchResult {
  const segments = ctx.parsedCommand?.segments ?? [];
  for (const seg of segments) {
    const hit = segmentMatchesReleaseReminder(seg);
    if (hit) {
      return { matched: true, detail: hit };
    }
  }
  return { matched: false };
}

export const RELEASE_REMINDER_RULE: PreToolRule = {
  id: "release-reminder",
  layer: "B",
  tools: ["Bash"],
  action: {
    default: "warn",
    rnd: "warn",
    publisher: "warn",
  },
  memory: "publisher-approves-every-publish",
  skill: "full-treatment",
  message: (res) =>
    [
      "[release-reminder] REMINDER: Every publish/release requires Publisher approval and the release checklist (memory: publisher-approves-every-publish, skill: full-treatment).",
      `  Command: ${res.detail ?? "publish/release"}`,
    ].join("\n"),
  match: matchReleaseReminder,
};

// ════════════════════════════════════════════════════════════════
// Exported Rule Table
// ════════════════════════════════════════════════════════════════

export const PRETOOL_RULES: readonly PreToolRule[] = [
  UNREVIEWED_MERGE_RULE,
  DIRECTOR_QUOTE_RULE,
  MEMORY_SHELL_WRITE_RULE,
  FUTURE_STAMP_RULE,
  RELEASE_REMINDER_RULE,
];
