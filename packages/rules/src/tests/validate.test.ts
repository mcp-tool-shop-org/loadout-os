import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateRules } from "../validate.js";

function setupRulesDir(): string {
  const tmp = mkdtempSync(join(tmpdir(), "claude-rules-test-"));
  const rulesDir = join(tmp, ".claude", "rules");
  mkdirSync(rulesDir, { recursive: true });
  return tmp;
}

describe("validateRules", () => {
  it("reports MISSING_INDEX when no index.json", () => {
    const tmp = mkdtempSync(join(tmpdir(), "claude-rules-test-"));
    const issues = validateRules(".claude/rules", tmp);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].code, "MISSING_INDEX");
  });

  it("reports MISSING_REF when rule file doesn't exist", () => {
    const tmp = setupRulesDir();
    const rulesDir = join(tmp, ".claude", "rules");

    writeFileSync(
      join(rulesDir, "index.json"),
      JSON.stringify({
        version: "1.0.0",
        generated: new Date().toISOString(),
        entries: [
          {
            id: "ghost",
            path: ".claude/rules/ghost.md",
            keywords: ["ghost"],
            patterns: [],
            priority: "domain",
            summary: "A ghost rule",
            triggers: { task: true, plan: true, edit: false },
            tokens_est: 100,
            lines: 10,
          },
        ],
        budget: {
          always_loaded_est: 0,
          on_demand_total_est: 100,
          avg_task_load_est: 100,
          avg_task_load_observed: null,
        },
      }),
    );

    const issues = validateRules(".claude/rules", tmp);
    const refs = issues.filter((i) => i.code === "MISSING_REF");
    assert.equal(refs.length, 1);
  });

  it("reports MISSING_FRONTMATTER when rule file has none", () => {
    const tmp = setupRulesDir();
    const rulesDir = join(tmp, ".claude", "rules");

    writeFileSync(
      join(rulesDir, "bare.md"),
      "# Just content\nNo frontmatter here.",
    );
    writeFileSync(
      join(rulesDir, "index.json"),
      JSON.stringify({
        version: "1.0.0",
        generated: new Date().toISOString(),
        entries: [
          {
            id: "bare",
            path: ".claude/rules/bare.md",
            keywords: ["bare"],
            patterns: [],
            priority: "domain",
            summary: "Bare rule",
            triggers: { task: true, plan: true, edit: false },
            tokens_est: 50,
            lines: 2,
          },
        ],
        budget: {
          always_loaded_est: 0,
          on_demand_total_est: 50,
          avg_task_load_est: 50,
          avg_task_load_observed: null,
        },
      }),
    );

    const issues = validateRules(".claude/rules", tmp);
    const fmIssues = issues.filter((i) => i.code === "MISSING_FRONTMATTER");
    assert.equal(fmIssues.length, 1);
  });

  it("reports ORPHAN_FILE for unreferenced .md files", () => {
    const tmp = setupRulesDir();
    const rulesDir = join(tmp, ".claude", "rules");

    writeFileSync(
      join(rulesDir, "orphan.md"),
      "---\nid: orphan\nkeywords: [lost]\npriority: domain\n---\n\n# Orphan",
    );
    writeFileSync(
      join(rulesDir, "index.json"),
      JSON.stringify({
        version: "1.0.0",
        generated: new Date().toISOString(),
        entries: [],
        budget: {
          always_loaded_est: 0,
          on_demand_total_est: 0,
          avg_task_load_est: 0,
          avg_task_load_observed: null,
        },
      }),
    );

    const issues = validateRules(".claude/rules", tmp);
    const orphans = issues.filter((i) => i.code === "ORPHAN_FILE");
    assert.equal(orphans.length, 1);
  });

  it("reports DRIFT_ID when frontmatter id differs from index", () => {
    const tmp = setupRulesDir();
    const rulesDir = join(tmp, ".claude", "rules");

    writeFileSync(
      join(rulesDir, "test.md"),
      "---\nid: different-id\nkeywords: [test]\npriority: domain\n---\n\n# Test",
    );
    writeFileSync(
      join(rulesDir, "index.json"),
      JSON.stringify({
        version: "1.0.0",
        generated: new Date().toISOString(),
        entries: [
          {
            id: "test",
            path: ".claude/rules/test.md",
            keywords: ["test"],
            patterns: [],
            priority: "domain",
            summary: "Test rule",
            triggers: { task: true, plan: true, edit: false },
            tokens_est: 50,
            lines: 3,
          },
        ],
        budget: {
          always_loaded_est: 0,
          on_demand_total_est: 50,
          avg_task_load_est: 50,
          avg_task_load_observed: null,
        },
      }),
    );

    const issues = validateRules(".claude/rules", tmp);
    const drift = issues.filter((i) => i.code === "DRIFT_ID");
    assert.equal(drift.length, 1);
  });

  it("reports EMPTY_KEYWORDS for domain rules without keywords", () => {
    const tmp = setupRulesDir();
    const rulesDir = join(tmp, ".claude", "rules");

    writeFileSync(
      join(rulesDir, "empty-kw.md"),
      "---\nid: empty-kw\nkeywords: []\npriority: domain\n---\n\n# Empty KW",
    );
    writeFileSync(
      join(rulesDir, "index.json"),
      JSON.stringify({
        version: "1.0.0",
        generated: new Date().toISOString(),
        entries: [
          {
            id: "empty-kw",
            path: ".claude/rules/empty-kw.md",
            keywords: [],
            patterns: [],
            priority: "domain",
            summary: "No keywords",
            triggers: { task: true, plan: true, edit: false },
            tokens_est: 50,
            lines: 3,
          },
        ],
        budget: {
          always_loaded_est: 0,
          on_demand_total_est: 50,
          avg_task_load_est: 50,
          avg_task_load_observed: null,
        },
      }),
    );

    const issues = validateRules(".claude/rules", tmp);
    const emptyKw = issues.filter((i) => i.code === "EMPTY_KEYWORDS");
    assert.equal(emptyKw.length, 1);
  });

  it("passes clean for valid setup", () => {
    const tmp = setupRulesDir();
    const rulesDir = join(tmp, ".claude", "rules");

    writeFileSync(
      join(rulesDir, "valid.md"),
      "---\nid: valid\nkeywords: [test, example]\npriority: domain\n---\n\n# Valid Rule\nContent here.",
    );
    writeFileSync(
      join(rulesDir, "index.json"),
      JSON.stringify({
        version: "1.0.0",
        generated: new Date().toISOString(),
        entries: [
          {
            id: "valid",
            path: ".claude/rules/valid.md",
            keywords: ["test", "example"],
            patterns: [],
            priority: "domain",
            summary: "A valid test rule",
            triggers: { task: true, plan: true, edit: false },
            tokens_est: 50,
            lines: 4,
          },
        ],
        budget: {
          always_loaded_est: 100,
          on_demand_total_est: 50,
          avg_task_load_est: 50,
          avg_task_load_observed: null,
        },
      }),
    );

    const issues = validateRules(".claude/rules", tmp);
    assert.equal(issues.length, 0);
  });
});
