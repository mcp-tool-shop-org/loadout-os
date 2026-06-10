import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateRuleFile, generateIndex, generateClaudeMd } from "../split.js";
import { parseFrontmatter } from "../parser.js";
import { DEFAULT_TRIGGERS } from "../types.js";
import type { Section, SplitProposal } from "../types.js";

// ── Helpers ──────────────────────────────────────────────────
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

function makeProposal(overrides: Partial<SplitProposal> = {}): SplitProposal {
  const section = overrides.section ?? makeSection(
    "GitHub Actions Rules (Non-Negotiable)",
    "## GitHub Actions Rules (Non-Negotiable)\nCI minutes are finite.\nEvery workflow must be paths-gated.",
    3,
  );
  return {
    section,
    suggestedId: "github-actions",
    suggestedPath: ".claude/rules/github-actions.md",
    suggestedKeywords: ["github", "actions", "workflow"],
    suggestedPatterns: ["ci_pipeline"],
    suggestedPriority: "domain",
    suggestedSummary: "CI minutes are finite. Every workflow must be paths-gated.",
    reason: "15 lines — too large to load every session",
    ...overrides,
  };
}

// ── generateRuleFile ─────────────────────────────────────────
describe("generateRuleFile", () => {
  it("produces valid frontmatter with correct metadata", () => {
    const proposal = makeProposal();
    const output = generateRuleFile(proposal);

    assert.ok(output.startsWith("---\n"));

    const { frontmatter } = parseFrontmatter(output);
    assert.ok(frontmatter);
    assert.equal(frontmatter.id, "github-actions");
    assert.deepEqual(frontmatter.keywords, ["github", "actions", "workflow"]);
    assert.deepEqual(frontmatter.patterns, ["ci_pipeline"]);
    assert.equal(frontmatter.priority, "domain");
  });

  it("includes original section content in body", () => {
    const proposal = makeProposal();
    const output = generateRuleFile(proposal);

    assert.ok(output.includes("CI minutes are finite"));
    assert.ok(output.includes("Every workflow must be paths-gated"));
  });

  it("uses DEFAULT_TRIGGERS", () => {
    const proposal = makeProposal();
    const output = generateRuleFile(proposal);

    const { frontmatter } = parseFrontmatter(output);
    assert.ok(frontmatter);
    assert.deepEqual(frontmatter.triggers, DEFAULT_TRIGGERS);
  });

  it("ends with a newline", () => {
    const proposal = makeProposal();
    const output = generateRuleFile(proposal);
    assert.ok(output.endsWith("\n"));
  });
});

// ── generateIndex ────────────────────────────────────────────
describe("generateIndex", () => {
  it("creates entries from accepted proposals", () => {
    const proposals = [makeProposal()];
    const index = generateIndex(proposals, 200);

    assert.equal(index.version, "1.0.0");
    assert.equal(index.entries.length, 1);
    assert.equal(index.entries[0].id, "github-actions");
    assert.equal(index.entries[0].path, ".claude/rules/github-actions.md");
    assert.deepEqual(index.entries[0].keywords, ["github", "actions", "workflow"]);
    assert.equal(index.entries[0].priority, "domain");
  });

  it("calculates budget correctly", () => {
    const p1 = makeProposal({ suggestedId: "a" });
    p1.section = makeSection("A", "## A\n" + "x\n".repeat(10), 11);
    const p2 = makeProposal({ suggestedId: "b" });
    p2.section = makeSection("B", "## B\n" + "y\n".repeat(10), 11);

    const index = generateIndex([p1, p2], 500);

    assert.equal(index.budget.always_loaded_est, 500);
    const expectedOnDemand = p1.section.tokens_est + p2.section.tokens_est;
    assert.equal(index.budget.on_demand_total_est, expectedOnDemand);
    assert.equal(index.budget.avg_task_load_est, Math.round(expectedOnDemand / 2));
    assert.equal(index.budget.avg_task_load_observed, null);
  });

  it("handles empty proposals", () => {
    const index = generateIndex([], 100);
    assert.equal(index.entries.length, 0);
    assert.equal(index.budget.on_demand_total_est, 0);
    assert.equal(index.budget.avg_task_load_est, 0);
  });

  it("includes summary and token estimate per entry", () => {
    const proposal = makeProposal();
    const index = generateIndex([proposal], 100);
    assert.equal(index.entries[0].summary, proposal.suggestedSummary);
    assert.equal(index.entries[0].tokens_est, proposal.section.tokens_est);
    assert.equal(index.entries[0].lines, proposal.section.lines);
  });
});

// ── generateClaudeMd ─────────────────────────────────────────
describe("generateClaudeMd", () => {
  it("preserves core sections content", () => {
    const core = [
      makeSection("(preamble)", "# Claude Memory\nML Partner."),
      makeSection("Role", "## Role\nShort role description."),
    ];
    const accepted = [makeProposal()];
    const index = generateIndex(accepted, 100);

    const output = generateClaudeMd(core, accepted, index, ".claude/rules");

    assert.ok(output.includes("# Claude Memory"));
    assert.ok(output.includes("ML Partner"));
    assert.ok(output.includes("## Role"));
  });

  it("generates Rules Index table", () => {
    const core = [makeSection("(preamble)", "# Title")];
    const accepted = [makeProposal()];
    const index = generateIndex(accepted, 100);

    const output = generateClaudeMd(core, accepted, index, ".claude/rules");

    assert.ok(output.includes("## Rules Index"));
    assert.ok(output.includes("| Topic | Keywords | Priority | File |"));
    assert.ok(output.includes("github-actions"));
    assert.ok(output.includes("`.claude/rules/github-actions.md`"));
  });

  it("includes dispatch instruction text", () => {
    const core: Section[] = [];
    const accepted = [makeProposal()];
    const index = generateIndex(accepted, 0);

    const output = generateClaudeMd(core, accepted, index, ".claude/rules");

    assert.ok(output.includes("dispatch table is at"));
    assert.ok(output.includes("When a task matches"));
  });

  it("strips trailing --- from core sections", () => {
    const core = [makeSection("Test", "## Test\nContent\n---")];
    const output = generateClaudeMd(core, [], generateIndex([], 0), ".claude/rules");

    const dashes = output.match(/^---$/gm);
    assert.equal(dashes?.length, 1);
  });

  it("uses original heading in topic column", () => {
    const proposal = makeProposal();
    const core: Section[] = [];
    const index = generateIndex([proposal], 0);
    const output = generateClaudeMd(core, [proposal], index, ".claude/rules");

    assert.ok(output.includes("GitHub Actions Rules (Non-Negotiable)"));
  });
});

// ── Lazy loading ──────────────────────────────────────────────
describe("generateIndex with lazyLoad", () => {
  it("sets lazyLoad: true when enabled", () => {
    const proposals = [makeProposal()];
    const index = generateIndex(proposals, 200, true);

    assert.equal(index.lazyLoad, true);
  });

  it("omits lazyLoad when disabled (default)", () => {
    const proposals = [makeProposal()];
    const index = generateIndex(proposals, 200);

    assert.equal(index.lazyLoad, undefined);
  });

  it("omits lazyLoad when explicitly false", () => {
    const proposals = [makeProposal()];
    const index = generateIndex(proposals, 200, false);

    assert.equal(index.lazyLoad, undefined);
  });
});

describe("generateClaudeMd with lazyLoad", () => {
  it("uses eager instruction text by default", () => {
    const core: Section[] = [];
    const accepted = [makeProposal()];
    const index = generateIndex(accepted, 0);

    const output = generateClaudeMd(core, accepted, index, ".claude/rules");

    assert.ok(output.includes("When a task matches"));
    assert.ok(!output.includes("NOT pre-loaded"));
  });

  it("uses lazy instruction text when lazyLoad is true", () => {
    const core: Section[] = [];
    const accepted = [makeProposal()];
    const index = generateIndex(accepted, 0, true);

    const output = generateClaudeMd(core, accepted, index, ".claude/loadout", true);

    assert.ok(output.includes("NOT pre-loaded"));
    assert.ok(output.includes("use the Read tool"));
    assert.ok(output.includes(".claude/loadout"));
  });

  it("references loadout directory in lazy mode", () => {
    const core: Section[] = [];
    const accepted = [makeProposal({ suggestedPath: ".claude/loadout/github-actions.md" })];
    const index = generateIndex(accepted, 0, true);

    const output = generateClaudeMd(core, accepted, index, ".claude/loadout", true);

    assert.ok(output.includes("`.claude/loadout/`"));
    assert.ok(output.includes("`.claude/loadout/index.json`"));
  });
});
