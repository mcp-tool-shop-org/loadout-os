/**
 * Signals configuration loader.
 *
 * Loads domain signals, stop words, and pattern mappings from a JSON file.
 * Falls back to built-in defaults when no config file exists.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { ok, warn, info } from "./cli.js";
import { flagValue } from "./cli.js";
import type { SignalsConfig } from "./types.js";

// ── Built-in defaults (moved from analyze.ts) ───────────────
export const DEFAULT_SIGNALS: SignalsConfig = {
  domainSignals: [
    "github actions", "ci", "workflow", "runner",
    "marketing", "site", "publishing", "automation",
    "shipping", "publish", "release", "npm",
    "ownership", "repo", "org", "canonical",
    "preview", "verification", "dev server",
    "shipcheck", "treatment", "landing page",
    "product", "development", "output-first",
    "guardian", "self-check",
    "document delight",
  ],
  stopWords: [
    "the", "and", "for", "are", "but", "not", "you", "all",
    "can", "had", "her", "was", "one", "our", "out", "has",
    "this", "that", "with", "have", "from", "they", "been",
    "must", "will", "each", "make", "like", "when", "never",
    "only", "rule", "rules", "non", "negotiable",
  ],
  patterns: {
    ci_pipeline: ["ci", "workflow", "github actions"],
    package_release: ["publish", "release", "npm"],
    marketing_ops: ["marketing", "site", "landing page"],
    repo_governance: ["ownership", "canonical", "repo"],
    dev_workflow: ["preview", "dev server", "verification"],
    quality_gate: ["shipcheck", "ship_gate", "treatment"],
    product_dev: ["product", "output-first"],
  },
};

// ── Loader ───────────────────────────────────────────────────
export function loadSignals(signalsPath?: string): SignalsConfig {
  const effectivePath = signalsPath ?? resolve(".claude", "signals.json");

  if (!existsSync(effectivePath)) {
    return DEFAULT_SIGNALS;
  }

  const raw = JSON.parse(readFileSync(effectivePath, "utf8"));

  // Merge with defaults: user can override any subset
  return {
    domainSignals: Array.isArray(raw.domainSignals)
      ? raw.domainSignals
      : DEFAULT_SIGNALS.domainSignals,
    stopWords: Array.isArray(raw.stopWords)
      ? raw.stopWords
      : DEFAULT_SIGNALS.stopWords,
    patterns:
      raw.patterns && typeof raw.patterns === "object"
        ? raw.patterns
        : DEFAULT_SIGNALS.patterns,
  };
}

// ── Generator for init-signals command ───────────────────────
export function generateDefaultSignalsJson(): string {
  return JSON.stringify(DEFAULT_SIGNALS, null, 2) + "\n";
}

// ── CLI command: init-signals ────────────────────────────────
export async function cmdInitSignals(args: string[]): Promise<void> {
  const outputPath = resolve(
    flagValue(args, "--signals") ?? ".claude/signals.json",
  );

  if (existsSync(outputPath)) {
    warn(`Signals file already exists: ${outputPath}`);
    info("Delete it first or edit it manually.");
    return;
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, generateDefaultSignalsJson(), "utf8");
  ok(`Generated ${outputPath}`);
  info("Edit this file to customize domain signals, stop words, and pattern mappings.");
}
