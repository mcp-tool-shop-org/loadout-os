import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { analyzeMemoryMd } from "../analyze.js";
import { generateIndex } from "../index-gen.js";
import { resolveRefPath } from "../paths.js";
// FT-MR10: the shared resolver must also be reachable from the barrel, so the
// unified loadout-os CLI resolves refs through the exact same export.
import { resolveRefPath as barrelResolveRefPath } from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "..", "..", "src", "tests", "fixtures");

// ── FT-MR3: structured diagnostics[] channel ─────────────────────────
describe("diagnostics channel (FT-MR3)", () => {
  it("analyzeMemoryMd populates a structured diagnostics array", () => {
    const analysis = analyzeMemoryMd(join(FIXTURES, "MEMORY.md"));
    assert.ok(Array.isArray(analysis.diagnostics), "diagnostics must be an array");
    assert.ok(analysis.diagnostics.length > 0, "fixture has missing + orphan signals");
    // Every diagnostic carries the typed shape.
    for (const d of analysis.diagnostics) {
      assert.ok(["error", "warning", "info"].includes(d.severity), "severity is an enum");
      assert.equal(typeof d.code, "string");
      assert.ok(d.code.length > 0, "code is non-empty");
      assert.equal(typeof d.message, "string");
    }
  });

  it("an unresolved ref produces a diagnostic with code + error severity", () => {
    const analysis = analyzeMemoryMd(join(FIXTURES, "MEMORY.md"));
    // nullout.md / xrpl-lab.md are referenced but absent on disk.
    const missing = analysis.diagnostics.filter(
      (d) => d.code === "MISSING_TOPIC_FILE" || d.code === "UNRESOLVED_REF",
    );
    assert.ok(missing.length >= 1, "at least one unresolved-ref diagnostic");
    const nullout = missing.find((d) => d.refPath?.includes("nullout"));
    assert.ok(nullout, "the unresolved nullout ref must surface as a diagnostic");
    assert.equal(nullout.severity, "error");
    assert.ok(nullout.refPath, "diagnostic carries the offending refPath");
    assert.ok(nullout.hint, "diagnostic carries an actionable hint");
  });

  it("orphan files surface as warning-severity diagnostics", () => {
    const dir = mkdtempSync(join(tmpdir(), "mem-diag-"));
    try {
      // Referenced topic exists; a second topic is an orphan.
      writeFileSync(join(dir, "topic.md"), "# Topic\nbody\n");
      writeFileSync(join(dir, "orphan.md"), "# Orphan\nnot referenced\n");
      writeFileSync(
        join(dir, "MEMORY.md"),
        "# Mem\n\n## Active\n\nTopic — real → `topic.md`\n",
      );
      const analysis = analyzeMemoryMd(join(dir, "MEMORY.md"));
      const orphans = analysis.diagnostics.filter((d) => d.code === "ORPHAN_TOPIC_FILE");
      assert.ok(orphans.length >= 1, "orphan.md must produce an ORPHAN_TOPIC_FILE diagnostic");
      assert.equal(orphans[0].severity, "warning");
      assert.ok(orphans.some((d) => d.refPath?.includes("orphan")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the flat string[] arrays remain derived views of diagnostics (back-compat)", () => {
    const analysis = analyzeMemoryMd(join(FIXTURES, "MEMORY.md"));
    // generateIndex also records unresolved refs; run it so both channels are populated.
    generateIndex(analysis);

    // Every missingFiles entry is mirrored by an error-severity diagnostic.
    for (const path of analysis.missingFiles) {
      assert.ok(
        analysis.diagnostics.some(
          (d) =>
            (d.code === "MISSING_TOPIC_FILE" || d.code === "UNRESOLVED_REF") &&
            d.refPath === path,
        ),
        `missingFiles entry ${path} must have a matching diagnostic`,
      );
    }
    // Every orphanFiles entry is mirrored by a warning-severity diagnostic.
    for (const path of analysis.orphanFiles) {
      assert.ok(
        analysis.diagnostics.some(
          (d) => d.code === "ORPHAN_TOPIC_FILE" && d.refPath === path,
        ),
        `orphanFiles entry ${path} must have a matching diagnostic`,
      );
    }
  });

  it("generateIndex emits an UNRESOLVED_REF diagnostic without console noise", () => {
    const analysis = analyzeMemoryMd(join(FIXTURES, "MEMORY.md"));
    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (...a: unknown[]) => { warnings.push(a.join(" ")); };
    try {
      generateIndex(analysis);
    } finally {
      console.warn = originalWarn;
    }
    // The library stays quiet (MEM-B03) — signals live in diagnostics, not stderr.
    assert.equal(warnings.length, 0, "generateIndex must not write to console.warn");
    assert.ok(
      analysis.diagnostics.some((d) => d.code === "UNRESOLVED_REF"),
      "skipped refs must be recorded as UNRESOLVED_REF diagnostics",
    );
  });
});

// ── FT-MR10: dedup resolveRefPath — behavior-preserving + exported ───
describe("shared resolveRefPath (FT-MR10)", () => {
  it("is exported from the barrel (unified CLI uses the same resolver)", () => {
    assert.equal(typeof resolveRefPath, "function");
    assert.equal(barrelResolveRefPath, resolveRefPath, "barrel re-exports the same function");
  });

  it("returns the first existing base-joined path, else null (behavior preserved)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mem-resolve-"));
    try {
      const sub = join(dir, "memory");
      writeFileSync(join(dir, "MEMORY.md"), "x\n");
      // Create memory/foo.md so the parent-relative base resolves it.
      mkdirSync(sub, { recursive: true });
      writeFileSync(join(sub, "foo.md"), "# foo\n");

      // First base (dir) does NOT contain memory/foo.md? It does: dir + memory/foo.md.
      const hit = resolveRefPath("memory/foo.md", dir, dirname(dir));
      assert.equal(hit, join(dir, "memory", "foo.md"));

      // Unresolvable ref → null.
      const miss = resolveRefPath("memory/does-not-exist.md", dir, dirname(dir));
      assert.equal(miss, null);

      // Order matters: earlier base wins.
      const a = join(dir, "a");
      const b = join(dir, "b");
      mkdirSync(a, { recursive: true });
      mkdirSync(b, { recursive: true });
      writeFileSync(join(a, "dup.md"), "a\n");
      writeFileSync(join(b, "dup.md"), "b\n");
      assert.equal(resolveRefPath("dup.md", a, b), join(a, "dup.md"));
      assert.equal(resolveRefPath("dup.md", b, a), join(b, "dup.md"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dedup refactor preserves analyze/index/validate ref resolution end-to-end", () => {
    // The proof that hoisting one resolver changed no behavior: the fixture
    // still resolves exactly the same refs (same missing set, same index entries).
    const analysis = analyzeMemoryMd(join(FIXTURES, "MEMORY.md"));
    const index = generateIndex(analysis);
    // ai-loadout / claude-rules / artifact resolve; nullout / xrpl-lab do not.
    const ids = index.entries.map((e) => e.id);
    assert.ok(ids.includes("ai-loadout"));
    assert.ok(ids.includes("claude-rules"));
    assert.ok(!ids.includes("nullout"));
    assert.ok(!ids.includes("xrpl-lab"));
    assert.ok(analysis.missingFiles.some((f) => f.includes("nullout")));
    assert.ok(analysis.missingFiles.some((f) => f.includes("xrpl-lab")));
  });
});
