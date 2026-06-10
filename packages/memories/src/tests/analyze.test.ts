import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeMemoryMd, extractKeywords } from "../analyze.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "..", "..", "src", "tests", "fixtures");

describe("analyzeMemoryMd", () => {
  it("analyzes fixture MEMORY.md", () => {
    const analysis = analyzeMemoryMd(join(FIXTURES, "MEMORY.md"));

    assert.ok(analysis.sections.length >= 3);
    assert.ok(analysis.refs.length >= 3); // at least ai-loadout, claude-rules, artifact
    assert.ok(analysis.inlineTokens > 0);
    assert.ok(analysis.topicTokens > 0);
    assert.ok(analysis.totalTokens > analysis.inlineTokens);
  });

  it("detects missing files", () => {
    const analysis = analyzeMemoryMd(join(FIXTURES, "MEMORY.md"));
    // nullout.md and xrpl-lab.md don't exist in fixtures
    assert.ok(analysis.missingFiles.length >= 2);
    assert.ok(analysis.missingFiles.some((f) => f.includes("nullout")));
  });

  it("detects existing referenced files", () => {
    const analysis = analyzeMemoryMd(join(FIXTURES, "MEMORY.md"));
    // ai-loadout.md, claude-rules.md, artifact.md exist
    assert.ok(analysis.missingFiles.length < analysis.refs.length);
  });
});

describe("analyzeMemoryMd error handling", () => {
  it("throws descriptive error for non-existent MEMORY.md", () => {
    assert.throws(
      () => analyzeMemoryMd(join(FIXTURES, "nonexistent", "MEMORY.md")),
      (err: Error) => {
        assert.ok(err.message.includes("Cannot read MEMORY.md"));
        return true;
      },
    );
  });

  it("treats unreadable topic files as missing", () => {
    // The fixture has refs to files that don't exist — those should be in missingFiles
    const analysis = analyzeMemoryMd(join(FIXTURES, "MEMORY.md"));
    assert.ok(analysis.missingFiles.length >= 2);
    // Should not throw even when topic files are missing
    assert.ok(typeof analysis.totalTokens === "number");
  });
});

describe("extractKeywords", () => {
  it("extracts keywords from name", () => {
    const keywords = extractKeywords("AI Loadout", "# AI Loadout\nSome content");
    assert.ok(keywords.includes("loadout"));
  });

  it("extracts keywords from headings", () => {
    const content = `# Title
## Architecture
## Key Types
`;
    const keywords = extractKeywords("Test", content);
    assert.ok(keywords.includes("architecture"));
    assert.ok(keywords.includes("key"));
    assert.ok(keywords.includes("types"));
  });

  it("filters stop words", () => {
    const keywords = extractKeywords("The Big Tool", "# The And For Content");
    assert.ok(!keywords.includes("the"));
    assert.ok(!keywords.includes("and"));
    assert.ok(!keywords.includes("for"));
  });

  it("filters short words", () => {
    const keywords = extractKeywords("AI ML", "# AI ML");
    // "ai" and "ml" are 2 chars, filtered out
    assert.ok(!keywords.includes("ai"));
    assert.ok(!keywords.includes("ml"));
  });
});
