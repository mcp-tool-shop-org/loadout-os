/**
 * Pre-tool rule table — Part 3 (Layer A hard blocks and Layer B soft reminders).
 *
 * Rules in this PR (Part 3, Part 4.3, and #25 enforce-readiness):
 *   1. unreviewed-merge   | warn-only | memory: { rnd: publisher-merges, publisher: publisher-merges-as-coordinator }
 *   2. director-quote     | Layer A   | memory: { rnd: never-quote-director-in-public, publisher: feedback-never-quote-director }
 *   3. memory-shell-write | Layer A   | memory: { rnd: build-in-studio-tools-not-side-scripts, publisher: project-memory-system }
 *   4. future-stamp       | Layer A   | memory: { rnd: rnd-memory-system, publisher: feedback-eastern-time }
 *   5. release-reminder   | Layer B   | memory: { rnd: publishing-tags-need-publisher-ok / publisher-approves-every-publish }
 */

import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join, posix, resolve } from "node:path";

import {
  defaultRepliesDir,
  extractSedWriteTargets,
  normalizePreToolPath,
  parseBashCommand,
  prenormalizeStorePaths,
  resolveRuleMemory,
  type CommandSegment,
  type PreToolRule,
  type RuleMatchInput,
  type RuleMatchResult,
} from "./pretool.js";

const HOMEDIR_SLASH = homedir().replace(/\\/g, "/");

// ════════════════════════════════════════════════════════════════
// Rule 1: unreviewed-merge (warn-only on every seat permanently — #25 ruling 2)
// ════════════════════════════════════════════════════════════════

function isExecutableNamed(token: string, expectedName: string): boolean {
  const norm = token.replace(/\\/g, "/").toLowerCase();
  const base = norm.slice(norm.lastIndexOf("/") + 1);
  const stripped = base.replace(/\.(?:ps1|sh|cmd|bat|exe|mjs|cjs|js|py)$/i, "");
  return stripped === expectedName.toLowerCase();
}

export interface UnreviewedMergeHit {
  detail: string;
  headSha?: string;
  repo?: string;
  prNumber?: string;
}

const HEX_SHA_RE = /^[0-9a-f]{7,40}$/i;

function extractMergeHitFromSegment(seg: CommandSegment): UnreviewedMergeHit | null {
  if (seg.tokens.length === 0) return null;

  // 1. Check if any token invokes `gatemerge` (directly or via pwsh/bash/sh/node wrapper)
  let gatemergeIdx = -1;
  for (let i = 0; i < seg.tokens.length; i++) {
    if (isExecutableNamed(seg.tokens[i], "gatemerge")) {
      gatemergeIdx = i;
      break;
    }
  }
  if (gatemergeIdx !== -1) {
    const after = seg.tokens.slice(gatemergeIdx + 1);
    let headSha: string | undefined;
    let repo: string | undefined;
    let prNumber: string | undefined;
    const positional: string[] = [];

    for (let i = 0; i < after.length; i++) {
      const a = after[i];
      if (
        (a === "--head" || a === "-Head" || a === "--match-head-commit") &&
        after[i + 1]
      ) {
        const val = after[++i];
        if (HEX_SHA_RE.test(val)) headSha = val.toLowerCase();
      } else if (a.startsWith("--head=") || a.startsWith("--match-head-commit=")) {
        const val = a.slice(a.indexOf("=") + 1);
        if (HEX_SHA_RE.test(val)) headSha = val.toLowerCase();
      } else if ((a === "--repo" || a === "-Repo" || a === "-R") && after[i + 1]) {
        repo = after[++i];
      } else if (a.startsWith("--repo=")) {
        repo = a.slice("--repo=".length);
      } else if ((a === "--pr" || a === "-Pr") && after[i + 1]) {
        prNumber = after[++i].replace(/^#/, "");
      } else if (a.startsWith("--pr=")) {
        prNumber = a.slice("--pr=".length).replace(/^#/, "");
      } else if (!a.startsWith("-")) {
        positional.push(a);
      }
    }

    // `gatemerge.sh <owner/repo> <pr> <expected-head-prefix>`
    if (!repo && positional.length >= 1 && !/^\d+$/.test(positional[0])) {
      repo = positional[0];
    }
    if (!prNumber) {
      const prTok = positional.find((t) => /^#?\d+$/.test(t));
      if (prTok) prNumber = prTok.replace(/^#/, "");
    }
    if (!headSha) {
      if (positional.length >= 3 && HEX_SHA_RE.test(positional[2])) {
        headSha = positional[2].toLowerCase();
      } else {
        const hexTok = positional.find((t) => /^[0-9a-f]{7,40}$/i.test(t) && !/^\d+$/.test(t));
        if (hexTok) headSha = hexTok.toLowerCase();
      }
    }
    return { detail: seg.raw || seg.tokens[gatemergeIdx], headSha, repo, prNumber };
  }

  // 2. Check `gh [flags] pr merge ...`
  if (isExecutableNamed(seg.tokens[0], "gh")) {
    const args = seg.tokens.slice(1);
    let idx = 0;
    let repo: string | undefined;
    while (idx < args.length) {
      const a = args[idx];
      if ((a === "-R" || a === "--repo") && args[idx + 1]) {
        repo = args[idx + 1];
        idx += 2;
      } else if (a.startsWith("--repo=")) {
        repo = a.slice("--repo=".length);
        idx += 1;
      } else if (a.startsWith("-R") && a.length > 2) {
        repo = a.slice(2);
        idx += 1;
      } else if (a === "--hostname") {
        idx += 2;
      } else if (a.startsWith("-")) {
        idx += 1;
      } else {
        break;
      }
    }
    if (args[idx] === "pr" && args[idx + 1] === "merge") {
      let headSha: string | undefined;
      let prNumber: string | undefined;
      for (let i = idx + 2; i < args.length; i++) {
        const a = args[i];
        if (
          (a === "--match-head-commit" || a === "--head") &&
          args[i + 1]
        ) {
          const val = args[++i];
          if (HEX_SHA_RE.test(val)) headSha = val.toLowerCase();
        } else if (a.startsWith("--match-head-commit=") || a.startsWith("--head=")) {
          const val = a.slice(a.indexOf("=") + 1);
          if (HEX_SHA_RE.test(val)) headSha = val.toLowerCase();
        } else if ((a === "-R" || a === "--repo") && args[i + 1]) {
          repo = args[++i];
        } else if (a.startsWith("--repo=")) {
          repo = a.slice("--repo=".length);
        } else if (a.startsWith("-R") && a.length > 2) {
          repo = a.slice(2);
        } else if (
          a === "-t" ||
          a === "--subject" ||
          a === "-b" ||
          a === "--body" ||
          a === "-F" ||
          a === "--body-file" ||
          a === "-A" ||
          a === "--author-email"
        ) {
          i++;
        } else if (!a.startsWith("-")) {
          const urlMatch = a.match(/(?:^|\/)([^/]+)\/([^/]+)\/pull\/(\d+)(?:$|\/|\?)/i);
          if (urlMatch) {
            if (!repo) repo = `${urlMatch[1]}/${urlMatch[2]}`;
            if (!prNumber) prNumber = urlMatch[3];
          } else if (/^#?\d+$/.test(a) && !prNumber) {
            prNumber = a.replace(/^#/, "");
          }
        }
      }
      return { detail: seg.raw || "gh pr merge", headSha, repo, prNumber };
    }
  }

  return null;
}

/**
 * Scan `repliesDir` for any `.md` review reply whose first line names the same
 * repository and PR number (`#<pr>`) and contains `PASS at <head8>` matching `headSha`
 * (comparing at least 7–8 leading hex chars).
 */
export function hasReviewPassAtHead(
  repliesDir: string | undefined,
  headSha: string,
  repo?: string,
  prNumber?: string,
): boolean {
  if (!repliesDir || !repliesDir.trim()) return false;
  const cleanHead = headSha.trim().toLowerCase();
  if (!HEX_SHA_RE.test(cleanHead)) return false;
  const head8 = cleanHead.slice(0, 8);

  const repoShort = (repo ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\.git$/i, "")
    .split("/")
    .filter(Boolean)
    .pop()
    ?.toLowerCase();
  const cleanPr = (prNumber ?? "").trim().replace(/^#/, "");
  if (!repoShort || !/^\d+$/.test(cleanPr)) {
    return false;
  }

  let entries: string[];
  try {
    entries = readdirSync(repliesDir);
  } catch {
    return false;
  }

  const escapedRepo = repoShort.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const repoRe = new RegExp(`(?:^|[^a-z0-9_-])${escapedRepo}(?:$|[^a-z0-9_-])`, "i");
  const prRe = new RegExp(`(?:#|\\bPR\\s*#?)${cleanPr}\\b`, "i");

  const buf = Buffer.allocUnsafe(256);
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    const fullPath = join(repliesDir, name);
    let fd: number | null = null;
    try {
      fd = openSync(fullPath, "r");
      const bytesRead = readSync(fd, buf, 0, 256, 0);
      if (bytesRead <= 0) continue;
      const headText = buf.subarray(0, bytesRead).toString("utf-8");
      const nlIdx = headText.indexOf("\n");
      const firstLine = (nlIdx === -1 ? headText : headText.slice(0, nlIdx)).trim();
      const m = firstLine.match(/\bPASS\s+at\s+([0-9a-f]{7,40})\b/i);
      if (m && m[1]) {
        const replySha = m[1].toLowerCase();
        const cmpLen = Math.min(8, head8.length, replySha.length);
        if (
          cmpLen >= 7 &&
          replySha.slice(0, cmpLen) === head8.slice(0, cmpLen) &&
          repoRe.test(firstLine) &&
          prRe.test(firstLine)
        ) {
          return true;
        }
      }
    } catch {
      /* ignore unreadable file */
    } finally {
      if (fd !== null) {
        try {
          closeSync(fd);
        } catch {
          /* ignore */
        }
      }
    }
  }
  return false;
}

export function matchUnreviewedMerge(ctx: RuleMatchInput): RuleMatchResult {
  const rawCmd =
    typeof ctx.toolInput.command === "string" ? ctx.toolInput.command : "";
  if (rawCmd && !/merge/i.test(rawCmd)) {
    return { matched: false };
  }

  const repliesDir = ctx.repliesDir ?? defaultRepliesDir();
  const segments = ctx.parsedCommand?.segments ?? [];
  for (const seg of segments) {
    const hit = extractMergeHitFromSegment(seg);
    if (hit) {
      const effectiveRepo =
        hit.repo ??
        (ctx.cwd
          ? normalizePreToolPath(ctx.cwd).split("/").filter(Boolean).pop()
          : undefined);
      if (
        repliesDir &&
        hit.headSha &&
        hasReviewPassAtHead(repliesDir, hit.headSha, effectiveRepo, hit.prNumber)
      ) {
        return { matched: false };
      }
      return { matched: true, detail: hit.detail };
    }
  }

  return { matched: false };
}

export const UNREVIEWED_MERGE_RULE: PreToolRule = {
  id: "unreviewed-merge",
  layer: "A",
  tools: ["Bash"],
  action: {
    default: "warn",
    rnd: "warn",
    publisher: "warn",
  },
  memory: {
    default: "publisher-merges",
    rnd: "publisher-merges",
    publisher: "publisher-merges-as-coordinator",
  },
  skill: "remote-argon",
  message: (_res, ctx) => {
    const memId = resolveRuleMemory(UNREVIEWED_MERGE_RULE, ctx.seat);
    if (ctx.seat === "rnd") {
      return [
        `[unreviewed-merge] REMINDER: R&D hands reviewed PRs to the Publisher to merge; merge only with an Argon-verdict sha (memory: ${memId}, skill: remote-argon).`,
        "Pass `--match-head-commit <head8>` (or `gatemerge <repo> <pr> <head8>`) with a matching `PASS at <head8>` reply to suppress.",
      ].join("\n");
    }
    return [
      `[unreviewed-merge] REMINDER: Merge only with an Argon-verdict sha (memory: ${memId}, skill: remote-argon, ledger step 2).`,
      "Pass `--match-head-commit <head8>` (or `gatemerge <repo> <pr> <head8>`) with a matching `PASS at <head8>` reply to suppress.",
    ].join("\n");
  },
  match: matchUnreviewedMerge,
};

// ════════════════════════════════════════════════════════════════
// Rule 2: director-quote (Layer A — port of quote-gate.py af95dd4e)
// ════════════════════════════════════════════════════════════════

/**
 * Files that legitimately contain the patterns because they document or test them
 * (ported from `quote-gate.py:58-61`, plus loadout-os's own quote-gate rule/test files).
 */
export const QUOTE_GATE_ALLOWLIST_SUFFIXES: readonly string[] = [
  "feedback/feedback_never_quote_the_director.md",
  ".claude/hooks/quote-gate.py",
  "packages/cli/src/pretool-rules.ts",
  "packages/cli/src/tests/pretool.test.ts",
];

const PUBLISHING_CMD =
  /\bgit\s+(commit|tag|notes)\b|\bgh\s+(pr|issue|release|gist)\b/i;

const SUBJECT = String.raw`(?:the\s+)?(?:Director|Mike|He|She|They|User)`;

// P1 - the void practice markers (`quote-gate.py:72-77`)
const P1_SOURCE =
  String.raw`\b(?:his|her|their)\s+words` +
  String.raw`|(?:Director|Mike)'s\s+words` +
  String.raw`|Director'?s?-word\s+block`;

const P1_QUICK_RE = /\b(?:words|block)\b/i;
const P1_RE = new RegExp(P1_SOURCE, "gi");

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

const ATTRIBUTION_RE = new RegExp(ATTRIBUTION_SOURCE, "gim");

// P3 - emphasised markdown block quote (`quote-gate.py:110`)
const P3_SOURCE = String.raw`^\s*>\s*\*{1,2}[\"\u201c]`;
const P3_RE = new RegExp(P3_SOURCE, "gm");

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

  if (P1_QUICK_RE.test(text)) {
    P1_RE.lastIndex = 0;
    for (const m of text.matchAll(P1_RE)) {
      const start = m.index ?? 0;
      const runUp = text.slice(Math.max(0, start - 70), start);
      if (NEGATION.test(runUp)) continue;
      hits.push({ rule: "P1", line: lineOf(text, start) });
    }
  }

  if (OPEN_QUOTE.test(text)) {
    ATTRIBUTION_RE.lastIndex = 0;
    for (const m of text.matchAll(ATTRIBUTION_RE)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      const span = quotedSpanAfter(text, end);
      if (span && isSpeechSpan(span)) {
        hits.push({ rule: "P2", line: lineOf(text, start) });
      }
    }

    if (text.includes(">")) {
      P3_RE.lastIndex = 0;
      for (const m of text.matchAll(P3_RE)) {
        const start = m.index ?? 0;
        const end = start + m[0].length;
        const span = quotedSpanAfter(text, end - 1);
        if (span && FIRST_PERSON.test(span)) {
          hits.push({ rule: "P3", line: lineOf(text, start) });
        }
      }
    }
  }

  if (hits.length === 0) return [];

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
  memory: {
    default: "never-quote-director-in-public",
    rnd: "never-quote-director-in-public",
    publisher: "feedback-never-quote-director",
  },
  skill: "none",
  skillNoneReason:
    "Inward/outward speech prohibition enforced at write/commit time; no procedural skill workflow applies.",
  message: (res, ctx) => {
    const memId = resolveRuleMemory(DIRECTOR_QUOTE_RULE, ctx.seat);
    return [
      `[director-quote] BLOCKED: Never reproduce the Director's words verbatim in any artifact (memory: ${memId}).`,
      `  ${res.detail ?? "[P1/P2/P3] quote violation"}`,
      'THE FIX: Write the decision or ruling ("He chose X because Y"), never the utterance.',
      "Carve-outs: present-tense trigger phrases (<=6 words), labelled Director-authored specs, plain non-emphasised block quotes.",
    ].join("\n");
  },
  match: matchDirectorQuote,
};

// ════════════════════════════════════════════════════════════════
// Rule 3: memory-shell-write (Layer A)
// ════════════════════════════════════════════════════════════════

const CLAUDE_PROJECT_MEMORY_RE =
  /(?:^|[\s'"`=:(/\\~])(?:\.claude\/projects\/[^/\s'"]+\/memory)(?:$|\/|[\s'"`):;])/i;

function expandEnvHomeInText(s: string): string {
  return s
    .replace(/%USERPROFILE%/gi, HOMEDIR_SLASH)
    .replace(/\$\{?USERPROFILE\}?/g, HOMEDIR_SLASH)
    .replace(/\$\{?HOME\}?/g, HOMEDIR_SLASH)
    .replace(/(^|[\s'"`=:(])~\//g, `$1${HOMEDIR_SLASH}/`);
}

function resolveCandidateWithCwd(
  candidatePath: string,
  effectiveCwd?: string,
): string {
  const normCandidate = normalizePreToolPath(candidatePath);
  if (!normCandidate) return "";
  // Already absolute (POSIX `/` or Windows `x:/`)
  if (normCandidate.startsWith("/") || /^[a-zA-Z]:\//.test(normCandidate)) {
    return posix.normalize(normCandidate);
  }
  if (!effectiveCwd) return normCandidate;
  const normCwd = normalizePreToolPath(effectiveCwd);
  if (!normCwd) return normCandidate;
  return posix.normalize(`${normCwd}/${normCandidate}`);
}

function matchesStoreNorm(normCandidate: string, normStores: string[]): boolean {
  if (!normCandidate) return false;
  const lower = normCandidate.toLowerCase();
  if (/\/\.claude\/projects\/[^/]+\/memory(?:$|\/)/i.test(lower)) {
    return true;
  }
  for (const normStore of normStores) {
    if (lower === normStore || lower.startsWith(normStore + "/")) {
      return true;
    }
  }
  return false;
}

/**
 * True if `candidatePath` is inside `~/.claude/projects/<slug>/memory/**`
 * or inside any configured store path from `seats.json` / `storePaths`
 * (resolving relative candidates against `effectiveCwd` when provided — #25 P2.6).
 */
export function isMemoryStorePath(
  candidatePath: string,
  storePaths: string[],
  effectiveCwd?: string,
  prenormalizedStores?: string[],
): boolean {
  if (!candidatePath || !candidatePath.trim()) return false;
  const trimmed = candidatePath.trim();

  // #25 P2.9: A sed substitution expression `s/.../.../` or `s|...|...|` is not a file path
  if (/^s[\/|#@!,;]/i.test(trimmed)) {
    return false;
  }

  const expanded = expandEnvHomeInText(trimmed).replace(/\\/g, "/").replace(/\/+/g, "/");
  if (CLAUDE_PROJECT_MEMORY_RE.test(expanded)) {
    return true;
  }

  const normStores = prenormalizedStores ?? prenormalizeStorePaths(storePaths);
  const directNorm = normalizePreToolPath(trimmed);
  if (matchesStoreNorm(directNorm, normStores)) {
    return true;
  }

  if (effectiveCwd) {
    const resolvedNorm = resolveCandidateWithCwd(trimmed, effectiveCwd);
    if (matchesStoreNorm(resolvedNorm, normStores)) {
      return true;
    }
  }

  return false;
}

/**
 * True if arbitrary script text (e.g. a `python -c` or heredoc body) mentions
 * a memory store path (or writes to a relative file while `effectiveCwd` is inside a store — #25 P2.6, P2.8).
 */
export function textMentionsMemoryStorePath(
  text: string,
  storePaths: string[],
  effectiveCwd?: string,
  prenormalizedStores?: string[],
): boolean {
  if (!text) return false;
  const slashText = expandEnvHomeInText(text)
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/");
  if (CLAUDE_PROJECT_MEMORY_RE.test(slashText)) {
    return true;
  }
  const normStores = prenormalizedStores ?? prenormalizeStorePaths(storePaths);
  const lowerText = slashText.toLowerCase();
  for (const normStore of normStores) {
    if (normStore.length >= 4 && lowerText.includes(normStore)) {
      return true;
    }
    // Also match MSYS form `/e/...` if normStore is `e:/...`
    if (/^[a-z]:\//.test(normStore)) {
      const msysStore = `/${normStore[0]}/${normStore.slice(3)}`;
      if (lowerText.includes(msysStore)) return true;
    }
  }

  // #25 P2.6: If `effectiveCwd` is itself inside a memory store, check whether quoted literals
  // in the script reference relative store files (e.g. `'BOARD.md'`, `'MEMORY.md'`, `'./foo.md'`)
  if (
    effectiveCwd &&
    isMemoryStorePath(effectiveCwd, storePaths, undefined, normStores)
  ) {
    const quotedLiterals = text.matchAll(/['"]([^'"\n]{1,200})['"]/g);
    for (const m of quotedLiterals) {
      const lit = (m[1] ?? "").trim();
      if (!lit || /^[waxr+b]+$/i.test(lit) || lit === "utf-8" || lit === "utf8") {
        continue;
      }
      if (
        /(?:\.(?:md|json|yaml|yml|txt|bak)$|^(?:BOARD|MEMORY|index)\b|^\.\.?\/)/i.test(
          lit,
        )
      ) {
        const resolved = resolveCandidateWithCwd(lit, effectiveCwd);
        if (matchesStoreNorm(resolved, normStores)) {
          return true;
        }
      }
    }
  }

  return false;
}

// #25 P2.5: Expanded Python/Node write calls including nested parens inside `open(...)`,
// `shutil.copy|move`, `os.replace|remove|unlink|rename`, `Path.unlink|rename|replace|write_bytes|write_text`,
// and `fs.unlink|unlinkSync|copyFile|copyFileSync|rename|renameSync|rm|rmSync|truncate|truncateSync`.
const INLINE_SCRIPT_WRITE_CALL_RE =
  /\bopen\s*\((?:[^();\r\n]|\([^();\r\n]*\)){1,240}?,\s*(?:mode\s*=\s*)?['"](?:[wax+]|r\+[b]*)[b+]*['"]|\.(?:write_text|write_bytes|unlink|rename|replace)\s*\(|\bshutil\s*\.\s*(?:copy|copy2|copyfile|copytree|move|rmtree)\s*\(|\bos\s*\.\s*(?:replace|remove|unlink|rename|renames)\s*\(|\b(?:fs|fsp|fsPromises)\s*\.\s*(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|unlink|unlinkSync|copyFile|copyFileSync|cp|cpSync|rename|renameSync|rm|rmSync|truncate|truncateSync)\s*\(|\b(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|unlinkSync|copyFileSync|renameSync|rmSync)\s*\(/i;

const POWERSHELL_WRITE_RE =
  /\b(?:Set-Content|Add-Content|Out-File|Remove-Item|Copy-Item|Move-Item|Rename-Item|New-Item|Clear-Content|sc|ac|ri|del|erase)\b|\[System\.IO\.File\]\s*::\s*(?:WriteAllText|WriteAllLines|WriteAllBytes|AppendAllText|Copy|Move|Delete|Replace)/i;

// #25 P2.7: Added `restore`, `switch`, `apply`, `am`, `cherry-pick`, `pull`
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
  "restore",
  "switch",
  "apply",
  "am",
  "cherry-pick",
  "pull",
]);

const MUTATING_FIND_FLAGS = new Set([
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

/**
 * Unwrap leading command wrappers (`env`, `command`, `nohup`, `nice`, `time`, `xargs`)
 * so wrapped commands like `env rm <store>/x` or `xargs rm <store>/x` are inspected (#25 P2.4).
 */
function unwrapSegmentTokens(
  tokens: string[],
  rawTokens: string[],
): { tokens: string[]; rawTokens: string[]; usedXargs: boolean } {
  let idx = 0;
  let usedXargs = false;

  while (idx < tokens.length) {
    const t = tokens[idx];
    if (isExecutableNamed(t, "env")) {
      idx++;
      while (idx < tokens.length) {
        const a = tokens[idx];
        if (a === "-u" || a === "--unset" || a === "-C" || a === "--chdir" || a === "-S") {
          idx += 2;
        } else if (a.startsWith("-")) {
          idx++;
        } else if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(a)) {
          idx++;
        } else {
          break;
        }
      }
      continue;
    }
    if (
      isExecutableNamed(t, "command") ||
      isExecutableNamed(t, "nohup") ||
      isExecutableNamed(t, "time")
    ) {
      idx++;
      while (idx < tokens.length && tokens[idx].startsWith("-")) {
        idx++;
      }
      continue;
    }
    if (isExecutableNamed(t, "nice")) {
      idx++;
      while (idx < tokens.length) {
        if (tokens[idx] === "-n" || tokens[idx] === "--adjustment") {
          idx += 2;
        } else if (tokens[idx].startsWith("-")) {
          idx++;
        } else {
          break;
        }
      }
      continue;
    }
    if (isExecutableNamed(t, "xargs")) {
      usedXargs = true;
      idx++;
      while (idx < tokens.length) {
        const a = tokens[idx];
        if (
          a === "-I" ||
          a === "-L" ||
          a === "-n" ||
          a === "-P" ||
          a === "-s" ||
          a === "-a" ||
          a === "--arg-file" ||
          a === "-d" ||
          a === "--delimiter"
        ) {
          idx += 2;
        } else if (a.startsWith("-")) {
          idx++;
        } else {
          break;
        }
      }
      continue;
    }
    break;
  }

  return {
    tokens: tokens.slice(idx),
    rawTokens: rawTokens.slice(idx),
    usedXargs,
  };
}

function extractSedTargetFilesAndWriteTargets(args: string[]): {
  hasInPlace: boolean;
  candidates: string[];
} {
  let hasInPlace = false;
  let hasExplicitExprOrFile = false;
  const positional: string[] = [];
  const scripts: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-i" || a === "--in-place" || a.startsWith("--in-place=")) {
      hasInPlace = true;
    } else if (a.startsWith("-i") && a.length > 2) {
      hasInPlace = true;
    } else if (a === "-e" || a === "--expression") {
      hasExplicitExprOrFile = true;
      if (i + 1 < args.length) scripts.push(args[++i]);
    } else if (a.startsWith("--expression=")) {
      hasExplicitExprOrFile = true;
      scripts.push(a.slice("--expression=".length));
    } else if (a.startsWith("-e") && a.length > 2) {
      hasExplicitExprOrFile = true;
      scripts.push(a.slice(2));
    } else if (a === "-f" || a === "--file") {
      hasExplicitExprOrFile = true;
      i++;
    } else if (a.startsWith("--file=") || (a.startsWith("-f") && a.length > 2)) {
      hasExplicitExprOrFile = true;
    } else if (a.startsWith("-") && !a.startsWith("--")) {
      const flags = a.slice(1);
      if (flags.includes("i")) hasInPlace = true;
      if (flags.includes("e")) {
        hasExplicitExprOrFile = true;
        if (i + 1 < args.length) scripts.push(args[++i]);
      } else if (flags.includes("f")) {
        hasExplicitExprOrFile = true;
        if (i + 1 < args.length) i++;
      }
    } else if (!a.startsWith("-")) {
      positional.push(a);
    }
  }

  // #25 P2.9: When no `-e` or `-f` flag was given, the first positional arg is the sed script expression,
  // and only subsequent positional args are target files.
  const targetFiles = hasExplicitExprOrFile ? positional : positional.slice(1);
  if (!hasExplicitExprOrFile && positional.length > 0) {
    scripts.push(positional[0]);
  }

  // Also extract any `w <file>` target inside sed scripts
  for (const sc of scripts) {
    for (const wt of extractSedWriteTargets(sc)) {
      if (wt && wt !== "<sed-w>") {
        targetFiles.push(wt);
      }
    }
  }

  return { hasInPlace, candidates: targetFiles };
}

interface CwdTracker {
  current: string;
  previous: string;
  stack: string[];
}

function advanceCwdTracker(
  seg: CommandSegment,
  tracker: CwdTracker,
  initialCwd: string,
): void {
  if (seg.tokens.length === 0) return;
  const cmd = seg.tokens[0];
  if (cmd === "popd") {
    tracker.previous = tracker.current;
    tracker.current = tracker.stack.pop() ?? initialCwd;
    return;
  }
  if (cmd === "cd") {
    if (seg.tokens.length === 1 || seg.tokens[1] === "~") {
      tracker.previous = tracker.current;
      tracker.current = HOMEDIR_SLASH;
      return;
    }
    if (seg.tokens[1] === "-") {
      const prev = tracker.previous;
      tracker.previous = tracker.current;
      tracker.current = prev;
      return;
    }
    const targetDir = seg.tokens[1];
    const rawTargetDir = seg.rawTokens[1];
    const candidate =
      rawTargetDir && /^[A-Za-z]:\\/.test(rawTargetDir) ? rawTargetDir : targetDir;
    const resolved = resolveCandidateWithCwd(candidate, tracker.current);
    if (resolved) {
      tracker.previous = tracker.current;
      tracker.current = resolved;
    }
    return;
  }
  if (cmd === "pushd" && seg.tokens.length >= 2) {
    const targetDir = seg.tokens[1];
    const rawTargetDir = seg.rawTokens[1];
    const candidate =
      rawTargetDir && /^[A-Za-z]:\\/.test(rawTargetDir) ? rawTargetDir : targetDir;
    const resolved = resolveCandidateWithCwd(candidate, tracker.current);
    if (resolved) {
      tracker.stack.push(tracker.current);
      tracker.previous = tracker.current;
      tracker.current = resolved;
    }
  }
}

const INLINE_WRITE_CALL_GLOBAL_RE = new RegExp(
  INLINE_SCRIPT_WRITE_CALL_RE.source,
  "gi",
);

/**
 * FP-MSW-1: Inspect inline Python/Node script text that mentions a store path and
 * contains write API calls. Returns `false` only when every write call in the script
 * has an explicit string-literal write target and none of those targets is a memory store.
 */
function inlineScriptWritesToStore(
  scriptText: string,
  isStore: (p: string) => boolean,
  mentionsStore: (t: string) => boolean,
): boolean {
  if (!mentionsStore(scriptText) || !INLINE_SCRIPT_WRITE_CALL_RE.test(scriptText)) {
    return false;
  }

  INLINE_WRITE_CALL_GLOBAL_RE.lastIndex = 0;
  let inspectedCount = 0;

  for (const m of scriptText.matchAll(INLINE_WRITE_CALL_GLOBAL_RE)) {
    inspectedCount++;
    const matchText = m[0];
    const startIdx = m.index ?? 0;

    // 1. `open(<arg1>, <write-mode>)`
    if (/^open\b/i.test(matchText)) {
      const openLit = matchText.match(
        /^open\s*\(\s*(?:str\s*\(\s*|Path\s*\(\s*)?(['"])([^'"\n]+)\1\s*\)?\s*,/i,
      );
      if (!openLit) return true;
      const target = openLit[2]!;
      if (isStore(target) || mentionsStore(target)) return true;
      continue;
    }

    // 2. `.write_text(`, `.write_bytes(`, `.unlink(`, `.rename(`, `.replace(`
    if (matchText.startsWith(".")) {
      const before = scriptText.slice(Math.max(0, startIdx - 240), startIdx);
      const recvMatch = before.match(/\bPath\s*\(\s*(['"])([^'"\n]+)\1\s*\)\s*$/);
      if (!recvMatch) return true;
      const recvTarget = recvMatch[2]!;
      if (isStore(recvTarget) || mentionsStore(recvTarget)) return true;
      if (/^\.(?:rename|replace)\s*\(/i.test(matchText)) {
        const after = scriptText.slice(
          startIdx + matchText.length,
          startIdx + matchText.length + 240,
        );
        const dstMatch = after.match(/^\s*(?:Path\s*\(\s*)?(['"])([^'"\n]+)\1/);
        if (!dstMatch) return true;
        const dstTarget = dstMatch[2]!;
        if (isStore(dstTarget) || mentionsStore(dstTarget)) return true;
      }
      continue;
    }

    const afterCall = scriptText.slice(
      startIdx + matchText.length,
      startIdx + matchText.length + 400,
    );

    // 3. Copy calls (`shutil.copy*`, `fs.copyFile*`, `fs.cp*`): 1st arg is read (src), 2nd arg is write (dst)
    if (
      /^(?:shutil\s*\.\s*(?:copy|copy2|copyfile|copytree)|(?:(?:fs|fsp|fsPromises)\s*\.\s*)?(?:copyFile|copyFileSync|cp|cpSync))\s*\($/i.test(
        matchText,
      )
    ) {
      const twoArg = afterCall.match(
        /^\s*(['"])([^'"\n]+)\1\s*,\s*(['"])([^'"\n]+)\3/,
      );
      if (!twoArg) return true;
      const dstTarget = twoArg[4]!;
      if (isStore(dstTarget) || mentionsStore(dstTarget)) return true;
      continue;
    }

    // 4. Move / rename / replace calls (`shutil.move`, `os.replace|rename|renames`, `fs.rename*`): mutates both src and dst
    if (
      /^(?:shutil\s*\.\s*move|os\s*\.\s*(?:replace|rename|renames)|(?:(?:fs|fsp|fsPromises)\s*\.\s*)?(?:rename|renameSync))\s*\($/i.test(
        matchText,
      )
    ) {
      const twoArg = afterCall.match(
        /^\s*(['"])([^'"\n]+)\1\s*,\s*(['"])([^'"\n]+)\3/,
      );
      if (!twoArg) return true;
      const srcTarget = twoArg[2]!;
      const dstTarget = twoArg[4]!;
      if (
        isStore(srcTarget) ||
        mentionsStore(srcTarget) ||
        isStore(dstTarget) ||
        mentionsStore(dstTarget)
      ) {
        return true;
      }
      continue;
    }

    // 5. Single-target write/delete calls (`shutil.rmtree`, `os.remove|unlink`, `fs.writeFile*`, `fs.unlink*`, `fs.rm*`, `fs.truncate*`, etc.)
    const oneArg = afterCall.match(/^\s*(['"])([^'"\n]+)\1/);
    if (!oneArg) return true;
    const target = oneArg[2]!;
    if (isStore(target) || mentionsStore(target)) return true;
  }

  return inspectedCount === 0;
}

const READONLY_SCRIPT_NAME_RE =
  /(?:^|[/\\_-])(?:count|check|validate|lint|inspect|verify|analyze|report|stats|list|show|scan|audit|read|get|find|search|dump|parse|diff|status|health)(?:$|[_.-])/i;
const MUTATING_SCRIPT_NAME_RE =
  /(?:^|[/\\_-])(?:mutate|write|edit|delete|remove|rm|patch|update|overwrite|wipe|clean|clear|truncate|modify|rewrite|fix|create|add|insert|append|drop|reset|mv|move|copy|cp)(?:$|[_.-])/i;

/**
 * FP-MSW-2: Determine whether a script file invocation (`python <script> <store>` or `node <script> <store>`)
 * is read-only.
 */
function isReadOnlyScriptInvocation(
  scriptArg: string,
  allArgs: string[],
  effectiveCwd: string,
): boolean {
  if (
    allArgs.includes("--dry-run") ||
    allArgs.includes("--check") ||
    allArgs.includes("--read-only")
  ) {
    return true;
  }

  const resolvedScript = isAbsolute(scriptArg)
    ? scriptArg
    : resolve(effectiveCwd || process.cwd(), scriptArg);
  if (existsSync(resolvedScript)) {
    try {
      const content = readFileSync(resolvedScript, "utf-8");
      return !INLINE_SCRIPT_WRITE_CALL_RE.test(content);
    } catch {
      /* fall through to name heuristic */
    }
  }

  const base = scriptArg.replace(/\\/g, "/").split("/").pop() ?? "";
  if (
    READONLY_SCRIPT_NAME_RE.test(base) &&
    !MUTATING_SCRIPT_NAME_RE.test(base)
  ) {
    return true;
  }
  return false;
}

const POWERSHELL_NON_COPY_WRITE_RE =
  /\b(?:Set-Content|Add-Content|Out-File|Remove-Item|Move-Item|Rename-Item|New-Item|Clear-Content|sc|ac|ri|del|erase)\b|\[System\.IO\.File\]\s*::\s*(?:WriteAllText|WriteAllLines|WriteAllBytes|AppendAllText|Move|Delete|Replace)/i;

/**
 * FP-MSW-3: Inspect PowerShell script text for writes to a memory store while allowing
 * `Copy-Item` / `[System.IO.File]::Copy` from a memory store to a non-store destination.
 */
function powershellScriptWritesToStore(
  psText: string,
  isStore: (p: string) => boolean,
  mentionsStore: (t: string) => boolean,
): boolean {
  if (!mentionsStore(psText)) return false;
  if (!POWERSHELL_WRITE_RE.test(psText) && !/(?:^|[^-])>{1,2}\s*\S/.test(psText)) {
    return false;
  }

  const stmts = psText
    .split(/[;\r\n|]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const stmt of stmts) {
    // 1. Check redirection `>` / `>>` in this statement
    for (const rm of stmt.matchAll(/(?:^|[^-])>{1,2}\s*(['"]?[^'"\s;|]+['"]?)/g)) {
      const target = (rm[1] ?? "").replace(/^['"]|['"]$/g, "");
      if (!target || isStore(target) || mentionsStore(target)) {
        return true;
      }
    }

    // 2. Check non-copy mutating cmdlets / .NET calls
    if (POWERSHELL_NON_COPY_WRITE_RE.test(stmt)) {
      if (mentionsStore(stmt)) return true;
      const withoutEnvVars = stmt.replace(/\$env:[A-Za-z_]\w*/gi, "");
      if (/\$[A-Za-z_]\w*/.test(withoutEnvVars)) return true;
    }

    // 3. Check `Copy-Item` (allow when copying FROM store TO an explicit non-store destination)
    if (/\bCopy-Item\b/i.test(stmt)) {
      const destNamed = stmt.match(
        /(?:^|\s)-(?:Destination|Dest)\s+(['"][^'"]+['"]|\S+)/i,
      );
      if (destNamed) {
        const dest = destNamed[1]!.replace(/^['"]|['"]$/g, "");
        if (isStore(dest) || mentionsStore(dest)) return true;
        continue;
      }
      const tokens = stmt.match(/'[^']*'|"[^"]*"|\S+/g) ?? [];
      const copyIdx = tokens.findIndex((t) => /^Copy-Item$/i.test(t));
      const pathArgs: string[] = [];
      for (let i = copyIdx + 1; i < tokens.length; i++) {
        const tok = tokens[i]!;
        if (/^-(?:Path|LiteralPath)$/i.test(tok)) {
          if (tokens[i + 1]) pathArgs.push(tokens[++i]!.replace(/^['"]|['"]$/g, ""));
        } else if (/^-(?:Filter|Include|Exclude|ErrorAction|WarningAction)$/i.test(tok)) {
          i++;
        } else if (tok.startsWith("-")) {
          continue;
        } else {
          pathArgs.push(tok.replace(/^['"]|['"]$/g, ""));
        }
      }
      if (pathArgs.length < 2) return true;
      const dest = pathArgs[pathArgs.length - 1]!;
      if (isStore(dest) || mentionsStore(dest)) return true;
      continue;
    }

    // 4. Check `[System.IO.File]::Copy(src, dst)`
    if (/\[System\.IO\.File\]\s*::\s*Copy\b/i.test(stmt)) {
      const m = stmt.match(
        /\[System\.IO\.File\]\s*::\s*Copy\s*\(\s*(['"])([^'"\n]+)\1\s*,\s*(['"])([^'"\n]+)\3/i,
      );
      if (!m) return true;
      const dst = m[4]!;
      if (isStore(dst) || mentionsStore(dst)) return true;
      continue;
    }
  }

  return false;
}

const STUDIO_CLI_SUBCOMMANDS = new Set([
  "memories",
  "rules",
  "doctor",
  "refresh",
  "report",
  "hook",
  "resolve",
  "explain",
  "usage",
  "dead",
  "overlaps",
  "budget",
  "validate",
  "index",
  "stats",
  "health",
  "sync-summaries",
  "place",
  "move",
  "split",
]);

function checkSegmentMemoryShellWrite(
  seg: CommandSegment,
  fullRawCommand: string,
  heredocBodies: string[],
  storePaths: string[],
  effectiveCwd: string,
  normStores: string[],
): string | null {
  const isStore = (p: string) =>
    isMemoryStorePath(p, storePaths, effectiveCwd, normStores);
  const mentionsStore = (t: string) =>
    textMentionsMemoryStorePath(t, storePaths, effectiveCwd, normStores);

  // 1. Check output redirections `>` / `>>` / `&>` / `>|` on any segment
  for (const r of seg.redirections) {
    if (r.op.includes(">") && isStore(r.target)) {
      return `redirection ${r.op} ${r.target}`;
    }
  }

  if (seg.tokens.length === 0) return null;

  const unwrapped = unwrapSegmentTokens(seg.tokens, seg.rawTokens);
  if (unwrapped.tokens.length === 0) return null;

  const cmd0 = unwrapped.tokens[0];
  const args = unwrapped.tokens.slice(1);
  const rawArgs = unwrapped.rawTokens.slice(1);

  // Allowed: any `loadout-os` / `claude-memories` CLI command (directly or via `node <.../cli.js>`)
  if (
    isExecutableNamed(cmd0, "loadout-os") ||
    isExecutableNamed(cmd0, "claude-memories") ||
    (isExecutableNamed(cmd0, "node") &&
      args[0] &&
      (/(?:^|\/)(?:loadout-os|claude-memories)\.[cm]?[jt]s$/i.test(
        args[0].replace(/\\/g, "/"),
      ) ||
        (/(?:^|\/)cli\.[cm]?[jt]s$/i.test(args[0].replace(/\\/g, "/")) &&
          Boolean(args[1] && STUDIO_CLI_SUBCOMMANDS.has(args[1])))))
  ) {
    return null;
  }

  // #25 P2.4: Shell wrappers (`bash -c "..."`, `sh -c "..."`, `zsh -c "..."`, `dash -c "..."`, `ksh -c "..."`)
  if (
    isExecutableNamed(cmd0, "bash") ||
    isExecutableNamed(cmd0, "sh") ||
    isExecutableNamed(cmd0, "zsh") ||
    isExecutableNamed(cmd0, "dash") ||
    isExecutableNamed(cmd0, "ksh")
  ) {
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if ((a === "-c" || (a.startsWith("-") && !a.startsWith("--") && a.slice(1).includes("c"))) && args[i + 1]) {
        const innerScript = args[i + 1];
        const innerParsed = parseBashCommand(innerScript, true);
        const innerTracker: CwdTracker = {
          current: effectiveCwd,
          previous: effectiveCwd,
          stack: [],
        };
        for (const innerSeg of innerParsed.segments) {
          advanceCwdTracker(innerSeg, innerTracker, effectiveCwd);
          const innerHit = checkSegmentMemoryShellWrite(
            innerSeg,
            innerScript,
            innerParsed.heredocBodies,
            storePaths,
            innerTracker.current,
            normStores,
          );
          if (innerHit) return `${cmd0} -c (${innerHit})`;
        }
      }
    }
  }

  // #25 P2.4 & FP-MSW-3: PowerShell (`pwsh`, `powershell`) targeting a memory store path
  if (isExecutableNamed(cmd0, "pwsh") || isExecutableNamed(cmd0, "powershell")) {
    const segHeredocs = seg.redirections.some((r) => r.op.includes("<<"))
      ? heredocBodies
      : [];
    const psText = [...args, ...segHeredocs].join("\n");
    if (powershellScriptWritesToStore(psText, isStore, mentionsStore)) {
      return `${cmd0} write to memory store`;
    }
  }

  // #25 P2.4: `find <store> ... -delete|-exec`
  if (isExecutableNamed(cmd0, "find")) {
    const hasMutatingFlag = args.some((a) => MUTATING_FIND_FLAGS.has(a));
    if (hasMutatingFlag) {
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (!a.startsWith("-") && (isStore(a) || (rawArgs[i] && isStore(rawArgs[i])))) {
          return `find ${a} (mutating flag)`;
        }
      }
      // `find` with no path arg defaults to `.` (`effectiveCwd`)
      if (isStore(".")) {
        return `find . (mutating flag in store cwd)`;
      }
    }
  }

  // 2. `tee` targeting a memory store path
  if (isExecutableNamed(cmd0, "tee")) {
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (!a.startsWith("-") && (isStore(a) || (rawArgs[i] && isStore(rawArgs[i])))) {
        return `tee ${a}`;
      }
    }
  }

  // 3. `sed -i` / `--in-place` (or `sed` with `w <store-file>`) targeting a memory store path (#25 P2.9)
  if (isExecutableNamed(cmd0, "sed")) {
    const { hasInPlace, candidates } = extractSedTargetFilesAndWriteTargets(args);
    const rawExtracted = extractSedTargetFilesAndWriteTargets(rawArgs);
    const allCandidates = [...candidates, ...rawExtracted.candidates];
    if (hasInPlace || allCandidates.length > 0) {
      for (const c of allCandidates) {
        if (isStore(c)) {
          return `sed ${hasInPlace ? "-i " : ""}${c}`;
        }
      }
      if (hasInPlace && unwrapped.usedXargs && mentionsStore(fullRawCommand)) {
        return `xargs sed -i (store pipeline)`;
      }
    }
  }

  // 4. `rm`, `touch`, `mv`, `cp`, `truncate`, `dd` targeting a memory store path
  if (
    isExecutableNamed(cmd0, "rm") ||
    isExecutableNamed(cmd0, "touch") ||
    isExecutableNamed(cmd0, "mv") ||
    isExecutableNamed(cmd0, "truncate")
  ) {
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (!a.startsWith("-") && (isStore(a) || (rawArgs[i] && isStore(rawArgs[i])))) {
        return `${cmd0} ${a}`;
      }
    }
    // #25 P2.4: `find <store> | xargs rm` where store path was in upstream pipeline segment
    if (unwrapped.usedXargs && mentionsStore(fullRawCommand)) {
      return `xargs ${cmd0} (store pipeline)`;
    }
  }

  if (isExecutableNamed(cmd0, "dd")) {
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a.startsWith("of=") && isStore(a.slice(3))) {
        return `dd ${a}`;
      }
      if (rawArgs[i]?.startsWith("of=") && isStore(rawArgs[i].slice(3))) {
        return `dd ${rawArgs[i]}`;
      }
    }
  }

  if (isExecutableNamed(cmd0, "cp")) {
    const positional: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === "-t" || a === "--target-directory") {
        const targetDir = args[i + 1];
        if (targetDir && isStore(targetDir)) {
          return `cp -t ${targetDir}`;
        }
        i++;
        continue;
      }
      if (a.startsWith("--target-directory=")) {
        const targetDir = a.slice("--target-directory=".length);
        if (isStore(targetDir)) {
          return `cp ${a}`;
        }
        continue;
      }
      if (!a.startsWith("-")) {
        positional.push(a);
        if (rawArgs[i] && !rawArgs[i].startsWith("-")) {
          positional.push(rawArgs[i]);
        }
      }
    }
    if (positional.length >= 2) {
      const lastArg = args.filter((x) => !x.startsWith("-")).pop();
      const lastRawArg = rawArgs.filter((x) => !x.startsWith("-")).pop();
      if ((lastArg && isStore(lastArg)) || (lastRawArg && isStore(lastRawArg))) {
        return `cp -> ${lastArg ?? lastRawArg}`;
      }
    }
  }

  // 5. `git -C <store> commit|checkout|reset|restore|switch|apply|am|cherry-pick|pull` (#25 P2.7)
  if (isExecutableNamed(cmd0, "git")) {
    let idx = 0;
    const gitDirs: string[] = [];
    while (idx < args.length) {
      const a = args[idx];
      if (a === "-C" || a === "--git-dir" || a === "--work-tree") {
        if (args[idx + 1]) gitDirs.push(args[idx + 1]);
        if (rawArgs[idx + 1]) gitDirs.push(rawArgs[idx + 1]);
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
    if (sub && GIT_STORE_WRITE_SUBCOMMANDS.has(sub)) {
      if (gitDirs.length > 0) {
        if (gitDirs.some((d) => isStore(d))) {
          return `git -C <store> ${sub}`;
        }
      } else if (isStore(".")) {
        return `git ${sub} (in store cwd)`;
      }
    }
  }

  // 6. `python` / `python3` / `py` / `node` (#25 P2.5, P2.6, P2.8, FP-MSW-1, FP-MSW-2)
  if (
    isExecutableNamed(cmd0, "python") ||
    isExecutableNamed(cmd0, "python3") ||
    isExecutableNamed(cmd0, "py") ||
    isExecutableNamed(cmd0, "node")
  ) {
    // Check if running a script file passed a store path as an argument (`python x.py <store>/BOARD.md`)
    const hasInlineFlag = args.some(
      (a) =>
        a === "-c" ||
        a === "-e" ||
        a === "--eval" ||
        a === "-" ||
        (a.startsWith("-") && !a.startsWith("--") && (a.slice(1).includes("c") || a.slice(1).includes("e"))),
    );
    const segHeredocs =
      seg.redirections.some((r) => r.op.includes("<<")) || args.includes("-")
        ? heredocBodies
        : [];
    if (!hasInlineFlag && segHeredocs.length === 0) {
      const nonFlagArgs = args.filter((a) => !a.startsWith("-"));
      const rawNonFlagArgs = rawArgs.filter((a) => !a.startsWith("-"));
      if (nonFlagArgs.length >= 2) {
        const scriptArg = nonFlagArgs[0]!;
        if (!isReadOnlyScriptInvocation(scriptArg, args, effectiveCwd)) {
          for (const a of [...nonFlagArgs.slice(1), ...rawNonFlagArgs.slice(1)]) {
            if (isStore(a) || mentionsStore(a)) {
              return `${cmd0} script targeting memory store (${a})`;
            }
          }
        }
      }
    }

    const combinedScript = [
      seg.raw,
      ...args,
      ...rawArgs,
      ...segHeredocs,
    ].join("\n");
    if (inlineScriptWritesToStore(combinedScript, isStore, mentionsStore)) {
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
  const normStores =
    ctx.normalizedStorePaths ?? prenormalizeStorePaths(ctx.storePaths);

  if (parsed) {
    const tracker: CwdTracker = {
      current: ctx.cwd,
      previous: ctx.cwd,
      stack: [],
    };
    for (const seg of parsed.segments) {
      // #25 P2.6 & FP-MSW-4: Track `cd`, `pushd`, and `popd` across segments
      advanceCwdTracker(seg, tracker, ctx.cwd);

      const hit = checkSegmentMemoryShellWrite(
        seg,
        rawCmd,
        heredocBodies,
        ctx.storePaths,
        tracker.current,
        normStores,
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
  memory: {
    default: "build-in-studio-tools-not-side-scripts",
    rnd: "build-in-studio-tools-not-side-scripts",
    publisher: "project-memory-system",
  },
  skill: "loadout-os",
  message: (res, ctx) => {
    const memId = resolveRuleMemory(MEMORY_SHELL_WRITE_RULE, ctx.seat);
    return [
      `[memory-shell-write] BLOCKED: Direct shell write into a memory store path is forbidden (memory: ${memId}).`,
      `  Matched: ${res.detail ?? "shell write targeting memory store"}`,
      "Use `loadout-os memories place|move|sync-summaries` or Claude Code's Write/Edit tools instead (skill: loadout-os).",
    ].join("\n");
  },
  match: matchMemoryShellWrite,
};

// ════════════════════════════════════════════════════════════════
// Rule 4: future-stamp (Layer A)
// ════════════════════════════════════════════════════════════════

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export function isStoreOrBoardFile(
  filePath: string | undefined,
  storePaths: string[],
  effectiveCwd?: string,
  prenormalizedStores?: string[],
): boolean {
  if (!filePath || !filePath.trim()) return false;
  // FP-FS-3: Only files inside a memory store are subject to future-stamp; non-store `*board.md` files are ignored.
  return isMemoryStorePath(filePath, storePaths, effectiveCwd, prenormalizedStores);
}

function isValidYmdHms(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): boolean {
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return false;
  }
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

/**
 * Compute the UTC offset in milliseconds (local - UTC) for `America/New_York`
 * at a given year and approximate UTC timestamp using US DST rules
 * (2nd Sunday in March 02:00 EST = 07:00 UTC to 1st Sunday in November 02:00 EDT = 06:00 UTC).
 */
function americaNewYorkOffsetMs(year: number, approxUtcMs: number): number {
  const march1Dow = new Date(Date.UTC(year, 2, 1)).getUTCDay();
  const secondSundayMarch = 8 + ((7 - march1Dow) % 7);
  const dstStartUtc = Date.UTC(year, 2, secondSundayMarch, 7, 0, 0, 0);

  const nov1Dow = new Date(Date.UTC(year, 10, 1)).getUTCDay();
  const firstSundayNov = 1 + ((7 - nov1Dow) % 7);
  const dstEndUtc = Date.UTC(year, 10, firstSundayNov, 6, 0, 0, 0);

  return approxUtcMs >= dstStartUtc && approxUtcMs < dstEndUtc
    ? -4 * 3_600_000 // EDT (UTC-4)
    : -5 * 3_600_000; // EST (UTC-5)
}

/**
 * Resolve a zone token (`ET`, `EST`, `EDT`, `UTC`, `Z`, `±HH:MM`, `±HHMM`, or undefined -> `ET`)
 * to its UTC offset in milliseconds (local - UTC) at the given wall-clock year and UTC guess.
 */
function resolveZoneOffsetMs(
  zoneRaw: string | undefined,
  year: number,
  utcGuessMs: number,
): number | null {
  const z = (zoneRaw ?? "ET").trim().toUpperCase();
  if (!z || z === "ET") {
    const offsetWithEdtGuess = americaNewYorkOffsetMs(
      year,
      utcGuessMs + 4 * 3_600_000,
    );
    return offsetWithEdtGuess;
  }
  if (z === "EST") return -5 * 3_600_000;
  if (z === "EDT") return -4 * 3_600_000;
  if (z === "UTC" || z === "Z") return 0;

  const offMatch = z.match(/^([+-])(\d{2}):?(\d{2})$/);
  if (offMatch) {
    const sign = offMatch[1] === "+" ? 1 : -1;
    const offH = Number(offMatch[2]);
    const offM = Number(offMatch[3]);
    if (offH <= 23 && offM <= 59) {
      return sign * (offH * 60 + offM) * 60_000;
    }
  }
  return null;
}

function zonedWallTimeToUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
  zoneRaw?: string,
): number | null {
  const utcWall = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const offsetMs = resolveZoneOffsetMs(zoneRaw, year, utcWall);
  if (offsetMs === null) return null;
  return utcWall - offsetMs;
}

function calendarDateInZone(
  epochMs: number,
  zoneRaw?: string,
): { year: number; month: number; day: number } {
  const approxYear = new Date(epochMs).getUTCFullYear();
  const z = (zoneRaw ?? "ET").trim().toUpperCase();
  const offsetMs =
    !z || z === "ET"
      ? americaNewYorkOffsetMs(approxYear, epochMs)
      : (resolveZoneOffsetMs(zoneRaw, approxYear, epochMs) ??
        americaNewYorkOffsetMs(approxYear, epochMs));
  const shifted = new Date(epochMs + offsetMs);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/**
 * Parse a leading tool-stamped timestamp in `rawValue` and ignore any trailing text after it.
 * Accepts at the start of the value (with optional leading `~`):
 *   - `YYYY-MM-DD HH:MM` (plus optional `:SS` and optional zone `ET`, `EST`, `EDT`, `UTC`, `Z`, or `±HH:MM`);
 *   - ISO 8601 with a `T` (`YYYY-MM-DDTHH:MM...` with optional zone);
 *   - time-only `~HH:MM` (with optional zone, defaulting to `ET`) or `HH:MM <zone>`, anchored to the
 *     nearest calendar day (`yesterday`, `today`, `tomorrow`) within ±12h of `nowMs` (#25 P3.11, P3.13);
 *   - a bare `YYYY-MM-DD` (compared at start of day `00:00:00.000 ET` so same-day bare dates pass — #25 P3.13).
 * `ET` (and omitted zones) mean `America/New_York` (handling EST/EDT).
 * Returns `null` if the string has no valid leading timestamp.
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
  } else if (s.startsWith('"') || s.startsWith("'")) {
    s = s.slice(1).trim();
  }
  if (!s) return null;

  // Form 1: Leading ISO 8601 with `T` (`2026-11-08T23:59:00Z — ...`, `~2026-11-08T15:03:00-05:00`)
  const isoMatch = s.match(
    /^~?\s*(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(?:\s*(Z|UTC|ET|EST|EDT|[+-]\d{2}:?\d{2}))?(?=$|[\s.,;()[\]\u2013\u2014"'-])/i,
  );
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    const hour = Number(isoMatch[4]);
    const minute = Number(isoMatch[5]);
    const second = isoMatch[6] !== undefined ? Number(isoMatch[6]) : 0;
    const fracStr = isoMatch[7] ? isoMatch[7].slice(0, 3).padEnd(3, "0") : "0";
    const ms = Number(fracStr);
    const zone = isoMatch[8];
    if (!isValidYmdHms(year, month, day, hour, minute, second)) {
      return null;
    }
    return zonedWallTimeToUtcMs(year, month, day, hour, minute, second, ms, zone);
  }

  // Form 2: Leading `YYYY-MM-DD HH:MM` (`2026-11-08 15:03 ET (clock-checked)...`, `2026-11-08 ~15:05 ET. Cutover: ...`)
  const ymdHmMatch = s.match(
    /^~?\s*(\d{4})-(\d{2})-(\d{2})\s+~?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(ET|EST|EDT|UTC|Z|[+-]\d{2}:?\d{2}))?(?=$|[\s.,;()[\]\u2013\u2014"'-])/i,
  );
  if (ymdHmMatch) {
    const year = Number(ymdHmMatch[1]);
    const month = Number(ymdHmMatch[2]);
    const day = Number(ymdHmMatch[3]);
    const hour = Number(ymdHmMatch[4]);
    const minute = Number(ymdHmMatch[5]);
    const second = ymdHmMatch[6] !== undefined ? Number(ymdHmMatch[6]) : 0;
    const zone = ymdHmMatch[7];
    if (!isValidYmdHms(year, month, day, hour, minute, second)) {
      return null;
    }
    return zonedWallTimeToUtcMs(year, month, day, hour, minute, second, 0, zone);
  }

  // Form 3: Leading time-only `~15:05 ET` / `~19:30` / `15:05 ET` (#25 P3.11 & P3.13 midnight wrap)
  // Requires either a leading `~` or an explicit zone token so bare ratios/numbers in headings aren't misread.
  const hmOnlyMatch = s.match(
    /^(?:(~)\s*(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(ET|EST|EDT|UTC|Z|[+-]\d{2}:?\d{2}))?|(\d{1,2}):(\d{2})(?::(\d{2}))?\s+(ET|EST|EDT|UTC|Z|[+-]\d{2}:?\d{2}))(?=$|[\s.,;()[\]\u2013\u2014"'-])/i,
  );
  if (hmOnlyMatch) {
    const hasTilde = Boolean(hmOnlyMatch[1]);
    const hour = Number(hasTilde ? hmOnlyMatch[2] : hmOnlyMatch[6]);
    const minute = Number(hasTilde ? hmOnlyMatch[3] : hmOnlyMatch[7]);
    const secStr = hasTilde ? hmOnlyMatch[4] : hmOnlyMatch[8];
    const second = secStr !== undefined ? Number(secStr) : 0;
    const zone = (hasTilde ? hmOnlyMatch[5] : hmOnlyMatch[9]) ?? "ET";
    const { year, month, day } = calendarDateInZone(nowMs, zone);
    if (!isValidYmdHms(year, month, day, hour, minute, second)) {
      return null;
    }
    const todayMs = zonedWallTimeToUtcMs(year, month, day, hour, minute, second, 0, zone);
    if (todayMs === null) return null;

    // #25 P3.13 & FP-FS-1: Handle midnight wrap only when `todayMs` appears in the far future
    // because the stamp is from just before midnight (`prevMs` within 6h in the past).
    // Never wrap an earlier same-day time (`todayMs <= nowMs`) forward to tomorrow (`nextDate`).
    if (nowMs > 0) {
      const prevDate = new Date(Date.UTC(year, month - 1, day - 1));
      const prevMs = zonedWallTimeToUtcMs(
        prevDate.getUTCFullYear(),
        prevDate.getUTCMonth() + 1,
        prevDate.getUTCDate(),
        hour,
        minute,
        second,
        0,
        zone,
      );
      if (
        prevMs !== null &&
        todayMs > nowMs + 12 * 3_600_000 &&
        nowMs - prevMs >= 0 &&
        nowMs - prevMs <= 6 * 3_600_000
      ) {
        return prevMs;
      }
    }
    return todayMs;
  }

  // Form 4: Leading bare `YYYY-MM-DD` (#25 P3.13: compare start of day `00:00:00.000 ET` so same-day bare dates pass)
  const ymdOnlyMatch = s.match(
    /^~?\s*(\d{4})-(\d{2})-(\d{2})(?![T\s]+~?\s*\d{1,2}:\d{2})(?=$|[\s.,;()[\]\u2013\u2014"'-])/,
  );
  if (ymdOnlyMatch) {
    const year = Number(ymdOnlyMatch[1]);
    const month = Number(ymdOnlyMatch[2]);
    const day = Number(ymdOnlyMatch[3]);
    if (!isValidYmdHms(year, month, day, 0, 0, 0)) {
      return null;
    }
    return zonedWallTimeToUtcMs(year, month, day, 0, 0, 0, 0, "ET");
  }

  return null;
}

interface ExtractedStampField {
  field: string;
  rawValue: string;
}

// #25 P3.11: Match both bold `**Last updated:**` and non-bold `Last updated:`
const LAST_UPDATED_RE =
  /^\s*(?:[-*>]\s*)?(?:\*\*Last updated(?::\*\*|\*\*:)|Last updated:)\s*(.+?)\s*$/gim;

const HEADING_LINE_RE = /^[ \t]*#{1,6}[ \t]+(.+?)[ \t]*$/gm;
const UPDATED_TOKEN_RE = /\bupdated\b(?::\*\*|\*\*:|:)?[ \t]+/gi;

// #25 P3.12: Heading `updated` stamps must carry a time component (`YYYY-MM-DD HH:MM`, `YYYY-MM-DDTHH:MM`, or `~HH:MM` / `HH:MM <zone>`),
// preventing false positives on prose headings like `### Milestones — updated 2026-12-01 schedule`.
const HEADING_TIME_STAMP_RE =
  /^~?\s*(?:\d{4}-\d{2}-\d{2}(?:T|\s+~?\s*)\d{1,2}:\d{2}|~\s*\d{1,2}:\d{2}|\d{1,2}:\d{2}(?::\d{2})?\s+(?:ET|EST|EDT|UTC|Z|[+-]\d{2}:?\d{2}))/i;

const FM_FIELD_RE = /^\s*(created_at|modified|verified_at)\s*:\s*(.+?)\s*$/gm;
const FENCED_CODE_BLOCK_RE = /^[ \t]*(?:`{3,}|~{3,})[^\r\n]*\r?\n[\s\S]*?^[ \t]*(?:`{3,}|~{3,})[ \t]*$/gm;
const LEADING_YAML_FRONTMATTER_RE = /^\s*---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function extractToolStampedFields(text: string): ExtractedStampField[] {
  const out: ExtractedStampField[] = [];
  if (!text) return out;

  // FP-FS-2: Strip fenced code blocks (` ```...``` ` / `~~~...~~~`) so YAML/markdown examples in the body are not treated as live stamps.
  const unfenced =
    text.includes("```") || text.includes("~~~")
      ? text.replace(FENCED_CODE_BLOCK_RE, "")
      : text;

  const hasUpdatedWord = /updated/i.test(unfenced);

  if (hasUpdatedWord) {
    LAST_UPDATED_RE.lastIndex = 0;
    for (const m of unfenced.matchAll(LAST_UPDATED_RE)) {
      const val = (m[1] ?? "").trim();
      if (val) {
        out.push({ field: "Last updated", rawValue: val });
      }
    }

    if (unfenced.includes("#")) {
      HEADING_LINE_RE.lastIndex = 0;
      for (const hm of unfenced.matchAll(HEADING_LINE_RE)) {
        const headingBody = hm[1] ?? "";
        if (!/updated/i.test(headingBody)) continue;
        UPDATED_TOKEN_RE.lastIndex = 0;
        for (const um of headingBody.matchAll(UPDATED_TOKEN_RE)) {
          const idx = (um.index ?? 0) + um[0].length;
          const afterUpdated = headingBody.slice(idx).trim();
          if (
            afterUpdated &&
            HEADING_TIME_STAMP_RE.test(afterUpdated) &&
            parseToolStampedTime(afterUpdated, 0) !== null
          ) {
            out.push({ field: "heading updated", rawValue: afterUpdated });
            break;
          }
        }
      }
    }
  }

  if (/(?:created_at|modified|verified_at)\s*:/.test(unfenced)) {
    // FP-FS-2: When the payload starts with a `--- ... ---` frontmatter block, restrict frontmatter keys to that block.
    const fmBlockMatch = unfenced.match(LEADING_YAML_FRONTMATTER_RE);
    const fmTargetText = fmBlockMatch ? fmBlockMatch[1]! : unfenced;
    FM_FIELD_RE.lastIndex = 0;
    for (const m of fmTargetText.matchAll(FM_FIELD_RE)) {
      const key = m[1];
      const val = (m[2] ?? "").trim();
      if (key && val) {
        out.push({ field: key, rawValue: val });
      }
    }
  }

  return out;
}

/**
 * #25 P3.10: When an `Edit` or `MultiEdit` replaces only the time substring
 * (e.g. `old_string: "15:03 ET"` -> `new_string: "23:59 ET"`), reconstruct the edited
 * line(s) from the on-disk target file before extracting tool-stamped fields.
 */
function reconstructEditedLinesFromDisk(
  filePath: string,
  cwd: string,
  toolName: string,
  oldString?: string,
  newString?: string,
  edits?: Array<{ old_string?: string; new_string: string }>,
): string[] {
  if (toolName !== "Edit" && toolName !== "MultiEdit") return [];
  const resolvedPath = isAbsolute(filePath)
    ? filePath
    : resolve(cwd || process.cwd(), filePath);
  if (!existsSync(resolvedPath)) return [];

  let fileContent: string;
  try {
    fileContent = readFileSync(resolvedPath, "utf-8");
  } catch {
    return [];
  }

  const editList: Array<{ old_string?: string; new_string: string }> = [];
  if (toolName === "Edit" && typeof oldString === "string" && typeof newString === "string") {
    editList.push({ old_string: oldString, new_string: newString });
  } else if (toolName === "MultiEdit" && edits) {
    editList.push(...edits);
  }

  const reconstructedSnippets: string[] = [];
  let working = fileContent;

  for (const ed of editList) {
    if (!ed.old_string || !ed.new_string) continue;
    const pos = working.indexOf(ed.old_string);
    if (pos === -1) continue;
    const lineStart = working.lastIndexOf("\n", pos) + 1;
    const matchEnd = pos + ed.old_string.length;
    const lineEndIdx = working.indexOf("\n", matchEnd);
    const lineEnd = lineEndIdx === -1 ? working.length : lineEndIdx;
    const reconstructedLine =
      working.slice(lineStart, pos) + ed.new_string + working.slice(matchEnd, lineEnd);
    reconstructedSnippets.push(reconstructedLine);
    working = working.slice(0, pos) + ed.new_string + working.slice(matchEnd);
  }

  return reconstructedSnippets;
}

export function matchFutureStamp(ctx: RuleMatchInput): RuleMatchResult {
  const wp = ctx.writePayload;
  const filePath =
    wp?.filePath ??
    (typeof ctx.toolInput.file_path === "string"
      ? ctx.toolInput.file_path
      : undefined);

  if (
    !isStoreOrBoardFile(
      filePath,
      ctx.storePaths,
      ctx.cwd,
      ctx.normalizedStorePaths,
    )
  ) {
    return { matched: false };
  }

  const texts = [...(wp?.texts ?? [])];
  if (filePath && (ctx.toolName === "Edit" || ctx.toolName === "MultiEdit")) {
    const reconstructed = reconstructEditedLinesFromDisk(
      filePath,
      ctx.cwd,
      ctx.toolName,
      wp?.old_string,
      wp?.new_string,
      wp?.edits,
    );
    for (const r of reconstructed) {
      if (!texts.includes(r)) texts.push(r);
    }
  }

  const maxAllowedMs = ctx.nowMs + FIVE_MINUTES_MS;

  for (const text of texts) {
    const fields = extractToolStampedFields(text);
    for (const item of fields) {
      const parsedMs = parseToolStampedTime(item.rawValue, ctx.nowMs);
      if (parsedMs === null) {
        // #25 P4.14: Hash the unparseable value instead of recording raw text in `notes`
        const valHash = createHash("sha256")
          .update(item.rawValue, "utf-8")
          .digest("hex")
          .slice(0, 12);
        ctx.recordNote(
          `unparseable_timestamp:${item.field}=sha256:${valHash}(len=${item.rawValue.length})`,
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
  memory: {
    default: "rnd-memory-system",
    rnd: "rnd-memory-system",
    publisher: "feedback-eastern-time",
  },
  skill: "loadout-os",
  message: (res, ctx) => {
    const memId = resolveRuleMemory(FUTURE_STAMP_RULE, ctx.seat);
    return [
      `[future-stamp] BLOCKED: Tool-stamped field is more than 5 minutes ahead of the OS clock (memory: ${memId}).`,
      `  Field: ${res.detail ?? "future timestamp"}`,
      "Stamp times from the real OS clock or let `loadout-os` stamp them (skill: loadout-os).",
    ].join("\n");
  },
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
  const rawCmd =
    typeof ctx.toolInput.command === "string" ? ctx.toolInput.command : "";
  if (rawCmd && !/\b(?:publish|release|push)\b/i.test(rawCmd)) {
    return { matched: false };
  }

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
  memory: {
    default: "publisher-approves-every-publish",
    rnd: "publisher-approves-every-publish",
    publisher: "publishing-tags-need-publisher-ok",
  },
  skill: "full-treatment",
  message: (res, ctx) => {
    const memId = resolveRuleMemory(RELEASE_REMINDER_RULE, ctx.seat);
    return [
      `[release-reminder] REMINDER: Every publish/release requires Publisher approval and the release checklist (memory: ${memId}, skill: full-treatment).`,
      `  Command: ${res.detail ?? "publish/release"}`,
    ].join("\n");
  },
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
