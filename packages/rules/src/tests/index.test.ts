import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

// ── FT-MR1 + FT-MR2 regression: the library barrel ──────────────
// The barrel must (a) re-export the pure logic + types and (b) be
// side-effect-free: importing it MUST NOT execute the CLI (parse argv, run a
// command, or exit the process). cli.ts self-executes main() as a binary, and
// the logic modules used to import helpers from cli.ts — so without the
// entrypoint guard, `import "@mcptoolshop/claude-rules"` would fire main().

import * as lib from "../index.js";
import {
  analyzeFile,
  classifyPriority,
  extractKeywords,
  generateSummary,
  suggestPatterns,
  generateRuleFile,
  generateIndex,
  generateClaudeMd,
  validateRules,
  loadSignals,
  DEFAULT_SIGNALS,
  DEFAULT_TRIGGERS,
  parseSections,
  estimateTokens,
  headingToId,
} from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX = resolve(__dirname, "..", "index.js");

describe("library barrel (FT-MR1)", () => {
  it("re-exports the pure analyze logic", () => {
    assert.equal(typeof analyzeFile, "function");
    assert.equal(typeof classifyPriority, "function");
    assert.equal(typeof extractKeywords, "function");
    assert.equal(typeof generateSummary, "function");
    assert.equal(typeof suggestPatterns, "function");
  });

  it("re-exports the split file generators", () => {
    assert.equal(typeof generateRuleFile, "function");
    assert.equal(typeof generateIndex, "function");
    assert.equal(typeof generateClaudeMd, "function");
  });

  it("re-exports the validator, signals, and parser core", () => {
    assert.equal(typeof validateRules, "function");
    assert.equal(typeof loadSignals, "function");
    assert.equal(typeof parseSections, "function");
    assert.equal(typeof estimateTokens, "function");
    assert.equal(typeof headingToId, "function");
    assert.ok(DEFAULT_SIGNALS && Array.isArray(DEFAULT_SIGNALS.domainSignals));
    assert.ok(DEFAULT_TRIGGERS && typeof DEFAULT_TRIGGERS === "object");
  });

  it("does NOT export the CLI wrappers or main()", () => {
    // Library consumers should never see the cmdX wrappers or the entrypoint.
    for (const banned of [
      "cmdAnalyze",
      "cmdSplit",
      "cmdValidate",
      "cmdStats",
      "cmdInitSignals",
      "main",
    ]) {
      assert.equal(
        (lib as Record<string, unknown>)[banned],
        undefined,
        `barrel must not export "${banned}"`,
      );
    }
  });

  it("the re-exported pure functions actually work end-to-end", () => {
    // estimateTokens/headingToId are deterministic — exercise them so the
    // barrel proves it re-exports working logic, not just symbols.
    assert.equal(headingToId("GitHub Actions Rules"), "github-actions");
    assert.ok(estimateTokens("hello world") > 0);
    const sections = parseSections("# Title\n\n## A\nbody\n");
    assert.ok(Array.isArray(sections));
  });
});

describe("barrel import is side-effect-free (FT-MR2)", () => {
  it("importing the barrel in this test process did not exit or parse argv", () => {
    // If importing ../index.js had fired main(), an unknown-command argv would
    // have called process.exit() and this test file would never have run. The
    // mere fact that we reached this assertion proves no top-level CLI ran.
    assert.equal(typeof analyzeFile, "function");
  });

  it("a fresh process that only imports the barrel runs NO CLI command", () => {
    // Write a tiny program that ONLY imports the barrel, then spawn it with an
    // argv that — IF the CLI's main() ran on import — would hit the
    // unknown-command branch (fail() → exit 1, "Unknown command" on stderr).
    // Running the program as a real script file means the trailing token lands
    // in process.argv[2] exactly like a real CLI invocation. Success (exit 0,
    // sentinel present, no CLI output) proves the import has no CLI side effect.
    const dir = mkdtempSync(join(tmpdir(), "rules-barrel-"));
    const prog = join(dir, "import-only.mjs");
    writeFileSync(
      prog,
      [
        `import * as lib from ${JSON.stringify(pathToFileURL(INDEX).href)};`,
        `if (typeof lib.analyzeFile !== "function") { console.error("MISSING_EXPORT"); process.exit(3); }`,
        `process.stdout.write("BARREL_OK");`,
      ].join("\n"),
      "utf8",
    );

    const out = execFileSync(
      process.execPath,
      [prog, "this-would-be-an-unknown-command"],
      { encoding: "utf8", timeout: 10000 },
    );

    assert.equal(out, "BARREL_OK", `unexpected output: ${JSON.stringify(out)}`);
    // CLI artifacts that would appear if main() had run:
    assert.ok(!out.includes("Unknown command"), "CLI dispatch must not run on import");
    assert.ok(!out.includes("claude-rules"), "help/version must not print on import");
  });
});
