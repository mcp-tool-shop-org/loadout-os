import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
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

  // MEM-003: junk prose path-citations must not surface as index entries.
  it("does not emit junk prose path-citations as entries (MEM-003)", () => {
    const analysis = analyzeMemoryMd(join(FIXTURES, "MEMORY.md"));
    const index = generateIndex(analysis);
    const ids = index.entries.map((e) => e.id);
    assert.ok(!ids.includes("memory-files"), "memory-files must not be an entry");
    assert.ok(!ids.includes("full-frame"), "full-frame must not be an entry");
    assert.ok(!ids.includes("see-also"), "see-also must not be an entry");
  });

  // MEM-B03: the library export must NOT write to console.warn for unresolved
  // refs (it spammed SDK consumers + rendered inconsistently). The unresolved
  // paths must instead land in analysis.missingFiles (the data channel the CLI
  // reads). Keep the library quiet.
  it("records unresolved refs in missingFiles, never via console.warn (MEM-B03)", () => {
    const analysis = analyzeMemoryMd(join(FIXTURES, "MEMORY.md"));

    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (...a: unknown[]) => { warnings.push(a.join(" ")); };
    try {
      generateIndex(analysis);
    } finally {
      console.warn = originalWarn;
    }

    // Fixture has unresolved refs (nullout.md, xrpl-lab.md) — they must be in
    // the data channel...
    assert.ok(
      analysis.missingFiles.some((f) => f.includes("nullout")),
      "unresolved ref must be recorded in missingFiles",
    );
    // ...and the library must have stayed silent on stderr.
    assert.equal(
      warnings.filter((w) => /unresolved ref/.test(w)).length,
      0,
      "generateIndex must not console.warn about unresolved refs",
    );
  });

  // MEM-007: entryFromFrontmatter must truncate the summary to 120 chars,
  // same as entryFromContent. The "Long Summary" ref points at a
  // frontmatter-bearing topic file and carries a >120-char description.
  it("truncates frontmatter-branch summaries to 120 chars (MEM-007)", () => {
    const analysis = analyzeMemoryMd(join(FIXTURES, "MEMORY.md"));
    const index = generateIndex(analysis);
    // long-summary.md has frontmatter id "long-summary".
    const entry = index.entries.find((e) => e.id === "long-summary");
    assert.ok(entry, "long-summary entry should exist (frontmatter branch)");
    assert.ok(
      entry.summary.length <= 120,
      `summary should be truncated to <=120 chars, got ${entry.summary.length}`,
    );
  });
});

/**
 * FT-MR11 — the store-relative path contract.
 *
 * The original fixture puts MEMORY.md ABOVE its `memory/` directory, so every
 * ref resolved against the first base and the parent-base fallback was never
 * exercised. The canonical store is the other shape: MEMORY.md sits INSIDE the
 * store and its pointers carry a `memory/` namespace prefix. Recording the raw
 * pointer there made `loadout-os refresh` re-apply the prefix, breaking 420 of
 * 492 live entries. These tests pin the resolved location instead.
 */
describe("generateIndex — store-relative paths (FT-MR11)", () => {
  const FLAT_STORE = join(FIXTURES, "flat-store", "memory");
  const flatIndex = () => generateIndex(analyzeMemoryMd(join(FLAT_STORE, "MEMORY.md")));

  it("strips the namespace prefix when the ref resolves via the parent base", () => {
    const entry = flatIndex().entries.find((e) => e.id === "flat-topic");
    assert.ok(entry, "flat-topic should be indexed");
    // Written `memory/flat-topic.md`; actually lives at the store root.
    assert.equal(entry.path, "flat-topic.md");
  });

  it("keeps the nested segment when the ref genuinely resolves under the store", () => {
    const entry = flatIndex().entries.find((e) => e.id === "nested-topic");
    assert.ok(entry, "nested-topic should be indexed");
    assert.equal(entry.path, "memory/nested-topic.md");
  });

  it("records POSIX separators regardless of host platform", () => {
    for (const entry of flatIndex().entries) {
      assert.ok(!entry.path.includes("\\"), `entry ${entry.id} must not carry backslashes`);
    }
  });

  it("every entry path resolves on disk once joined onto the store root", () => {
    // This is the miniature of the live acceptance test: resolve(store, path)
    // must exist for EVERY entry, which is exactly what the CLI's
    // rewritePathsAbsolute does before publishing the global index.
    const entries = flatIndex().entries;
    assert.equal(entries.length, 2);
    for (const entry of entries) {
      assert.ok(
        existsSync(resolve(FLAT_STORE, entry.path)),
        `entry ${entry.id} path "${entry.path}" must resolve under the store root`,
      );
    }
  });
});
