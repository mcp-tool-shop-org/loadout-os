/**
 * loadout-os report — read-only observability report.
 *
 * Composes the kernel's usage/dead/budget analysers over the live usage.jsonl
 * and the global index into one monthly report: what loaded, what never
 * loaded (dead weight), the token budget, and — when the hook records a
 * `score` per event — the score distribution that tells you whether the
 * HOOK_MIN_SCORE floor is calibrated. Pure read; never writes.
 *
 * Standards compliance (workflow-standards.md — read-only analyser):
 *   EXTERNAL_VERIFIER 2 — every number comes from a kernel function the report
 *     does not own (summarizeUsage / findDeadEntries / analyzeBudget); the CLI
 *     only arranges + renders.
 *   NAMED_COMPENSATORS skip: pure read, nothing to undo.
 *   Remaining four standards skip: single deterministic screen, not a pipeline.
 */

import { readFileSync, existsSync } from "node:fs";

import {
  readUsageWithStats,
  summarizeUsage,
  summaryToJSON,
  findDeadEntries,
  analyzeBudget,
  type LoadoutIndex,
  type UsageEvent,
} from "@mcptoolshop/ai-loadout";

import { BOLD, DIM, RESET, GREEN, YELLOW, RED, CYAN, log } from "./console.js";

export interface ScoreBucket {
  label: string; // e.g. "0.3–0.4"
  count: number;
}

export interface ReportResult {
  inputs: { index: string; usage: string };
  events: number;
  skipped: number;
  usage: ReturnType<typeof summaryToJSON>[];
  dead: { id: string; tokens: number; reason: string }[];
  budget: ReturnType<typeof analyzeBudget>;
  scoreDistribution: ScoreBucket[] | null; // null when no event carried a score
  ok: boolean;
  /** Present when an input was missing (exit code 2). */
  error?: { code: string; message: string };
}

/** Bucket scores into 0.1-wide bins from 0.0 to 1.0. */
function buildScoreDistribution(events: UsageEvent[]): ScoreBucket[] | null {
  const scored = events.filter(
    (e) => typeof (e as { score?: unknown }).score === "number",
  ) as (UsageEvent & { score: number })[];
  if (scored.length === 0) return null;

  const buckets: ScoreBucket[] = [];
  for (let lo = 0; lo < 10; lo++) {
    const a = lo / 10;
    const b = (lo + 1) / 10;
    buckets.push({ label: `${a.toFixed(1)}–${b.toFixed(1)}`, count: 0 });
  }
  for (const e of scored) {
    let idx = Math.floor(e.score * 10);
    if (idx < 0) idx = 0;
    if (idx > 9) idx = 9; // score 1.0 lands in the top bucket
    buckets[idx].count++;
  }
  return buckets;
}

function loadIndex(path: string): LoadoutIndex | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as LoadoutIndex;
    if (!parsed || !Array.isArray(parsed.entries)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Build the report. Returns `ok:false` + `error` (caller exits 2) when a
 * required input is missing — never throws for a missing file.
 */
export function buildReport(indexPath: string, usagePath: string): ReportResult {
  const base = {
    inputs: { index: indexPath, usage: usagePath },
  };

  if (!existsSync(usagePath)) {
    return {
      ...base,
      events: 0,
      skipped: 0,
      usage: [],
      dead: [],
      budget: emptyBudget(),
      scoreDistribution: null,
      ok: false,
      error: {
        code: "USAGE_NOT_FOUND",
        message: `Usage log not found: ${usagePath}`,
      },
    };
  }

  const index = loadIndex(indexPath);
  if (!index) {
    return {
      ...base,
      events: 0,
      skipped: 0,
      usage: [],
      dead: [],
      budget: emptyBudget(),
      scoreDistribution: null,
      ok: false,
      error: {
        code: "INDEX_NOT_FOUND",
        message: `Global index missing or unreadable: ${indexPath}`,
      },
    };
  }

  const { events, skipped } = readUsageWithStats(usagePath);
  const summaries = summarizeUsage(events);
  const dead = findDeadEntries(index, events);
  const budget = analyzeBudget(index, summaries);
  const scoreDistribution = buildScoreDistribution(events);

  return {
    ...base,
    events: events.length,
    skipped,
    usage: summaries.map(summaryToJSON),
    dead: dead.map((d) => ({
      id: d.entry.id,
      tokens: d.entry.tokens_est,
      reason: d.reason,
    })),
    budget,
    scoreDistribution,
    ok: true,
  };
}

function emptyBudget(): ReturnType<typeof analyzeBudget> {
  return {
    totalTokens: 0,
    coreTokens: 0,
    domainTokens: 0,
    manualTokens: 0,
    coreEntries: 0,
    domainEntries: 0,
    manualEntries: 0,
    avgDomainSize: 0,
    largestEntry: null,
    smallestEntry: null,
    observedAvg: null,
  };
}

/** Render the report as a human screen. */
export function printReport(r: ReportResult): void {
  log();
  log(`${BOLD}loadout-os report${RESET} ${DIM}— observability over usage.jsonl${RESET}`);
  log(`  ${DIM}index: ${r.inputs.index}${RESET}`);
  log(`  ${DIM}usage: ${r.inputs.usage}${RESET}`);
  log();

  if (r.skipped > 0) {
    log(`  ${YELLOW}!${RESET} skipped ${r.skipped} malformed usage line(s)`);
  }

  // Usage summary (top 10 by load count)
  log(`${BOLD}Loaded entries${RESET} (${r.events} events, ${r.usage.length} distinct)`);
  if (r.usage.length === 0) {
    log(`  ${DIM}(no usage events recorded)${RESET}`);
  } else {
    log(`  ${"Entry".padEnd(36)} ${"Loads".padStart(6)} ${"Tokens".padStart(8)}`);
    for (const s of r.usage.slice(0, 10)) {
      log(
        `  ${s.entryId.slice(0, 36).padEnd(36)} ${String(s.loadCount).padStart(6)} ${String(s.totalTokens).padStart(8)}`,
      );
    }
  }
  log();

  // Dead entries
  log(`${BOLD}Dead entries${RESET} (${r.dead.length} never loaded)`);
  if (r.dead.length === 0) {
    log(`  ${GREEN}✓${RESET} every non-core entry has been loaded at least once`);
  } else {
    let wasted = 0;
    for (const d of r.dead.slice(0, 15)) {
      log(`  ${YELLOW}!${RESET} ${d.id} ${DIM}(${d.tokens} tokens)${RESET}`);
      wasted += d.tokens;
    }
    if (r.dead.length > 15) log(`  ${DIM}… and ${r.dead.length - 15} more${RESET}`);
    log(`  ${RED}${wasted.toLocaleString()} tokens${RESET} in never-loaded entries`);
  }
  log();

  // Budget
  const b = r.budget;
  log(`${BOLD}Budget${RESET}`);
  log(`  Total:  ${b.totalTokens.toLocaleString()} tokens`);
  log(`  Core:   ${b.coreTokens.toLocaleString()} (${b.coreEntries}) · Domain: ${b.domainTokens.toLocaleString()} (${b.domainEntries}) · Manual: ${b.manualTokens.toLocaleString()} (${b.manualEntries})`);
  if (b.observedAvg !== null) {
    log(`  ${GREEN}Observed avg load:${RESET} ${b.observedAvg.toLocaleString()} tokens/load`);
  }
  log();

  // Score distribution
  if (r.scoreDistribution) {
    log(`${BOLD}Score distribution${RESET} ${DIM}(injected events)${RESET}`);
    const max = Math.max(1, ...r.scoreDistribution.map((s) => s.count));
    for (const bkt of r.scoreDistribution) {
      const barLen = Math.round((bkt.count / max) * 30);
      log(`  ${CYAN}${bkt.label}${RESET} ${"█".repeat(barLen)} ${DIM}${bkt.count}${RESET}`);
    }
    log();
  }
}
