import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateIndex } from "../validate.js";
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
      always_loaded_est: 100,
      on_demand_total_est: 200,
      avg_task_load_est: 100,
      avg_task_load_observed: null,
    },
  };
}

describe("validateIndex", () => {
  it("passes clean index", () => {
    const index = makeIndex([makeEntry()]);
    const issues = validateIndex(index);
    assert.equal(issues.length, 0);
  });

  it("catches missing version", () => {
    const index = makeIndex([makeEntry()]);
    index.version = "";
    const issues = validateIndex(index);
    assert.ok(issues.some((i) => i.code === "MISSING_VERSION"));
  });

  it("catches duplicate IDs", () => {
    const index = makeIndex([
      makeEntry({ id: "dupe" }),
      makeEntry({ id: "dupe" }),
    ]);
    const issues = validateIndex(index);
    assert.ok(issues.some((i) => i.code === "DUPLICATE_ID"));
  });

  it("catches missing summary", () => {
    const index = makeIndex([makeEntry({ summary: "" })]);
    const issues = validateIndex(index);
    assert.ok(issues.some((i) => i.code === "MISSING_SUMMARY"));
  });

  it("warns on long summary", () => {
    const index = makeIndex([makeEntry({ summary: "x".repeat(121) })]);
    const issues = validateIndex(index);
    assert.ok(issues.some((i) => i.code === "LONG_SUMMARY"));
  });

  it("catches empty keywords on domain entries", () => {
    const index = makeIndex([makeEntry({ priority: "domain", keywords: [] })]);
    const issues = validateIndex(index);
    assert.ok(issues.some((i) => i.code === "EMPTY_KEYWORDS"));
  });

  it("allows empty keywords on manual entries", () => {
    const index = makeIndex([makeEntry({ priority: "manual", keywords: [] })]);
    const issues = validateIndex(index);
    assert.ok(!issues.some((i) => i.code === "EMPTY_KEYWORDS"));
  });

  it("catches missing path", () => {
    const index = makeIndex([makeEntry({ path: "" })]);
    const issues = validateIndex(index);
    assert.ok(issues.some((i) => i.code === "MISSING_PATH"));
  });

  it("warns on non-kebab-case ID", () => {
    const index = makeIndex([makeEntry({ id: "NotKebab" })]);
    const issues = validateIndex(index);
    assert.ok(issues.some((i) => i.code === "BAD_ID_FORMAT"));
  });

  it("catches invalid priority", () => {
    const index = makeIndex([makeEntry({ priority: "bogus" as any })]);
    const issues = validateIndex(index);
    assert.ok(issues.some((i) => i.code === "INVALID_PRIORITY"));
  });

  it("warns on negative token estimate", () => {
    const index = makeIndex([makeEntry({ tokens_est: -5 })]);
    const issues = validateIndex(index);
    assert.ok(issues.some((i) => i.code === "BAD_TOKEN_EST"));
  });
});
