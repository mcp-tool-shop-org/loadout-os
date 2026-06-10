import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "..", "cli.js");

function run(...args: string[]): string {
  return execFileSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    timeout: 5000,
  });
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
