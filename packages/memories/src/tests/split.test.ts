/**
 * Tests for PR 2 (memory-index scaling):
 * - Item 7: Nested sub-indexes expanded recursively by `analyzeMemoryMd` (with cycle detection)
 *   and supported across `generateIndex`, `validateMemory`, `syncSummaries`, and `placeOrMoveEntry`.
 * - Item 8: `splitMemoryStore` / `memories split --by <rules.json>` mechanical split of root
 *   entries into sub-indexes on a temp store of >= 80 entries (preserving every entry and its
 *   priority, writing nothing on `--dry-run`, and refusing when the entry count or priority differs).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  analyzeMemoryMd,
  generateIndex,
  validateMemory,
  validateMemoryIndex,
  syncSummaries,
  placeOrMoveEntry,
  splitMemoryStore,
  loadSplitRulesFile,
  parseSplitRules,
  normalizeSubindexFilename,
  SplitError,
  type Priority,
} from "../index.js";

describe("Item 7: Nested sub-indexes in analyzeMemoryMd, generateIndex, and sync", () => {
  it("recursively expands multi-level nested sub-indexes (index-*.md and metadata.loadout_role: subindex) and inherits defaultPriority", () => {
    const tmp = mkdtempSync(join(tmpdir(), "loadout-nested-subindex-"));
    try {
      // Topic files at root, tier 1, tier 2, and custom role-based tier 3
      writeFileSync(
        join(tmp, "root-core.md"),
        [
          "---",
          "id: root-core",
          "name: Root Core Entry",
          "description: Core entry in root MEMORY.md",
          "priority: core",
          "---",
          "# Root Core Entry",
          "",
        ].join("\n"),
        "utf-8",
      );

      writeFileSync(
        join(tmp, "tier1-topic.md"),
        [
          "---",
          "id: tier1-topic",
          "name: Tier 1 Topic",
          "description: Topic inside tier 1 sub-index",
          "---",
          "# Tier 1 Topic",
          "",
        ].join("\n"),
        "utf-8",
      );

      writeFileSync(
        join(tmp, "tier2-topic.md"),
        [
          "---",
          "id: tier2-topic",
          "name: Tier 2 Topic",
          "description: Topic inside nested tier 2 archive sub-index",
          "---",
          "# Tier 2 Topic",
          "",
        ].join("\n"),
        "utf-8",
      );

      writeFileSync(
        join(tmp, "tier3-topic.md"),
        [
          "---",
          "id: tier3-topic",
          "name: Tier 3 Topic",
          "description: Topic inside tier 3 role-marked sub-index inheriting manual priority",
          "---",
          "# Tier 3 Topic",
          "",
        ].join("\n"),
        "utf-8",
      );

      // Tier 3 sub-index (marked via metadata.loadout_role: subindex, not named index-*.md)
      writeFileSync(
        join(tmp, "deep-subindex.md"),
        [
          "---",
          "name: Deep Subindex",
          "description: Role-marked nested sub-index",
          "metadata:",
          "  loadout_role: subindex",
          "---",
          "# Deep Subindex",
          "- [Tier 3 Topic](tier3-topic.md) — Stale tier 3 summary",
          "",
        ].join("\n"),
        "utf-8",
      );

      // Tier 2 sub-index (index-archive.md -> sets defaultPriority: "manual")
      writeFileSync(
        join(tmp, "index-archive.md"),
        [
          "---",
          "name: Archive Subindex",
          "description: Second-level archive sub-index",
          "metadata:",
          "  loadout_role: subindex",
          "---",
          "# Archive",
          "- [Tier 2 Topic](tier2-topic.md) — Topic inside nested tier 2 archive sub-index",
          "- [Deep Subindex](deep-subindex.md) — Role-marked nested sub-index",
          "",
        ].join("\n"),
        "utf-8",
      );

      // Tier 1 sub-index linking to Tier 2
      writeFileSync(
        join(tmp, "index-projects.md"),
        [
          "---",
          "name: Projects Subindex",
          "description: First-level projects sub-index",
          "metadata:",
          "  loadout_role: subindex",
          "---",
          "# Projects",
          "- [Tier 1 Topic](tier1-topic.md) — Topic inside tier 1 sub-index",
          "- [Archive Subindex](index-archive.md) — Second-level archive sub-index",
          "",
        ].join("\n"),
        "utf-8",
      );

      // Root MEMORY.md
      const memPath = join(tmp, "MEMORY.md");
      writeFileSync(
        memPath,
        [
          "# Memory",
          "- [Root Core Entry](root-core.md) — Core entry in root MEMORY.md",
          "- [Projects Subindex](index-projects.md) — First-level projects sub-index",
          "",
        ].join("\n"),
        "utf-8",
      );

      const analysis = analyzeMemoryMd(memPath);
      assert.deepEqual(analysis.subindexFiles, [
        "index-projects.md",
        "index-archive.md",
        "deep-subindex.md",
      ]);
      assert.deepEqual(analysis.subindexEntryCounts, {
        "index-projects.md": 2,
        "index-archive.md": 2,
        "deep-subindex.md": 1,
      });
      assert.equal(analysis.orphanFiles.length, 0);
      assert.equal(analysis.missingFiles.length, 0);

      const index = generateIndex(analysis);
      assert.equal(index.entries.length, 4);
      const byId = new Map(index.entries.map((e) => [e.id, e]));
      assert.equal(byId.get("root-core")?.priority, "core");
      assert.equal(byId.get("tier1-topic")?.priority, "domain");
      assert.equal(byId.get("tier2-topic")?.priority, "manual");
      // tier3-topic inherits "manual" defaultPriority from parent index-archive.md
      assert.equal(byId.get("tier3-topic")?.priority, "manual");

      // syncSummaries reaches into tier 3 nested sub-index
      const syncRes = syncSummaries(memPath, { fix: true });
      assert.equal(syncRes.fixed, true);
      assert.equal(syncRes.changes.length, 1);
      assert.equal(syncRes.changes[0].indexFile, "deep-subindex.md");

      // placeOrMoveEntry removes from nested tier 3 sub-index when moving to index-projects.md
      const moveRes = placeOrMoveEntry({
        storeDir: tmp,
        topicFile: "tier3-topic.md",
        targetIndex: "index-projects.md",
        action: "move",
      });
      assert.ok(moveRes.removedFrom.includes("deep-subindex.md"));
      assert.equal(moveRes.targetIndex, "index-projects.md");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("detects circular sub-index references and emits SUBINDEX_CYCLE warning without infinite recursion", () => {
    const tmp = mkdtempSync(join(tmpdir(), "loadout-subindex-cycle-"));
    try {
      writeFileSync(
        join(tmp, "topic-a.md"),
        "---\nid: topic-a\nname: Topic A\ndescription: Valid topic A\n---\n# Topic A\n",
        "utf-8",
      );
      writeFileSync(
        join(tmp, "index-a.md"),
        [
          "---",
          "metadata:",
          "  loadout_role: subindex",
          "---",
          "# Index A",
          "- [Topic A](topic-a.md) — Valid topic A",
          "- [Index B](index-b.md) — Link to B",
          "",
        ].join("\n"),
        "utf-8",
      );
      writeFileSync(
        join(tmp, "index-b.md"),
        [
          "---",
          "metadata:",
          "  loadout_role: subindex",
          "---",
          "# Index B",
          "- [Index A](index-a.md) — Circular link back to A",
          "",
        ].join("\n"),
        "utf-8",
      );
      const memPath = join(tmp, "MEMORY.md");
      writeFileSync(memPath, "# Memory\n- [Index A](index-a.md) — Link to A\n", "utf-8");

      const analysis = analyzeMemoryMd(memPath);
      const cycleDiag = analysis.diagnostics.find((d) => d.code === "SUBINDEX_CYCLE");
      assert.ok(cycleDiag, "expected SUBINDEX_CYCLE warning diagnostic");
      assert.equal(cycleDiag.severity, "warning");

      const index = generateIndex(analysis);
      assert.equal(index.entries.length, 1);
      assert.equal(index.entries[0].id, "topic-a");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("Item 8: splitMemoryStore (--by <rules.json>) on a temp store of >= 80 entries", () => {
  function build84EntryStore(tmp: string): {
    memPath: string;
    expectedPriorities: Map<string, Priority>;
  } {
    const expectedPriorities = new Map<string, Priority>();
    const sections: Record<string, string[]> = {
      "Core Architecture": [],
      Feedback: [],
      Projects: [],
      Operations: [],
      Archive: [],
    };

    // 1. 6 Core entries (3 top-level priority: core, 3 metadata.priority: core)
    for (let i = 1; i <= 6; i++) {
      const id = `core-rule-${String(i).padStart(2, "0")}`;
      const file = `${id}.md`;
      const desc = `Core architecture rule number ${i} for global session routing`;
      const fm =
        i <= 3
          ? [
              "---",
              `id: ${id}`,
              `name: Core Rule ${i}`,
              `description: ${desc}`,
              "priority: core",
              "---",
            ]
          : [
              "---",
              `id: ${id}`,
              `name: Core Rule ${i}`,
              `description: ${desc}`,
              "metadata:",
              "  priority: core",
              "---",
            ];
      writeFileSync(join(tmp, file), [...fm, `# Core Rule ${i}`, ""].join("\n"), "utf-8");
      sections["Core Architecture"].push(`- [Core Rule ${i}](${file}) — ${desc}`);
      expectedPriorities.set(id, "core");
    }

    // 2. 26 Feedback entries (mix of domain and manual priorities)
    for (let i = 1; i <= 26; i++) {
      const id = `feedback-item-${String(i).padStart(2, "0")}`;
      const file = `feedback_${String(i).padStart(2, "0")}.md`;
      const prio: Priority = i % 5 === 0 ? "manual" : "domain";
      const desc = `Feedback memory ${i} capturing workflow ruling and verification guardrails`;
      writeFileSync(
        join(tmp, file),
        [
          "---",
          `id: ${id}`,
          `name: Feedback Item ${i}`,
          `description: ${desc}`,
          `priority: ${prio}`,
          "keywords: [feedback, ruling]",
          "---",
          `# Feedback Item ${i}`,
          "",
        ].join("\n"),
        "utf-8",
      );
      sections.Feedback.push(`- [Feedback Item ${i}](${file}) — ${desc}`);
      expectedPriorities.set(id, prio);
    }

    // 3. 26 Project entries (implicit domain priority — no priority field in frontmatter)
    for (let i = 1; i <= 26; i++) {
      const id = `project-spec-${String(i).padStart(2, "0")}`;
      const file = `project_${String(i).padStart(2, "0")}.md`;
      const desc = `Project specification ${i} with milestones, architecture, and build targets`;
      writeFileSync(
        join(tmp, file),
        [
          "---",
          `id: ${id}`,
          `name: Project Spec ${i}`,
          `description: ${desc}`,
          "keywords: [project, roadmap]",
          "---",
          `# Project Spec ${i}`,
          "",
        ].join("\n"),
        "utf-8",
      );
      sections.Projects.push(`- [Project Spec ${i}](${file}) — ${desc}`);
      expectedPriorities.set(id, "domain");
    }

    // 4. 14 Operations entries (mix of core and domain priorities)
    for (let i = 1; i <= 14; i++) {
      const id = `ops-runbook-${String(i).padStart(2, "0")}`;
      const file = `ops_${String(i).padStart(2, "0")}.md`;
      const prio: Priority = i === 1 ? "core" : "domain";
      const desc = `Operations runbook ${i} for CI pipelines, release gates, and fleet diagnostics`;
      writeFileSync(
        join(tmp, file),
        [
          "---",
          `id: ${id}`,
          `name: Ops Runbook ${i}`,
          `description: ${desc}`,
          `priority: ${prio}`,
          "keywords: [ops, runbook]",
          "---",
          `# Ops Runbook ${i}`,
          "",
        ].join("\n"),
        "utf-8",
      );
      sections.Operations.push(`- [Ops Runbook ${i}](${file}) — ${desc}`);
      expectedPriorities.set(id, prio);
    }

    // 5. 12 Archive entries (10 explicit manual, 2 implicit domain to verify index-archive.md preserves domain!)
    for (let i = 1; i <= 12; i++) {
      const id = `archive-note-${String(i).padStart(2, "0")}`;
      const file = `archive_${String(i).padStart(2, "0")}.md`;
      const hasExplicitManual = i <= 10;
      const prio: Priority = hasExplicitManual ? "manual" : "domain";
      const desc = `Historical archive note ${i} retained for audit trail reference`;
      const fm = [
        "---",
        `id: ${id}`,
        `name: Archive Note ${i}`,
        `description: ${desc}`,
        ...(hasExplicitManual ? ["priority: manual"] : []),
        "---",
        `# Archive Note ${i}`,
        "",
      ];
      writeFileSync(join(tmp, file), fm.join("\n"), "utf-8");
      sections.Archive.push(`- [Archive Note ${i}](${file}) — ${desc}`);
      expectedPriorities.set(id, prio);
    }

    const memLines = ["# Workspace Memory", ""];
    for (const [heading, bullets] of Object.entries(sections)) {
      memLines.push(`## ${heading}`, "", ...bullets, "");
    }
    const memPath = join(tmp, "MEMORY.md");
    writeFileSync(memPath, memLines.join("\n"), "utf-8");

    assert.equal(expectedPriorities.size, 84);
    return { memPath, expectedPriorities };
  }

  it("splits an 84-entry store into sub-indexes, writes nothing on --dry-run, and preserves all 84 entries and their priorities", () => {
    const tmp = mkdtempSync(join(tmpdir(), "loadout-split-84-"));
    try {
      const { memPath, expectedPriorities } = build84EntryStore(tmp);
      const beforeRaw = readFileSync(memPath, "utf-8");
      const filesBefore = readdirSync(tmp).sort();

      const rulesPath = join(tmp, "split-rules.json");
      writeFileSync(
        rulesPath,
        JSON.stringify(
          {
            keepInRoot: {
              sections: ["Core Architecture"],
            },
            rules: [
              {
                subindex: "index-feedback.md",
                title: "Feedback Rulings",
                description: "Sub-index for feedback rulings and guardrails",
                prefix: "feedback_",
              },
              {
                subindex: "index-projects.md",
                title: "Project Specifications",
                description: "Sub-index for active project specs",
                section: "Projects",
              },
              {
                subindex: "ops",
                title: "Operations Runbooks",
                description: "Sub-index for CI and operations runbooks",
                pattern: "^ops_",
              },
              {
                subindex: "index-archive.md",
                title: "Historical Archive",
                description: "Sub-index for archived historical notes",
                glob: "archive_*.md",
              },
            ],
          },
          null,
          2,
        ),
        "utf-8",
      );

      const rulesConfig = loadSplitRulesFile(rulesPath);

      // 1. Dry-run: proves 84 -> 84 and priorities unchanged, writes NOTHING to disk
      const dryRes = splitMemoryStore(memPath, rulesConfig, { dryRun: true });
      assert.equal(dryRes.dryRun, true);
      assert.equal(dryRes.beforeEntryCount, 84);
      assert.equal(dryRes.afterEntryCount, 84);
      assert.equal(dryRes.entryCountUnchanged, true);
      assert.equal(dryRes.prioritiesUnchanged, true);
      assert.equal(dryRes.movedEntryCount, 78);
      assert.equal(dryRes.keptInRootCount, 6);
      assert.equal(dryRes.subindexes.length, 4);
      assert.ok(dryRes.afterMemoryMdBytes < dryRes.beforeMemoryMdBytes);

      // Verify --dry-run wrote nothing
      assert.equal(readFileSync(memPath, "utf-8"), beforeRaw);
      assert.equal(existsSync(join(tmp, "index-feedback.md")), false);
      assert.equal(existsSync(join(tmp, "index-projects.md")), false);
      assert.equal(existsSync(join(tmp, "index-ops.md")), false);
      assert.equal(existsSync(join(tmp, "index-archive.md")), false);
      assert.deepEqual(
        readdirSync(tmp).filter((f) => f !== "split-rules.json").sort(),
        filesBefore,
      );

      // 2. Real split: writes sub-indexes and updates MEMORY.md
      const realRes = splitMemoryStore(memPath, rulesConfig, { dryRun: false });
      assert.equal(realRes.dryRun, false);
      assert.equal(realRes.beforeEntryCount, 84);
      assert.equal(realRes.afterEntryCount, 84);
      assert.equal(realRes.entryCountUnchanged, true);
      assert.equal(realRes.prioritiesUnchanged, true);
      assert.equal(realRes.movedEntryCount, 78);
      assert.equal(realRes.keptInRootCount, 6);

      // All 4 sub-indexes exist on disk and carry metadata.loadout_role: subindex
      for (const subFile of [
        "index-feedback.md",
        "index-projects.md",
        "index-ops.md",
        "index-archive.md",
      ]) {
        const p = join(tmp, subFile);
        assert.ok(existsSync(p), `expected ${subFile} to be created`);
        assert.match(readFileSync(p, "utf-8"), /loadout_role:\s*subindex/);
      }

      // Independent post-split verification via analyzeMemoryMd + generateIndex + validateMemory
      const afterAnalysis = analyzeMemoryMd(memPath);
      const afterIndex = generateIndex(afterAnalysis);
      assert.equal(afterIndex.entries.length, 84);

      for (const entry of afterIndex.entries) {
        assert.equal(
          entry.priority,
          expectedPriorities.get(entry.id),
          `priority mismatch for ${entry.id}`,
        );
      }

      const memIssues = validateMemory(afterAnalysis);
      const idxIssues = validateMemoryIndex(afterIndex);
      assert.equal(
        memIssues.filter((i) => i.severity === "error").length,
        0,
        "post-split store must have 0 validation errors",
      );
      assert.equal(
        idxIssues.filter((i) => i.severity === "error").length,
        0,
        "post-split generated index must have 0 validation errors",
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("refuses and writes nothing when the post-split entry count or priority differs", () => {
    const tmp = mkdtempSync(join(tmpdir(), "loadout-split-refuse-"));
    try {
      const { memPath } = build84EntryStore(tmp);
      const originalMemoryMd = readFileSync(memPath, "utf-8");

      // 1. Rule with `drop: true` causes entry count to drop from 84 to 72 -> must refuse!
      assert.throws(
        () =>
          splitMemoryStore(memPath, {
            rules: [
              {
                subindex: "index-archive.md",
                glob: "archive_*.md",
                drop: true,
              },
            ],
          }),
        (err: unknown) => {
          assert.ok(err instanceof SplitError);
          assert.equal(err.code, "ENTRY_COUNT_MISMATCH");
          assert.match(err.message, /84 to 72/);
          return true;
        },
      );
      assert.equal(readFileSync(memPath, "utf-8"), originalMemoryMd);
      assert.equal(existsSync(join(tmp, "index-archive.md")), false);

      // 2. Tampered proposed output that changes an entry's priority -> must refuse with PRIORITY_MISMATCH!
      assert.throws(
        () =>
          splitMemoryStore(
            memPath,
            {
              rules: [
                {
                  subindex: "index-projects.md",
                  section: "Projects",
                },
              ],
            },
            {
              _transformProposed: (proposed) => {
                const sub = proposed.subindexContents.get("index-projects.md")!;
                const tampered = sub.replace(
                  "  loadout_role: subindex",
                  "  loadout_role: subindex\n  loadout_default_priority: manual",
                );
                const nextMap = new Map(proposed.subindexContents);
                nextMap.set("index-projects.md", tampered);
                return { ...proposed, subindexContents: nextMap };
              },
            },
          ),
        (err: unknown) => {
          assert.ok(err instanceof SplitError);
          assert.equal(err.code, "PRIORITY_MISMATCH");
          return true;
        },
      );
      assert.equal(readFileSync(memPath, "utf-8"), originalMemoryMd);
      assert.equal(existsSync(join(tmp, "index-projects.md")), false);

      // 3. Tampered proposed output that swaps an entry ID while keeping count at 84 -> ENTRY_MISSING_AFTER_SPLIT
      writeFileSync(
        join(tmp, "rogue-extra.md"),
        "---\nid: rogue-extra\nname: Rogue Extra\ndescription: Unreferenced extra\n---\n# Rogue\n",
        "utf-8",
      );
      assert.throws(
        () =>
          splitMemoryStore(
            memPath,
            {
              rules: [
                {
                  subindex: "index-projects.md",
                  section: "Projects",
                },
              ],
            },
            {
              _transformProposed: (proposed) => {
                const sub = proposed.subindexContents
                  .get("index-projects.md")!
                  .replace("project_01.md", "rogue-extra.md");
                const nextMap = new Map(proposed.subindexContents);
                nextMap.set("index-projects.md", sub);
                return { ...proposed, subindexContents: nextMap };
              },
            },
          ),
        (err: unknown) => {
          assert.ok(err instanceof SplitError);
          assert.equal(err.code, "ENTRY_MISSING_AFTER_SPLIT");
          return true;
        },
      );
      assert.equal(readFileSync(memPath, "utf-8"), originalMemoryMd);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("supports array rules, map shorthand, appending to an existing sub-index, and matcher variants (ids, files, keywords, priorities, catchAll)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "loadout-split-matchers-"));
    try {
      for (const item of [
        { id: "alpha", file: "alpha.md", kw: "alpha", prio: "core" },
        { id: "beta", file: "beta.md", kw: "beta", prio: "domain" },
        { id: "gamma", file: "gamma.md", kw: "gamma", prio: "manual" },
        { id: "delta", file: "delta.md", kw: "delta", prio: "domain" },
        { id: "epsilon", file: "epsilon.md", kw: "epsilon", prio: "domain" },
      ]) {
        writeFileSync(
          join(tmp, item.file),
          [
            "---",
            `id: ${item.id}`,
            `name: ${item.id}`,
            `description: Description for ${item.id}`,
            `priority: ${item.prio}`,
            `keywords: [${item.kw}]`,
            "---",
            `# ${item.id}`,
            "",
          ].join("\n"),
          "utf-8",
        );
      }

      // Pre-existing sub-index with alpha.md
      writeFileSync(
        join(tmp, "index-existing.md"),
        [
          "---",
          "name: Existing Subindex",
          "description: Pre-existing sub-index",
          "metadata:",
          "  loadout_role: subindex",
          "---",
          "# Existing",
          "- [alpha](alpha.md) — Description for alpha",
          "",
        ].join("\n"),
        "utf-8",
      );

      const memPath = join(tmp, "MEMORY.md");
      writeFileSync(
        memPath,
        [
          "# Memory",
          "- [Existing](index-existing.md) — Pre-existing sub-index",
          "- [beta](beta.md) — Description for beta",
          "- [gamma](gamma.md) — Description for gamma",
          "- [delta](delta.md) — Description for delta",
          "- [epsilon](epsilon.md) — Description for epsilon",
          "",
        ].join("\n"),
        "utf-8",
      );

      const res = splitMemoryStore(memPath, [
        { subindex: "index-existing.md", ids: ["beta"] },
        { subindex: "index-manual.md", priorities: ["manual"] },
        { subindex: "index-kw.md", keywords: ["delta"] },
        { subindex: "index-rest.md", catchAll: true },
      ]);

      assert.equal(res.beforeEntryCount, 5);
      assert.equal(res.afterEntryCount, 5);
      assert.equal(res.movedEntryCount, 4);

      //Also test map shorthand in parseSplitRules
      const mapRules = parseSplitRules({
        "index-files.md": ["a.md", "b.md"],
        "index-globs.md": ["foo_*.md"],
        "index-star.md": "*",
        "index-wild.md": "bar_*",
        "index-pref.md": "baz_",
      });
      assert.equal(mapRules.rules.length, 5);
      assert.equal(normalizeSubindexFilename("cards"), "index-cards.md");
      assert.equal(normalizeSubindexFilename("index-cards.md"), "index-cards.md");

      // Error handling on bad inputs
      assert.throws(() => normalizeSubindexFilename("   "), SplitError);
      assert.throws(() => parseSplitRules([]), SplitError);
      assert.throws(() => parseSplitRules(null), SplitError);
      assert.throws(() => parseSplitRules({}), SplitError);
      assert.throws(() => parseSplitRules({ rules: [] }), SplitError);
      assert.throws(() => parseSplitRules([null]), SplitError);
      assert.throws(() => parseSplitRules([{}]), SplitError);
      assert.throws(() => loadSplitRulesFile(join(tmp, "nope.json")), SplitError);

      const badJsonPath = join(tmp, "bad.json");
      writeFileSync(badJsonPath, "{ invalid json", "utf-8");
      assert.throws(() => loadSplitRulesFile(badJsonPath), SplitError);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
