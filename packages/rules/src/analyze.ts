/**
 * Section scorer, token estimator, and split proposer.
 *
 * Reads a CLAUDE.md (or MEMORY.md), parses sections, scores each one,
 * and proposes extractions based on size, domain specificity, and priority.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseSections, estimateTokens, headingToId } from "./parser.js";
import { log, ok, warn, info, BOLD, DIM, RESET, CYAN, YELLOW } from "./cli.js";
import { hasFlag, positionalArgs, flagValue } from "./cli.js";
import { loadSignals, DEFAULT_SIGNALS } from "./signals.js";
import type { Section, SplitProposal, AnalysisReport, Priority, SignalsConfig } from "./types.js";

// ── Constants ──────────────────────────────────────────────────
const CORE_THRESHOLD = 8;    // sections <= this many lines → lean toward core
const EXTRACT_THRESHOLD = 15; // sections >= this many lines → lean toward extraction
const NON_NEGOTIABLE_RE = /non-negotiable/i;

// ── Keyword extraction ─────────────────────────────────────────
// Extract likely routing keywords from a section's heading and content.
// Grabs heading words + any capitalized/notable terms from the first few lines.
export function extractKeywords(
  section: Section,
  signals: SignalsConfig = DEFAULT_SIGNALS,
): string[] {
  const words = new Set<string>();

  // From heading
  const headingWords = section.heading
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
  for (const w of headingWords) words.add(w);

  // From content — look for domain signal words
  const contentLower = section.content.toLowerCase();
  for (const signal of signals.domainSignals) {
    if (contentLower.includes(signal)) {
      // Add each word of multi-word signals
      for (const w of signal.split(/\s+/)) {
        if (w.length > 2) words.add(w);
      }
    }
  }

  // Filter out generic stop words
  const stopWords = new Set(signals.stopWords);
  return [...words].filter((w) => !stopWords.has(w));
}

// ── Priority classification ────────────────────────────────────
// Headings that should always stay inline regardless of domain signals.
const ALWAYS_CORE_RE = /^role$/i;

export function classifyPriority(
  section: Section,
  signals: SignalsConfig = DEFAULT_SIGNALS,
): Priority {
  // Explicit core headings (e.g. "Role") — always inline
  if (ALWAYS_CORE_RE.test(section.heading.trim())) return "core";

  // Short + universal → core
  if (section.lines <= CORE_THRESHOLD) return "core";

  // Non-negotiable sections with substantial content → keep a summary core,
  // but the detail should be domain
  if (NON_NEGOTIABLE_RE.test(section.heading) && section.lines > CORE_THRESHOLD) {
    return "domain";
  }

  // Long sections → domain
  if (section.lines >= EXTRACT_THRESHOLD) return "domain";

  // Medium sections — check for domain signals in the heading specifically
  // (not content, which can false-positive on common words)
  const headingLower = section.heading.toLowerCase();
  for (const signal of signals.domainSignals) {
    if (headingLower.includes(signal)) return "domain";
  }

  // Default: if it's short-ish and not clearly domain, keep as core
  return "core";
}

// ── Summary generation ─────────────────────────────────────────
// Creates a dense <120 char summary from the heading and first content line.
export function generateSummary(section: Section): string {
  const lines = section.content.split("\n").filter((l) => l.trim().length > 0);
  // Skip the heading line itself
  const contentLines = lines.filter((l) => !l.startsWith("#"));

  if (contentLines.length === 0) return section.heading;

  // Take the first meaningful line, truncate to 120 chars
  let summary = contentLines[0].replace(/^[-*]\s*/, "").trim();
  if (summary.length > 117) summary = summary.slice(0, 117) + "...";
  return summary;
}

// ── Pattern suggestions ────────────────────────────────────────
// Suggest named intents based on section content.
export function suggestPatterns(
  section: Section,
  signals: SignalsConfig = DEFAULT_SIGNALS,
): string[] {
  const result: string[] = [];
  const lower = section.content.toLowerCase();

  for (const [patternName, triggers] of Object.entries(signals.patterns)) {
    if (triggers.some((t) => lower.includes(t))) {
      result.push(patternName);
    }
  }

  return result;
}

// ── Analyze a file ─────────────────────────────────────────────
export function analyzeFile(
  filePath: string,
  rulesDir: string,
  signals?: SignalsConfig,
): AnalysisReport {
  const cfg = signals ?? DEFAULT_SIGNALS;
  const content = readFileSync(filePath, "utf8");
  const sections = parseSections(content);
  const totalTokens = estimateTokens(content);
  const totalLines = content.split("\n").length;

  const proposals: SplitProposal[] = [];
  const unsplittable: Section[] = [];
  const coreCandidate: Section[] = [];

  for (const section of sections) {
    // Preamble (level 0) is usually the title / role — keep as core
    if (section.level === 0) {
      coreCandidate.push(section);
      continue;
    }

    // Empty sections
    if (section.lines <= 1) {
      continue;
    }

    const priority = classifyPriority(section, cfg);

    if (priority === "core") {
      coreCandidate.push(section);
      continue;
    }

    // This section should be extracted
    const id = headingToId(section.heading);
    const keywords = extractKeywords(section, cfg);
    const patterns = suggestPatterns(section, cfg);
    const summary = generateSummary(section);

    proposals.push({
      section,
      suggestedId: id,
      suggestedPath: `${rulesDir}/${id}.md`,
      suggestedKeywords: keywords,
      suggestedPatterns: patterns,
      suggestedPriority: priority,
      suggestedSummary: summary,
      reason:
        section.lines >= EXTRACT_THRESHOLD
          ? `${section.lines} lines — too large to load every session`
          : `Domain-specific content (${keywords.slice(0, 3).join(", ")})`,
    });
  }

  return {
    filePath,
    totalLines,
    totalTokens,
    sections,
    proposals,
    unsplittable,
    coreCandidate,
  };
}

// ── CLI command: analyze ───────────────────────────────────────
export async function cmdAnalyze(args: string[]): Promise<void> {
  const filePath = resolveClaudeMd(positionalArgs(args, ["--rules-dir", "--signals"]));
  const rulesDir = hasFlag(args, "--rules-dir")
    ? args[args.indexOf("--rules-dir") + 1]
    : ".claude/rules";
  const signals = loadSignals(flagValue(args, "--signals") ?? undefined);

  if (!existsSync(filePath)) {
    const { fail } = await import("./cli.js");
    fail(
      "IO_FILE_NOT_FOUND",
      `File not found: ${filePath}`,
      "Provide a path to your CLAUDE.md or run from a directory containing .claude/CLAUDE.md",
    );
  }

  info(`Analyzing ${CYAN}${filePath}${RESET}`);
  log("");

  const report = analyzeFile(filePath, rulesDir, signals);

  // Header
  log(
    `${BOLD}File:${RESET} ${report.filePath}  ${DIM}(${report.totalLines} lines, ~${report.totalTokens} tokens)${RESET}`,
  );
  log("");

  // Sections overview
  log(`${BOLD}Detected sections:${RESET} ${report.sections.length}`);
  for (const s of report.sections) {
    const label =
      s.level === 0
        ? `${DIM}(preamble)${RESET}`
        : `${"#".repeat(s.level)} ${s.heading}`;
    log(`  L${String(s.startLine + 1).padStart(3)}  ${label}  ${DIM}${s.lines} lines, ~${s.tokens_est} tokens${RESET}`);
  }
  log("");

  // Core candidates
  if (report.coreCandidate.length > 0) {
    log(`${BOLD}Keep inline (core):${RESET} ${report.coreCandidate.length} sections`);
    for (const s of report.coreCandidate) {
      const label = s.level === 0 ? "(preamble)" : s.heading;
      ok(`${label}  ${DIM}${s.lines} lines${RESET}`);
    }
    log("");
  }

  // Proposals
  if (report.proposals.length > 0) {
    log(`${BOLD}Proposed extractions:${RESET} ${report.proposals.length} sections`);
    log("");
    for (let i = 0; i < report.proposals.length; i++) {
      const p = report.proposals[i];
      log(
        `  ${BOLD}${i + 1}. "${p.section.heading}"${RESET} ${DIM}(L${p.section.startLine + 1}-${p.section.endLine}, ${p.section.lines} lines, ~${p.section.tokens_est} tokens)${RESET}`,
      );
      log(`     → ${CYAN}${p.suggestedPath}${RESET}`);
      log(`     keywords: [${p.suggestedKeywords.join(", ")}]`);
      if (p.suggestedPatterns.length > 0) {
        log(`     patterns: [${p.suggestedPatterns.join(", ")}]`);
      }
      log(`     priority: ${p.suggestedPriority}`);
      log(`     ${DIM}${p.reason}${RESET}`);
      log("");
    }
  }

  // Unsplittable
  if (report.unsplittable.length > 0) {
    log(`${YELLOW}Unsplittable sections:${RESET} ${report.unsplittable.length}`);
    for (const s of report.unsplittable) {
      warn(`${s.heading} (L${s.startLine + 1}-${s.endLine}) — no clean heading boundary`);
    }
    log("");
  }

  // Budget summary
  const coreTokens = report.coreCandidate.reduce(
    (sum, s) => sum + s.tokens_est,
    0,
  );
  const extractTokens = report.proposals.reduce(
    (sum, p) => sum + p.section.tokens_est,
    0,
  );
  const savingsPct =
    report.totalTokens > 0
      ? Math.round((extractTokens / report.totalTokens) * 100)
      : 0;

  log(`${BOLD}Budget estimate:${RESET}`);
  log(`  Always loaded:    ~${coreTokens} tokens (${report.coreCandidate.reduce((s, c) => s + c.lines, 0)} lines)`);
  log(`  On-demand:        ~${extractTokens} tokens (${report.proposals.reduce((s, p) => s + p.section.lines, 0)} lines)`);
  log(`  ${BOLD}Savings:          ${savingsPct}% per session${RESET}`);

  // Also process MEMORY.md if --memory flag is set
  if (hasFlag(args, "--memory")) {
    const memoryPath = resolveMemoryMd();
    if (memoryPath) {
      log("");
      log(DIM + "─".repeat(60) + RESET);
      log("");
      info(`Also analyzing ${CYAN}${memoryPath}${RESET}`);
      log("");
      const memReport = analyzeFile(memoryPath, rulesDir, signals);
      log(
        `${BOLD}File:${RESET} ${memReport.filePath}  ${DIM}(${memReport.totalLines} lines, ~${memReport.totalTokens} tokens)${RESET}`,
      );
      log(`${BOLD}Detected sections:${RESET} ${memReport.sections.length}`);
      for (const s of memReport.sections) {
        const label =
          s.level === 0
            ? `${DIM}(preamble)${RESET}`
            : `${"#".repeat(s.level)} ${s.heading}`;
        log(`  L${String(s.startLine + 1).padStart(3)}  ${label}  ${DIM}${s.lines} lines, ~${s.tokens_est} tokens${RESET}`);
      }
      if (memReport.proposals.length > 0) {
        log("");
        log(`${BOLD}Proposed extractions:${RESET} ${memReport.proposals.length} sections`);
        for (const p of memReport.proposals) {
          log(`  → ${CYAN}${p.suggestedPath}${RESET}  ${DIM}${p.reason}${RESET}`);
        }
      } else {
        log(`${DIM}  No sections to extract from MEMORY.md${RESET}`);
      }
    } else {
      warn("No MEMORY.md found. Skipping --memory.");
    }
  }
}

// ── Resolve CLAUDE.md path ─────────────────────────────────────
export function resolveClaudeMd(positional: string[]): string {
  if (positional.length > 0) {
    return resolve(positional[0]);
  }
  // Auto-detect
  const candidates = [
    resolve(".claude/CLAUDE.md"),
    resolve("CLAUDE.md"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0]; // will error at read time
}

// ── Resolve MEMORY.md path ────────────────────────────────────
export function resolveMemoryMd(): string | null {
  const candidates = [
    resolve(".claude/MEMORY.md"),
    resolve("MEMORY.md"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}
