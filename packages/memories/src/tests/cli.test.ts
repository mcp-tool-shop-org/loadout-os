import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "cli.js");
const FIXTURES = join(__dirname, "..", "..", "src", "tests", "fixtures");

/**
 * Run the CLI and capture stdout, stderr, and exit status.
 * execFileSync throws on a non-zero exit; we normalize both paths into a
 * single shape so tests can assert on code + streams uniformly.
 */
function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("node", [CLI, ...args], { encoding: "utf8" });
    return { status: 0, stdout, stderr: "" };
  } catch (err: any) {
    return {
      status: typeof err.status === "number" ? err.status : 1,
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? "",
    };
  }
}

// ── MEM-B01: no raw stacks; structured fail on read failure ───────────
describe("cli error routing (MEM-B01)", () => {
  it("routes a read failure through structured fail, not a raw stack", () => {
    const res = runCli(["analyze", join(FIXTURES, "nope", "MEMORY.md")]);
    assert.equal(res.status, 1, "should exit 1");
    // The structured fail() prefix is "✗ [CODE] message"; a raw V8 stack would
    // instead contain "at " frames and "Error:" with a file:line trace.
    assert.match(res.stderr, /\[(FILE_NOT_FOUND|READ_FAILED)\]/);
    assert.doesNotMatch(res.stderr, /\n\s+at .+:\d+:\d+/, "no V8 stack frames");
  });

  it("a forced read failure on an existing-but-unreadable shape exits cleanly", () => {
    // Point analyze at a directory via an explicit path: resolveMemoryMd's
    // NOT_A_FILE guard (MEM-B02) catches it, but even if it reached readFileSync
    // the EISDIR would be classified to READ_FAILED rather than a raw throw.
    const res = runCli(["analyze", FIXTURES]); // FIXTURES is a directory
    assert.equal(res.status, 1);
    assert.match(res.stderr, /\[(NOT_A_FILE|READ_FAILED)\]/);
    assert.doesNotMatch(res.stderr, /\n\s+at .+:\d+:\d+/, "no V8 stack frames");
  });
});

// ── MEM-B02: directory path is rejected with NOT_A_FILE, never EISDIR ──
describe("resolveMemoryMd directory guard (MEM-B02)", () => {
  it("rejects an explicit directory path with NOT_A_FILE + hint", () => {
    const res = runCli(["analyze", FIXTURES]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /\[NOT_A_FILE\]/);
    assert.match(res.stderr, /not a directory/);
    // Crucially: not a raw EISDIR escaping from readFileSync.
    assert.doesNotMatch(res.stderr, /EISDIR/);
  });

  it("still accepts a real MEMORY.md file", () => {
    const res = runCli(["analyze", join(FIXTURES, "MEMORY.md")]);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /Analyzing/);
  });
});

// ── MEM-B05: a flag value must not be the next flag ───────────────────
describe("flagValue guard (MEM-B05)", () => {
  it("rejects `index --out --lazy` instead of writing a file named --lazy", () => {
    const res = runCli(["index", join(FIXTURES, "MEMORY.md"), "--out", "--lazy"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /\[MISSING_FLAG_VALUE\]/);
    assert.match(res.stderr, /--out needs a path/);
    // The bug we're guarding: a file literally named "--lazy" must not appear.
    assert.ok(
      !readdirSync(process.cwd()).includes("--lazy"),
      "must not have written a file named --lazy in cwd",
    );
  });

  it("accepts a real --out path", () => {
    const dir = mkdtempSync(join(tmpdir(), "mem-cli-"));
    try {
      const out = join(dir, "index.json");
      const res = runCli(["index", join(FIXTURES, "MEMORY.md"), "--out", out]);
      assert.equal(res.status, 0);
      assert.match(res.stdout, /Index written/);
      assert.ok(readdirSync(dir).includes("index.json"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── MEM-B03: CLI renders one-line unresolved-ref summary; no lib noise ─
describe("unresolved-ref summary (MEM-B03)", () => {
  it("cmdIndex prints a one-line summary pointing at validate", () => {
    const dir = mkdtempSync(join(tmpdir(), "mem-cli-"));
    try {
      const out = join(dir, "index.json");
      // The fixture has unresolved refs (nullout.md, xrpl-lab.md, …).
      const res = runCli(["index", join(FIXTURES, "MEMORY.md"), "--out", out]);
      assert.equal(res.status, 0);
      assert.match(res.stdout, /unresolved ref/);
      assert.match(res.stdout, /run `validate` for detail/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("library generateIndex emits nothing to stderr for unresolved refs", () => {
    const dir = mkdtempSync(join(tmpdir(), "mem-cli-"));
    try {
      const out = join(dir, "index.json");
      const res = runCli(["index", join(FIXTURES, "MEMORY.md"), "--out", out]);
      // The library used to console.warn per unresolved ref. With MEM-B03 the
      // library stays quiet; only the CLI's one-line summary (on stdout) shows.
      assert.doesNotMatch(res.stderr, /\[claude-memories\] unresolved ref/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a clean MEMORY.md with all refs resolved prints no unresolved summary", () => {
    const dir = mkdtempSync(join(tmpdir(), "mem-clean-"));
    try {
      // MEMORY.md references one real, on-disk topic file and nothing missing.
      writeFileSync(
        join(dir, "topic.md"),
        "# Topic\nSome content for the topic file.\n",
      );
      writeFileSync(
        join(dir, "MEMORY.md"),
        "# Mem\n\n## Active\n\nTopic — a real topic → `topic.md`\n",
      );
      const res = runCli(["index", join(dir, "MEMORY.md"), "--out", join(dir, "out.json")]);
      assert.equal(res.status, 0);
      assert.doesNotMatch(res.stdout, /unresolved ref/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
