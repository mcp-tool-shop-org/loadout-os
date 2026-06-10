import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { planLoad, recordLoad, manualLookup } from "../runtime.js";
import type { LoadoutIndex, LoadoutEntry } from "../types.js";
import { DEFAULT_TRIGGERS } from "../types.js";

// ── Helpers ──────────────────────────────────────────────────────

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
    generated: "2026-03-06T00:00:00Z",
    entries,
    budget: {
      always_loaded_est: entries.filter((e) => e.priority === "core").reduce((s, e) => s + e.tokens_est, 0),
      on_demand_total_est: entries.filter((e) => e.priority !== "core").reduce((s, e) => s + e.tokens_est, 0),
      avg_task_load_est: 0,
      avg_task_load_observed: null,
    },
  };
}

interface TmpSetup {
  root: string;
  globalDir: string;
  projectRoot: string;
}

function setup(): TmpSetup {
  const root = mkdtempSync(join(tmpdir(), "ai-loadout-runtime-"));
  const globalDir = join(root, "global");
  const projectRoot = join(root, "project");
  mkdirSync(globalDir, { recursive: true });
  mkdirSync(join(projectRoot, ".claude", "loadout"), { recursive: true });
  return { root, globalDir, projectRoot };
}

function writeProjectIndex(projectRoot: string, index: LoadoutIndex) {
  writeFileSync(
    join(projectRoot, ".claude", "loadout", "index.json"),
    JSON.stringify(index),
  );
}

function cleanup(root: string) {
  rmSync(root, { recursive: true, force: true });
}

// ── planLoad ─────────────────────────────────────────────────────

describe("planLoad", () => {
  it("separates preload and on-demand entries", () => {
    const { root, globalDir, projectRoot } = setup();
    writeProjectIndex(projectRoot, makeIndex([
      makeEntry({ id: "safety", priority: "core", tokens_est: 200 }),
      makeEntry({ id: "ci-rules", priority: "domain", keywords: ["ci", "pipeline"], tokens_est: 300 }),
      makeEntry({ id: "docs-rules", priority: "domain", keywords: ["docs", "readme"], tokens_est: 150 }),
    ]));

    const plan = planLoad("set up ci pipeline", {
      globalDir,
      projectRoot,
    });

    // Core entry should be preloaded
    assert.equal(plan.preload.length, 1);
    assert.equal(plan.preload[0].entry.id, "safety");
    assert.equal(plan.preload[0].mode, "eager");

    // CI rules should match on-demand
    assert.equal(plan.onDemand.length, 1);
    assert.equal(plan.onDemand[0].entry.id, "ci-rules");
    assert.equal(plan.onDemand[0].mode, "lazy");

    // Docs rules didn't match, should be in manual
    assert.ok(plan.manual.some((e) => e.id === "docs-rules"));

    cleanup(root);
  });

  it("calculates token costs correctly", () => {
    const { root, globalDir, projectRoot } = setup();
    writeProjectIndex(projectRoot, makeIndex([
      makeEntry({ id: "core-1", priority: "core", tokens_est: 100 }),
      makeEntry({ id: "core-2", priority: "core", tokens_est: 200 }),
      makeEntry({ id: "domain-1", priority: "domain", keywords: ["deploy"], tokens_est: 300 }),
    ]));

    const plan = planLoad("deploy the app", { globalDir, projectRoot });

    assert.equal(plan.preloadTokens, 300); // 100 + 200
    assert.equal(plan.onDemandTokens, 300); // test matched
    cleanup(root);
  });

  it("includes layer provenance", () => {
    const { root, globalDir, projectRoot } = setup();
    writeFileSync(
      join(globalDir, "index.json"),
      JSON.stringify(makeIndex([makeEntry({ id: "global-rule", keywords: ["safety"] })])),
    );
    writeProjectIndex(projectRoot, makeIndex([
      makeEntry({ id: "project-rule", keywords: ["ci"] }),
    ]));

    const plan = planLoad("check safety and ci", { globalDir, projectRoot });

    assert.equal(plan.provenance["global-rule"], "global");
    assert.equal(plan.provenance["project-rule"], "project");
    assert.deepEqual(plan.layerNames, ["global", "project"]);
    cleanup(root);
  });

  it("reports conflicts when layers override", () => {
    const { root, globalDir, projectRoot } = setup();
    writeFileSync(
      join(globalDir, "index.json"),
      JSON.stringify(makeIndex([makeEntry({ id: "auth", keywords: ["auth"], summary: "Global" })])),
    );
    writeProjectIndex(projectRoot, makeIndex([
      makeEntry({ id: "auth", keywords: ["auth"], summary: "Project" }),
    ]));

    const plan = planLoad("set up auth", { globalDir, projectRoot });

    assert.equal(plan.conflicts.length, 1);
    assert.equal(plan.conflicts[0].entryId, "auth");
    cleanup(root);
  });

  it("handles no matching entries gracefully", () => {
    const { root, globalDir, projectRoot } = setup();
    writeProjectIndex(projectRoot, makeIndex([
      makeEntry({ id: "ci", keywords: ["ci", "pipeline"] }),
    ]));

    const plan = planLoad("unrelated task about cooking", { globalDir, projectRoot });

    assert.equal(plan.preload.length, 0);
    assert.equal(plan.onDemand.length, 0);
    assert.equal(plan.manual.length, 1);
    assert.equal(plan.preloadTokens, 0);
    cleanup(root);
  });

  it("handles no layers found", () => {
    const { root, globalDir, projectRoot } = setup();
    // No index files written

    const plan = planLoad("anything", { globalDir, projectRoot });

    assert.equal(plan.preload.length, 0);
    assert.equal(plan.onDemand.length, 0);
    assert.equal(plan.manual.length, 0);
    assert.equal(plan.layerNames.length, 0);
    cleanup(root);
  });

  it("includes manual-priority entries in manual list", () => {
    const { root, globalDir, projectRoot } = setup();
    writeProjectIndex(projectRoot, makeIndex([
      makeEntry({ id: "reference", priority: "manual", keywords: ["ref"] }),
      makeEntry({ id: "ci", priority: "domain", keywords: ["ci"] }),
    ]));

    const plan = planLoad("ci setup", { globalDir, projectRoot });

    assert.ok(plan.manual.some((e) => e.id === "reference"));
    assert.equal(plan.onDemand.length, 1);
    cleanup(root);
  });
});

// ── recordLoad ───────────────────────────────────────────────────

describe("recordLoad", () => {
  it("appends usage event to JSONL file", () => {
    const { root, globalDir } = setup();
    const usagePath = join(root, "usage.jsonl");

    recordLoad("ci-rules", "keyword-ci", "lazy", 300, {
      usagePath,
      taskHash: "test-123",
      globalDir, // need valid ResolveOptions fields
    });

    assert.ok(existsSync(usagePath));
    const content = readFileSync(usagePath, "utf-8").trim();
    const event = JSON.parse(content);
    assert.equal(event.entryId, "ci-rules");
    assert.equal(event.trigger, "keyword-ci");
    assert.equal(event.mode, "lazy");
    assert.equal(event.tokensEst, 300);
    assert.equal(event.taskHash, "test-123");
    cleanup(root);
  });

  it("does nothing without usagePath", () => {
    // Should not throw
    recordLoad("ci-rules", "keyword-ci", "lazy", 300);
    recordLoad("ci-rules", "keyword-ci", "lazy", 300, {});
  });

  it("appends multiple events", () => {
    const { root } = setup();
    const usagePath = join(root, "usage.jsonl");

    recordLoad("a", "kw-a", "eager", 100, { usagePath, taskHash: "t" });
    recordLoad("b", "kw-b", "lazy", 200, { usagePath, taskHash: "t" });

    const lines = readFileSync(usagePath, "utf-8").trim().split("\n");
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).entryId, "a");
    assert.equal(JSON.parse(lines[1]).entryId, "b");
    cleanup(root);
  });
});

// ── manualLookup ─────────────────────────────────────────────────

describe("manualLookup", () => {
  it("finds entry by ID in resolved index", () => {
    const { root, globalDir, projectRoot } = setup();
    writeProjectIndex(projectRoot, makeIndex([
      makeEntry({ id: "reference", priority: "manual", summary: "XRPL ref" }),
    ]));

    const entry = manualLookup("reference", { globalDir, projectRoot });

    assert.ok(entry);
    assert.equal(entry.id, "reference");
    assert.equal(entry.summary, "XRPL ref");
    cleanup(root);
  });

  it("returns undefined for unknown ID", () => {
    const { root, globalDir, projectRoot } = setup();
    writeProjectIndex(projectRoot, makeIndex([makeEntry({ id: "known" })]));

    const entry = manualLookup("unknown", { globalDir, projectRoot });
    assert.equal(entry, undefined);
    cleanup(root);
  });

  it("finds entry across layers", () => {
    const { root, globalDir, projectRoot } = setup();
    writeFileSync(
      join(globalDir, "index.json"),
      JSON.stringify(makeIndex([makeEntry({ id: "global-ref", priority: "manual" })])),
    );
    writeProjectIndex(projectRoot, makeIndex([makeEntry({ id: "project-ref" })]));

    const entry = manualLookup("global-ref", { globalDir, projectRoot });
    assert.ok(entry);
    assert.equal(entry.id, "global-ref");
    cleanup(root);
  });
});
