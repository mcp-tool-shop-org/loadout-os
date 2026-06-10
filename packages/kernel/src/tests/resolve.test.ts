import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverLayers, resolveLoadout, explainEntry } from "../resolve.js";
import type { LoadoutIndex, LoadoutEntry, DiscoveredLayer } from "../index.js";
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
      always_loaded_est: 0,
      on_demand_total_est: 0,
      avg_task_load_est: 0,
      avg_task_load_observed: null,
    },
  };
}

interface TmpDirs {
  root: string;
  globalDir: string;
  projectRoot: string;
}

function setupTmpDirs(): TmpDirs {
  const root = mkdtempSync(join(tmpdir(), "ai-loadout-resolve-"));
  const globalDir = join(root, "global");
  const projectRoot = join(root, "project");
  mkdirSync(globalDir, { recursive: true });
  mkdirSync(join(projectRoot, ".claude", "loadout"), { recursive: true });
  return { root, globalDir, projectRoot };
}

function writeIndex(dir: string, index: LoadoutIndex) {
  writeFileSync(join(dir, "index.json"), JSON.stringify(index));
}

function cleanup(root: string) {
  rmSync(root, { recursive: true, force: true });
}

// ── discoverLayers ───────────────────────────────────────────────

describe("discoverLayers", () => {
  it("finds global and project indexes", () => {
    const { root, globalDir, projectRoot } = setupTmpDirs();
    writeIndex(globalDir, makeIndex([makeEntry({ id: "global-rule" })]));
    writeIndex(
      join(projectRoot, ".claude", "loadout"),
      makeIndex([makeEntry({ id: "project-rule" })])
    );

    const { layers, searched } = discoverLayers({
      globalDir,
      projectRoot,
    });

    assert.equal(layers.length, 2);
    assert.equal(layers[0].name, "global");
    assert.equal(layers[1].name, "project");
    assert.equal(searched.filter((s) => s.found).length, 2);
    cleanup(root);
  });

  it("handles missing layers gracefully", () => {
    const { root, globalDir, projectRoot } = setupTmpDirs();
    // No index files written — both missing

    const { layers, searched } = discoverLayers({
      globalDir,
      projectRoot,
    });

    assert.equal(layers.length, 0);
    assert.ok(searched.length >= 2);
    assert.ok(searched.every((s) => !s.found));
    cleanup(root);
  });

  it("skips malformed index files", () => {
    const { root, globalDir, projectRoot } = setupTmpDirs();
    writeFileSync(join(globalDir, "index.json"), "not json {{{");
    writeIndex(
      join(projectRoot, ".claude", "loadout"),
      makeIndex([makeEntry({ id: "ok" })])
    );

    const { layers, searched } = discoverLayers({
      globalDir,
      projectRoot,
    });

    assert.equal(layers.length, 1);
    assert.equal(layers[0].name, "project");
    // Global was searched but marked not found due to parse error
    const globalSearch = searched.find((s) => s.name === "global")!;
    assert.equal(globalSearch.found, false);
    cleanup(root);
  });

  it("includes org layer when path is provided", () => {
    const { root, globalDir, projectRoot } = setupTmpDirs();
    const orgDir = join(root, "org");
    mkdirSync(orgDir, { recursive: true });
    writeIndex(orgDir, makeIndex([makeEntry({ id: "org-rule" })]));

    const { layers } = discoverLayers({
      globalDir,
      projectRoot,
      orgPath: join(orgDir, "index.json"),
    });

    assert.equal(layers.length, 1);
    assert.equal(layers[0].name, "org");
    cleanup(root);
  });

  it("includes session layer when path is provided", () => {
    const { root, globalDir, projectRoot } = setupTmpDirs();
    const sessionFile = join(root, "session-index.json");
    writeFileSync(sessionFile, JSON.stringify(makeIndex([makeEntry({ id: "session-rule" })])));

    const { layers } = discoverLayers({
      globalDir,
      projectRoot,
      sessionPath: sessionFile,
    });

    assert.equal(layers.length, 1);
    assert.equal(layers[0].name, "session");
    cleanup(root);
  });

  it("maintains correct layer order: global → org → project → session", () => {
    const { root, globalDir, projectRoot } = setupTmpDirs();
    const orgDir = join(root, "org");
    mkdirSync(orgDir, { recursive: true });
    const sessionFile = join(root, "session-index.json");

    writeIndex(globalDir, makeIndex([makeEntry({ id: "g" })]));
    writeIndex(orgDir, makeIndex([makeEntry({ id: "o" })]));
    writeIndex(join(projectRoot, ".claude", "loadout"), makeIndex([makeEntry({ id: "p" })]));
    writeFileSync(sessionFile, JSON.stringify(makeIndex([makeEntry({ id: "s" })])));

    const { layers } = discoverLayers({
      globalDir,
      projectRoot,
      orgPath: join(orgDir, "index.json"),
      sessionPath: sessionFile,
    });

    assert.equal(layers.length, 4);
    assert.equal(layers[0].name, "global");
    assert.equal(layers[1].name, "org");
    assert.equal(layers[2].name, "project");
    assert.equal(layers[3].name, "session");
    cleanup(root);
  });
});

// ── resolveLoadout ───────────────────────────────────────────────

describe("resolveLoadout", () => {
  it("merges layers with later overriding earlier", () => {
    const { root, globalDir, projectRoot } = setupTmpDirs();
    writeIndex(globalDir, makeIndex([
      makeEntry({ id: "auth", summary: "Global auth" }),
      makeEntry({ id: "logging", summary: "Global logging" }),
    ]));
    writeIndex(join(projectRoot, ".claude", "loadout"), makeIndex([
      makeEntry({ id: "auth", summary: "Project auth" }),
      makeEntry({ id: "ci", summary: "CI rules" }),
    ]));

    const result = resolveLoadout({ globalDir, projectRoot });

    assert.equal(result.merged.entries.length, 3);
    const auth = result.merged.entries.find((e) => e.id === "auth")!;
    assert.equal(auth.summary, "Project auth");
    assert.equal(result.merged.provenance["auth"], "project");
    assert.equal(result.merged.provenance["logging"], "global");
    assert.equal(result.merged.provenance["ci"], "project");
    cleanup(root);
  });

  it("returns empty merge when no layers exist", () => {
    const { root, globalDir, projectRoot } = setupTmpDirs();

    const result = resolveLoadout({ globalDir, projectRoot });

    assert.equal(result.merged.entries.length, 0);
    assert.equal(result.layers.length, 0);
    cleanup(root);
  });

  it("works with project-only (most common case)", () => {
    const { root, globalDir, projectRoot } = setupTmpDirs();
    writeIndex(join(projectRoot, ".claude", "loadout"), makeIndex([
      makeEntry({ id: "a", tokens_est: 100, priority: "core" }),
      makeEntry({ id: "b", tokens_est: 200 }),
    ]));

    const result = resolveLoadout({ globalDir, projectRoot });

    assert.equal(result.layers.length, 1);
    assert.equal(result.layers[0].name, "project");
    assert.equal(result.merged.entries.length, 2);
    assert.equal(result.merged.budget.always_loaded_est, 100);
    assert.equal(result.merged.budget.on_demand_total_est, 200);
    cleanup(root);
  });

  it("tracks conflicts across layers", () => {
    const { root, globalDir, projectRoot } = setupTmpDirs();
    writeIndex(globalDir, makeIndex([makeEntry({ id: "shared" })]));
    writeIndex(join(projectRoot, ".claude", "loadout"), makeIndex([makeEntry({ id: "shared" })]));

    const result = resolveLoadout({ globalDir, projectRoot });

    assert.equal(result.merged.conflicts.length, 1);
    assert.equal(result.merged.conflicts[0].entryId, "shared");
    assert.deepEqual(result.merged.conflicts[0].layers, ["global", "project"]);
    cleanup(root);
  });

  it("four-layer merge with progressive override", () => {
    const { root, globalDir, projectRoot } = setupTmpDirs();
    const orgDir = join(root, "org");
    mkdirSync(orgDir, { recursive: true });
    const sessionFile = join(root, "session.json");

    writeIndex(globalDir, makeIndex([makeEntry({ id: "rule", summary: "v1-global" })]));
    writeIndex(orgDir, makeIndex([makeEntry({ id: "rule", summary: "v2-org" })]));
    writeIndex(join(projectRoot, ".claude", "loadout"), makeIndex([makeEntry({ id: "rule", summary: "v3-project" })]));
    writeFileSync(sessionFile, JSON.stringify(makeIndex([makeEntry({ id: "rule", summary: "v4-session" })])));

    const result = resolveLoadout({
      globalDir,
      projectRoot,
      orgPath: join(orgDir, "index.json"),
      sessionPath: sessionFile,
    });

    assert.equal(result.merged.entries.length, 1);
    assert.equal(result.merged.entries[0].summary, "v4-session");
    assert.equal(result.merged.provenance["rule"], "session");
    assert.equal(result.merged.conflicts[0].layers.length, 4);
    cleanup(root);
  });
});

// ── explainEntry ─────────────────────────────────────────────────

describe("explainEntry", () => {
  function makeLayers(): DiscoveredLayer[] {
    return [
      {
        name: "global",
        path: "/global/index.json",
        index: makeIndex([
          makeEntry({ id: "auth", summary: "Global auth", priority: "domain", tokens_est: 100, keywords: ["auth"] }),
          makeEntry({ id: "logging", summary: "Global logging", tokens_est: 50 }),
        ]),
      },
      {
        name: "org",
        path: "/org/index.json",
        index: makeIndex([
          makeEntry({ id: "auth", summary: "Org auth", priority: "core", tokens_est: 200, keywords: ["auth", "sso"] }),
        ]),
      },
      {
        name: "project",
        path: "/project/.claude/loadout/index.json",
        index: makeIndex([
          makeEntry({ id: "auth", summary: "Project auth", priority: "core", tokens_est: 150, keywords: ["auth", "jwt"] }),
          makeEntry({ id: "ci", summary: "CI rules", tokens_est: 300 }),
        ]),
      },
    ];
  }

  it("explains entry defined in one layer", () => {
    const layers = makeLayers();
    const result = explainEntry("logging", layers)!;

    assert.equal(result.id, "logging");
    assert.equal(result.finalLayer, "global");
    assert.equal(result.definitions.length, 1);
    assert.equal(result.isConflict, false);
    assert.deepEqual(result.overrideChain, ["global"]);
  });

  it("explains entry overridden across layers", () => {
    const layers = makeLayers();
    const result = explainEntry("auth", layers)!;

    assert.equal(result.id, "auth");
    assert.equal(result.finalLayer, "project");
    assert.equal(result.definitions.length, 3);
    assert.equal(result.isConflict, true);
    assert.deepEqual(result.overrideChain, ["global", "org", "project"]);

    // Verify each definition
    assert.equal(result.definitions[0].layer, "global");
    assert.equal(result.definitions[0].summary, "Global auth");
    assert.equal(result.definitions[0].priority, "domain");

    assert.equal(result.definitions[1].layer, "org");
    assert.equal(result.definitions[1].summary, "Org auth");
    assert.equal(result.definitions[1].priority, "core");

    assert.equal(result.definitions[2].layer, "project");
    assert.equal(result.definitions[2].summary, "Project auth");
    assert.deepEqual(result.definitions[2].keywords, ["auth", "jwt"]);
  });

  it("returns null for unknown entry", () => {
    const layers = makeLayers();
    const result = explainEntry("nonexistent", layers);
    assert.equal(result, null);
  });

  it("works with empty layers", () => {
    const result = explainEntry("anything", []);
    assert.equal(result, null);
  });

  it("shows single-layer entry as non-conflict", () => {
    const layers = makeLayers();
    const result = explainEntry("ci", layers)!;

    assert.equal(result.finalLayer, "project");
    assert.equal(result.isConflict, false);
    assert.equal(result.definitions.length, 1);
  });

  it("captures keyword changes across layers", () => {
    const layers = makeLayers();
    const result = explainEntry("auth", layers)!;

    // Global had ["auth"], org had ["auth", "sso"], project has ["auth", "jwt"]
    assert.deepEqual(result.definitions[0].keywords, ["auth"]);
    assert.deepEqual(result.definitions[1].keywords, ["auth", "sso"]);
    assert.deepEqual(result.definitions[2].keywords, ["auth", "jwt"]);
  });
});
