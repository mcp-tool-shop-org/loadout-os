import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "cli.js");

describe("health command", () => {
  it("should report version and platform", () => {
    const output = execFileSync("node", [CLI, "health"], { encoding: "utf8" });
    assert.match(output, /claude-memories/);
    assert.match(output, /v\d+\.\d+\.\d+/);
    assert.match(output, /Node\.js:/);
    assert.match(output, /Platform:/);
    assert.match(output, /MEMORY\.md detection:/);
    assert.match(output, /Available commands:/);
  });

  it("should exit 0 when Node is compatible", () => {
    // If we can run this test, Node is compatible
    const result = execFileSync("node", [CLI, "health"], { encoding: "utf8" });
    assert.match(result, /\(OK\)/);
  });
});
