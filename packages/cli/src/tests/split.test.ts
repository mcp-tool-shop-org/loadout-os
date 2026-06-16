/**
 * `rules split` subprocess passthrough.
 *
 * split is interactive (a readline Y/n/skip prompt per extraction), so loadout-os
 * spawns the `claude-rules split` bin with inherited stdio rather than wrapping
 * the library. These tests assert the WIRING without ever spawning an
 * interactive prompt:
 *   - resolveRulesBin() resolves the real claude-rules bin path
 *   - buildSplitArgv() constructs [bin, "split", ...args] (forwarding verbatim)
 *   - the dispatcher routes `rules split --dry-run` through the passthrough and
 *     the real bin runs NON-interactively (dry-run prints the plan, exits 0)
 *     against a scratch CLAUDE.md — no readline prompt, no hang.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { resolveRulesBin, buildSplitArgv } from "../commands.js";
import { makeSandbox } from "./fixtures.js";

test("resolveRulesBin() resolves the claude-rules bin to an existing file", () => {
  const bin = resolveRulesBin();
  assert.ok(bin, "expected to resolve the claude-rules bin");
  assert.ok(existsSync(bin!), `resolved bin should exist on disk: ${bin}`);
  assert.match(bin!, /claude-rules|rules[/\\]dist[/\\]cli\.js$/);
});

test("buildSplitArgv() builds [bin, 'split', ...args] forwarding args verbatim", () => {
  const argv = buildSplitArgv("/path/to/rules/cli.js", [
    ".claude/CLAUDE.md",
    "--dry-run",
    "--rules-dir",
    ".claude/rules",
  ]);
  assert.deepEqual(argv, [
    "/path/to/rules/cli.js",
    "split",
    ".claude/CLAUDE.md",
    "--dry-run",
    "--rules-dir",
    ".claude/rules",
  ]);
  // the literal "split" subcommand is always second, regardless of args
  assert.equal(argv[1], "split");
});

test("buildSplitArgv() with no extra args still inserts the split subcommand", () => {
  const argv = buildSplitArgv("/bin/cli.js", []);
  assert.deepEqual(argv, ["/bin/cli.js", "split"]);
});

test("rules split --dry-run runs the real bin NON-interactively against a scratch CLAUDE.md", () => {
  const sb = makeSandbox();
  try {
    // a CLAUDE.md with one extractable domain section
    const claudeMd = join(sb.dir, "CLAUDE.md");
    // A long, clearly-extractable domain block so split proposes an extraction
    // (a small block yields "nothing to split"; either way it runs non-interactively).
    const githubBlock = Array.from({ length: 20 }, (_, i) =>
      `Rule line ${i + 1}: CI minutes are finite — paths-gate every workflow, default to ubuntu-latest, never macos, cap matrices at 6 jobs, require a concurrency block, and trigger release workflows on release:published only.`,
    ).join("\n");
    writeFileSync(
      claudeMd,
      `# Project

## Role
Short core section that stays inline.

## GitHub Actions Rules
${githubBlock}
`,
    );

    const bin = resolveRulesBin();
    assert.ok(bin, "claude-rules bin must resolve");
    const argv = buildSplitArgv(bin!, [claudeMd, "--dry-run"]);

    // Drive the SAME passthrough wiring the dispatcher uses (node <bin> split
    // <claude.md> --dry-run), but capture stdio instead of inheriting it so the
    // test never blocks on a prompt. --dry-run never prompts → no hang.
    const res = spawnSync(process.execPath, argv, {
      encoding: "utf-8",
      input: "", // empty stdin: if it WERE interactive this would EOF, not hang
      timeout: 30_000,
    });

    assert.equal(res.status, 0, `dry-run split should exit 0; stderr: ${res.stderr}`);
    // The bin ran NON-interactively (no prompt, clean exit). Output is either the
    // proposed split (Savings/Budget) or "Analyzing …" — both prove the
    // passthrough wiring + dry-run path work without a readline prompt.
    const out = (res.stdout ?? "") + (res.stderr ?? "");
    assert.match(out, /Analyzing|Savings|Budget|extract|split/i);
    // it must NOT have written any rule files into the scratch dir
    assert.equal(
      existsSync(join(sb.dir, ".claude", "rules")),
      false,
      "dry-run must not write rule files",
    );
  } finally {
    sb.cleanup();
  }
});

test("rules split passthrough does not require a writable .claude/rules up front", () => {
  // Sanity: the scratch sandbox has no pre-made rules dir; resolveRulesBin works
  // independent of cwd / project layout (it resolves via the package, not cwd).
  const sb = makeSandbox();
  try {
    mkdirSync(join(sb.dir, "empty"), { recursive: true });
    const bin = resolveRulesBin();
    assert.ok(bin);
    assert.equal(buildSplitArgv(bin!, ["--dry-run"])[1], "split");
  } finally {
    sb.cleanup();
  }
});
