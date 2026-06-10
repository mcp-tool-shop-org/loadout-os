import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { recordUsage, readUsage, summarizeUsage } from "../usage.js";
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
});
