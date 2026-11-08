import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { matchLoadout } from "@mcptoolshop/ai-loadout";
import { analyzeMemoryMd } from "../analyze.js";
import { generateIndex, hasExplicitId, hasExplicitPriority } from "../index-gen.js";
import { validateMemory, validateMemoryIndex } from "../validate.js";
import { syncSummaries, placeOrMoveEntry, resolveTargetIndexFile } from "../sync.js";

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

      // 4. Arrow-format line rewrite in syncSummaries + dry-run (fix: false)
      writeFileSync(
        memPath,
        [
          "# Memory Index",
          "- Alpha Project — Outdated arrow desc → `project_alpha.md`",
          "- [Projects](index-projects.md) — Sub-index for projects",
          "- [Archive](index-archive.md) — Sub-index for archive",
          "",
        ].join("\n"),
        "utf-8",
      );
      const drySync = syncSummaries(memPath, { fix: false });
      assert.equal(drySync.fixed, false);
      assert.ok(drySync.changes.length >= 1);
      const fixedArrow = syncSummaries(memPath, { fix: true });
      assert.equal(fixedArrow.fixed, true);

      // 5. resolveTargetIndexFile shorthands and error branches
      assert.ok(resolveTargetIndexFile(tmp, "main").endsWith("MEMORY.md"));
      assert.ok(resolveTargetIndexFile(tmp, "MEMORY.md").endsWith("MEMORY.md"));
      assert.ok(resolveTargetIndexFile(tmp, "index-archive.md").endsWith("index-archive.md"));
      assert.ok(resolveTargetIndexFile(tmp, "custom.md").endsWith("custom.md"));
      assert.throws(() => resolveTargetIndexFile(tmp, "   "), /cannot be empty/);
      assert.throws(
        () => placeOrMoveEntry({ storeDir: join(tmp, "no-such-dir"), topicFile: "x.md", targetIndex: "main" }),
        /MEMORY\.md not found/,
      );
      assert.throws(
        () => placeOrMoveEntry({ storeDir: tmp, topicFile: "   ", targetIndex: "main" }),
        /Topic file name is required/,
      );
      assert.throws(
        () => placeOrMoveEntry({ storeDir: tmp, topicFile: "missing.md", targetIndex: "main" }),
        /Topic file not found/,
      );
      assert.throws(
        () => placeOrMoveEntry({ storeDir: tmp, topicFile: "project_beta.md", targetIndex: "nonexistent-sub" }),
        /Target index file not found/,
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("collapses duplicate bullets pointing to the same topic file into ONE entry without DUPLICATE_ID, while still raising DUPLICATE_ID for different files with the same id (Q5-1a)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "loadout-dup-bullets-"));
    try {
      // Topic file with frontmatter description
      writeFileSync(
        join(tmp, "forkctl.md"),
        [
          "---",
          "name: forkctl",
          "description: Authoritative forkctl frontmatter description",
          "---",
          "# forkctl",
          "Body text.",
          "",
        ].join("\n"),
        "utf-8",
      );
      // Topic file without frontmatter description (falls back to first bullet's text)
      writeFileSync(
        join(tmp, "seed-vault.md"),
        "# Seed Vault\nBody without frontmatter.\n",
        "utf-8",
      );
      // Two DIFFERENT files that resolve to the same id ("collision-id")
      writeFileSync(
        join(tmp, "collision-a.md"),
        "---\nid: collision-id\ndescription: First collision file\n---\n# A\n",
        "utf-8",
      );
      writeFileSync(
        join(tmp, "collision-b.md"),
        "---\nid: collision-id\ndescription: Second collision file\n---\n# B\n",
        "utf-8",
      );

      const memPath = join(tmp, "MEMORY.md");
      writeFileSync(
        memPath,
        [
          "# Memory",
          "- [forkctl](forkctl.md) — First forkctl bullet description",
          "- [Seed Vault](seed-vault.md) — First seed-vault bullet description",
          "- [forkable v1.0.0 ship](forkctl.md) — Second forkctl bullet description",
          "- [Seed Vault Wave 2](seed-vault.md) — Second seed-vault bullet description",
          "- [forkctl v2.0.0 ship](forkctl.md) — Third forkctl bullet description",
          "",
        ].join("\n"),
        "utf-8",
      );

      const analysis = analyzeMemoryMd(memPath);
      const index = generateIndex(analysis);
      const issues = validateMemoryIndex(index);

      // 5 bullets pointing to 2 files -> collapsed to 2 entries in first-bullet order
      assert.equal(index.entries.length, 2);
      assert.equal(index.entries[0].id, "forkctl");
      assert.equal(index.entries[0].path, "forkctl.md");
      assert.equal(index.entries[0].summary, "Authoritative forkctl frontmatter description");

      assert.equal(index.entries[1].id, "seed-vault");
      assert.equal(index.entries[1].path, "seed-vault.md");
      assert.equal(index.entries[1].summary, "First seed-vault bullet description");

      // Zero DUPLICATE_ID errors when duplicate bullets point to the same topic file
      assert.ok(!issues.some((i) => i.code === "DUPLICATE_ID"));

      // Now add two bullets pointing to DIFFERENT files that resolve to the same id -> MUST raise DUPLICATE_ID
      writeFileSync(
        memPath,
        [
          "# Memory",
          "- [Collision A](collision-a.md) — First file",
          "- [Collision B](collision-b.md) — Second file",
          "",
        ].join("\n"),
        "utf-8",
      );
      const colAnalysis = analyzeMemoryMd(memPath);
      const colIndex = generateIndex(colAnalysis);
      const colIssues = validateMemoryIndex(colIndex);
      assert.equal(colIndex.entries.length, 2);
      assert.ok(colIssues.some((i) => i.code === "DUPLICATE_ID" && i.severity === "error"));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("idSource='title' (global default) derives entry ids from first bullet title when frontmatter has no explicit id: (Publisher ruling B)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "loadout-idsource-title-"));
    try {
      writeFileSync(
        join(tmp, "user_profile.md"),
        [
          "---",
          "name: Mike User Profile Studio Model",
          "description: User profile and studio model",
          "---",
          "# User Profile",
          "",
        ].join("\n"),
        "utf-8",
      );
      writeFileSync(
        join(tmp, "forkctl.md"),
        [
          "---",
          "name: Forkctl Automation CLI",
          "description: Forkctl automation tool",
          "---",
          "# Forkctl",
          "",
        ].join("\n"),
        "utf-8",
      );
      const memPath = join(tmp, "MEMORY.md");
      writeFileSync(
        memPath,
        [
          "# Memory",
          "- [Mike](user_profile.md) — User profile",
          "- [forkctl](forkctl.md) — First forkctl bullet",
          "- [forkable v1.0.0 ship](forkctl.md) — Duplicate forkctl bullet",
          "",
        ].join("\n"),
        "utf-8",
      );

      const analysis = analyzeMemoryMd(memPath);
      // Default without options is idSource: "title"
      const defaultIndex = generateIndex(analysis);
      assert.equal(defaultIndex.entries.length, 2);
      assert.equal(defaultIndex.entries[0].id, "mike");
      assert.equal(defaultIndex.entries[1].id, "forkctl");

      // Explicit idSource: "title" produces the same result
      const explicitTitleIndex = generateIndex(analysis, { idSource: "title" });
      assert.equal(explicitTitleIndex.entries[0].id, "mike");
      assert.equal(explicitTitleIndex.entries[1].id, "forkctl");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("idSource='name' derives entry ids from frontmatter name: when frontmatter has no explicit id: (Publisher ruling B)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "loadout-idsource-name-"));
    try {
      writeFileSync(
        join(tmp, "user_profile.md"),
        [
          "---",
          "name: Mike User Profile Studio Model",
          "description: User profile and studio model",
          "---",
          "# User Profile",
          "",
        ].join("\n"),
        "utf-8",
      );
      const memPath = join(tmp, "MEMORY.md");
      writeFileSync(
        memPath,
        "# Memory\n- [Mike](user_profile.md) — User profile\n",
        "utf-8",
      );

      const analysis = analyzeMemoryMd(memPath);
      const nameIndex = generateIndex(analysis, { idSource: "name" });
      assert.equal(nameIndex.entries.length, 1);
      assert.equal(nameIndex.entries[0].id, "mike-user-profile-studio-model");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("explicit idSource option (--id-source) beats the per-store setting in .loadout.json and MEMORY.md frontmatter (Publisher ruling B)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "loadout-idsource-override-"));
    try {
      writeFileSync(
        join(tmp, "user_profile.md"),
        [
          "---",
          "name: Mike User Profile Studio Model",
          "description: User profile and studio model",
          "---",
          "# User Profile",
          "",
        ].join("\n"),
        "utf-8",
      );
      const memPath = join(tmp, "MEMORY.md");
      writeFileSync(
        memPath,
        [
          "---",
          "name: Memory Index",
          "metadata:",
          "  id_source: name",
          "---",
          "# Memory",
          "- [Mike](user_profile.md) — User profile",
          "",
        ].join("\n"),
        "utf-8",
      );

      // 1. Store frontmatter sets id_source: name -> produces name-derived id when no flag passed
      const analysis = analyzeMemoryMd(memPath);
      assert.equal(generateIndex(analysis).entries[0].id, "mike-user-profile-studio-model");

      // 2. Explicit idSource: "title" beats MEMORY.md frontmatter id_source: name
      assert.equal(generateIndex(analysis, { idSource: "title" }).entries[0].id, "mike");

      // 3. Store .loadout.json sets idSource: "title", explicit idSource: "name" beats it (and vice versa)
      writeFileSync(join(tmp, ".loadout.json"), JSON.stringify({ idSource: "name" }), "utf-8");
      assert.equal(generateIndex(analysis).entries[0].id, "mike-user-profile-studio-model");
      assert.equal(generateIndex(analysis, { idSource: "title" }).entries[0].id, "mike");

      writeFileSync(join(tmp, ".loadout.json"), JSON.stringify({ idSource: "title" }), "utf-8");
      assert.equal(generateIndex(analysis, { projectMode: true }).entries[0].id, "mike");
      assert.equal(generateIndex(analysis, { projectMode: true, idSource: "name" }).entries[0].id, "mike-user-profile-studio-model");

      // 4. Top-level `id_source: name` in MEMORY.md frontmatter without `name:`/`id:` (raw fallback)
      writeFileSync(join(tmp, ".loadout.json"), "{ invalid json", "utf-8");
      writeFileSync(
        memPath,
        [
          "---",
          'id_source: "name"',
          "---",
          "# Memory",
          "- [Mike](user_profile.md) — User profile",
          "",
        ].join("\n"),
        "utf-8",
      );
      const rawAnalysis = analyzeMemoryMd(memPath);
      assert.equal(generateIndex(rawAnalysis).entries[0].id, "mike-user-profile-studio-model");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("explicit frontmatter id: always beats both idSource='title' and idSource='name' (Publisher ruling B)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "loadout-idsource-explicit-id-"));
    try {
      writeFileSync(
        join(tmp, "ollama-sizing.md"),
        [
          "---",
          "id: ollama-model-sizing",
          "name: Ollama Local Model Sizing Reference",
          "description: Sizing reference for Ollama models",
          "---",
          "# Ollama Sizing",
          "",
        ].join("\n"),
        "utf-8",
      );
      const memPath = join(tmp, "MEMORY.md");
      writeFileSync(
        memPath,
        "# Memory\n- [Ollama Bullet Title](ollama-sizing.md) — Sizing guide\n",
        "utf-8",
      );

      const analysis = analyzeMemoryMd(memPath);
      assert.equal(generateIndex(analysis, { idSource: "title" }).entries[0].id, "ollama-model-sizing");
      assert.equal(generateIndex(analysis, { idSource: "name" }).entries[0].id, "ollama-model-sizing");
      assert.equal(generateIndex(analysis, { projectMode: false }).entries[0].id, "ollama-model-sizing");
      assert.equal(generateIndex(analysis, { projectMode: true }).entries[0].id, "ollama-model-sizing");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("projectMode defaults to idSource='name' while non-project mode defaults to idSource='title' (Publisher ruling B)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "loadout-idsource-proj-default-"));
    try {
      writeFileSync(
        join(tmp, "hardware-omen-45l.md"),
        [
          "---",
          "name: Omen 45L Gaming Desktop",
          "description: Hardware specs for Omen 45L",
          "---",
          "# Omen 45L",
          "",
        ].join("\n"),
        "utf-8",
      );
      const memPath = join(tmp, "MEMORY.md");
      writeFileSync(
        memPath,
        "# Memory\n- [Omen 45L 5080 Rig](hardware-omen-45l.md) — Hardware specs\n",
        "utf-8",
      );

      const analysis = analyzeMemoryMd(memPath);
      const globalDefault = generateIndex(analysis, { projectMode: false });
      const projectDefault = generateIndex(analysis, { projectMode: true });

      assert.equal(globalDefault.entries[0].id, "omen-45l-5080-rig");
      assert.equal(projectDefault.entries[0].id, "omen-45l-gaming-desktop");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("reads metadata.priority when top-level priority is absent, lets top-level win on conflict, and preserves archive default manual when neither is set (#19)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "loadout-issue19-priority-"));
    try {
      // 1. Top-level priority: core only
      writeFileSync(
        join(tmp, "board-top.md"),
        [
          "---",
          "name: Top Only Board",
          "description: Board with top-level priority only",
          "priority: core",
          "metadata:",
          "  loadout_inject: session-start",
          "---",
          "# Top Only Board",
          "",
        ].join("\n"),
        "utf-8",
      );

      // 2. metadata.priority: core only — exact shape Claude Code writes on Edit/Write
      const claudeCodeRewrittenShape = [
        "---",
        "name: Rewritten Board",
        "description: Session-start board rewritten by Claude Code",
        "metadata:",
        "  node_type: memory",
        "  priority: core",
        "  loadout_inject: session-start",
        "  originSessionId: 01965a00-0000-7000-8000-000000000001",
        "  modified: 1731090000000",
        "---",
        "# Rewritten Board",
        "",
      ].join("\n");
      writeFileSync(join(tmp, "board-meta.md"), claudeCodeRewrittenShape, "utf-8");

      // 3. Both top-level priority: core and metadata.priority: core
      writeFileSync(
        join(tmp, "board-both.md"),
        [
          "---",
          "name: Both Priority Board",
          "description: Board with both top-level and metadata priority",
          "priority: core",
          "metadata:",
          "  node_type: memory",
          "  priority: core",
          "  loadout_inject: session-start",
          "---",
          "# Both Priority Board",
          "",
        ].join("\n"),
        "utf-8",
      );

      // 4. Conflict: top-level priority: domain vs metadata.priority: core -> top-level wins (domain)
      writeFileSync(
        join(tmp, "board-conflict.md"),
        [
          "---",
          "name: Conflict Priority Board",
          "description: Top-level domain beats metadata core",
          "priority: domain",
          "metadata:",
          "  priority: core",
          "---",
          "# Conflict Priority Board",
          "",
        ].join("\n"),
        "utf-8",
      );

      // 5. Archive sub-index with neither top-level nor metadata.priority set (plus a non-metadata indented line)
      writeFileSync(
        join(tmp, "index-archive.md"),
        [
          "# Archive",
          "- [Archived Unset](archive-unset.md) — Archived topic without priority",
          "- [Archived Invalid](archive-invalid.md) — Archived topic with invalid priority",
          "- [Archived Meta Core](archive-meta-core.md) — Archived topic with metadata.priority: core",
          "",
        ].join("\n"),
        "utf-8",
      );
      const archiveUnsetContent = [
        "---",
        "name: Archived Unset",
        "description: Archived topic without priority",
        "triggers:",
        "  task: true",
        "---",
        "# Archived Unset",
        "",
      ].join("\n");
      writeFileSync(join(tmp, "archive-unset.md"), archiveUnsetContent, "utf-8");

      const archiveInvalidContent = [
        "---",
        "name: Archived Invalid",
        "description: Archived topic with invalid priority value",
        "metadata:",
        "  priority: urgent",
        "---",
        "# Archived Invalid",
        "",
      ].join("\n");
      writeFileSync(join(tmp, "archive-invalid.md"), archiveInvalidContent, "utf-8");

      writeFileSync(
        join(tmp, "archive-meta-core.md"),
        [
          "---",
          "name: Archived Meta Core",
          "description: Archived topic with explicit metadata.priority",
          "metadata:",
          "  priority: core",
          "---",
          "# Archived Meta Core",
          "",
        ].join("\n"),
        "utf-8",
      );

      const memPath = join(tmp, "MEMORY.md");
      writeFileSync(
        memPath,
        [
          "# Memory",
          "- [Top Only](board-top.md) — Board with top-level priority only",
          "- [Rewritten](board-meta.md) — Session-start board rewritten by Claude Code",
          "- [Both](board-both.md) — Board with both top-level and metadata priority",
          "- [Conflict](board-conflict.md) — Top-level domain beats metadata core",
          "- [Archive](index-archive.md) — Archive sub-index",
          "",
        ].join("\n"),
        "utf-8",
      );

      const analysis = analyzeMemoryMd(memPath);
      const index = generateIndex(analysis);
      const byPath = new Map(index.entries.map((e) => [e.path, e]));

      assert.equal(byPath.get("board-top.md")?.priority, "core");
      assert.equal(byPath.get("board-meta.md")?.priority, "core");
      assert.equal(byPath.get("board-meta.md")?.metadata?.loadout_inject, "session-start");
      assert.equal(byPath.get("board-meta.md")?.metadata?.node_type, "memory");
      assert.equal(byPath.get("board-both.md")?.priority, "core");
      assert.equal(byPath.get("board-conflict.md")?.priority, "domain");
      assert.equal(byPath.get("archive-unset.md")?.priority, "manual");
      assert.equal(byPath.get("archive-invalid.md")?.priority, "manual");
      assert.equal(byPath.get("archive-meta-core.md")?.priority, "core");

      // hasExplicitPriority agrees with what is actually read
      assert.equal(hasExplicitPriority(claudeCodeRewrittenShape), true);
      assert.equal(hasExplicitPriority(archiveUnsetContent), false);
      assert.equal(hasExplicitPriority(archiveInvalidContent), false);
      assert.equal(
        hasExplicitPriority("---\nname: X\ntriggers:\n  priority: core\n---\n"),
        false,
        "indented priority outside metadata: must not count as explicit",
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("reads metadata.id when top-level id is absent, lets top-level id win on conflict, and keeps hasExplicitId aligned (#19)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "loadout-issue19-id-"));
    try {
      const metaIdOnly = [
        "---",
        "name: Rewritten Topic Name",
        "description: Topic whose id was moved under metadata",
        "metadata:",
        "  node_type: memory",
        "  id: custom-meta-id",
        "---",
        "# Rewritten Topic",
        "",
      ].join("\n");
      writeFileSync(join(tmp, "meta-id.md"), metaIdOnly, "utf-8");

      const conflictId = [
        "---",
        "id: top-level-id",
        "name: Conflict Id Topic",
        "description: Top-level id beats metadata.id",
        "metadata:",
        "  id: nested-meta-id",
        "---",
        "# Conflict Id",
        "",
      ].join("\n");
      writeFileSync(join(tmp, "conflict-id.md"), conflictId, "utf-8");

      const nonMetaIndentedId = [
        "---",
        "name: Derived Name Topic",
        "description: Indented id under triggers must be ignored",
        "triggers:",
        "  id: bogus-trigger-id",
        "---",
        "# Derived Name",
        "",
      ].join("\n");
      writeFileSync(join(tmp, "non-meta-id.md"), nonMetaIndentedId, "utf-8");

      const memPath = join(tmp, "MEMORY.md");
      writeFileSync(
        memPath,
        [
          "# Memory",
          "- [Bullet Title One](meta-id.md) — Topic whose id was moved under metadata",
          "- [Bullet Title Two](conflict-id.md) — Top-level id beats metadata.id",
          "- [Bullet Title Three](non-meta-id.md) — Indented id under triggers must be ignored",
          "",
        ].join("\n"),
        "utf-8",
      );

      assert.equal(hasExplicitId(metaIdOnly), true);
      assert.equal(hasExplicitId(conflictId), true);
      assert.equal(hasExplicitId(nonMetaIndentedId), false);

      const analysis = analyzeMemoryMd(memPath);
      const titleIndex = generateIndex(analysis, { idSource: "title" });
      const nameIndex = generateIndex(analysis, { idSource: "name" });

      // metadata.id wins over both idSource="title" and idSource="name"
      assert.equal(titleIndex.entries[0].id, "custom-meta-id");
      assert.equal(nameIndex.entries[0].id, "custom-meta-id");

      // top-level id wins over metadata.id
      assert.equal(titleIndex.entries[1].id, "top-level-id");
      assert.equal(nameIndex.entries[1].id, "top-level-id");

      // non-metadata indented id is ignored, so idSource="title" uses bullet title and idSource="name" uses name:
      assert.equal(titleIndex.entries[2].id, "bullet-title-three");
      assert.equal(nameIndex.entries[2].id, "derived-name-topic");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("reads loadout_inject, stale_after_min, max_lines, and max_bytes from metadata (#19)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "loadout-issue19-meta-keys-"));
    try {
      writeFileSync(
        join(tmp, "board.md"),
        [
          "---",
          "name: Session Board",
          "description: Session board with metadata keys",
          "metadata:",
          "  node_type: memory",
          "  priority: core",
          "  loadout_inject: session-start",
          "  stale_after_min: 45",
          "---",
          "# Session Board",
          "",
        ].join("\n"),
        "utf-8",
      );

      const memPath = join(tmp, "MEMORY.md");
      // 12 lines total, exceeding metadata.max_lines: 5 and metadata.max_bytes: 100
      writeFileSync(
        memPath,
        [
          "---",
          "name: Memory Index",
          "metadata:",
          "  max_lines: 5",
          "  max_bytes: 100",
          "---",
          "# Memory",
          "- [Session Board](board.md) — Session board with metadata keys",
          "",
          "## Notes",
          "Extra line 1",
          "Extra line 2",
          "",
        ].join("\n"),
        "utf-8",
      );

      const analysis = analyzeMemoryMd(memPath);
      const index = generateIndex(analysis);
      assert.equal(index.entries.length, 1);
      assert.equal(index.entries[0].priority, "core");
      assert.equal(index.entries[0].metadata?.loadout_inject, "session-start");
      assert.equal(index.entries[0].metadata?.stale_after_min, 45);

      const issues = validateMemory(analysis);
      const limitIssue = issues.find((i) => i.code === "MEMORY_LIMIT_EXCEEDED");
      assert.ok(limitIssue, "metadata.max_lines / metadata.max_bytes must trigger MEMORY_LIMIT_EXCEEDED");
      assert.equal(limitIssue.severity, "error");
      assert.match(limitIssue.message, /lines > limit 5/);
      assert.match(limitIssue.message, /bytes > limit 100/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
