import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
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
