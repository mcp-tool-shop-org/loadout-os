import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findDeadEntries, findKeywordOverlaps, analyzeBudget } from "../analysis.js";
import type { LoadoutIndex, LoadoutEntry, UsageEvent } from "../types.js";
import { DEFAULT_TRIGGERS } from "../types.js";

function makeEntry(overrides: Partial<LoadoutEntry> = {}): LoadoutEntry {
  return {
    id: "test-rule",
    path: ".rules/test-rule.md",
    keywords: ["test"],
    patterns: [],
    priority: "domain",
    summary: "A test rule",
    triggers: { ...DEFAULT_TRIGGERS },
    tokens_est: 100,
    lines: 10,
    ...overrides,
  };
}

function makeIndex(entries: LoadoutEntry[]): LoadoutIndex {
  return {
    version: "1.0.0",
    generated: new Date().toISOString(),
    entries,
    budget: {
      always_loaded_est: 0,
      on_demand_total_est: 0,
      avg_task_load_est: 0,
      avg_task_load_observed: null,
    },
  };
}

function makeEvent(entryId: string): UsageEvent {
  return {
    timestamp: "2026-03-06T12:00:00Z",
    taskHash: "abc",
    entryId,
    trigger: "test",
    mode: "lazy",
    tokensEst: 100,
  };
}

describe("findDeadEntries", () => {
  it("finds entries never loaded", () => {
    const index = makeIndex([
      makeEntry({ id: "used", tokens_est: 100 }),
      makeEntry({ id: "dead", tokens_est: 200 }),
      makeEntry({ id: "also-dead", tokens_est: 300 }),
    ]);
    const events = [makeEvent("used")];
    const dead = findDeadEntries(index, events);

    assert.equal(dead.length, 2);
    assert.ok(dead.some((d) => d.entry.id === "dead"));
    assert.ok(dead.some((d) => d.entry.id === "also-dead"));
  });

  it("excludes core entries from dead list", () => {
    const index = makeIndex([
      makeEntry({ id: "core-rule", priority: "core" }),
      makeEntry({ id: "unused-domain" }),
    ]);
    const dead = findDeadEntries(index, []);
    assert.equal(dead.length, 1);
    assert.equal(dead[0].entry.id, "unused-domain");
  });

  it("sorts by token cost descending", () => {
    const index = makeIndex([
      makeEntry({ id: "small", tokens_est: 50 }),
      makeEntry({ id: "big", tokens_est: 500 }),
      makeEntry({ id: "medium", tokens_est: 200 }),
    ]);
    const dead = findDeadEntries(index, []);
    assert.equal(dead[0].entry.id, "big");
    assert.equal(dead[1].entry.id, "medium");
    assert.equal(dead[2].entry.id, "small");
  });

  it("returns empty when all entries are loaded", () => {
    const index = makeIndex([
      makeEntry({ id: "a" }),
      makeEntry({ id: "b" }),
    ]);
    const events = [makeEvent("a"), makeEvent("b")];
    assert.equal(findDeadEntries(index, events).length, 0);
  });
});

describe("findKeywordOverlaps", () => {
  it("finds shared keywords", () => {
    const index = makeIndex([
      makeEntry({ id: "ci", keywords: ["ci", "workflow", "runner"] }),
      makeEntry({ id: "deploy", keywords: ["deploy", "workflow", "release"] }),
    ]);
    const overlaps = findKeywordOverlaps(index);
    assert.equal(overlaps.length, 1);
    assert.equal(overlaps[0].keyword, "workflow");
    assert.deepEqual(overlaps[0].entries, ["ci", "deploy"]);
  });

  it("returns empty when no overlaps", () => {
    const index = makeIndex([
      makeEntry({ id: "a", keywords: ["alpha"] }),
      makeEntry({ id: "b", keywords: ["beta"] }),
    ]);
    assert.equal(findKeywordOverlaps(index).length, 0);
  });

  it("handles three-way overlap", () => {
    const index = makeIndex([
      makeEntry({ id: "a", keywords: ["shared"] }),
      makeEntry({ id: "b", keywords: ["shared"] }),
      makeEntry({ id: "c", keywords: ["shared"] }),
    ]);
    const overlaps = findKeywordOverlaps(index);
    assert.equal(overlaps.length, 1);
    assert.equal(overlaps[0].entries.length, 3);
  });

  it("sorts by overlap count descending", () => {
    const index = makeIndex([
      makeEntry({ id: "a", keywords: ["x", "y"] }),
      makeEntry({ id: "b", keywords: ["x", "y"] }),
      makeEntry({ id: "c", keywords: ["x"] }),
    ]);
    const overlaps = findKeywordOverlaps(index);
    // "x" appears in 3 entries, "y" in 2
    assert.equal(overlaps[0].keyword, "x");
    assert.equal(overlaps[0].entries.length, 3);
  });
});

describe("analyzeBudget", () => {
  it("breaks down by priority tier", () => {
    const index = makeIndex([
      makeEntry({ id: "core-1", priority: "core", tokens_est: 200 }),
      makeEntry({ id: "domain-1", priority: "domain", tokens_est: 300 }),
      makeEntry({ id: "domain-2", priority: "domain", tokens_est: 100 }),
      makeEntry({ id: "manual-1", priority: "manual", tokens_est: 50 }),
    ]);
    const breakdown = analyzeBudget(index);

    assert.equal(breakdown.coreTokens, 200);
    assert.equal(breakdown.domainTokens, 400);
    assert.equal(breakdown.manualTokens, 50);
    assert.equal(breakdown.totalTokens, 650);
    assert.equal(breakdown.coreEntries, 1);
    assert.equal(breakdown.domainEntries, 2);
    assert.equal(breakdown.manualEntries, 1);
  });

  it("calculates average domain size", () => {
    const index = makeIndex([
      makeEntry({ id: "d1", priority: "domain", tokens_est: 300 }),
      makeEntry({ id: "d2", priority: "domain", tokens_est: 100 }),
    ]);
    const breakdown = analyzeBudget(index);
    assert.equal(breakdown.avgDomainSize, 200);
  });

  it("identifies largest and smallest entries", () => {
    const index = makeIndex([
      makeEntry({ id: "small", tokens_est: 50 }),
      makeEntry({ id: "big", tokens_est: 500 }),
      makeEntry({ id: "medium", tokens_est: 200 }),
    ]);
    const breakdown = analyzeBudget(index);
    assert.equal(breakdown.largestEntry?.id, "big");
    assert.equal(breakdown.smallestEntry?.id, "small");
  });

  it("calculates observed average from usage", () => {
    const index = makeIndex([makeEntry()]);
    const usage = [
      { entryId: "a", loadCount: 3, totalTokens: 600, lastLoaded: "t", triggers: ["t"], modes: new Set(["lazy"]) },
      { entryId: "b", loadCount: 1, totalTokens: 200, lastLoaded: "t", triggers: ["t"], modes: new Set(["lazy"]) },
    ];
    const breakdown = analyzeBudget(index, usage);
    assert.equal(breakdown.observedAvg, 200); // 800 / 4
  });

  it("returns null observedAvg without usage data", () => {
    const index = makeIndex([makeEntry()]);
    const breakdown = analyzeBudget(index);
    assert.equal(breakdown.observedAvg, null);
  });

  it("handles empty index", () => {
    const index = makeIndex([]);
    const breakdown = analyzeBudget(index);
    assert.equal(breakdown.totalTokens, 0);
    assert.equal(breakdown.largestEntry, null);
  });
});
