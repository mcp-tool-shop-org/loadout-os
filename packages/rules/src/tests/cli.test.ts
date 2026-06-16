import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { positionalArgs, flagValue } from "../console.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "..", "cli.js");

function run(...args: string[]): string {
  return execFileSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    timeout: 5000,
  });
}

// Runs the CLI expecting a non-zero exit; returns combined status + stderr.
function runExpectFail(...args: string[]): { status: number; stderr: string } {
  try {
    execFileSync(process.execPath, [CLI, ...args], {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stderr?: string };
    return { status: err.status ?? -1, stderr: err.stderr ?? "" };
  }
}

describe("CLI flags", () => {
  it("--version prints tool name and version", () => {
    const out = run("--version");
    assert.match(out, /^claude-rules \d+\.\d+\.\d+/);
  });

  it("-V prints tool name and version", () => {
    const out = run("-V");
    assert.match(out, /^claude-rules \d+\.\d+\.\d+/);
  });

  it("--help includes Usage section", () => {
    const out = run("--help");
    assert.ok(out.includes("Usage:"));
    assert.ok(out.includes("--json"));
    assert.ok(out.includes("--version"));
  });

  it("-h prints help", () => {
    const out = run("-h");
    assert.ok(out.includes("Usage:"));
  });
});

describe("positionalArgs", () => {
  it("does not mis-parse a value-flag's argument as positional (analyze --rules-dir <dir> <path>)", () => {
    // Regression for RUL-001/002: `--rules-dir foo path` must yield only `path`,
    // not `["foo", "path"]`, regardless of flag ordering.
    const args = ["--rules-dir", "custom/rules", "CLAUDE.md"];
    assert.deepEqual(positionalArgs(args, ["--rules-dir", "--signals"]), [
      "CLAUDE.md",
    ]);
  });

  it("handles the path-before-flag ordering too", () => {
    const args = ["CLAUDE.md", "--rules-dir", "custom/rules"];
    assert.deepEqual(positionalArgs(args, ["--rules-dir", "--signals"]), [
      "CLAUDE.md",
    ]);
  });

  it("skips known value-flags even when the caller omits them", () => {
    // VALUE_FLAGS is the single source of truth; --signals is skipped even
    // though only --rules-dir was passed by the caller.
    const args = ["--signals", "sig.json", "CLAUDE.md"];
    assert.deepEqual(positionalArgs(args, ["--rules-dir"]), ["CLAUDE.md"]);
  });

  it("drops boolean flags without consuming the next arg", () => {
    const args = ["--dry-run", "CLAUDE.md"];
    assert.deepEqual(positionalArgs(args, []), ["CLAUDE.md"]);
  });
});

describe("flagValue bounds safety", () => {
  it("returns undefined when a value-flag is the last argument", () => {
    // Regression for RUL-001: `analyze --rules-dir` (no value) must not read
    // past the end of the array.
    assert.equal(flagValue(["--rules-dir"], "--rules-dir"), undefined);
  });

  it("returns the value when present", () => {
    assert.equal(
      flagValue(["--rules-dir", "custom/rules"], "--rules-dir"),
      "custom/rules",
    );
  });

  it("returns undefined when the next token is itself a flag (RUL-B6)", () => {
    // `split --rules-dir --dry-run` must NOT treat `--dry-run` as the value —
    // doing so would create a directory literally named "--dry-run".
    assert.equal(
      flagValue(["--rules-dir", "--dry-run"], "--rules-dir"),
      undefined,
    );
    assert.equal(
      flagValue(["split", "--signals", "--lazy"], "--signals"),
      undefined,
    );
  });
});

describe("--lazy directory awareness (RUL-B2)", () => {
  // Build a CLAUDE.md with one fat, extractable section so split has work to do.
  function writeClaudeMd(dir: string): string {
    const claudeMd = join(dir, "CLAUDE.md");
    const content = [
      "# Project",
      "",
      "## GitHub Actions Rules",
      "CI minutes are finite. Every workflow must be paths-gated.",
      ...Array(20).fill("Detail line for a long extractable section."),
    ].join("\n");
    writeFileSync(claudeMd, content, "utf8");
    return claudeMd;
  }

  it("validate --lazy reads .claude/loadout after a lazy split (no false MISSING_INDEX)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "lazy-validate-"));
    // split resolves the rules dir relative to the file's parent's parent, so
    // place CLAUDE.md under <tmp>/.claude/CLAUDE.md → loadout at <tmp>/.claude/loadout.
    const claudeDir = join(tmp, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    const claudeMd = writeClaudeMd(claudeDir);

    // Lazy split writes rule files + index.json under .claude/loadout/.
    execFileSync(process.execPath, [CLI, "split", "--lazy", "--yes", claudeMd], {
      encoding: "utf8",
      timeout: 10000,
      cwd: tmp,
    });

    // validate --lazy must find the index there and NOT report MISSING_INDEX.
    const out = execFileSync(
      process.execPath,
      [CLI, "validate", "--lazy"],
      { encoding: "utf8", timeout: 10000, cwd: tmp },
    );
    assert.ok(
      !out.includes("MISSING_INDEX"),
      `validate --lazy should not report MISSING_INDEX, got:\n${out}`,
    );
    assert.ok(out.includes(".claude/loadout"), "should validate the loadout dir");
  });

  it("validate WITHOUT --lazy still looks at .claude/rules (false MISSING_INDEX reproduces the bug)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "lazy-validate-default-"));
    const claudeDir = join(tmp, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    const claudeMd = writeClaudeMd(claudeDir);

    execFileSync(process.execPath, [CLI, "split", "--lazy", "--yes", claudeMd], {
      encoding: "utf8",
      timeout: 10000,
      cwd: tmp,
    });

    // Without --lazy, validate defaults to .claude/rules (empty) → MISSING_INDEX,
    // exit 1. This documents that --lazy is required to match the lazy split.
    const { status, out } = (() => {
      try {
        const o = execFileSync(process.execPath, [CLI, "validate"], {
          encoding: "utf8",
          timeout: 10000,
          cwd: tmp,
        });
        return { status: 0, out: o };
      } catch (e) {
        const err = e as { status?: number; stdout?: string };
        return { status: err.status ?? -1, out: err.stdout ?? "" };
      }
    })();
    assert.equal(status, 1);
    assert.ok(out.includes("MISSING_INDEX"), `expected MISSING_INDEX, got:\n${out}`);
  });
});

describe("analyze command --rules-dir ordering (end-to-end)", () => {
  it("honors --rules-dir <dir> <path> ordering in proposal paths", () => {
    const tmp = mkdtempSync(join(tmpdir(), "analyze-cli-"));
    const claudeMd = join(tmp, "CLAUDE.md");
    const content = [
      "# Project",
      "",
      "## GitHub Actions Rules",
      "CI minutes are finite. Every workflow must be paths-gated.",
      ...Array(15).fill("Detail line for a long extractable section."),
    ].join("\n");
    writeFileSync(claudeMd, content, "utf8");

    // Flag BEFORE the positional path — the exact ordering that previously
    // mis-parsed (RUL-001/002).
    const out = run("analyze", "--rules-dir", "my/custom/dir", claudeMd);
    assert.ok(
      out.includes("my/custom/dir/"),
      `expected proposal path under my/custom/dir, got:\n${out}`,
    );
    // The bug would have produced "undefined/<id>.md" when --rules-dir was last;
    // assert that never leaks here either.
    assert.ok(!out.includes("undefined/"), "rulesDir resolved to undefined");
  });
});

describe("malformed signals.json (RUL-005)", () => {
  it("emits a structured INVALID_SIGNALS error instead of a raw RUNTIME_FATAL", () => {
    const tmp = mkdtempSync(join(tmpdir(), "bad-signals-"));
    const claudeMd = join(tmp, "CLAUDE.md");
    writeFileSync(claudeMd, "# Project\n\n## Role\nML partner.\n", "utf8");
    const badSignals = join(tmp, "signals.json");
    writeFileSync(badSignals, "{ this is not valid json ", "utf8");

    const { status, stderr } = runExpectFail(
      "analyze",
      "--signals",
      badSignals,
      claudeMd,
    );
    // Structured, non-fatal classification (exit 1 via fail()), not the
    // catch-all RUNTIME_FATAL (exit 2) the unguarded parse produced.
    assert.equal(status, 1);
    assert.ok(
      stderr.includes("INVALID_SIGNALS"),
      `expected INVALID_SIGNALS code, got:\n${stderr}`,
    );
    assert.ok(
      !stderr.includes("RUNTIME_FATAL"),
      "should not surface as RUNTIME_FATAL",
    );
  });
});
