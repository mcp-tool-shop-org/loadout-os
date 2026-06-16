/**
 * Shared arg parser: flag detection, value reading (both `--k v` and `--k=v`),
 * and the fail-loud-on-swallowed-value behaviour.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { hasFlag, flagValue, positionalArgs, CliError } from "../console.js";

test("hasFlag detects presence", () => {
  assert.equal(hasFlag(["--json", "x"], "json"), true);
  assert.equal(hasFlag(["x"], "json"), false);
});

test("flagValue reads space-separated value", () => {
  assert.equal(flagValue(["--out", "path.json"], "out"), "path.json");
});

test("flagValue reads = form", () => {
  assert.equal(flagValue(["--out=path.json"], "out"), "path.json");
});

test("flagValue returns undefined when absent", () => {
  assert.equal(flagValue(["--json"], "out"), undefined);
});

test("flagValue fails loudly when value swallowed by next flag", () => {
  assert.throws(
    () => flagValue(["--out", "--json"], "out"),
    (err: unknown) => {
      assert.ok(err instanceof CliError);
      assert.equal(err.code, "MISSING_FLAG_VALUE");
      return true;
    },
  );
});

test("flagValue fails loudly when flag is the last token", () => {
  assert.throws(
    () => flagValue(["--out"], "out"),
    (err: unknown) => {
      assert.ok(err instanceof CliError);
      assert.equal(err.code, "MISSING_FLAG_VALUE");
      return true;
    },
  );
});

test("positionalArgs drops flags, keeps leading paths", () => {
  assert.deepEqual(positionalArgs(["index.json", "usage.jsonl", "--json"]), [
    "index.json",
    "usage.jsonl",
  ]);
});
