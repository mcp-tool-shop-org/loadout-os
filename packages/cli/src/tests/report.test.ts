/**
 * report: composes usage summary + dead entries + budget + score distribution
 * over a synthetic index/usage sandbox; missing inputs return ok:false with a
 * structured error (caller exits 2).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";

import { buildReport } from "../report.js";
import { makeSandbox } from "./fixtures.js";

test("report: composes usage, dead, budget, and score distribution", () => {
  const sb = makeSandbox({ withUsage: true, withCore: true });
  try {
    const r = buildReport(sb.indexPath, sb.usagePath);
    assert.equal(r.ok, true);
    assert.equal(r.events, 3);

    // usage summary: sample-topic loaded twice, core-rule once
    const sample = r.usage.find((u) => u.entryId === "sample-topic");
    assert.ok(sample);
    assert.equal(sample!.loadCount, 2);

    // dead entries: 'never-loaded' was never in usage; core is excluded
    const deadIds = r.dead.map((d) => d.id);
    assert.ok(deadIds.includes("never-loaded"));
    assert.ok(!deadIds.includes("core-rule"), "core entries are never dead");

    // budget rolls up the index
    assert.ok(r.budget.totalTokens > 0);
    assert.equal(r.budget.coreEntries, 1);

    // score distribution present (events carry score): bins 0.4–0.5, 0.6–0.7, 0.9–1.0
    assert.ok(r.scoreDistribution, "score distribution should be present");
    const total = r.scoreDistribution!.reduce((s, b) => s + b.count, 0);
    assert.equal(total, 3);
    const topBucket = r.scoreDistribution!.find((b) => b.label === "0.9–1.0");
    assert.equal(topBucket!.count, 1, "score 1.0 lands in the top bucket");
  } finally {
    sb.cleanup();
  }
});

test("report: no score on events → scoreDistribution is null", () => {
  const sb = makeSandbox({ withUsage: false, withCore: true });
  try {
    // write a usage line with NO score field
    writeFileSync(
      sb.usagePath,
      JSON.stringify({
        timestamp: new Date().toISOString(),
        taskHash: "t1",
        entryId: "sample-topic",
        trigger: "UserPromptSubmit",
        mode: "lazy",
        tokensEst: 60,
      }) + "\n",
    );
    const r = buildReport(sb.indexPath, sb.usagePath);
    assert.equal(r.ok, true);
    assert.equal(r.scoreDistribution, null);
  } finally {
    sb.cleanup();
  }
});

test("report: missing usage log → ok:false with USAGE_NOT_FOUND", () => {
  const sb = makeSandbox({ withCore: true });
  try {
    const r = buildReport(sb.indexPath, `${sb.dir}/.ai-loadout/missing.jsonl`);
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, "USAGE_NOT_FOUND");
  } finally {
    sb.cleanup();
  }
});

test("report: missing index → ok:false with INDEX_NOT_FOUND", () => {
  const sb = makeSandbox({ withUsage: true, withCore: true });
  try {
    const r = buildReport(`${sb.dir}/.ai-loadout/missing-index.json`, sb.usagePath);
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, "INDEX_NOT_FOUND");
  } finally {
    sb.cleanup();
  }
});

test("report: skipped malformed usage lines are counted", () => {
  const sb = makeSandbox({ withCore: true });
  try {
    writeFileSync(
      sb.usagePath,
      [
        JSON.stringify({ timestamp: "x", taskHash: "a", entryId: "sample-topic", trigger: "t", mode: "lazy", tokensEst: 1 }),
        "{ not valid json",
        "",
      ].join("\n") + "\n",
    );
    const r = buildReport(sb.indexPath, sb.usagePath);
    assert.equal(r.ok, true);
    assert.equal(r.skipped, 1);
    assert.equal(r.events, 1);
  } finally {
    sb.cleanup();
  }
});
