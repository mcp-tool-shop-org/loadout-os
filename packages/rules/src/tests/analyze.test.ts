import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  extractKeywords,
  classifyPriority,
  generateSummary,
  suggestPatterns,
  analyzeFile,
  resolveMemoryMd,
} from "../analyze.js";
import type { Section } from "../types.js";

function makeSection(
  heading: string,
  content: string,
  lines?: number,
): Section {
  const actualLines = content.split("\n").length;
  return {
    heading,
    level: 2,
    startLine: 0,
    endLine: actualLines,
    content,
    lines: lines ?? actualLines,
    tokens_est: Math.ceil(content.length / 4),
  };
}

describe("classifyPriority", () => {
  it("classifies short sections as core", () => {
    const section = makeSection("Role", "## Role\nML Partner.", 2);
    assert.equal(classifyPriority(section), "core");
  });

  it("classifies Role heading as always core", () => {
    const section = makeSection("Role", "## Role\n" + "x\n".repeat(20), 21);
    assert.equal(classifyPriority(section), "core");
  });

  it("classifies long sections as domain", () => {
    const content = "## Big Section\n" + "Line\n".repeat(20);
    const section = makeSection("Big Section", content, 21);
    assert.equal(classifyPriority(section), "domain");
  });

  it("classifies Non-Negotiable sections as domain when large", () => {
    const content = "## GitHub Actions (Non-Negotiable)\n" + "Line\n".repeat(15);
    const section = makeSection(
      "GitHub Actions (Non-Negotiable)",
      content,
      16,
    );
    assert.equal(classifyPriority(section), "domain");
  });

  it("classifies medium sections with domain heading signals as domain", () => {
    const content = "## GitHub Actions\n" + "Line\n".repeat(10);
    const section = makeSection("GitHub Actions", content, 11);
    assert.equal(classifyPriority(section), "domain");
  });

  it("classifies medium sections without domain signals as core", () => {
    const content = "## Quick Notes\n" + "Line\n".repeat(10);
    const section = makeSection("Quick Notes", content, 11);
    assert.equal(classifyPriority(section), "core");
  });
});

describe("extractKeywords", () => {
  it("extracts heading words", () => {
    const section = makeSection("GitHub Actions Rules", "## GitHub Actions Rules\nSome content");
    const kw = extractKeywords(section);
    assert.ok(kw.includes("github"));
    assert.ok(kw.includes("actions"));
  });

  it("extracts domain signal words from content", () => {
    const section = makeSection("CI Setup", "## CI Setup\nUse workflow_dispatch as a manual fallback.");
    const kw = extractKeywords(section);
    assert.ok(kw.includes("workflow"));
  });

  it("filters stop words", () => {
    const section = makeSection("The Big Rule", "## The Big Rule\nContent");
    const kw = extractKeywords(section);
    assert.ok(!kw.includes("the"));
  });
});

describe("generateSummary", () => {
  it("uses first content line as summary", () => {
    const section = makeSection(
      "CI Rules",
      "## CI Rules\nCI minutes are finite. Every workflow must be paths-gated.",
    );
    const summary = generateSummary(section);
    assert.ok(summary.includes("CI minutes"));
  });

  it("truncates long summaries", () => {
    const longLine = "x".repeat(200);
    const section = makeSection("Test", `## Test\n${longLine}`);
    const summary = generateSummary(section);
    assert.ok(summary.length <= 120);
  });

  it("falls back to heading for empty content", () => {
    const section = makeSection("Empty", "## Empty");
    // Only heading line, no content
    const summary = generateSummary(section);
    assert.equal(summary, "Empty");
  });
});

describe("suggestPatterns", () => {
  it("suggests ci_pipeline for CI content", () => {
    const section = makeSection("CI", "## CI\nGitHub Actions workflow setup");
    const patterns = suggestPatterns(section);
    assert.ok(patterns.includes("ci_pipeline"));
  });

  it("suggests package_release for publish content", () => {
    const section = makeSection("Ship", "## Ship\nnpm publish steps");
    const patterns = suggestPatterns(section);
    assert.ok(patterns.includes("package_release"));
  });

  it("returns empty for unrelated content", () => {
    const section = makeSection("Notes", "## Notes\nSome random thoughts here.");
    const patterns = suggestPatterns(section);
    assert.equal(patterns.length, 0);
  });
});

describe("analyzeFile with --memory content", () => {
  it("analyzes a MEMORY.md-like file and proposes extractions", () => {
    const tmp = mkdtempSync(join(tmpdir(), "analyze-mem-"));
    const memPath = join(tmp, "MEMORY.md");
    const content = [
      "# Memory",
      "",
      "## GitHub Actions Incident",
      "Feb 2026, $130 burn, cost-saving rules.",
      ...Array(12).fill("Detail line."),
      "",
      "## Short Note",
      "Just a quick thing.",
    ].join("\n");
    writeFileSync(memPath, content, "utf8");

    const report = analyzeFile(memPath, ".claude/rules");
    // The long section should be proposed for extraction
    assert.ok(report.proposals.length >= 1);
    assert.ok(report.proposals.some((p) => p.suggestedId.includes("github-actions")));
    // The short note should stay core
    assert.ok(report.coreCandidate.some((s) => s.heading === "Short Note"));
  });
});
