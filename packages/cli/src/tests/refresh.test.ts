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
import { isAbsolute } from "node:path";

import { runRefresh, RefreshError } from "../refresh.js";
import { makeRefreshSandbox } from "./fixtures.js";

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
