import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadSignals, DEFAULT_SIGNALS, generateDefaultSignalsJson } from "../signals.js";
import { extractKeywords } from "../analyze.js";
import type { Section } from "../types.js";

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

// ── loadSignals ──────────────────────────────────────────────
describe("loadSignals", () => {
  it("returns defaults when no file exists", () => {
    const signals = loadSignals("/nonexistent/path/signals.json");
    assert.deepEqual(signals, DEFAULT_SIGNALS);
  });

  it("loads custom signals from file", () => {
    const tmp = mkdtempSync(join(tmpdir(), "signals-test-"));
    const path = join(tmp, "signals.json");
    writeFileSync(path, JSON.stringify({
      domainSignals: ["rust", "cargo"],
      stopWords: ["the"],
      patterns: { rust_build: ["cargo", "rustc"] },
    }));
    const signals = loadSignals(path);
    assert.deepEqual(signals.domainSignals, ["rust", "cargo"]);
    assert.deepEqual(signals.stopWords, ["the"]);
    assert.deepEqual(signals.patterns, { rust_build: ["cargo", "rustc"] });
  });

  it("falls back per-field for partial config", () => {
    const tmp = mkdtempSync(join(tmpdir(), "signals-test-"));
    const path = join(tmp, "signals.json");
    writeFileSync(path, JSON.stringify({ domainSignals: ["custom"] }));
    const signals = loadSignals(path);
    assert.deepEqual(signals.domainSignals, ["custom"]);
    assert.deepEqual(signals.stopWords, DEFAULT_SIGNALS.stopWords);
    assert.deepEqual(signals.patterns, DEFAULT_SIGNALS.patterns);
  });
});

// ── generateDefaultSignalsJson ───────────────────────────────
describe("generateDefaultSignalsJson", () => {
  it("produces valid JSON that round-trips", () => {
    const json = generateDefaultSignalsJson();
    const parsed = JSON.parse(json);
    assert.deepEqual(parsed, DEFAULT_SIGNALS);
  });
});

// ── Custom signals through analyze ───────────────────────────
describe("extractKeywords with custom signals", () => {
  it("uses custom domain signals", () => {
    const section = makeSection("Build", "## Build\nRun cargo build to compile.");
    const signals = { ...DEFAULT_SIGNALS, domainSignals: ["cargo"] };
    const kw = extractKeywords(section, signals);
    assert.ok(kw.includes("cargo"));
  });

  it("uses custom stop words", () => {
    const section = makeSection("Build Config", "## Build Config\nSet the build target.");
    const signals = { ...DEFAULT_SIGNALS, stopWords: ["build"] };
    const kw = extractKeywords(section, signals);
    assert.ok(!kw.includes("build"));
    assert.ok(kw.includes("config"));
  });
});
