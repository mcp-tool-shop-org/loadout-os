import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeMemoryMd } from "../analyze.js";
import { generateIndex } from "../index-gen.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "..", "..", "src", "tests", "fixtures");

describe("generateIndex", () => {
  it("generates index from analysis", () => {
    const analysis = analyzeMemoryMd(join(FIXTURES, "MEMORY.md"));
    const index = generateIndex(analysis);

    assert.equal(index.version, "1.0.0");
    assert.ok(index.generated);
    assert.ok(index.entries.length >= 3); // only files that exist
    assert.ok(index.budget);
  });

  it("creates entries only for existing files", () => {
    const analysis = analyzeMemoryMd(join(FIXTURES, "MEMORY.md"));
    const index = generateIndex(analysis);

    // Missing files should NOT be in the index
    const ids = index.entries.map((e) => e.id);
    assert.ok(!ids.includes("nullout"));
    assert.ok(!ids.includes("xrpl-lab"));
  });

  it("generates kebab-case IDs from names", () => {
    const analysis = analyzeMemoryMd(join(FIXTURES, "MEMORY.md"));
    const index = generateIndex(analysis);

    for (const entry of index.entries) {
      assert.match(entry.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("populates keywords from content", () => {
    const analysis = analyzeMemoryMd(join(FIXTURES, "MEMORY.md"));
    const index = generateIndex(analysis);

    const aiLoadout = index.entries.find((e) => e.id === "ai-loadout");
    assert.ok(aiLoadout);
    assert.ok(aiLoadout.keywords.length > 0);
  });

  it("sets lazyLoad when option provided", () => {
    const analysis = analyzeMemoryMd(join(FIXTURES, "MEMORY.md"));
    const index = generateIndex(analysis, { lazyLoad: true });
    assert.equal(index.lazyLoad, true);
  });

  it("omits lazyLoad when not set", () => {
    const analysis = analyzeMemoryMd(join(FIXTURES, "MEMORY.md"));
    const index = generateIndex(analysis);
    assert.equal(index.lazyLoad, undefined);
  });

  it("calculates budget correctly", () => {
    const analysis = analyzeMemoryMd(join(FIXTURES, "MEMORY.md"));
    const index = generateIndex(analysis);

    assert.ok(index.budget.always_loaded_est > 0); // includes inline tokens
    assert.ok(index.budget.on_demand_total_est >= 0);
    assert.equal(index.budget.avg_task_load_observed, null);
  });

  it("uses description from MEMORY.md as summary", () => {
    const analysis = analyzeMemoryMd(join(FIXTURES, "MEMORY.md"));
    const index = generateIndex(analysis);

    const aiLoadout = index.entries.find((e) => e.id === "ai-loadout");
    assert.ok(aiLoadout);
    assert.ok(aiLoadout.summary.includes("routing core"));
  });
});
