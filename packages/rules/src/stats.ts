/**
 * Token budget dashboard.
 *
 * Shows the physics of the system: what's always loaded, what's on-demand,
 * and how much context you're saving per session.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { estimateTokens, parseFrontmatter } from "./parser.js";
import { resolveClaudeMd } from "./analyze.js";
import { log, info, ok, warn, fail, BOLD, DIM, RESET, CYAN, GREEN, YELLOW } from "./console.js";
import { positionalArgs, flagValue, hasFlag } from "./console.js";
import type { RuleIndex, RuleEntry } from "./types.js";

// ── CLI command: stats ─────────────────────────────────────────
export async function cmdStats(args: string[]): Promise<void> {
  const jsonMode = hasFlag(args, "--json");
  const lazy = hasFlag(args, "--lazy");
  // RUL-B2: mirror split's --lazy default (.claude/loadout) so stats reports on
  // the directory a lazy split actually wrote to, instead of an empty
  // .claude/rules.
  const rulesDir =
    flagValue(args, "--rules-dir") ?? (lazy ? ".claude/loadout" : ".claude/rules");
  const repoRoot = process.cwd();
  const absRulesDir = resolve(repoRoot, rulesDir);
  const indexPath = join(absRulesDir, "index.json");

  // Check if split has been done
  if (!existsSync(indexPath)) {
    // No split yet — analyze the monolithic file
    const filePath = resolveClaudeMd(positionalArgs(args, ["--rules-dir"]));
    if (!existsSync(filePath)) {
      fail(
        "IO_FILE_NOT_FOUND",
        "No CLAUDE.md or index.json found",
        "Run 'claude-rules analyze' first to see what can be optimized",
      );
    }

    const content = readFileSync(filePath, "utf8");
    const lines = content.split("\n").length;
    const tokens = estimateTokens(content);

    if (jsonMode) {
      console.log(JSON.stringify({
        mode: "monolithic",
        claudeMd: { lines, tokens },
        rules: [],
        budget: { alwaysLoaded: tokens, onDemandTotal: 0, savingsPct: 0 },
      }, null, 2));
      return;
    }

    log("");
    log(`${BOLD}claude-rules stats${RESET}  ${DIM}(monolithic — not yet split)${RESET}`);
    log("");
    log(`  ${BOLD}CLAUDE.md${RESET} (always loaded)`);
    log(`    Lines: ${lines}    Tokens (est): ${tokens}`);
    log("");
    log(`  ${DIM}No rule files found. Run 'claude-rules split' to optimize.${RESET}`);
    log("");
    log(`  ${BOLD}Budget${RESET}`);
    log(`    Always loaded:         ${tokens} tokens`);
    log(`    On-demand total:       0 tokens`);
    log(`    ${YELLOW}Savings vs current:    0%${RESET}`);
    log("");
    return;
  }

  // Parse index
  let index: RuleIndex;
  try {
    index = JSON.parse(readFileSync(indexPath, "utf8")) as RuleIndex;
  } catch {
    fail(
      "INVALID_INDEX",
      "Failed to parse index.json",
      "Run 'claude-rules validate' to diagnose",
    );
  }

  // Read actual CLAUDE.md for current always-loaded cost
  const claudeMdPath = resolveClaudeMd(positionalArgs(args, ["--rules-dir"]));
  let claudeMdTokens = 0;
  let claudeMdLines = 0;
  if (existsSync(claudeMdPath)) {
    const content = readFileSync(claudeMdPath, "utf8");
    claudeMdTokens = estimateTokens(content);
    claudeMdLines = content.split("\n").length;
  }

  // Collect rule stats
  const ruleStats: Array<{ id: string; lines: number; tokens: number; priority: string }> = [];
  let totalOnDemandTokens = 0;
  let totalOnDemandLines = 0;

  for (const rule of index.entries) {
    const absPath = resolve(repoRoot, rule.path);
    let actualTokens = rule.tokens_est;
    let actualLines = rule.lines;

    if (existsSync(absPath)) {
      const content = readFileSync(absPath, "utf8");
      actualTokens = estimateTokens(content);
      actualLines = content.split("\n").length;
    }

    totalOnDemandTokens += actualTokens;
    totalOnDemandLines += actualLines;
    ruleStats.push({ id: rule.id, lines: actualLines, tokens: actualTokens, priority: rule.priority });
  }

  const totalTokens = claudeMdTokens + totalOnDemandTokens;
  const totalKeywords = index.entries.reduce((sum, r) => sum + Math.max(r.keywords.length, 1), 0);
  const weightedTaskLoad =
    totalKeywords > 0
      ? Math.round(
          index.entries.reduce((sum, r) => {
            const absPath = resolve(repoRoot, r.path);
            let tokens = r.tokens_est;
            if (existsSync(absPath)) {
              tokens = estimateTokens(readFileSync(absPath, "utf8"));
            }
            const weight = Math.max(r.keywords.length, 1) / totalKeywords;
            return sum + tokens * weight;
          }, 0),
        )
      : 0;

  const savingsPct =
    totalTokens > 0
      ? Math.round(((totalOnDemandTokens) / totalTokens) * 100)
      : 0;

  // JSON output mode
  if (jsonMode) {
    console.log(JSON.stringify({
      mode: "split",
      claudeMd: { lines: claudeMdLines, tokens: claudeMdTokens },
      rules: ruleStats,
      budget: {
        alwaysLoaded: claudeMdTokens,
        onDemandTotal: totalOnDemandTokens,
        avgTaskLoadEst: weightedTaskLoad,
        avgTaskLoadObs: index.budget.avg_task_load_observed,
        savingsPct,
      },
    }, null, 2));
    return;
  }

  // Human-readable output
  log("");
  log(`${BOLD}claude-rules stats${RESET}`);
  log("");

  log(`  ${BOLD}CLAUDE.md${RESET} (always loaded)`);
  log(`    Lines: ${claudeMdLines}    Tokens (est): ${claudeMdTokens}`);
  log("");

  if (ruleStats.length > 0) {
    log(`  ${BOLD}Rule files${RESET} (on-demand)`);

    for (const rule of ruleStats) {
      const priorityColor =
        rule.priority === "domain"
          ? CYAN
          : rule.priority === "manual"
            ? DIM
            : GREEN;

      log(
        `    ${rule.id.padEnd(24)} ${String(rule.lines).padStart(4)} lines  ${String(rule.tokens).padStart(5)} tokens  ${priorityColor}${rule.priority}${RESET}`,
      );
    }

    log(`    ${"─".repeat(58)}`);
    log(
      `    ${"Total on-demand".padEnd(24)} ${String(totalOnDemandLines).padStart(4)} lines  ${String(totalOnDemandTokens).padStart(5)} tokens`,
    );
    log("");

    log(`  ${BOLD}Budget${RESET}`);
    log(`    Always loaded:         ${claudeMdTokens} tokens`);
    log(`    On-demand total:       ${totalOnDemandTokens} tokens`);
    log(`    Avg task load (est):   ${weightedTaskLoad} tokens  ${DIM}(keyword-weighted)${RESET}`);
    if (index.budget.avg_task_load_observed !== null) {
      log(`    Avg task load (obs):   ${index.budget.avg_task_load_observed} tokens`);
    }
    log(`    ${GREEN}Savings vs monolithic:   ${savingsPct}%${RESET}`);
  }

  log("");
}
