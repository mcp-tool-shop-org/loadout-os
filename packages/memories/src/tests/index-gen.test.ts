import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { matchLoadout } from "@mcptoolshop/ai-loadout";
import { analyzeMemoryMd } from "../analyze.js";
import { generateIndex } from "../index-gen.js";
import { validateMemory } from "../validate.js";
import { syncSummaries, placeOrMoveEntry } from "../sync.js";

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

describe("sub-index expansion, frontmatter summary authority, and keyword extraction (Part B)", () => {
  it("expands index-*.md and metadata.loadout_role: subindex files without reporting sub-index targets as orphans", () => {
    const tmp = mkdtempSync(join(tmpdir(), "loadout-subidx-"));
    try {
      writeFileSync(
        join(tmp, "MEMORY.md"),
        [
          "# Memory Index",
          "- [Projects Sub-index](index-projects.md) — Active projects sub-index",
          "- [Archive Sub-index](index-archive.md) — Historical entries",
          "- [Custom Role Sub-index](custom-sub.md) — Role-declared sub-index",
          "",
        ].join("\n"),
        "utf-8",
      );

      writeFileSync(
        join(tmp, "index-projects.md"),
        [
          "# Active Projects",
          "- [UDLab](project_udlab.md) — Stale bullet summary in sub-index",
          "- [Missing Target](missing_in_subindex.md) — Broken link inside sub-index",
          "",
        ].join("\n"),
        "utf-8",
      );

      writeFileSync(
        join(tmp, "index-archive.md"),
        [
          "# Archive",
          "- [Old Migration](archive_old_migration.md) — Archived migration notes",
          "- [Explicit Domain Archive](archive_explicit.md) — Archived but explicitly domain",
          "",
        ].join("\n"),
        "utf-8",
      );

      writeFileSync(
        join(tmp, "custom-sub.md"),
        [
          "---",
          "name: Custom Subindex",
          "description: Custom role subindex",
          "metadata:",
          "  loadout_role: subindex",
          "---",
          "# Custom Subindex",
          "- [Custom Topic](topic_custom.md) — Custom topic summary",
          "",
        ].join("\n"),
        "utf-8",
      );

      writeFileSync(
        join(tmp, "project_udlab.md"),
        [
          "---",
          "name: udlab: understanding-dataset-lab (PRIVATE)",
          "description: Authoritative UDLab dataset pipeline architecture",
          "type: project",
          "---",
          "# UDLab Pipeline (v1.0.2)",
          "Details about dataset curation.",
          "",
        ].join("\n"),
        "utf-8",
      );

      writeFileSync(
        join(tmp, "archive_old_migration.md"),
        [
          "---",
          "name: Old Migration",
          "description: Legacy migration notes from 2025",
          "type: project",
          "---",
          "# Old Migration",
          "Historical context.",
          "",
        ].join("\n"),
        "utf-8",
      );

      writeFileSync(
        join(tmp, "archive_explicit.md"),
        [
          "---",
          "name: Explicit Domain Archive",
          "description: Archived but still domain-routed",
          "priority: domain",
          "---",
          "# Explicit Domain Archive",
          "Body.",
          "",
        ].join("\n"),
        "utf-8",
      );

      writeFileSync(
        join(tmp, "topic_custom.md"),
        [
          "---",
          "name: Custom Topic",
          "description: Custom topic description",
          "---",
          "# Custom Topic",
          "Body.",
          "",
        ].join("\n"),
        "utf-8",
      );

      const analysis = analyzeMemoryMd(join(tmp, "MEMORY.md"));
      const index = generateIndex(analysis);
      const issues = validateMemory(analysis);

      // Sub-index files themselves are NOT entries in the generated index
      const ids = index.entries.map((e) => e.id);
      assert.ok(!ids.includes("index-projects"));
      assert.ok(!ids.includes("index-archive"));
      assert.ok(!ids.includes("custom-sub"));

      // Leaf topic files ARE indexed and marked subindex: true
      const udlab = index.entries.find((e) => e.path === "project_udlab.md");
      assert.ok(udlab, "project_udlab.md should be indexed from index-projects.md");
      assert.equal(udlab.subindex, true);
      // Summary comes from topic frontmatter description, NOT the stale sub-index bullet (F-02)
      assert.equal(udlab.summary, "Authoritative UDLab dataset pipeline architecture");

      // Topic in custom-sub.md is also indexed
      const custom = index.entries.find((e) => e.path === "topic_custom.md");
      assert.ok(custom, "topic_custom.md should be indexed from role-declared subindex");
      assert.equal(custom.subindex, true);

      // Topic in index-archive.md without explicit priority gets priority: "manual" (Amendment 4)
      const archived = index.entries.find((e) => e.path === "archive_old_migration.md");
      assert.ok(archived);
      assert.equal(archived.priority, "manual");

      // Topic in index-archive.md WITH explicit priority: domain keeps "domain"
      const explicitDomain = index.entries.find((e) => e.path === "archive_explicit.md");
      assert.ok(explicitDomain);
      assert.equal(explicitDomain.priority, "domain");

      // None of the sub-index files or their referenced targets are reported as ORPHAN_TOPIC_FILE
      assert.equal(analysis.orphanFiles.length, 0, `expected 0 orphans, got ${analysis.orphanFiles.join(", ")}`);
      assert.ok(!issues.some((i) => i.code === "ORPHAN_TOPIC_FILE"));

      // Dead link inside index-projects.md IS reported as MISSING_TOPIC_FILE
      const missingIssues = issues.filter((i) => i.code === "MISSING_TOPIC_FILE");
      assert.equal(missingIssues.length, 1);
      assert.match(missingIssues[0].message, /missing_in_subindex\.md/);

      // Drifted bullet summary in index-projects.md is reported as STALE_INDEX_SUMMARY (F-02 / F-09)
      const staleSummary = issues.find((i) => i.code === "STALE_INDEX_SUMMARY");
      assert.ok(staleSummary, "expected STALE_INDEX_SUMMARY warning when bullet differs from frontmatter description");
      assert.equal(staleSummary.severity, "warning");
      assert.match(staleSummary.message, /project_udlab\.md/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("strips punctuation in keyword extraction, includes file-stem tokens, and clears hook score floor with 1-2 technical words (F-04)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "loadout-kw-"));
    try {
      writeFileSync(
        join(tmp, "MEMORY.md"),
        "# Memory\n- [UDLab](project_udlab_dataset.md) — Dataset lab\n",
        "utf-8",
      );
      writeFileSync(
        join(tmp, "project_udlab_dataset.md"),
        [
          "---",
          "name: udlab: understanding-dataset-lab (PRIVATE)",
          "description: Dataset lab for v1.0.2 curation",
          "type: project",
          "---",
          "# udlab: understanding-dataset-lab (PRIVATE)",
          "## Release v1.0.2",
          "## Pipeline Architecture",
          "## Storage Backend",
          "## Evaluation Metrics",
          "",
        ].join("\n"),
        "utf-8",
      );

      const analysis = analyzeMemoryMd(join(tmp, "MEMORY.md"));
      const index = generateIndex(analysis);
      const entry = index.entries[0];
      assert.ok(entry);

      // Punctuation must be stripped from keywords (no trailing colons or parens)
      for (const kw of entry.keywords) {
        assert.doesNotMatch(kw, /[():,]/, `keyword "${kw}" must not contain punctuation`);
      }
      assert.ok(entry.keywords.includes("udlab"), "must include stripped token 'udlab'");
      assert.ok(entry.keywords.includes("private"), "must include stripped token 'private'");
      assert.ok(entry.keywords.includes("dataset"), "must include file-stem / title token 'dataset'");

      // Matching 2 exact technical words ("udlab dataset") clears the hook's 0.5 score floor
      const twoWordMatches = matchLoadout("check udlab dataset", index, { minScore: 0.5 });
      assert.ok(twoWordMatches.length >= 1, "2 exact technical words must clear 0.5 score floor");
      assert.ok(twoWordMatches[0].score >= 0.5);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("clears the 0.5 score floor with a single exact technical word on a concise topic file (F-04)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "loadout-kw1-"));
    try {
      writeFileSync(
        join(tmp, "MEMORY.md"),
        "# Memory\n- [Xrpl](project_xrpl.md) — Ledger\n",
        "utf-8",
      );
      writeFileSync(
        join(tmp, "project_xrpl.md"),
        [
          "---",
          "name: xrpl: ledger",
          "description: Ripple ledger node",
          "---",
          "Body text without extra headings.",
          "",
        ].join("\n"),
        "utf-8",
      );

      const analysis = analyzeMemoryMd(join(tmp, "MEMORY.md"));
      const index = generateIndex(analysis);
      const oneWordMatches = matchLoadout("inspect xrpl", index, { minScore: 0.5 });
      assert.ok(oneWordMatches.length >= 1, "1 exact technical word must clear 0.5 score floor");
      assert.ok(oneWordMatches[0].score >= 0.5);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("syncSummaries updates drifted bullet descriptions and placeOrMoveEntry places/moves without duplicates (F-19, F-21)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "loadout-sync-"));
    try {
      const memPath = join(tmp, "MEMORY.md");
      writeFileSync(
        memPath,
        [
          "# Memory Index",
          "## Core",
          "- [Projects](index-projects.md) — Sub-index for projects",
          "- [Archive](index-archive.md) — Sub-index for archive",
          "",
        ].join("\n"),
        "utf-8",
      );
      writeFileSync(
        join(tmp, "index-projects.md"),
        [
          "# Projects",
          "- [Alpha](project_alpha.md) — Old outdated bullet text",
          "",
        ].join("\n"),
        "utf-8",
      );
      writeFileSync(join(tmp, "index-archive.md"), "# Archive\n", "utf-8");
      writeFileSync(
        join(tmp, "project_alpha.md"),
        [
          "---",
          "name: Alpha Project",
          "description: Fresh frontmatter description for Alpha",
          "---",
          "# Alpha",
          "",
        ].join("\n"),
        "utf-8",
      );
      writeFileSync(
        join(tmp, "project_beta.md"),
        [
          "---",
          "name: Beta Project",
          "description: Beta frontmatter summary",
          "---",
          "# Beta",
          "",
        ].join("\n"),
        "utf-8",
      );

      // 1. syncSummaries fixes drifted bullet in index-projects.md
      const syncRes = syncSummaries(memPath, { fix: true });
      assert.equal(syncRes.fixed, true);
      assert.equal(syncRes.changes.length, 1);
      assert.match(syncRes.changes[0].before, /Old outdated bullet text/);
      assert.match(syncRes.changes[0].after, /Fresh frontmatter description for Alpha/);

      // Re-validating now shows 0 STALE_INDEX_SUMMARY warnings
      const afterSyncIssues = validateMemory(analyzeMemoryMd(memPath));
      assert.ok(!afterSyncIssues.some((i) => i.code === "STALE_INDEX_SUMMARY"));

      // 2. placeOrMoveEntry places project_beta.md into index-projects.md
      const placeRes = placeOrMoveEntry({
        storeDir: tmp,
        topicFile: "project_beta.md",
        targetIndex: "projects",
        action: "place",
      });
      assert.equal(placeRes.targetIndex, "index-projects.md");
      assert.equal(placeRes.removedFrom.length, 0);

      // 3. Moving project_alpha.md to index-archive.md removes it from index-projects.md and adds to index-archive.md
      const moveRes = placeOrMoveEntry({
        storeDir: tmp,
        topicFile: "project_alpha.md",
        targetIndex: "archive",
        action: "move",
      });
      assert.equal(moveRes.targetIndex, "index-archive.md");
      assert.equal(moveRes.removedFrom.length, 1);
      assert.equal(moveRes.removedFrom[0], "index-projects.md");

      // Verify no duplicate entries and zero orphans
      const finalAnalysis = analyzeMemoryMd(memPath);
      const finalIssues = validateMemory(finalAnalysis);
      assert.equal(finalIssues.filter((i) => i.severity === "error").length, 0);
      assert.equal(finalAnalysis.orphanFiles.length, 0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
