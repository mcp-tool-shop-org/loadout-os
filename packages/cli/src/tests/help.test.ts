/**
 * Per-command --help (Hard Gate C: "--help accurate").
 *
 * Asserts that `<cmd> --help` renders a command-specific block (synopsis / args
 * / flags / example / exit codes), that --help is INTERCEPTED before execution
 * (the command never runs — proven by driving a help request at a command that
 * would otherwise throw on a missing arg), that the `dead <index> <jsonl>`
 * ordering foot-gun is documented, and that EVERY dispatched leaf command has a
 * help entry.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { dispatch } from "../cli.js";
import { COMMAND_HELP, renderCommandHelp } from "../help.js";
import { captureLog } from "./fixtures.js";

// A representative sample across namespaced / flat / ritual commands.
const SAMPLE = [
  ["dead", ["dead", "--help"], "dead"],
  ["validate", ["validate", "--help"], "validate"],
  ["budget", ["budget", "--help"], "budget"],
  ["doctor", ["doctor", "--help"], "doctor"],
  ["refresh", ["refresh", "--help"], "refresh"],
  ["memories index", ["memories", "index", "--help"], "memories index"],
  ["rules split", ["rules", "split", "--help"], "rules split"],
  ["hook test", ["hook", "test", "--help"], "hook test"],
] as const;

for (const [label, argv, key] of SAMPLE) {
  test(`per-command help: '${label} --help' renders command-specific usage`, () => {
    const out = captureLog(() => dispatch([...argv]));
    // names the command, shows a synopsis, an example, and exit codes
    assert.match(out, new RegExp(`loadout-os ${key.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}`));
    assert.match(out, /Synopsis:/);
    assert.match(out, /Example:/);
    assert.match(out, /Exit codes:/);
  });
}

test("per-command help: 'dead --help' documents the <index> <jsonl> ordering foot-gun", () => {
  const out = captureLog(() => dispatch(["dead", "--help"]));
  // both positionals named in the right order, plus the explicit warning
  assert.match(out, /<index>/);
  assert.match(out, /<jsonl>/);
  assert.match(out, /Order matters/i);
});

test("per-command help: --help is INTERCEPTED before execution (command never runs)", () => {
  // `dead` with --help and NO positionals would normally throw MISSING_ARG.
  // If help is intercepted first, dispatch returns cleanly with help text.
  let threw = false;
  let out = "";
  try {
    out = captureLog(() => dispatch(["dead", "--help"]));
  } catch {
    threw = true;
  }
  assert.equal(threw, false, "--help must short-circuit before the missing-arg check");
  assert.match(out, /Synopsis:/);
});

test("per-command help: -h is honored as well as --help", () => {
  const out = captureLog(() => dispatch(["validate", "-h"]));
  assert.match(out, /loadout-os validate/);
  assert.match(out, /KERNEL/);
});

test("per-command help: 'rules split --help' renders WITHOUT spawning the interactive bin", () => {
  // help is intercepted in dispatchRules before rulesSplit() is ever called,
  // so no subprocess + no readline prompt — the call returns synchronously.
  const out = captureLog(() => dispatch(["rules", "split", "--help"]));
  assert.match(out, /loadout-os rules split/);
  assert.match(out, /interactive/i);
  assert.match(out, /claude-rules/);
});

test("per-command help: namespace help still works without a subcommand", () => {
  // `memories --help` is the NAMESPACE help, not a per-command block.
  const out = captureLog(() => dispatch(["memories", "--help"]));
  assert.match(out, /loadout-os memories/);
  // namespace help does not carry a per-command "Synopsis:" header
  assert.doesNotMatch(out, /Exit codes:/);
});

test("every dispatched leaf command has a per-command help entry", () => {
  // The full set the dispatcher routes. Keeping this list in lockstep with the
  // switch is the contract; a new command without a help block fails here.
  const dispatched = [
    "memories index",
    "memories validate",
    "memories stats",
    "memories health",
    "rules analyze",
    "rules validate",
    "rules stats",
    "rules split",
    "resolve",
    "explain",
    "usage",
    "dead",
    "overlaps",
    "budget",
    "validate",
    "doctor",
    "report",
    "hook test",
    "refresh",
  ];
  for (const key of dispatched) {
    assert.ok(key in COMMAND_HELP, `missing per-command help for "${key}"`);
    // and it renders a non-trivial block
    const rendered = renderCommandHelp(key);
    assert.match(rendered, /Synopsis:/);
    assert.match(rendered, /Example:/);
  }
});
