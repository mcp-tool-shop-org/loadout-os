/**
 * hook test: drives the real apps/hook/loadout-hook.mjs in an isolated HOME so
 * the live usage.jsonl is never touched. Confirms it runs, returns structured
 * output, and (crucially) does not write to the user's real ~/.ai-loadout.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

import { runHookTest, defaultHookPath } from "../hook.js";

const HOOK = defaultHookPath(process.cwd());

test("hook test: runs the hook against a sample prompt (when hook present)", () => {
  if (!existsSync(HOOK)) {
    // repo without the hook checked out — skip rather than fail
    return;
  }
  const result = runHookTest({
    prompt: "scaffold a new game and run the dogfood swarm",
    hookPath: HOOK,
  });
  assert.equal(result.ran, true);
  // exit code is 0 whether it injects or stays silent (fail-silent contract)
  assert.equal(result.exitCode, 0);
  assert.equal(typeof result.note, "string");
});

test("hook test: does NOT write the live ~/.ai-loadout/usage.jsonl", () => {
  if (!existsSync(HOOK)) return;
  const liveUsage = join(homedir(), ".ai-loadout", "usage.jsonl");
  const before = existsSync(liveUsage) ? statSync(liveUsage).size : -1;
  runHookTest({ prompt: "a test prompt that should not touch live state", hookPath: HOOK });
  const after = existsSync(liveUsage) ? statSync(liveUsage).size : -1;
  assert.equal(after, before, "hook test must not append to the live usage.jsonl");
});

test("hook test: absent hook → ran:false, structured note", () => {
  const result = runHookTest({
    prompt: "x",
    hookPath: resolve(process.cwd(), "apps", "hook", "does-not-exist.mjs"),
  });
  assert.equal(result.ran, false);
  assert.match(result.note, /not found/i);
});
