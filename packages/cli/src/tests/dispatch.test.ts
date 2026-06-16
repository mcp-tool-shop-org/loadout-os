/**
 * Dispatcher routing: each namespace + flat verb routes correctly, --help /
 * --version behave, and unknown commands throw a structured CliError.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { dispatch, getVersion, topLevelHelp } from "../cli.js";
import { CliError } from "../console.js";
import { captureLog } from "./fixtures.js";

test("--version prints the package version and nothing else", () => {
  const out = captureLog(() => dispatch(["--version"]));
  assert.equal(out.trim(), getVersion());
  assert.notEqual(getVersion(), "unknown");
});

test("no args prints top-level help listing namespaces + flat verbs + rituals", () => {
  const out = captureLog(() => dispatch([]));
  assert.match(out, /loadout-os/);
  assert.match(out, /memories/);
  assert.match(out, /rules/);
  assert.match(out, /doctor/);
  assert.match(out, /report/);
  assert.match(out, /hook test/);
  assert.match(out, /resolve/);
});

test("--help prints the same top-level help", () => {
  const out = captureLog(() => dispatch(["--help"]));
  assert.match(out, /Namespaces/);
  assert.match(out, /Flat verbs/);
  assert.match(out, /Rituals/);
});

test("topLevelHelp() includes refresh stub note", () => {
  assert.match(topLevelHelp(), /refresh/);
  assert.match(topLevelHelp(), /not yet implemented/);
});

test("memories --help prints the namespace help", () => {
  const out = captureLog(() => dispatch(["memories", "--help"]));
  assert.match(out, /loadout-os memories/);
  assert.match(out, /index/);
  assert.match(out, /validate/);
  assert.match(out, /stats/);
  assert.match(out, /health/);
});

test("rules --help prints the namespace help including split notice", () => {
  const out = captureLog(() => dispatch(["rules", "--help"]));
  assert.match(out, /loadout-os rules/);
  assert.match(out, /analyze/);
  assert.match(out, /split/);
});

test("memories with no subcommand prints namespace help (not an error)", () => {
  const out = captureLog(() => dispatch(["memories"]));
  assert.match(out, /loadout-os memories/);
});

test("rules split prints the deferred-notice (not yet wrapped)", () => {
  const out = captureLog(() => dispatch(["rules", "split"]));
  assert.match(out, /not yet wrapped/i);
  assert.match(out, /claude-rules/);
});

test("refresh prints the stub notice and does not throw", () => {
  const out = captureLog(() => dispatch(["refresh"]));
  assert.match(out, /not yet implemented/i);
  assert.match(out, /Index Freshness Ritual/);
});

test("unknown top-level command throws structured CliError", () => {
  assert.throws(
    () => dispatch(["frobnicate"]),
    (err: unknown) => {
      assert.ok(err instanceof CliError);
      assert.equal(err.code, "UNKNOWN_COMMAND");
      assert.match(err.message, /frobnicate/);
      return true;
    },
  );
});

test("unknown memories subcommand throws structured CliError", () => {
  assert.throws(
    () => dispatch(["memories", "bogus"]),
    (err: unknown) => {
      assert.ok(err instanceof CliError);
      assert.equal(err.code, "UNKNOWN_COMMAND");
      assert.match(err.message, /memories subcommand/);
      return true;
    },
  );
});

test("unknown rules subcommand throws structured CliError", () => {
  assert.throws(
    () => dispatch(["rules", "bogus"]),
    (err: unknown) => {
      assert.ok(err instanceof CliError);
      assert.equal(err.code, "UNKNOWN_COMMAND");
      return true;
    },
  );
});

test("unknown hook subcommand throws structured CliError", () => {
  assert.throws(
    () => dispatch(["hook", "bogus"]),
    (err: unknown) => {
      assert.ok(err instanceof CliError);
      assert.equal(err.code, "UNKNOWN_COMMAND");
      return true;
    },
  );
});

test("flat verb with missing required arg throws MISSING_ARG", () => {
  assert.throws(
    () => dispatch(["explain"]),
    (err: unknown) => {
      assert.ok(err instanceof CliError);
      assert.equal(err.code, "MISSING_ARG");
      return true;
    },
  );
});

test("swallowed flag value fails loudly (MISSING_FLAG_VALUE)", () => {
  // `doctor --index --json` — the path value was swallowed by the next flag.
  // doctor reads --index via the shared fail-loud flagValue parser.
  assert.throws(
    () => dispatch(["doctor", "--index", "--json"]),
    (err: unknown) => {
      assert.ok(err instanceof CliError);
      assert.equal(err.code, "MISSING_FLAG_VALUE");
      assert.match(err.message, /--index/);
      return true;
    },
  );
});
