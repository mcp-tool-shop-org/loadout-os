import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchLoadout, lookupEntry, DEFAULT_MIN_SCORE } from "../match.js";
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

  it("scores by recall-aware blend (coverage vs absolute)", () => {
    const index = makeIndex(
      { id: "narrow", keywords: ["ci", "workflow", "runner", "matrix", "dependabot"] },
      { id: "broad", keywords: ["ci", "workflow"] },
    );
    const results = matchLoadout("fix the ci workflow", index);
    // FT-K1: both match 2 keywords.
    //   broad:  coverage 2/2 = 1.0, absolute 2/5 = 0.4 → max = 1.0
    //   narrow: coverage 2/5 = 0.4, absolute 2/5 = 0.4 → max = 0.4
    assert.equal(results[0].entry.id, "broad");
    assert.equal(results[0].score, 1.0);
    const narrow = results.find((r) => r.entry.id === "narrow")!;
    assert.equal(narrow.score, 0.4);
    assert.ok(results[0].score > narrow.score);
  });

  it("gives pattern bonus", () => {
    // Use entries where keyword match is partial so the 0.2 bonus is visible
    const index = makeIndex(
      { id: "with-pattern", keywords: ["ci", "workflow", "runner"], patterns: ["ci_pipeline"] },
      { id: "without-pattern", keywords: ["ci", "workflow", "runner"] },
    );
    // 1 matched keyword: coverage 1/3 = 0.333, absolute 1/5 = 0.2 → base 0.333.
    // with-pattern: 0.333 + 0.2 bonus = 0.533; without-pattern: 0.333.
    const results = matchLoadout("fix the ci pipeline", index);
    const withPattern = results.find((r) => r.entry.id === "with-pattern")!;
    const without = results.find((r) => r.entry.id === "without-pattern")!;
    assert.ok(Math.abs(withPattern.score - 0.5333333333333333) < 1e-9);
    assert.ok(Math.abs(without.score - 0.3333333333333333) < 1e-9);
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

// Build N filler keywords that will NOT match the test tasks below.
function filler(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `filler${i}`);
}

describe("matchLoadout — recall-aware scoring (FT-K1)", () => {
  it("(a) a 2-keyword match on a 20+ keyword entry now scores >= 0.4", () => {
    // 24-keyword entry; task hits exactly 2 of them.
    const index = makeIndex(
      { id: "rich", keywords: ["deploy", "release", ...filler(22)] },
    );
    const results = matchLoadout("deploy a release", index);
    assert.equal(results.length, 1);
    assert.equal(results[0].matchedKeywords.length, 2);
    // coverage 2/24 = 0.083, absolute 2/5 = 0.4 -> max = 0.4
    assert.ok(results[0].score >= 0.4, `score was ${results[0].score}`);
    assert.equal(results[0].score, 0.4);
    // Transparency: component breakdown is present and explains the score.
    assert.ok(results[0].scoreComponents);
    assert.equal(results[0].scoreComponents!.matched, 2);
    assert.equal(results[0].scoreComponents!.absolute, 0.4);
    assert.ok(results[0].scoreComponents!.coverage < 0.1);
    assert.equal(results[0].scoreComponents!.base, 0.4);
  });

  it("(a') a 3-keyword match on a keyword-rich entry scores 0.6", () => {
    const index = makeIndex(
      { id: "rich", keywords: ["deploy", "release", "rollback", ...filler(27)] },
    );
    const results = matchLoadout("deploy release rollback now", index);
    assert.equal(results[0].matchedKeywords.length, 3);
    // absolute 3/5 = 0.6 dominates coverage 3/30 = 0.1
    assert.ok(Math.abs(results[0].score - 0.6) < 1e-9, `score was ${results[0].score}`);
  });

  it("(b) a single incidental hit on a large entry stays <= 0.2", () => {
    // 30-keyword entry; task hits exactly 1 keyword incidentally.
    const index = makeIndex(
      { id: "big", keywords: ["deploy", ...filler(29)] },
    );
    const results = matchLoadout("deploy something", index);
    assert.equal(results.length, 1);
    assert.equal(results[0].matchedKeywords.length, 1);
    // coverage 1/30 = 0.033, absolute 1/5 = 0.2 -> max = 0.2
    assert.ok(results[0].score <= 0.2, `score was ${results[0].score}`);
    assert.equal(results[0].score, 0.2);
  });

  it("single hit on a tiny entry keeps high coverage (max picks coverage)", () => {
    const index = makeIndex(
      { id: "tiny", keywords: ["deploy", "release", "rollback"] },
    );
    const results = matchLoadout("deploy something", index);
    // coverage 1/3 = 0.333 beats absolute 1/5 = 0.2 -> max = 0.333
    assert.ok(Math.abs(results[0].score - 0.3333333333333333) < 1e-9, `score was ${results[0].score}`);
  });
});

describe("matchLoadout — minScore option (FT-K3)", () => {
  it("(c) minScore option filters out low scores", () => {
    // Single incidental hit on a large entry -> score 0.2.
    const index = makeIndex(
      { id: "big", keywords: ["deploy", ...filler(29)] },
    );
    // Default threshold (0.1): the 0.2 entry is included.
    const included = matchLoadout("deploy something", index);
    assert.equal(included.length, 1);
    // Raised threshold (0.3): the 0.2 entry is filtered out as noise.
    const filtered = matchLoadout("deploy something", index, { minScore: 0.3 });
    assert.equal(filtered.length, 0);
  });

  it("minScore option does not affect a genuine multi-keyword match", () => {
    const index = makeIndex(
      { id: "rich", keywords: ["deploy", "release", ...filler(22)] },
    );
    // score 0.4 survives a 0.3 threshold.
    const results = matchLoadout("deploy a release", index, { minScore: 0.3 });
    assert.equal(results.length, 1);
    assert.equal(results[0].entry.id, "rich");
  });

  it("DEFAULT_MIN_SCORE matches the implicit 2-arg behavior", () => {
    const index = makeIndex(
      { id: "big", keywords: ["deploy", ...filler(29)] },
    );
    const implicit = matchLoadout("deploy something", index);
    const explicit = matchLoadout("deploy something", index, { minScore: DEFAULT_MIN_SCORE });
    assert.equal(implicit.length, explicit.length);
    assert.equal(implicit.length, 1);
  });
});

describe("matchLoadout — core/manual unchanged (FT-K1 regression)", () => {
  it("(d) core entries still score 1.0 with no component breakdown", () => {
    const index = makeIndex(
      { id: "core-rule", keywords: ["whatever"], priority: "core" },
    );
    const results = matchLoadout("anything at all", index);
    assert.equal(results.length, 1);
    assert.equal(results[0].score, 1.0);
    assert.equal(results[0].mode, "eager");
    assert.equal(results[0].reason, "core: always loaded");
    // Core entries do not get a recall-aware component breakdown.
    assert.equal(results[0].scoreComponents, undefined);
  });

  it("(d) manual entries are still never auto-included", () => {
    const index = makeIndex(
      { id: "manual-rule", keywords: ["deploy", "release"], priority: "manual" },
    );
    // Even with a strong keyword match, manual entries do not auto-load.
    const results = matchLoadout("deploy a release now", index);
    assert.equal(results.length, 0);
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
