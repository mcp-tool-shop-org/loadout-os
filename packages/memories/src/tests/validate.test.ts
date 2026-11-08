import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { analyzeMemoryMd } from "../analyze.js";
import { generateIndex } from "../index-gen.js";
import { validateMemory, validateMemoryIndex } from "../validate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "..", "..", "src", "tests", "fixtures");

describe("validateMemory", () => {
  it("reports missing topic files", () => {
    const analysis = analyzeMemoryMd(join(FIXTURES, "MEMORY.md"));
    const issues = validateMemory(analysis);
    const missing = issues.filter((i) => i.code === "MISSING_TOPIC_FILE");
    assert.ok(missing.length >= 2); // nullout.md, xrpl-lab.md
  });

  it("does not report false missing for existing files", () => {
    const analysis = analyzeMemoryMd(join(FIXTURES, "MEMORY.md"));
    const issues = validateMemory(analysis);
    const missing = issues.filter((i) => i.code === "MISSING_TOPIC_FILE");
    // ai-loadout.md exists, should not be in missing
    assert.ok(!missing.some((i) => i.message.includes("ai-loadout")));
  });

  it("issues have hints", () => {
    const analysis = analyzeMemoryMd(join(FIXTURES, "MEMORY.md"));
    const issues = validateMemory(analysis);
    const missing = issues.filter((i) => i.code === "MISSING_TOPIC_FILE");
    for (const issue of missing) {
      assert.ok(issue.hint);
    }
  });

  // MEM-004: derived ids longer than 60 chars get an ID_TOO_LONG warning.
  it("flags over-long derived ids (MEM-004)", () => {
    const analysis = analyzeMemoryMd(join(FIXTURES, "MEMORY.md"));
    const issues = validateMemory(analysis);
    const tooLong = issues.filter((i) => i.code === "ID_TOO_LONG");
    assert.ok(tooLong.length >= 1, "should flag at least one over-long id");
    assert.equal(tooLong[0].severity, "warning");
    assert.ok(tooLong[0].hint, "ID_TOO_LONG should carry a hint");
    assert.match(tooLong[0].message, /line \d+/); // carries a line number
  });

  it("does not flag normal-length ids (MEM-004)", () => {
    const analysis = analyzeMemoryMd(join(FIXTURES, "MEMORY.md"));
    const issues = validateMemory(analysis);
    const tooLong = issues.filter((i) => i.code === "ID_TOO_LONG");
    // ai-loadout, claude-rules, artifact etc. are all short.
    assert.ok(
      !tooLong.some((i) => /ai-loadout|claude-rules|artifact/.test(i.message)),
      "short ids must not be flagged",
    );
  });

  // MEM-B08: ID_TOO_LONG must also fire on a frontmatter-supplied id, not just
  // the name-derived one. long-fm-id.md has a SHORT ref name ("Short FM" →
  // "short-fm") but an over-long frontmatter id — exactly the gap MEM-004 left.
  it("flags an over-long frontmatter id (MEM-B08)", () => {
    const analysis = analyzeMemoryMd(join(FIXTURES, "MEMORY.md"));
    const issues = validateMemory(analysis);
    const tooLong = issues.filter((i) => i.code === "ID_TOO_LONG");
    const fmFlag = tooLong.find((i) => /Frontmatter id/.test(i.message));
    assert.ok(fmFlag, "the over-long frontmatter id must be flagged");
    assert.equal(fmFlag.severity, "warning");
    assert.match(
      fmFlag.message,
      /this-is-an-intentionally-very-long-frontmatter-id/,
      "message names the offending frontmatter id",
    );
    assert.ok(fmFlag.hint, "frontmatter ID_TOO_LONG carries a hint");
    assert.match(fmFlag.hint, /long-fm-id\.md/, "hint points at the topic file");
  });

  it("does not flag a short frontmatter id via the name path (MEM-B08)", () => {
    // "Short FM" derives "short-fm" — the derived path must NOT flag this ref;
    // only its over-long frontmatter id should (asserted above). Confirm there
    // is no "Derived id" flag for the short name.
    const analysis = analyzeMemoryMd(join(FIXTURES, "MEMORY.md"));
    const issues = validateMemory(analysis);
    const tooLong = issues.filter((i) => i.code === "ID_TOO_LONG");
    assert.ok(
      !tooLong.some((i) => /Derived id.*short-fm/.test(i.message)),
      "short derived id short-fm must not be flagged",
    );
  });

  it("errors with MEMORY_LIMIT_EXCEEDED at 181 lines and at 24,001 bytes, citing the measured truncation event (Part B)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "loadout-limit-"));
    try {
      // 1. Exactly 180 lines -> passes without MEMORY_LIMIT_EXCEEDED
      const lines180 = Array.from({ length: 180 }, (_, i) => `# Line ${i + 1}`).join("\n");
      const memPath = join(tmp, "MEMORY.md");
      writeFileSync(memPath, lines180, "utf-8");
      const okIssues = validateMemory(analyzeMemoryMd(memPath));
      assert.ok(!okIssues.some((i) => i.code === "MEMORY_LIMIT_EXCEEDED"));

      // 2. 181 lines -> errors with MEMORY_LIMIT_EXCEEDED
      const lines181 = Array.from({ length: 181 }, (_, i) => `# Line ${i + 1}`).join("\n");
      writeFileSync(memPath, lines181, "utf-8");
      const lineErrIssues = validateMemory(analyzeMemoryMd(memPath));
      const lineErr = lineErrIssues.find((i) => i.code === "MEMORY_LIMIT_EXCEEDED");
      assert.ok(lineErr, "181 lines must trigger MEMORY_LIMIT_EXCEEDED");
      assert.equal(lineErr.severity, "error");
      assert.match(lineErr.message, /measured 2026-11-08: a 242-line \/ 33 KB index was cut at line 194/);

      // 3. 24,001 bytes in <= 180 lines -> errors with MEMORY_LIMIT_EXCEEDED
      const longLine = "# " + "x".repeat(240); // 242 bytes per line
      const bytesOver24k = Array.from({ length: 100 }, () => longLine).join("\n"); // 100 lines, >24,000 bytes
      writeFileSync(memPath, bytesOver24k, "utf-8");
      const byteErrIssues = validateMemory(analyzeMemoryMd(memPath));
      const byteErr = byteErrIssues.find((i) => i.code === "MEMORY_LIMIT_EXCEEDED");
      assert.ok(byteErr, ">24,000 bytes must trigger MEMORY_LIMIT_EXCEEDED");
      assert.equal(byteErr.severity, "error");
      assert.match(byteErr.message, /bytes > limit 24000/);

      // 4. Configurable limits override defaults
      const customOk = validateMemory(analyzeMemoryMd(memPath), { maxLines: 200, maxBytes: 30000 });
      assert.ok(!customOk.some((i) => i.code === "MEMORY_LIMIT_EXCEEDED"));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("validateMemoryIndex", () => {
  it("validates generated index without errors", () => {
    const analysis = analyzeMemoryMd(join(FIXTURES, "MEMORY.md"));
    const index = generateIndex(analysis);
    const issues = validateMemoryIndex(index);
    const errors = issues.filter((i) => i.severity === "error");
    assert.equal(errors.length, 0);
  });
});
