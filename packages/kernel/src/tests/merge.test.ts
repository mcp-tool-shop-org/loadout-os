import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeIndexes } from "../merge.js";
import type { LoadoutIndex, LoadoutEntry } from "../types.js";
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

describe("mergeIndexes", () => {
  it("merges disjoint entries from multiple layers", () => {
    const global = makeIndex([makeEntry({ id: "auth", keywords: ["auth"] })]);
    const project = makeIndex([makeEntry({ id: "ci", keywords: ["ci"] })]);

    const result = mergeIndexes([
      { name: "global", index: global },
      { name: "project", index: project },
    ]);

    assert.equal(result.entries.length, 2);
    assert.equal(result.provenance["auth"], "global");
    assert.equal(result.provenance["ci"], "project");
    assert.equal(result.conflicts.length, 0);
  });

  it("later layer overrides earlier for same ID", () => {
    const global = makeIndex([makeEntry({ id: "auth", summary: "Global auth" })]);
    const project = makeIndex([makeEntry({ id: "auth", summary: "Project auth" })]);

    const result = mergeIndexes([
      { name: "global", index: global },
      { name: "project", index: project },
    ]);

    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].summary, "Project auth");
    assert.equal(result.provenance["auth"], "project");
  });

  it("reports conflicts when same ID in multiple layers", () => {
    const global = makeIndex([makeEntry({ id: "auth" })]);
    const project = makeIndex([makeEntry({ id: "auth" })]);

    const result = mergeIndexes([
      { name: "global", index: global },
      { name: "project", index: project },
    ]);

    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0].entryId, "auth");
    assert.deepEqual(result.conflicts[0].layers, ["global", "project"]);
    assert.equal(result.conflicts[0].resolution, "override");
  });

  it("handles empty layers", () => {
    const result = mergeIndexes([]);
    assert.equal(result.entries.length, 0);
    assert.equal(result.conflicts.length, 0);
  });

  it("recalculates budget from merged entries", () => {
    const global = makeIndex([
      makeEntry({ id: "core-1", priority: "core", tokens_est: 200 }),
    ]);
    const project = makeIndex([
      makeEntry({ id: "domain-1", priority: "domain", tokens_est: 300 }),
      makeEntry({ id: "domain-2", priority: "domain", tokens_est: 100 }),
    ]);

    const result = mergeIndexes([
      { name: "global", index: global },
      { name: "project", index: project },
    ]);

    assert.equal(result.budget.always_loaded_est, 200);
    assert.equal(result.budget.on_demand_total_est, 400);
    assert.equal(result.budget.avg_task_load_est, 200); // 400 / 2 domain entries
  });

  it("preserves entry order (later layers after earlier)", () => {
    const global = makeIndex([makeEntry({ id: "a", keywords: ["a"] })]);
    const project = makeIndex([makeEntry({ id: "b", keywords: ["b"] })]);

    const result = mergeIndexes([
      { name: "global", index: global },
      { name: "project", index: project },
    ]);

    assert.equal(result.entries[0].id, "a");
    assert.equal(result.entries[1].id, "b");
  });

  it("three-layer merge with overrides", () => {
    const global = makeIndex([
      makeEntry({ id: "auth", summary: "Global" }),
      makeEntry({ id: "logging", summary: "Global logging" }),
    ]);
    const org = makeIndex([
      makeEntry({ id: "auth", summary: "Org" }),
    ]);
    const project = makeIndex([
      makeEntry({ id: "auth", summary: "Project" }),
      makeEntry({ id: "ci", keywords: ["ci"] }),
    ]);

    const result = mergeIndexes([
      { name: "global", index: global },
      { name: "org", index: org },
      { name: "project", index: project },
    ]);

    assert.equal(result.entries.length, 3);
    // auth was overridden twice, final is project
    const auth = result.entries.find((e) => e.id === "auth")!;
    assert.equal(auth.summary, "Project");
    assert.equal(result.provenance["auth"], "project");
    assert.equal(result.provenance["logging"], "global");
    assert.equal(result.provenance["ci"], "project");

    // auth conflict lists all 3 layers
    const authConflict = result.conflicts.find((c) => c.entryId === "auth")!;
    assert.deepEqual(authConflict.layers, ["global", "org", "project"]);
  });

  it("includes version and generated fields", () => {
    const result = mergeIndexes([
      { name: "global", index: makeIndex([]) },
    ]);
    assert.equal(result.version, "1.0.0");
    assert.ok(result.generated);
  });
});
