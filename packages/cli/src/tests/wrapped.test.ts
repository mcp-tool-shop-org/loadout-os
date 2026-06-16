/**
 * Wrapped surfaces: the namespaced (memories/rules) and flat (kernel) verbs
 * each dispatch into the right library and render. We drive them via the public
 * dispatcher with --json and parse the output to confirm the call landed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { dispatch } from "../cli.js";
import { CliError } from "../console.js";
import { makeSandbox, captureLog } from "./fixtures.js";

// ── memories namespace ─────────────────────────────────────────

test("memories validate <MEMORY.md> --json validates the synthetic store", () => {
  const sb = makeSandbox({ withCore: true });
  try {
    const out = captureLog(() => dispatch(["memories", "validate", sb.memoryMd, "--json"]));
    const parsed = JSON.parse(out);
    assert.equal(typeof parsed.valid, "boolean");
    assert.ok(Array.isArray(parsed.issues));
    // the synthetic store resolves its one ref → no MISSING_TOPIC_FILE error
    const missing = parsed.issues.filter((i: { code: string }) => i.code === "MISSING_TOPIC_FILE");
    assert.equal(missing.length, 0);
  } finally {
    sb.cleanup();
  }
});

test("memories index <MEMORY.md> --json builds a dispatch index", () => {
  const sb = makeSandbox({ withCore: true });
  try {
    const out = captureLog(() => dispatch(["memories", "index", sb.memoryMd, "--json"]));
    const parsed = JSON.parse(out);
    assert.ok(parsed.index);
    assert.ok(Array.isArray(parsed.index.entries));
    // the one referenced topic file becomes an entry
    const ids = parsed.index.entries.map((e: { id: string }) => e.id);
    assert.ok(ids.includes("sample-topic"));
  } finally {
    sb.cleanup();
  }
});

test("memories stats <MEMORY.md> --json reports a token budget", () => {
  const sb = makeSandbox({ withCore: true });
  try {
    const out = captureLog(() => dispatch(["memories", "stats", sb.memoryMd, "--json"]));
    const parsed = JSON.parse(out);
    assert.equal(typeof parsed.totalTokens, "number");
    assert.equal(typeof parsed.entryCount, "number");
  } finally {
    sb.cleanup();
  }
});

test("memories health --json reports node + detection", () => {
  const out = captureLog(() => dispatch(["memories", "health", "--json"]));
  const parsed = JSON.parse(out);
  assert.equal(typeof parsed.nodeOk, "boolean");
  assert.ok(Array.isArray(parsed.checked));
});

test("memories index with no path throws MISSING_ARG", () => {
  assert.throws(
    () => dispatch(["memories", "index"]),
    (err: unknown) => err instanceof CliError && err.code === "MISSING_ARG",
  );
});

// ── rules namespace ────────────────────────────────────────────

test("rules analyze <CLAUDE.md> --json analyzes a section file", () => {
  const sb = makeSandbox();
  try {
    // a CLAUDE.md with one large domain-ish section to extract
    const claudeMd = join(sb.dir, "CLAUDE.md");
    writeFileSync(
      claudeMd,
      `# Project

## Role
Short core section.

## GitHub Actions Rules
CI minutes are finite. Every workflow must be paths-gated and right-sized.
Use on.push.paths filters. Default to ubuntu-latest. Avoid macos-latest.
Concurrency block required. Max 2 workflow files. Paths-gated triggers only.
Release workflows trigger on release published. Dependabot is opt-in only.
Matrices capped at 6 jobs. Node versions 2-3 max. This is a long domain block.
`,
    );
    const out = captureLog(() => dispatch(["rules", "analyze", claudeMd, "--json"]));
    const parsed = JSON.parse(out);
    assert.equal(typeof parsed.totalLines, "number");
    assert.ok(Array.isArray(parsed.sections));
    assert.ok(Array.isArray(parsed.proposals));
  } finally {
    sb.cleanup();
  }
});

test("rules validate --json against a synthetic rules dir", () => {
  const sb = makeSandbox();
  try {
    // build a .claude/rules with a matching index + rule file
    const rulesDir = join(sb.dir, ".claude", "rules");
    mkdirSync(rulesDir, { recursive: true });
    writeFileSync(
      join(rulesDir, "sample.md"),
      `---
id: sample
keywords: [alpha, beta]
patterns: []
priority: domain
triggers:
  task: true
  plan: true
  edit: false
---

# Sample
Body.
`,
    );
    const ruleIndex = {
      version: "1.0.0",
      generated: new Date().toISOString(),
      entries: [
        {
          id: "sample",
          path: ".claude/rules/sample.md",
          keywords: ["alpha", "beta"],
          patterns: [],
          priority: "domain",
          summary: "a sample rule",
          triggers: { task: true, plan: true, edit: false },
          tokens_est: 10,
          lines: 12,
        },
      ],
      budget: { always_loaded_est: 0, on_demand_total_est: 10, avg_task_load_est: 10, avg_task_load_observed: null },
    };
    writeFileSync(join(rulesDir, "index.json"), JSON.stringify(ruleIndex, null, 2));

    const out = captureLog(() =>
      dispatch(["rules", "validate", "--repo-root", sb.dir, "--rules-dir", ".claude/rules", "--json"]),
    );
    const parsed = JSON.parse(out);
    assert.equal(typeof parsed.valid, "boolean");
    assert.equal(parsed.valid, true, "matching index+frontmatter should validate clean");
  } finally {
    sb.cleanup();
  }
});

// ── flat kernel verbs ──────────────────────────────────────────

test("validate <index> --json is the KERNEL structure validator", () => {
  const sb = makeSandbox({ withCore: true });
  try {
    const out = captureLog(() => dispatch(["validate", sb.indexPath, "--json"]));
    const parsed = JSON.parse(out);
    assert.equal(parsed.valid, true);
    assert.equal(typeof parsed.errors, "number");
  } finally {
    sb.cleanup();
  }
});

test("budget <index> --json breaks down tokens by tier", () => {
  const sb = makeSandbox({ withCore: true });
  try {
    const out = captureLog(() => dispatch(["budget", sb.indexPath, "--json"]));
    const parsed = JSON.parse(out);
    assert.equal(typeof parsed.totalTokens, "number");
    assert.equal(parsed.coreEntries, 1);
  } finally {
    sb.cleanup();
  }
});

test("overlaps <index> --json finds shared keywords", () => {
  const sb = makeSandbox({ withCore: true });
  try {
    const out = captureLog(() => dispatch(["overlaps", sb.indexPath, "--json"]));
    const parsed = JSON.parse(out);
    assert.ok(Array.isArray(parsed));
  } finally {
    sb.cleanup();
  }
});

test("dead <index> <jsonl> --json finds never-loaded entries", () => {
  const sb = makeSandbox({ withUsage: true, withCore: true });
  try {
    const out = captureLog(() => dispatch(["dead", sb.indexPath, sb.usagePath, "--json"]));
    const parsed = JSON.parse(out);
    assert.ok(Array.isArray(parsed));
    assert.ok(parsed.some((d: { id: string }) => d.id === "never-loaded"));
  } finally {
    sb.cleanup();
  }
});

test("usage <jsonl> --json summarizes the event log", () => {
  const sb = makeSandbox({ withUsage: true, withCore: true });
  try {
    const out = captureLog(() => dispatch(["usage", sb.usagePath, "--json"]));
    const parsed = JSON.parse(out);
    assert.ok(Array.isArray(parsed));
    assert.ok(parsed.some((u: { entryId: string }) => u.entryId === "sample-topic"));
  } finally {
    sb.cleanup();
  }
});

test("validate <index> on a non-index JSON throws INVALID_INDEX", () => {
  const sb = makeSandbox();
  try {
    const bad = join(sb.dir, "bad.json");
    writeFileSync(bad, JSON.stringify({ not: "an index" }));
    assert.throws(
      () => dispatch(["validate", bad]),
      (err: unknown) => err instanceof CliError && err.code === "INVALID_INDEX",
    );
  } finally {
    sb.cleanup();
  }
});

test("validate <index> on a missing file throws FILE_NOT_FOUND", () => {
  assert.throws(
    () => dispatch(["validate", "/no/such/index.json"]),
    (err: unknown) => err instanceof CliError && err.code === "FILE_NOT_FOUND",
  );
});
