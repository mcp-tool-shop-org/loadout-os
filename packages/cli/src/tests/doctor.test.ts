/**
 * doctor: run against a synthetic store/index/settings/usage sandbox and assert
 * each check's status. Confirms it is read-only (no files created) and that the
 * overall `ok` flips on a hard ✗.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, existsSync } from "node:fs";

import { runDoctor, type DoctorPaths } from "../doctor.js";
import { makeSandbox } from "./fixtures.js";

function pathsFor(sb: ReturnType<typeof makeSandbox>): DoctorPaths {
  return {
    store: sb.storeDir,
    index: sb.indexPath,
    settings: sb.settingsPath,
    usage: sb.usagePath,
    // self-contained synthetic hook files (identical bytes → no drift); the
    // drift test swaps hookMirror for the different-bytes file. This keeps the
    // suite independent of cwd and the repo's real apps/hook location.
    hookSource: sb.hookSource,
    hookMirror: sb.hookMirror,
  };
}

function find(checks: { id: string; status: string }[], id: string) {
  const c = checks.find((x) => x.id === id);
  assert.ok(c, `expected a check with id "${id}"`);
  return c!;
}

test("doctor: healthy sandbox passes the structural checks", () => {
  const sb = makeSandbox({
    withUsage: true,
    withSettingsHook: true,
    withCore: true,
    observedAvg: 130,
  });
  try {
    const result = runDoctor(pathsFor(sb));

    // store + index parse cleanly
    assert.notEqual(find(result.checks, "store-validates").status, "fail");
    assert.notEqual(find(result.checks, "index-parse").status, "fail");
    // core entries present → pass
    assert.equal(find(result.checks, "core-entries").status, "pass");
    // observed avg set → pass
    assert.equal(find(result.checks, "observability-loop").status, "pass");
    // hook wired in settings → pass
    assert.equal(find(result.checks, "hook-wired").status, "pass");
    // usage recent + nonzero → pass
    assert.equal(find(result.checks, "usage-growing").status, "pass");
    // identical source/mirror → no drift
    assert.equal(find(result.checks, "hook-drift").status, "pass");
  } finally {
    sb.cleanup();
  }
});

test("doctor: missing hook in settings → hook-wired fail flips ok=false", () => {
  const sb = makeSandbox({ withSettingsHook: false, withCore: true });
  try {
    const result = runDoctor(pathsFor(sb));
    assert.equal(find(result.checks, "hook-wired").status, "fail");
    assert.equal(result.ok, false);
  } finally {
    sb.cleanup();
  }
});

test("doctor: 0 core entries → core-entries warn (not fail)", () => {
  const sb = makeSandbox({ withCore: false, withSettingsHook: true, withUsage: true });
  try {
    const result = runDoctor(pathsFor(sb));
    assert.equal(find(result.checks, "core-entries").status, "warn");
  } finally {
    sb.cleanup();
  }
});

test("doctor: null observed avg → observability-loop warn", () => {
  const sb = makeSandbox({ observedAvg: null, withSettingsHook: true });
  try {
    const result = runDoctor(pathsFor(sb));
    assert.equal(find(result.checks, "observability-loop").status, "warn");
  } finally {
    sb.cleanup();
  }
});

test("doctor: missing index → index-parse fail, ok=false", () => {
  const sb = makeSandbox({ withSettingsHook: true });
  try {
    const paths = pathsFor(sb);
    paths.index = `${sb.dir}/.ai-loadout/does-not-exist.json`;
    const result = runDoctor(paths);
    assert.equal(find(result.checks, "index-parse").status, "fail");
    assert.equal(result.ok, false);
  } finally {
    sb.cleanup();
  }
});

test("doctor: drifting hook mirror → hook-drift fail", () => {
  const sb = makeSandbox({ withSettingsHook: true });
  try {
    const paths = pathsFor(sb);
    // mirror = the different-bytes hook file → drift vs. the source
    paths.hookMirror = sb.hookDrifted;
    const result = runDoctor(paths);
    assert.equal(find(result.checks, "hook-drift").status, "fail");
  } finally {
    sb.cleanup();
  }
});

test("doctor: NEVER writes — sandbox dir file count is unchanged", () => {
  const sb = makeSandbox({ withUsage: true, withSettingsHook: true });
  try {
    const before = readdirSync(sb.dir).length;
    runDoctor(pathsFor(sb));
    const after = readdirSync(sb.dir).length;
    assert.equal(before, after, "doctor must not create files");
    // and it must not have created the missing never-loaded topic file
    assert.equal(existsSync(`${sb.storeDir}/never-loaded.md`), false);
  } finally {
    sb.cleanup();
  }
});
