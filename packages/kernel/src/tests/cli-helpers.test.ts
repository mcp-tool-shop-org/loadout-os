import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isLoadoutIndex,
  describeIndexShapeProblem,
  getFlagValue,
  diagnoseFlagValue,
} from "../cli-helpers.js";

// ── isLoadoutIndex (KER-B1) ──────────────────────────────────────

describe("isLoadoutIndex (KER-B1 trust boundary)", () => {
  it("accepts an object with an entries array", () => {
    assert.equal(isLoadoutIndex({ entries: [] }), true);
    assert.equal(isLoadoutIndex({ version: "1.0.0", entries: [{ id: "a" }] }), true);
  });

  it("rejects valid-but-wrong JSON that would crash downstream", () => {
    // These all parse as valid JSON yet would throw a raw TypeError the moment
    // something reads `.entries`. The guard catches them at the boundary.
    assert.equal(isLoadoutIndex(null), false);
    assert.equal(isLoadoutIndex(42), false);
    assert.equal(isLoadoutIndex("a string"), false);
    assert.equal(isLoadoutIndex(true), false);
    assert.equal(isLoadoutIndex({}), false);
    assert.equal(isLoadoutIndex([]), false);
    assert.equal(isLoadoutIndex([{ entries: [] }]), false);
    assert.equal(isLoadoutIndex({ entries: "not an array" }), false);
    assert.equal(isLoadoutIndex({ version: "1.0.0" }), false); // missing entries
  });
});

describe("describeIndexShapeProblem (KER-B1 actionable hint)", () => {
  it("returns null for a valid index (no problem)", () => {
    assert.equal(describeIndexShapeProblem({ entries: [] }), null);
  });

  it("names the specific problem for each wrong shape", () => {
    assert.match(describeIndexShapeProblem(null)!, /null/);
    assert.match(describeIndexShapeProblem([])!, /array/);
    assert.match(describeIndexShapeProblem(42)!, /number/);
    assert.match(describeIndexShapeProblem("x")!, /string/);
    assert.match(describeIndexShapeProblem({})!, /entries/);
    assert.match(describeIndexShapeProblem({ entries: 5 })!, /entries/);
  });
});

// ── getFlagValue (KER-B6) ────────────────────────────────────────

describe("getFlagValue (KER-B6 defensive flag parsing)", () => {
  it("reads --flag value", () => {
    assert.equal(getFlagValue(["--project", "/tmp/x"], "project"), "/tmp/x");
  });

  it("reads --flag=value", () => {
    assert.equal(getFlagValue(["--project=/tmp/x"], "project"), "/tmp/x");
  });

  it("honors --flag=value even when value starts with -- (explicit pairing)", () => {
    assert.equal(getFlagValue(["--project=--json"], "project"), "--json");
  });

  it("does NOT swallow a following flag as the value", () => {
    // `--project --json` previously returned "--json"; now it returns undefined
    // because the user clearly forgot the value for --project.
    assert.equal(getFlagValue(["--project", "--json"], "project"), undefined);
  });

  it("returns undefined when the flag is the last token", () => {
    assert.equal(getFlagValue(["resolve", "--project"], "project"), undefined);
  });

  it("returns undefined when the flag is absent", () => {
    assert.equal(getFlagValue(["resolve", "--json"], "project"), undefined);
  });
});

describe("diagnoseFlagValue (KER-B6 error classification)", () => {
  it("returns null when a value is present", () => {
    assert.equal(diagnoseFlagValue(["--project", "/tmp/x"], "project"), null);
    assert.equal(diagnoseFlagValue(["--project=/tmp/x"], "project"), null);
  });

  it("classifies a swallowed following flag", () => {
    assert.equal(diagnoseFlagValue(["--project", "--json"], "project"), "swallowed");
  });

  it("classifies an absent or trailing flag as missing", () => {
    assert.equal(diagnoseFlagValue(["resolve"], "project"), "missing");
    assert.equal(diagnoseFlagValue(["resolve", "--project"], "project"), "missing");
  });
});
