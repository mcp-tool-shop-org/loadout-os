import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { recordUsage, readUsage, readUsageWithStats, summarizeUsage, summaryToJSON } from "../usage.js";
import type { UsageEvent } from "../types.js";

function makeTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "ai-loadout-test-"));
  return join(dir, "usage.jsonl");
}

function makeEvent(overrides: Partial<UsageEvent> = {}): UsageEvent {
  return {
    timestamp: "2026-03-06T12:00:00Z",
    taskHash: "abc123",
    entryId: "test-rule",
    trigger: "test",
    mode: "lazy",
    tokensEst: 100,
    ...overrides,
  };
}

describe("recordUsage", () => {
  it("appends events to JSONL file", () => {
    const path = makeTmp();
    recordUsage(makeEvent({ entryId: "a" }), path);
    recordUsage(makeEvent({ entryId: "b" }), path);
    const events = readUsage(path);
    assert.equal(events.length, 2);
    assert.equal(events[0].entryId, "a");
    assert.equal(events[1].entryId, "b");
    unlinkSync(path);
  });
});

describe("readUsage", () => {
  it("returns empty array for missing file", () => {
    const events = readUsage("/nonexistent/path/usage.jsonl");
    assert.equal(events.length, 0);
  });

  it("skips malformed lines", () => {
    const path = makeTmp();
    writeFileSync(path, '{"entryId":"a","timestamp":"t","taskHash":"h","trigger":"t","mode":"lazy","tokensEst":1}\nnot json\n{"entryId":"b","timestamp":"t","taskHash":"h","trigger":"t","mode":"lazy","tokensEst":2}\n');
    const events = readUsage(path);
    assert.equal(events.length, 2);
    unlinkSync(path);
  });

  it("handles empty file", () => {
    const path = makeTmp();
    writeFileSync(path, "");
    const events = readUsage(path);
    assert.equal(events.length, 0);
    unlinkSync(path);
  });
});

describe("readUsageWithStats (KER-B5 observability)", () => {
  it("counts malformed lines instead of silently dropping them", () => {
    const path = makeTmp();
    writeFileSync(
      path,
      '{"entryId":"a","timestamp":"t","taskHash":"h","trigger":"t","mode":"lazy","tokensEst":1}\n' +
        "not json\n" +
        "also { broken\n" +
        '{"entryId":"b","timestamp":"t","taskHash":"h","trigger":"t","mode":"lazy","tokensEst":2}\n'
    );
    const { events, skipped } = readUsageWithStats(path);
    assert.equal(events.length, 2);
    assert.equal(skipped, 2);
    unlinkSync(path);
  });

  it("reports zero skipped for a clean file", () => {
    const path = makeTmp();
    writeFileSync(
      path,
      '{"entryId":"a","timestamp":"t","taskHash":"h","trigger":"t","mode":"lazy","tokensEst":1}\n'
    );
    const { events, skipped } = readUsageWithStats(path);
    assert.equal(events.length, 1);
    assert.equal(skipped, 0);
    unlinkSync(path);
  });

  it("does not count blank lines as malformed", () => {
    const path = makeTmp();
    writeFileSync(
      path,
      '{"entryId":"a","timestamp":"t","taskHash":"h","trigger":"t","mode":"lazy","tokensEst":1}\n\n   \n'
    );
    const { events, skipped } = readUsageWithStats(path);
    assert.equal(events.length, 1);
    assert.equal(skipped, 0);
    unlinkSync(path);
  });

  it("returns zero skipped for a missing file", () => {
    const { events, skipped } = readUsageWithStats("/nonexistent/path/usage.jsonl");
    assert.equal(events.length, 0);
    assert.equal(skipped, 0);
  });

  it("readUsage remains a thin wrapper returning just the events", () => {
    const path = makeTmp();
    writeFileSync(path, "broken\n" + '{"entryId":"a","timestamp":"t","taskHash":"h","trigger":"t","mode":"lazy","tokensEst":1}\n');
    const events = readUsage(path);
    assert.equal(events.length, 1);
    assert.equal(events[0].entryId, "a");
    unlinkSync(path);
  });
});

describe("summarizeUsage", () => {
  it("groups by entry ID", () => {
    const events = [
      makeEvent({ entryId: "a", tokensEst: 100 }),
      makeEvent({ entryId: "a", tokensEst: 100 }),
      makeEvent({ entryId: "b", tokensEst: 200 }),
    ];
    const summary = summarizeUsage(events);
    assert.equal(summary.length, 2);

    const a = summary.find((s) => s.entryId === "a")!;
    assert.equal(a.loadCount, 2);
    assert.equal(a.totalTokens, 200);
  });

  it("sorts by load count descending", () => {
    const events = [
      makeEvent({ entryId: "rare" }),
      makeEvent({ entryId: "common" }),
      makeEvent({ entryId: "common" }),
      makeEvent({ entryId: "common" }),
    ];
    const summary = summarizeUsage(events);
    assert.equal(summary[0].entryId, "common");
    assert.equal(summary[0].loadCount, 3);
  });

  it("tracks unique triggers", () => {
    const events = [
      makeEvent({ entryId: "a", trigger: "keyword-ci" }),
      makeEvent({ entryId: "a", trigger: "keyword-deploy" }),
      makeEvent({ entryId: "a", trigger: "keyword-ci" }),
    ];
    const summary = summarizeUsage(events);
    assert.equal(summary[0].triggers.length, 2);
  });

  it("returns empty for no events", () => {
    assert.equal(summarizeUsage([]).length, 0);
  });

  it("tracks latest timestamp", () => {
    const events = [
      makeEvent({ entryId: "a", timestamp: "2026-03-01T00:00:00Z" }),
      makeEvent({ entryId: "a", timestamp: "2026-03-06T12:00:00Z" }),
      makeEvent({ entryId: "a", timestamp: "2026-03-03T00:00:00Z" }),
    ];
    const summary = summarizeUsage(events);
    assert.equal(summary[0].lastLoaded, "2026-03-06T12:00:00Z");
  });

  it("tracks unique modes as a Set", () => {
    const events = [
      makeEvent({ entryId: "a", mode: "eager" }),
      makeEvent({ entryId: "a", mode: "lazy" }),
      makeEvent({ entryId: "a", mode: "eager" }),
    ];
    const summary = summarizeUsage(events);
    assert.ok(summary[0].modes instanceof Set);
    assert.equal(summary[0].modes.size, 2);
    assert.ok(summary[0].modes.has("eager"));
    assert.ok(summary[0].modes.has("lazy"));
  });
});

describe("summaryToJSON (KER-06)", () => {
  it("serializes modes as an array, not an empty object", () => {
    // Regression: JSON.stringify(summary) drops the modes Set to {}.
    // summaryToJSON projects modes to an array so --json output keeps them.
    const events = [
      makeEvent({ entryId: "a", mode: "eager" }),
      makeEvent({ entryId: "a", mode: "lazy" }),
    ];
    const summary = summarizeUsage(events);

    // The raw Set would serialize to {} — confirm the bug we are fixing.
    assert.equal(JSON.stringify(summary[0].modes), "{}");

    const json = summary.map(summaryToJSON);
    assert.ok(Array.isArray(json[0].modes));
    assert.deepEqual([...json[0].modes].sort(), ["eager", "lazy"]);

    // The serialized JSON string actually contains the modes.
    const serialized = JSON.stringify(json, null, 2);
    const parsed = JSON.parse(serialized) as Array<{ modes: string[] }>;
    assert.deepEqual(parsed[0].modes.sort(), ["eager", "lazy"]);
  });

  it("preserves all other summary fields", () => {
    const events = [makeEvent({ entryId: "x", trigger: "kw-ci", tokensEst: 42 })];
    const json = summaryToJSON(summarizeUsage(events)[0]);
    assert.equal(json.entryId, "x");
    assert.equal(json.loadCount, 1);
    assert.equal(json.totalTokens, 42);
    assert.deepEqual(json.triggers, ["kw-ci"]);
    assert.deepEqual(json.modes, ["lazy"]);
  });
});
