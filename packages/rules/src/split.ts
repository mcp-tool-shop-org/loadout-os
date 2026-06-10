/**
 * Interactive extraction workflow.
 *
 * 1. Runs analyze internally
 * 2. Shows each proposal with preview
 * 3. User approves/skips each one
 * 4. Generates rule files with frontmatter
 * 5. Generates index.json from frontmatter
 * 6. Rewrites CLAUDE.md as lean index + core rules
 * 7. Runs validate internally
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, rmSync, mkdtempSync } from "node:fs";
import { resolve, dirname, relative, join } from "node:path";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { analyzeFile, resolveClaudeMd, resolveMemoryMd } from "./analyze.js";
import { serializeFrontmatter, estimateTokens } from "./parser.js";
import { log, ok, warn, info, fail, BOLD, DIM, RESET, CYAN, GREEN, YELLOW } from "./cli.js";
import { hasFlag, positionalArgs, flagValue } from "./cli.js";
import { loadSignals } from "./signals.js";
import type {
  SplitProposal,
  RuleEntry,
  RuleIndex,
  Budget,
  Frontmatter,
  Section,
} from "./types.js";
import { DEFAULT_TRIGGERS } from "./types.js";

// ── Interactive prompt ─────────────────────────────────────────
async function prompt(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ── Generate a rule file with frontmatter ──────────────────────
export function generateRuleFile(
  proposal: SplitProposal,
): string {
  const fm: Frontmatter = {
    id: proposal.suggestedId,
    keywords: proposal.suggestedKeywords,
    patterns: proposal.suggestedPatterns,
    priority: proposal.suggestedPriority,
    triggers: { ...DEFAULT_TRIGGERS },
  };

  const header = serializeFrontmatter(fm);

  // The content already includes the heading; use it as-is
  return `${header}\n\n${proposal.section.content}\n`;
}

// ── Generate index.json from accepted proposals ────────────────
export function generateIndex(
  accepted: SplitProposal[],
  coreTokens: number,
  lazyLoad = false,
): RuleIndex {
  const entries: RuleEntry[] = accepted.map((p) => ({
    id: p.suggestedId,
    path: p.suggestedPath,
    keywords: p.suggestedKeywords,
    patterns: p.suggestedPatterns,
    priority: p.suggestedPriority,
    summary: p.suggestedSummary,
    triggers: { ...DEFAULT_TRIGGERS },
    tokens_est: p.section.tokens_est,
    lines: p.section.lines,
  }));

  const onDemandTotal = entries.reduce((sum, r) => sum + r.tokens_est, 0);
  const avgTaskLoad = entries.length > 0
    ? Math.round(onDemandTotal / entries.length)
    : 0;

  const budget: Budget = {
    always_loaded_est: coreTokens,
    on_demand_total_est: onDemandTotal,
    avg_task_load_est: avgTaskLoad,
    avg_task_load_observed: null,
  };

  return {
    version: "1.0.0",
    generated: new Date().toISOString(),
    entries,
    budget,
    ...(lazyLoad ? { lazyLoad: true } : {}),
  };
}

// ── Generate the lean CLAUDE.md ────────────────────────────────
export function generateClaudeMd(
  coreSections: Section[],
  accepted: SplitProposal[],
  index: RuleIndex,
  rulesDir: string,
  lazyLoad = false,
): string {
  const lines: string[] = [];

  // Core sections — include full content, strip trailing ---
  for (const section of coreSections) {
    // Remove trailing --- separators from content (we'll add our own spacing)
    const cleaned = section.content.replace(/\n---\s*$/, "").trimEnd();
    lines.push(cleaned);
    lines.push("");
  }

  lines.push("---");
  lines.push("");

  // Rules Index section
  lines.push("## Rules Index");
  lines.push("");
  lines.push(`Rules are split into topic files under \`${rulesDir}/\`.`);
  lines.push(`The dispatch table is at \`${rulesDir}/index.json\`.`);
  lines.push("");
  if (lazyLoad) {
    lines.push(
      "**Rule files are NOT pre-loaded. When a task matches a domain rule's keywords, use the Read tool to load the rule file before planning or editing.**",
    );
  } else {
    lines.push(
      "**When a task matches a domain rule's keywords, read that rule file before planning or editing.**",
    );
  }
  lines.push("");
  lines.push("| Topic | Keywords | Priority | File |");
  lines.push("|-------|----------|----------|------|");
  for (let i = 0; i < index.entries.length; i++) {
    const rule = index.entries[i];
    // Use the original heading as the topic name (clean and readable)
    const topic = accepted[i]?.section.heading ?? rule.id;
    const kw = rule.keywords.slice(0, 4).join(", ");
    lines.push(
      `| ${topic} | ${kw} | ${rule.priority} | \`${rule.path}\` |`,
    );
  }
  lines.push("");

  return lines.join("\n");
}

// ── CLI command: split ─────────────────────────────────────────
export async function cmdSplit(args: string[]): Promise<void> {
  const filePath = resolveClaudeMd(positionalArgs(args, ["--rules-dir", "--signals"]));
  const lazyLoad = hasFlag(args, "--lazy");
  const rulesDir = flagValue(args, "--rules-dir") ?? (lazyLoad ? ".claude/loadout" : ".claude/rules");
  const dryRun = hasFlag(args, "--dry-run");
  const yesMode = hasFlag(args, "--yes");
  const signals = loadSignals(flagValue(args, "--signals") ?? undefined);

  if (!existsSync(filePath)) {
    fail(
      "IO_FILE_NOT_FOUND",
      `File not found: ${filePath}`,
      "Provide a path to your CLAUDE.md",
    );
  }

  info(`Analyzing ${CYAN}${filePath}${RESET}`);
  const report = analyzeFile(filePath, rulesDir, signals);

  // Also include MEMORY.md proposals when --memory is set
  if (hasFlag(args, "--memory")) {
    const memoryPath = resolveMemoryMd();
    if (memoryPath) {
      info(`Also analyzing ${CYAN}${memoryPath}${RESET}`);
      const memReport = analyzeFile(memoryPath, rulesDir, signals);
      report.proposals.push(...memReport.proposals);
    } else {
      warn("No MEMORY.md found. Skipping --memory.");
    }
  }

  if (report.proposals.length === 0) {
    ok("Nothing to split — all sections are already lean enough.");
    return;
  }

  log("");
  log(
    `${BOLD}Found ${report.proposals.length} sections to extract${RESET} (${report.totalLines} lines, ~${report.totalTokens} tokens)`,
  );
  log("");

  // Interactive approval
  const accepted: SplitProposal[] = [];

  for (let i = 0; i < report.proposals.length; i++) {
    const p = report.proposals[i];
    log(`${BOLD}${i + 1}/${report.proposals.length}. "${p.section.heading}"${RESET}`);
    log(`  ${DIM}Lines ${p.section.startLine + 1}-${p.section.endLine} (${p.section.lines} lines, ~${p.section.tokens_est} tokens)${RESET}`);
    log(`  → ${CYAN}${p.suggestedPath}${RESET}`);
    log(`  keywords: [${p.suggestedKeywords.join(", ")}]`);
    if (p.suggestedPatterns.length > 0) {
      log(`  patterns: [${p.suggestedPatterns.join(", ")}]`);
    }
    log(`  priority: ${p.suggestedPriority}`);
    log(`  summary: ${p.suggestedSummary}`);
    log("");

    // Preview: first and last 3 lines of content
    const contentLines = p.section.content.split("\n");
    if (contentLines.length <= 8) {
      for (const line of contentLines) {
        log(`  ${DIM}${line}${RESET}`);
      }
    } else {
      for (const line of contentLines.slice(0, 3)) {
        log(`  ${DIM}${line}${RESET}`);
      }
      log(`  ${DIM}  ... (${contentLines.length - 6} more lines) ...${RESET}`);
      for (const line of contentLines.slice(-3)) {
        log(`  ${DIM}${line}${RESET}`);
      }
    }
    log("");

    if (dryRun) {
      info("(dry run — would extract)");
      accepted.push(p);
      log("");
      continue;
    }

    if (yesMode) {
      accepted.push(p);
      ok(`Accepted "${p.section.heading}"`);
      log("");
      continue;
    }

    const answer = await prompt(`  Extract? [${GREEN}Y${RESET}/n/skip] `);
    if (answer.toLowerCase() === "n" || answer.toLowerCase() === "skip") {
      warn(`Skipped "${p.section.heading}"`);
    } else {
      accepted.push(p);
      ok(`Accepted "${p.section.heading}"`);
    }
    log("");
  }

  if (accepted.length === 0) {
    info("No sections accepted. Nothing to do.");
    return;
  }

  // Calculate core tokens
  const coreTokens = report.coreCandidate.reduce(
    (sum, s) => sum + s.tokens_est,
    0,
  );

  // Generate index
  const index = generateIndex(accepted, coreTokens, lazyLoad);

  // Generate lean CLAUDE.md
  const newClaudeMd = generateClaudeMd(
    report.coreCandidate,
    accepted,
    index,
    rulesDir,
    lazyLoad,
  );

  if (dryRun) {
    log(`${BOLD}Dry run complete.${RESET} Would generate:`);
    log(`  ${accepted.length} rule files in ${rulesDir}/`);
    log(`  ${rulesDir}/index.json`);
    log(`  Rewritten ${filePath}`);
    log("");
    log(`${BOLD}New CLAUDE.md preview:${RESET}`);
    log(DIM + "─".repeat(60) + RESET);
    log(newClaudeMd);
    log(DIM + "─".repeat(60) + RESET);
    log("");
    log(`${BOLD}Budget:${RESET}`);
    log(`  Before: ${report.totalLines} lines, ~${report.totalTokens} tokens (every session)`);
    log(`  After:  ~${estimateTokens(newClaudeMd)} tokens always loaded`);
    log(`  Savings: ${Math.round(((report.totalTokens - estimateTokens(newClaudeMd)) / report.totalTokens) * 100)}%`);
    return;
  }

  // ── Atomic write phase ──────────────────────────────────────
  const absRulesDir = resolve(dirname(filePath), "..", rulesDir);

  interface FileWrite {
    dest: string;
    content: string;
  }

  const writes: FileWrite[] = [];

  // Collect all file writes
  for (const p of accepted) {
    const absPath = resolve(dirname(filePath), "..", p.suggestedPath);
    writes.push({ dest: absPath, content: generateRuleFile(p) });
  }

  // index.json
  writes.push({
    dest: resolve(absRulesDir, "index.json"),
    content: JSON.stringify(index, null, 2) + "\n",
  });

  // New CLAUDE.md
  writes.push({ dest: filePath, content: newClaudeMd });

  // Stage all writes to temp directory
  const stagingDir = mkdtempSync(join(tmpdir(), "claude-rules-split-"));

  try {
    // Write all files to staging
    for (let i = 0; i < writes.length; i++) {
      writeFileSync(join(stagingDir, `file-${i}`), writes[i].content, "utf8");
    }

    // All staging writes succeeded — backup original CLAUDE.md
    const backupPath = resolve(dirname(filePath), "CLAUDE.md.bak");
    if (existsSync(filePath)) {
      copyFileSync(filePath, backupPath);
      info(`Backed up ${relative(process.cwd(), filePath)} → CLAUDE.md.bak`);
    }

    // Ensure directories exist
    mkdirSync(absRulesDir, { recursive: true });
    for (const w of writes) {
      mkdirSync(dirname(w.dest), { recursive: true });
    }

    // Copy from staging to final destinations
    for (let i = 0; i < writes.length; i++) {
      try {
        copyFileSync(join(stagingDir, `file-${i}`), writes[i].dest);
      } catch (copyErr) {
        const failedDest = relative(process.cwd(), writes[i].dest);
        warn(`Split failed writing ${failedDest}. Original CLAUDE.md backed up to CLAUDE.md.bak.`);
        warn(`Error: ${(copyErr as Error).message}`);
        process.exitCode = 1;
        return;
      }
    }

    // Report success
    for (const p of accepted) {
      ok(`${p.suggestedPath}`);
    }
    ok(`${rulesDir}/index.json`);
    ok(`Rewrote ${relative(process.cwd(), filePath)}`);

  } catch (err) {
    warn(`Split failed during staging. Original files unchanged.`);
    warn(`Error: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  } finally {
    // Always clean up staging directory
    try {
      rmSync(stagingDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }

  log("");
  log(`${BOLD}Split complete.${RESET}`);
  log(`  ${accepted.length} rule files created`);
  log(`  Before: ${report.totalLines} lines, ~${report.totalTokens} tokens`);
  log(`  After:  ~${estimateTokens(newClaudeMd)} tokens always loaded`);
  log(`  Savings: ${Math.round(((report.totalTokens - estimateTokens(newClaudeMd)) / report.totalTokens) * 100)}%`);
  log("");
  info("Run 'claude-rules validate' to confirm invariants.");
}
