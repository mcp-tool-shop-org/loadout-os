import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatter, serializeFrontmatter } from "../frontmatter.js";
import { DEFAULT_TRIGGERS } from "../types.js";

describe("parseFrontmatter", () => {
  it("returns null when no delimiters", () => {
    const { frontmatter, body } = parseFrontmatter("Just content");
    assert.equal(frontmatter, null);
    assert.equal(body, "Just content");
  });

  it("parses basic frontmatter", () => {
    const content = "---\nid: test\nkeywords: [ci, deploy]\npriority: domain\n---\n\nBody";
    const { frontmatter, body } = parseFrontmatter(content);
    assert.ok(frontmatter);
    assert.equal(frontmatter.id, "test");
    assert.deepEqual(frontmatter.keywords, ["ci", "deploy"]);
    assert.equal(frontmatter.priority, "domain");
    assert.ok(body.includes("Body"));
  });

  it("parses triggers block", () => {
    const content = "---\nid: t\nkeywords: [x]\npriority: core\ntriggers:\n  task: false\n  plan: true\n  edit: true\n---\nBody";
    const { frontmatter } = parseFrontmatter(content);
    assert.ok(frontmatter);
    assert.equal(frontmatter.triggers.task, false);
    assert.equal(frontmatter.triggers.plan, true);
    assert.equal(frontmatter.triggers.edit, true);
  });

  it("defaults triggers when missing", () => {
    const content = "---\nid: t\nkeywords: [x]\npriority: domain\n---\nBody";
    const { frontmatter } = parseFrontmatter(content);
    assert.ok(frontmatter);
    assert.deepEqual(frontmatter.triggers, DEFAULT_TRIGGERS);
  });

  it("returns null when id missing", () => {
    const content = "---\nkeywords: [x]\npriority: domain\n---\nBody";
    const { frontmatter } = parseFrontmatter(content);
    assert.equal(frontmatter, null);
  });

  it("defaults invalid priority to domain", () => {
    const content = "---\nid: t\nkeywords: [x]\npriority: bogus\n---\nBody";
    const { frontmatter } = parseFrontmatter(content);
    assert.ok(frontmatter);
    assert.equal(frontmatter.priority, "domain");
  });

  it("handles patterns field", () => {
    const content = "---\nid: t\nkeywords: [x]\npatterns: [ci_pipeline, deploy_flow]\npriority: domain\n---\nBody";
    const { frontmatter } = parseFrontmatter(content);
    assert.ok(frontmatter);
    assert.deepEqual(frontmatter.patterns, ["ci_pipeline", "deploy_flow"]);
  });

  it("handles empty keywords gracefully", () => {
    const content = "---\nid: t\nkeywords: []\npriority: manual\n---\nBody";
    const { frontmatter } = parseFrontmatter(content);
    assert.ok(frontmatter);
    assert.deepEqual(frontmatter.keywords, []);
  });

  it("peeks the correct next line for byte-identical empty-value keys", () => {
    // Regression (KER-03): the empty-value block-key peek used
    // `fmLines.indexOf(line)`, which returns the FIRST byte-identical line.
    // When the same empty-value key line ("triggers:") appears twice, the
    // SECOND occurrence would peek the FIRST occurrence's next line and
    // mis-classify its block (array vs object).
    //
    // First `triggers:` is followed by a dash item (would open an array);
    // the last-wins `triggers:` is followed by an indented object. With the
    // buggy indexOf, the second `triggers:` peeks the first occurrence's next
    // line ("- task") and wrongly opens an array, so the real triggers object
    // is dropped and triggers fall back to DEFAULT_TRIGGERS. With numeric
    // indexing, the second occurrence peeks its OWN next line and parses the
    // object correctly.
    const content = [
      "---",
      "id: dup-key",
      "keywords: [x]",
      "priority: core",
      "triggers:",        // first occurrence — dash item follows
      "- task",           //   (buggy indexOf peek target for the 2nd key)
      "triggers:",        // byte-identical key line — indented object follows
      "  task: false",
      "  plan: false",
      "  edit: true",
      "---",
      "Body",
    ].join("\n");
    const { frontmatter } = parseFrontmatter(content);
    assert.ok(frontmatter);
    // The winning (second) triggers block must be parsed as an object.
    // On the buggy code it would be skipped, leaving DEFAULT_TRIGGERS
    // (task: true, edit: false) — distinct from the expected values below.
    assert.equal(frontmatter.triggers.task, false);
    assert.equal(frontmatter.triggers.plan, false);
    assert.equal(frontmatter.triggers.edit, true);
  });
});

describe("serializeFrontmatter", () => {
  it("round-trips correctly", () => {
    const original = {
      id: "github-actions",
      keywords: ["ci", "workflow"],
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

  it("omits empty patterns", () => {
    const fm = {
      id: "test",
      keywords: ["x"],
      patterns: [],
      priority: "core" as const,
      triggers: { task: true, plan: true, edit: false },
    };
    const serialized = serializeFrontmatter(fm);
    assert.ok(!serialized.includes("patterns:"));
  });
});
