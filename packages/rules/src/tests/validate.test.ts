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

  it("reports DRIFT_PRIORITY when frontmatter priority differs from index", () => {
    const tmp = setupRulesDir();
    const rulesDir = join(tmp, ".claude", "rules");

    // Frontmatter says core; index says domain → priority drift (warning).
    writeFileSync(
      join(rulesDir, "prio.md"),
      "---\nid: prio\nkeywords: [alpha]\npriority: core\n---\n\n# Prio",
    );
    writeFileSync(
      join(rulesDir, "index.json"),
      JSON.stringify({
        version: "1.0.0",
        generated: new Date().toISOString(),
        entries: [
          {
            id: "prio",
            path: ".claude/rules/prio.md",
            keywords: ["alpha"],
            patterns: [],
            priority: "domain",
            summary: "Priority drift rule",
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
    const drift = issues.filter((i) => i.code === "DRIFT_PRIORITY");
    assert.equal(drift.length, 1);
    assert.equal(drift[0].severity, "warning");
  });

  it("reports DRIFT_KEYWORDS when frontmatter keywords differ from index", () => {
    const tmp = setupRulesDir();
    const rulesDir = join(tmp, ".claude", "rules");

    // Frontmatter keywords [alpha, beta] vs index [alpha] → keyword drift.
    writeFileSync(
      join(rulesDir, "kw.md"),
      "---\nid: kw\nkeywords: [alpha, beta]\npriority: domain\n---\n\n# KW",
    );
    writeFileSync(
      join(rulesDir, "index.json"),
      JSON.stringify({
        version: "1.0.0",
        generated: new Date().toISOString(),
        entries: [
          {
            id: "kw",
            path: ".claude/rules/kw.md",
            keywords: ["alpha"],
            patterns: [],
            priority: "domain",
            summary: "Keyword drift rule",
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
    const drift = issues.filter((i) => i.code === "DRIFT_KEYWORDS");
    assert.equal(drift.length, 1);
    assert.equal(drift[0].severity, "warning");
  });

  it("reports DUPLICATE_ID when two entries share an id", () => {
    const tmp = setupRulesDir();
    const rulesDir = join(tmp, ".claude", "rules");

    const fm = "---\nid: dup\nkeywords: [alpha]\npriority: domain\n---\n\n# Dup";
    writeFileSync(join(rulesDir, "dup-a.md"), fm);
    writeFileSync(join(rulesDir, "dup-b.md"), fm);
    writeFileSync(
      join(rulesDir, "index.json"),
      JSON.stringify({
        version: "1.0.0",
        generated: new Date().toISOString(),
        entries: [
          {
            id: "dup",
            path: ".claude/rules/dup-a.md",
            keywords: ["alpha"],
            patterns: [],
            priority: "domain",
            summary: "First dup",
            triggers: { task: true, plan: true, edit: false },
            tokens_est: 50,
            lines: 3,
          },
          {
            id: "dup",
            path: ".claude/rules/dup-b.md",
            keywords: ["beta"],
            patterns: [],
            priority: "domain",
            summary: "Second dup",
            triggers: { task: true, plan: true, edit: false },
            tokens_est: 50,
            lines: 3,
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
    const dupes = issues.filter((i) => i.code === "DUPLICATE_ID");
    assert.equal(dupes.length, 1);
    assert.equal(dupes[0].severity, "error");
  });

  it("reports DUPLICATE_KEYWORD when a keyword spans multiple rules", () => {
    const tmp = setupRulesDir();
    const rulesDir = join(tmp, ".claude", "rules");

    writeFileSync(
      join(rulesDir, "a.md"),
      "---\nid: a\nkeywords: [shared]\npriority: domain\n---\n\n# A",
    );
    writeFileSync(
      join(rulesDir, "b.md"),
      "---\nid: b\nkeywords: [shared]\npriority: domain\n---\n\n# B",
    );
    writeFileSync(
      join(rulesDir, "index.json"),
      JSON.stringify({
        version: "1.0.0",
        generated: new Date().toISOString(),
        entries: [
          {
            id: "a",
            path: ".claude/rules/a.md",
            keywords: ["shared"],
            patterns: [],
            priority: "domain",
            summary: "Rule A",
            triggers: { task: true, plan: true, edit: false },
            tokens_est: 50,
            lines: 3,
          },
          {
            id: "b",
            path: ".claude/rules/b.md",
            keywords: ["shared"],
            patterns: [],
            priority: "domain",
            summary: "Rule B",
            triggers: { task: true, plan: true, edit: false },
            tokens_est: 50,
            lines: 3,
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
    const dupKw = issues.filter((i) => i.code === "DUPLICATE_KEYWORD");
    assert.equal(dupKw.length, 1);
    assert.equal(dupKw[0].severity, "warning");
  });

  it("reports MISSING_SUMMARY when an entry has an empty summary", () => {
    const tmp = setupRulesDir();
    const rulesDir = join(tmp, ".claude", "rules");

    writeFileSync(
      join(rulesDir, "nosum.md"),
      "---\nid: nosum\nkeywords: [alpha]\npriority: domain\n---\n\n# NoSum",
    );
    writeFileSync(
      join(rulesDir, "index.json"),
      JSON.stringify({
        version: "1.0.0",
        generated: new Date().toISOString(),
        entries: [
          {
            id: "nosum",
            path: ".claude/rules/nosum.md",
            keywords: ["alpha"],
            patterns: [],
            priority: "domain",
            summary: "",
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
    const missing = issues.filter((i) => i.code === "MISSING_SUMMARY");
    assert.equal(missing.length, 1);
    assert.equal(missing[0].severity, "error");
  });

  it("reports LONG_SUMMARY when a summary exceeds 120 chars", () => {
    const tmp = setupRulesDir();
    const rulesDir = join(tmp, ".claude", "rules");

    const longSummary = "x".repeat(150);
    writeFileSync(
      join(rulesDir, "long.md"),
      "---\nid: long\nkeywords: [alpha]\npriority: domain\n---\n\n# Long",
    );
    writeFileSync(
      join(rulesDir, "index.json"),
      JSON.stringify({
        version: "1.0.0",
        generated: new Date().toISOString(),
        entries: [
          {
            id: "long",
            path: ".claude/rules/long.md",
            keywords: ["alpha"],
            patterns: [],
            priority: "domain",
            summary: longSummary,
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
    const long = issues.filter((i) => i.code === "LONG_SUMMARY");
    assert.equal(long.length, 1);
    assert.equal(long[0].severity, "warning");
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
