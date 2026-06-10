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
