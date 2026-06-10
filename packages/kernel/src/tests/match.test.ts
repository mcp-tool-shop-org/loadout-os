import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchLoadout, lookupEntry } from "../match.js";
import type { LoadoutIndex } from "../types.js";
import { DEFAULT_TRIGGERS } from "../types.js";

function makeIndex(...entries: Array<{
  id: string;
  keywords: string[];
  patterns?: string[];
  priority?: "core" | "domain" | "manual";
}>): LoadoutIndex {
  return {
    version: "1.0.0",
    generated: new Date().toISOString(),
    entries: entries.map((e) => ({
      id: e.id,
      path: `.rules/${e.id}.md`,
      keywords: e.keywords,
      patterns: e.patterns ?? [],
      priority: e.priority ?? "domain",
      summary: `Summary for ${e.id}`,
      triggers: { ...DEFAULT_TRIGGERS },
      tokens_est: 100,
      lines: 10,
    })),
    budget: {
      always_loaded_est: 0,
      on_demand_total_est: 0,
      avg_task_load_est: 0,
      avg_task_load_observed: null,
    },
  };
}

describe("matchLoadout", () => {
  it("always includes core entries", () => {
    const index = makeIndex(
      { id: "core-rule", keywords: [], priority: "core" },
      { id: "domain-rule", keywords: ["ci"], priority: "domain" },
    );
    const results = matchLoadout("unrelated task", index);
    assert.equal(results.length, 1);
    assert.equal(results[0].entry.id, "core-rule");
    assert.equal(results[0].score, 1.0);
    assert.equal(results[0].mode, "eager");
    assert.equal(results[0].reason, "core: always loaded");
  });

  it("never auto-includes manual entries", () => {
    const index = makeIndex(
      { id: "manual-rule", keywords: ["ci", "deploy"], priority: "manual" },
    );
    const results = matchLoadout("fix the ci pipeline and deploy", index);
    assert.equal(results.length, 0);
  });

  it("matches domain entries by keywords", () => {
    const index = makeIndex(
      { id: "ci", keywords: ["ci", "workflow", "runner"] },
      { id: "shipping", keywords: ["publish", "release", "npm"] },
    );
    const results = matchLoadout("update the ci workflow", index);
    assert.equal(results.length, 1);
    assert.equal(results[0].entry.id, "ci");
    assert.ok(results[0].matchedKeywords.includes("ci"));
    assert.ok(results[0].matchedKeywords.includes("workflow"));
    assert.equal(results[0].mode, "lazy");
    assert.ok(results[0].reason.includes("keywords"));
  });

  it("scores by keyword overlap proportion", () => {
    const index = makeIndex(
      { id: "narrow", keywords: ["ci", "workflow", "runner", "matrix", "dependabot"] },
      { id: "broad", keywords: ["ci", "workflow"] },
    );
    const results = matchLoadout("fix the ci workflow", index);
    // "broad" has 2/2 match (1.0), "narrow" has 2/5 match (0.4)
    assert.equal(results[0].entry.id, "broad");
    assert.ok(results[0].score > results[1].score);
  });

  it("gives pattern bonus", () => {
    // Use entries where keyword match is partial so the 0.2 bonus is visible
    const index = makeIndex(
      { id: "with-pattern", keywords: ["ci", "workflow", "runner"], patterns: ["ci_pipeline"] },
      { id: "without-pattern", keywords: ["ci", "workflow", "runner"] },
    );
    // Task matches 1/3 keywords (0.33) + pattern bonus (0.2) = 0.53 vs 0.33
    const results = matchLoadout("fix the ci pipeline", index);
    const withPattern = results.find((r) => r.entry.id === "with-pattern")!;
    const without = results.find((r) => r.entry.id === "without-pattern")!;
    assert.ok(withPattern.score > without.score);
    assert.ok(withPattern.reason.includes("keywords") && withPattern.reason.includes("patterns"));
  });

  it("returns empty for no matches", () => {
    const index = makeIndex(
      { id: "ci", keywords: ["ci", "workflow"] },
    );
    const results = matchLoadout("update the readme", index);
    assert.equal(results.length, 0);
  });

  it("sorts by score descending", () => {
    const index = makeIndex(
      { id: "low", keywords: ["ci", "workflow", "runner", "matrix", "dependabot"] },
      { id: "high", keywords: ["ci"] },
    );
    const results = matchLoadout("fix ci", index);
    assert.equal(results[0].entry.id, "high");
  });
});

describe("lookupEntry", () => {
  it("finds entry by id", () => {
    const index = makeIndex(
      { id: "ci", keywords: ["ci"] },
      { id: "shipping", keywords: ["npm"] },
    );
    const entry = lookupEntry("shipping", index);
    assert.ok(entry);
    assert.equal(entry.id, "shipping");
  });

  it("returns undefined for missing id", () => {
    const index = makeIndex({ id: "ci", keywords: ["ci"] });
    const entry = lookupEntry("nope", index);
    assert.equal(entry, undefined);
  });
});
