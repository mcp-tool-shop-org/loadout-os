import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseSections,
  parseFrontmatter,
  serializeFrontmatter,
  estimateTokens,
  headingToId,
} from "../parser.js";
import { DEFAULT_TRIGGERS } from "../types.js";

describe("estimateTokens", () => {
  it("estimates ~1 token per 4 chars", () => {
    assert.equal(estimateTokens("abcd"), 1);
    assert.equal(estimateTokens("abcde"), 2); // ceil(5/4)
    assert.equal(estimateTokens(""), 0);
  });
});

describe("headingToId", () => {
  it("converts heading to clean kebab-case", () => {
    assert.equal(headingToId("GitHub Actions Rules (Non-Negotiable)"), "github-actions");
  });

  it("strips parenthetical context", () => {
    assert.equal(headingToId("Canonical Ownership (Source of Truth)"), "canonical-ownership");
  });

  it("limits to 3 words", () => {
    assert.equal(headingToId("Very Long Section Heading With Many Words"), "very-long-section");
  });

  it("handles simple headings", () => {
    assert.equal(headingToId("Role"), "role");
  });

  it("strips noise words", () => {
    assert.equal(headingToId("The Rules for Everything"), "everything");
  });

  it("handles empty heading", () => {
    assert.equal(headingToId(""), "unnamed");
  });
});

describe("parseSections", () => {
  it("returns empty for empty content", () => {
    const sections = parseSections("");
    assert.equal(sections.length, 0);
  });

  it("returns preamble for content without headings", () => {
    const sections = parseSections("Just some text\nwithout headings");
    assert.equal(sections.length, 1);
    assert.equal(sections[0].heading, "(preamble)");
    assert.equal(sections[0].level, 0);
  });

  it("splits on ## headings", () => {
    const content = [
      "# Title",
      "",
      "## Section One",
      "Content one",
      "",
      "## Section Two",
      "Content two",
    ].join("\n");

    const sections = parseSections(content);
    // Preamble (# Title) + Section One + Section Two
    assert.equal(sections.length, 3);
    assert.equal(sections[0].heading, "(preamble)");
    assert.equal(sections[1].heading, "Section One");
    assert.equal(sections[2].heading, "Section Two");
  });

  it("groups ### under parent ##", () => {
    const content = [
      "## Parent",
      "Parent content",
      "",
      "### Child One",
      "Child content",
      "",
      "### Child Two",
      "More child content",
      "",
      "## Next Section",
      "Next content",
    ].join("\n");

    const sections = parseSections(content);
    assert.equal(sections.length, 2);
    assert.equal(sections[0].heading, "Parent");
    // Parent section should include both ### children
    assert.ok(sections[0].content.includes("Child One"));
    assert.ok(sections[0].content.includes("Child Two"));
    assert.equal(sections[1].heading, "Next Section");
  });

  it("treats standalone ### as its own section when no parent ##", () => {
    const content = [
      "### Standalone",
      "Some content",
      "",
      "### Another",
      "More content",
    ].join("\n");

    const sections = parseSections(content);
    assert.equal(sections.length, 2);
    assert.equal(sections[0].heading, "Standalone");
    assert.equal(sections[1].heading, "Another");
  });

  it("handles preamble before first heading", () => {
    const content = [
      "This is preamble",
      "",
      "## First Section",
      "Content",
    ].join("\n");

    const sections = parseSections(content);
    assert.equal(sections.length, 2);
    assert.equal(sections[0].heading, "(preamble)");
    assert.equal(sections[0].content.trim(), "This is preamble");
  });

  it("skips blank-line-only preamble", () => {
    const content = [
      "",
      "",
      "## First Section",
      "Content",
    ].join("\n");

    const sections = parseSections(content);
    assert.equal(sections.length, 1);
    assert.equal(sections[0].heading, "First Section");
  });

  it("calculates correct line ranges", () => {
    const content = [
      "## Section A",  // line 0
      "Line 1",        // line 1
      "Line 2",        // line 2
      "",              // line 3
      "## Section B",  // line 4
      "Line 3",        // line 5
    ].join("\n");

    const sections = parseSections(content);
    assert.equal(sections[0].startLine, 0);
    assert.equal(sections[0].endLine, 3); // trims trailing blank
    assert.equal(sections[1].startLine, 4);
  });
});

describe("parseFrontmatter", () => {
  it("returns null frontmatter when no --- delimiters", () => {
    const { frontmatter, body } = parseFrontmatter("Just content\nno frontmatter");
    assert.equal(frontmatter, null);
    assert.equal(body, "Just content\nno frontmatter");
  });

  it("parses basic frontmatter", () => {
    const content = [
      "---",
      "id: github-actions",
      "keywords: [ci, workflow, runner]",
      "priority: domain",
      "---",
      "",
      "# Content here",
    ].join("\n");

    const { frontmatter, body } = parseFrontmatter(content);
    assert.ok(frontmatter);
    assert.equal(frontmatter.id, "github-actions");
    assert.deepEqual(frontmatter.keywords, ["ci", "workflow", "runner"]);
    assert.equal(frontmatter.priority, "domain");
    assert.ok(body.includes("# Content here"));
  });

  it("parses triggers block", () => {
    const content = [
      "---",
      "id: test-rule",
      "keywords: [test]",
      "priority: domain",
      "triggers:",
      "  task: true",
      "  plan: false",
      "  edit: true",
      "---",
      "Body",
    ].join("\n");

    const { frontmatter } = parseFrontmatter(content);
    assert.ok(frontmatter);
    assert.equal(frontmatter.triggers.task, true);
    assert.equal(frontmatter.triggers.plan, false);
    assert.equal(frontmatter.triggers.edit, true);
  });

  it("defaults triggers when not specified", () => {
    const content = [
      "---",
      "id: minimal",
      "keywords: [test]",
      "priority: core",
      "---",
      "Body",
    ].join("\n");

    const { frontmatter } = parseFrontmatter(content);
    assert.ok(frontmatter);
    assert.deepEqual(frontmatter.triggers, DEFAULT_TRIGGERS);
  });

  it("returns null when id is missing", () => {
    const content = [
      "---",
      "keywords: [test]",
      "priority: domain",
      "---",
      "Body",
    ].join("\n");

    const { frontmatter } = parseFrontmatter(content);
    assert.equal(frontmatter, null);
  });

  it("defaults priority to domain when invalid", () => {
    const content = [
      "---",
      "id: test",
      "keywords: [test]",
      "priority: bogus",
      "---",
      "Body",
    ].join("\n");

    const { frontmatter } = parseFrontmatter(content);
    assert.ok(frontmatter);
    assert.equal(frontmatter.priority, "domain");
  });

  it("handles patterns field", () => {
    const content = [
      "---",
      "id: shipping",
      "keywords: [publish, npm]",
      "patterns: [package_release, artifact_publish]",
      "priority: domain",
      "---",
      "Body",
    ].join("\n");

    const { frontmatter } = parseFrontmatter(content);
    assert.ok(frontmatter);
    assert.deepEqual(frontmatter.patterns, ["package_release", "artifact_publish"]);
  });
});

describe("serializeFrontmatter", () => {
  it("round-trips through parse → serialize → parse", () => {
    const original = {
      id: "github-actions",
      keywords: ["ci", "workflow", "runner"],
      patterns: ["ci_pipeline"],
      priority: "domain" as const,
      triggers: { task: true, plan: true, edit: false },
    };

    const serialized = serializeFrontmatter(original);
    const { frontmatter } = parseFrontmatter(serialized + "\n\nBody");
    assert.ok(frontmatter);
    assert.equal(frontmatter.id, original.id);
    assert.deepEqual(frontmatter.keywords, original.keywords);
    assert.deepEqual(frontmatter.patterns, original.patterns);
    assert.equal(frontmatter.priority, original.priority);
    assert.deepEqual(frontmatter.triggers, original.triggers);
  });
});
