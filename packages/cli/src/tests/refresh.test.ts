/**
 * refresh: the Index Freshness Ritual, exercised entirely against a SCRATCH
 * store + a temp dest. NO test here points at the real ~/.ai-loadout or the
 * canonical store — makeRefreshSandbox() builds a throwaway temp dir and the
 * --dest is always inside it. Asserts:
 *   - the dest index is written + entry paths rewritten to ABSOLUTE
 *   - the ANDON gate halts (RefreshError exit 1) on an invalid store, writing
 *     nothing downstream
 *   - the COMPENSATOR backs up an existing dest to <dest>.bak before overwrite
 *   - --dry-run computes everything but writes NOTHING
 *   - a missing store / MEMORY.md exits 2
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, writeFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import {
  runRefresh,
  printRefresh,
  defaultDest,
  sameResolvedPath,
  RefreshError,
  type RefreshResult,
} from "../refresh.js";
import { makeRefreshSandbox } from "./fixtures.js";

/** The canonical live dest with its drive letter lower-cased (win32 only). */
function lowerDriveVariant(p: string): string {
  return p.replace(/^([A-Za-z]):/, (_m, d: string) => `${d.toLowerCase()}:`);
}

/** Capture everything printRefresh writes via console.log into one string. */
function captureLog(fn: () => void): string {
  const orig = console.log;
  const lines: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  console.log = (msg?: any) => {
    lines.push(String(msg ?? ""));
  };
  try {
    fn();
  } finally {
    console.log = orig;
  }
  return lines.join("\n");
}

/** A minimal successful (non-dry-run) result, parameterised by dest. */
function okResult(dest: string): RefreshResult {
  return {
    store: "/scratch/store",
    memoryMd: "/scratch/store/MEMORY.md",
    storeIndexPath: "/scratch/store/index.json",
    dest,
    dryRun: false,
    entryCount: 3,
    pathsRewritten: 3,
    gateErrors: [],
    gateWarnings: [],
    destIssues: [],
    backupPath: null,
    wrote: true,
  };
}

test("refresh: writes the dest index with entry paths rewritten to absolute", () => {
  const sb = makeRefreshSandbox({ valid: true });
  try {
    const result = runRefresh({ store: sb.storeDir, dest: sb.destPath });
    assert.equal(result.wrote, true);
    assert.equal(result.dryRun, false);

    // dest file exists and is valid JSON
    assert.ok(existsSync(sb.destPath), "dest index should be written");
    const written = JSON.parse(readFileSync(sb.destPath, "utf-8"));
    assert.ok(Array.isArray(written.entries));
    assert.ok(written.entries.length >= 1);

    // every entry path is ABSOLUTE under the store root
    for (const e of written.entries) {
      assert.ok(isAbsolute(e.path), `entry path should be absolute: ${e.path}`);
      assert.ok(
        e.path.startsWith(sb.storeDir) || e.path.includes("store"),
        `entry path should resolve under the store root: ${e.path}`,
      );
    }
    assert.ok(result.pathsRewritten >= 1, "at least one relative path rewritten");

    // index.source stamped to the store's MEMORY.md
    assert.equal(written.source, sb.memoryMd);

    // the store index.json was also written in-tree
    assert.ok(existsSync(result.storeIndexPath));
  } finally {
    sb.cleanup();
  }
});

test("refresh: ANDON HALT on an invalid store — exits 1 and writes nothing", () => {
  const sb = makeRefreshSandbox({ valid: false });
  try {
    assert.throws(
      () => runRefresh({ store: sb.storeDir, dest: sb.destPath }),
      (err: unknown) => {
        assert.ok(err instanceof RefreshError);
        assert.equal(err.code, "VALIDATION_FAILED");
        assert.equal(err.exitCode, 1);
        assert.ok((err.issues?.length ?? 0) >= 1);
        return true;
      },
    );
    // nothing downstream written: neither the dest nor the store index.json
    assert.equal(existsSync(sb.destPath), false, "andon must not write the dest");
    assert.equal(
      existsSync(`${sb.storeDir}/index.json`),
      false,
      "andon must not write the store index either",
    );
  } finally {
    sb.cleanup();
  }
});

test("refresh: COMPENSATOR backs up an existing dest to <dest>.bak before overwrite", () => {
  const sb = makeRefreshSandbox({ valid: true });
  try {
    // pre-seed an existing dest with sentinel content the backup must preserve
    const sentinel = JSON.stringify({ sentinel: "previous-live-index" }, null, 2) + "\n";
    writeFileSync(sb.destPath, sentinel, "utf-8");

    const result = runRefresh({ store: sb.storeDir, dest: sb.destPath });
    assert.equal(result.wrote, true);

    // a backup was created and reported
    const backup = `${sb.destPath}.bak`;
    assert.equal(result.backupPath, backup);
    assert.ok(existsSync(backup), "compensator should create <dest>.bak");

    // the backup holds the PREVIOUS content (the undo target)
    assert.equal(readFileSync(backup, "utf-8"), sentinel);

    // the dest now holds the FRESH index (not the sentinel)
    const fresh = JSON.parse(readFileSync(sb.destPath, "utf-8"));
    assert.ok(Array.isArray(fresh.entries), "dest replaced with the fresh index");
    assert.equal(fresh.sentinel, undefined);
  } finally {
    sb.cleanup();
  }
});

test("refresh: no prior dest → backupPath null (nothing to back up)", () => {
  const sb = makeRefreshSandbox({ valid: true });
  try {
    assert.equal(existsSync(sb.destPath), false);
    const result = runRefresh({ store: sb.storeDir, dest: sb.destPath });
    assert.equal(result.backupPath, null);
    assert.equal(existsSync(`${sb.destPath}.bak`), false);
  } finally {
    sb.cleanup();
  }
});

test("refresh: creates the dest parent directory when it does not exist", () => {
  const sb = makeRefreshSandbox({ valid: true });
  try {
    // a dest under a directory tree that doesn't exist yet (fresh-machine case)
    const nestedDest = `${sb.dir}/brand/new/.ai-loadout/index.json`;
    assert.equal(existsSync(`${sb.dir}/brand`), false);
    const result = runRefresh({ store: sb.storeDir, dest: nestedDest });
    assert.equal(result.wrote, true);
    assert.ok(existsSync(nestedDest), "refresh should create the dest dir tree + write");
  } finally {
    sb.cleanup();
  }
});

test("refresh: --dry-run computes everything but writes NOTHING", () => {
  const sb = makeRefreshSandbox({ valid: true });
  try {
    const result = runRefresh({ store: sb.storeDir, dest: sb.destPath, dryRun: true });
    assert.equal(result.dryRun, true);
    assert.equal(result.wrote, false);
    // it computed the change set
    assert.ok(result.entryCount >= 1);
    assert.ok(result.pathsRewritten >= 1);
    // but touched nothing on disk
    assert.equal(existsSync(sb.destPath), false, "dry-run must not write the dest");
    assert.equal(
      existsSync(`${sb.storeDir}/index.json`),
      false,
      "dry-run must not write the store index",
    );
    assert.equal(existsSync(`${sb.destPath}.bak`), false, "dry-run must not back up");
  } finally {
    sb.cleanup();
  }
});

test("refresh: --dry-run over an existing dest leaves it byte-for-byte unchanged", () => {
  const sb = makeRefreshSandbox({ valid: true });
  try {
    const sentinel = JSON.stringify({ sentinel: "live" }, null, 2) + "\n";
    writeFileSync(sb.destPath, sentinel, "utf-8");
    const before = statSync(sb.destPath).mtimeMs;

    runRefresh({ store: sb.storeDir, dest: sb.destPath, dryRun: true });

    assert.equal(readFileSync(sb.destPath, "utf-8"), sentinel, "dry-run must not mutate dest");
    assert.equal(statSync(sb.destPath).mtimeMs, before, "dry-run must not touch dest mtime");
  } finally {
    sb.cleanup();
  }
});

test("refresh: missing store directory exits 2", () => {
  assert.throws(
    () => runRefresh({ store: "/no/such/store/dir", dest: "/tmp/whatever-out.json" }),
    (err: unknown) => {
      assert.ok(err instanceof RefreshError);
      assert.equal(err.code, "STORE_NOT_FOUND");
      assert.equal(err.exitCode, 2);
      return true;
    },
  );
});

test("refresh: store present but MEMORY.md missing exits 2", () => {
  const sb = makeRefreshSandbox({ valid: true });
  try {
    // delete MEMORY.md by pointing at the empty 'out' dir as the store
    assert.throws(
      () => runRefresh({ store: `${sb.dir}/out`, dest: sb.destPath }),
      (err: unknown) => {
        assert.ok(err instanceof RefreshError);
        assert.equal(err.code, "MEMORY_MD_NOT_FOUND");
        assert.equal(err.exitCode, 2);
        return true;
      },
    );
  } finally {
    sb.cleanup();
  }
});

// ── printRefresh closing note (regression for the stale "deferred" copy) ──
// The note used to ALWAYS claim "this scratch/CLI run … a LIVE run … is deferred
// to a coordinator-supervised step", even when refresh had just written the live
// resolver index. It's now contrastive: live-dest confirms the live write;
// custom-dest says the live index was untouched. Neither prints the stale note.

test("printRefresh: a live-dest run confirms the change is live and drops the stale note", () => {
  const out = captureLog(() => printRefresh(okResult(resolve(defaultDest()))));
  assert.match(out, /the change is live now/i, "live-dest run must confirm the live write");
  assert.doesNotMatch(
    out,
    /deferred|coordinator-supervised|scratch\/CLI run/i,
    "the stale scratch/deferred note must be gone on a live run",
  );
});

test("printRefresh: a custom --dest run says the live index was NOT modified (still no stale note)", () => {
  const customDest = resolve(`${process.cwd()}/__scratch__/index.json`);
  // sanity: the synthetic custom dest must differ from the live resolver path
  assert.notEqual(customDest, resolve(defaultDest()));
  const out = captureLog(() => printRefresh(okResult(customDest)));
  assert.match(out, /not modified/i, "custom-dest run must say the live index was untouched");
  assert.match(out, /not the live resolver index/i);
  assert.doesNotMatch(
    out,
    /deferred|coordinator-supervised|scratch\/CLI run/i,
    "the stale scratch/deferred note must be gone on a custom-dest run too",
  );
});

test("sameResolvedPath: identical resolved paths match on every platform", () => {
  assert.ok(sameResolvedPath(defaultDest(), defaultDest()));
  assert.ok(sameResolvedPath(resolve(defaultDest()), defaultDest()));
});

test(
  "sameResolvedPath: folds Windows drive-letter case — a lowercase-drive path equal on disk to the live dest matches",
  { skip: process.platform !== "win32" },
  () => {
    const live = resolve(defaultDest());
    const lower = lowerDriveVariant(live);
    assert.notEqual(lower, live, "sanity: the variant must differ by drive-letter case");
    assert.ok(
      sameResolvedPath(lower, defaultDest()),
      "win32 must recognise the lowercase-drive path as the live index",
    );
  },
);

test(
  "printRefresh: a lowercase-drive --dest that IS the live index prints the LIVE note, not the false 'NOT modified' advice (win32 regression)",
  { skip: process.platform !== "win32" },
  () => {
    const lower = lowerDriveVariant(resolve(defaultDest()));
    const out = captureLog(() => printRefresh(okResult(lower)));
    assert.match(out, /the change is live now/i, "a live-on-disk dest must show the live confirmation");
    assert.doesNotMatch(out, /not modified/i, "must NOT falsely claim the live index was untouched");
    assert.doesNotMatch(out, /deferred|coordinator-supervised/i);
  },
);
