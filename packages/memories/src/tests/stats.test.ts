import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeMemoryMd } from "../analyze.js";
import { generateIndex } from "../index-gen.js";
import { generateStats, formatStats } from "../stats.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "..", "..", "src", "tests", "fixtures");

describe("generateStats", () => {
  it("produces stats from analysis and index", () => {
    const analysis = analyzeMemoryMd(join(FIXTURES, "MEMORY.md"));
    const index = generateIndex(analysis);
    const stats = generateStats(analysis, index);

    assert.ok(stats.totalTokens > 0);
    assert.ok(stats.entryCount >= 3);
    assert.ok(stats.domainCount >= 3);
    assert.equal(stats.missingCount, analysis.missingFiles.length);
    assert.equal(stats.orphanCount, analysis.orphanFiles.length);
  });

  it("calculates savings percentage", () => {
    const analysis = analyzeMemoryMd(join(FIXTURES, "MEMORY.md"));
    const index = generateIndex(analysis);
    const stats = generateStats(analysis, index);

    assert.ok(stats.savingsPercent >= 0);
    assert.ok(stats.savingsPercent <= 100);
  });

  it("lists top entries by token cost", () => {
    const analysis = analyzeMemoryMd(join(FIXTURES, "MEMORY.md"));
    const index = generateIndex(analysis);
    const stats = generateStats(analysis, index);

    assert.ok(stats.topEntries.length > 0);
    // Should be sorted descending by tokens
    for (let i = 1; i < stats.topEntries.length; i++) {
      assert.ok(stats.topEntries[i - 1].tokens >= stats.topEntries[i].tokens);
    }
  });
});

describe("formatStats", () => {
  it("produces non-empty formatted output", () => {
    const analysis = analyzeMemoryMd(join(FIXTURES, "MEMORY.md"));
    const index = generateIndex(analysis);
    const stats = generateStats(analysis, index);
    const output = formatStats(stats);

    assert.ok(output.length > 0);
    assert.ok(output.includes("Token Budget"));
    assert.ok(output.includes("Total tokens"));
  });
});
