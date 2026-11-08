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
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, existsSync, writeFileSync, statSync, mkdirSync, openSync, closeSync, unlinkSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as refreshMod from "../refresh.js";
import {
  runRefresh,
  printRefresh,
  defaultDest,
  projectDest,
  sameResolvedPath,
  withFileLock,
  lockFilePathForKey,
  RefreshError,
  type RefreshResult,
} from "../refresh.js";
import { runPostWrite } from "../hook.js";
import { dispatch } from "../cli.js";
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

test("printRefresh: a live-dest run confirms the live write and drops the stale note", () => {
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

// ── Part B: --project, --snapshot-repo, --mirror-repo, --fix, and locking ──

test("refresh --project <root>: writes <root>/.claude/loadout/index.json with source and leaves global index untouched (F-16, F-23)", () => {
  const sb = makeRefreshSandbox({ valid: true });
  try {
    const projRoot = join(sb.dir, "my-project");
    mkdirSync(projRoot, { recursive: true });

    const result = runRefresh({ store: sb.storeDir, project: projRoot });
    const expectedDest = projectDest(projRoot);
    assert.equal(result.dest, expectedDest);
    assert.equal(result.wrote, true);
    assert.ok(existsSync(expectedDest), "project index must be written");
    assert.equal(existsSync(sb.destPath), false, "custom/global dest must remain untouched");

    const written = JSON.parse(readFileSync(expectedDest, "utf-8"));
    assert.equal(written.source, sb.memoryMd, "project index must record source MEMORY.md (F-23)");

    // Second run backs up existing project index to .bak (F-16)
    const second = runRefresh({ store: sb.storeDir, project: projRoot });
    assert.equal(second.backupPath, `${expectedDest}.bak`);
    assert.ok(existsSync(`${expectedDest}.bak`));
  } finally {
    sb.cleanup();
  }
});

test("refresh --snapshot-repo and --mirror-repo: commits store .md files, pushes to bare mirror (-b main), treats no-change as success, and fails non-zero on git error (F-10, F-21, F-31)", () => {
  const sb = makeRefreshSandbox({ valid: true });
  try {
    const projRoot = join(sb.dir, "proj");
    const snapDir = join(sb.dir, "snap-repo");
    const mirrorDir = join(sb.dir, "mirror.git");

    // 1. First run initializes snapshot repo + bare mirror (-b main) and commits + pushes
    const r1 = runRefresh({
      store: sb.storeDir,
      project: projRoot,
      snapshotRepo: snapDir,
      mirrorRepo: mirrorDir,
    });
    assert.equal(r1.snapshot?.committed, true);
    assert.equal(r1.snapshot?.mirrored, true);
    assert.ok(existsSync(join(snapDir, "MEMORY.md")), "MEMORY.md copied to snapshot repo");
    assert.ok(existsSync(join(mirrorDir, "HEAD")), "bare mirror initialized");
    const mirrorHead = readFileSync(join(mirrorDir, "HEAD"), "utf-8");
    assert.match(mirrorHead, /refs\/heads\/main/, "bare mirror HEAD must point to main (F-31)");

    // 2. Second run with no changes succeeds with committed: false, noChange: true
    const r2 = runRefresh({
      store: sb.storeDir,
      project: projRoot,
      snapshotRepo: snapDir,
      mirrorRepo: mirrorDir,
    });
    assert.equal(r2.snapshot?.committed, false);
    assert.equal(r2.snapshot?.noChange, true);
    assert.equal(r2.snapshot?.mirrored, true);

    // 3. Broken mirror path (file instead of directory) fails non-zero (F-10 / F-21)
    const badMirror = join(sb.dir, "not-a-repo-file");
    writeFileSync(badMirror, "corrupt", "utf-8");
    // Modify a store file so it tries to commit and push to the bad mirror
    writeFileSync(join(sb.storeDir, "topic-a.md"), "# Topic A\nUpdated body.\n", "utf-8");
    assert.throws(
      () =>
        runRefresh({
          store: sb.storeDir,
          project: projRoot,
          snapshotRepo: snapDir,
          mirrorRepo: badMirror,
        }),
      (err: unknown) => {
        assert.ok(err instanceof RefreshError);
        assert.equal(err.exitCode, 1);
        return true;
      },
    );
  } finally {
    sb.cleanup();
  }
});

test("withFileLock: serializes access and cleans up the lock file (F-07)", () => {
  const sb = makeRefreshSandbox({ valid: true });
  try {
    const lockKey = join(sb.dir, "refresh-target");
    const actualLockPath = lockFilePathForKey(lockKey);
    const value = withFileLock(lockKey, () => {
      assert.ok(existsSync(actualLockPath), "lock file must exist while inside critical section");
      return 42;
    });
    assert.equal(value, 42);
    assert.equal(existsSync(actualLockPath), false, "lock file must be cleaned up after completion");
  } finally {
    sb.cleanup();
  }
});


test("CLI dispatch: exercises refresh --project/--fix, memories sync-summaries/place/move, and hook session-start/pre-compact/post-write in-process", () => {
  const sb = makeRefreshSandbox({ valid: true });
  try {
    const projRoot = join(sb.dir, "cli-proj");
    mkdirSync(projRoot, { recursive: true });

    // Create sub-indexes and a topic with frontmatter + board
    writeFileSync(
      join(sb.storeDir, "index-projects.md"),
      "# Projects\n- [Topic A](topic-a.md) — Stale summary\n",
      "utf-8",
    );
    writeFileSync(join(sb.storeDir, "index-archive.md"), "# Archive\n", "utf-8");
    writeFileSync(
      join(sb.storeDir, "topic-a.md"),
      [
        "---",
        "name: Topic A",
        "description: Authoritative Topic A summary",
        "---",
        "# Topic A",
        "Body.",
        "",
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(sb.storeDir, "BOARD.md"),
      [
        "---",
        "name: Active Board",
        "description: Session board",
        "priority: core",
        "metadata:",
        "  loadout_inject: session-start",
        "  stale_after_min: 60",
        "---",
        "# Active Board",
        "Current state.",
        "",
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      sb.memoryMd,
      [
        "# Memory",
        "- [Board](BOARD.md) — Session board",
        "- [Projects](index-projects.md) — Projects sub-index",
        "- [Archive](index-archive.md) — Archive sub-index",
        "",
      ].join("\n"),
      "utf-8",
    );

    // 1. memories sync-summaries without --fix throws STALE_SUMMARIES
    assert.throws(() =>
      captureLog(() => dispatch(["memories", "sync-summaries", sb.memoryMd])),
    );
    assert.throws(() =>
      captureLog(() => dispatch(["memories", "sync-summaries", sb.memoryMd, "--json"])),
    );

    // 2. memories sync-summaries --fix updates the drifted summary
    const syncOut = captureLog(() =>
      dispatch(["memories", "sync-summaries", sb.memoryMd, "--fix"]),
    );
    assert.match(syncOut, /synced/);
    const syncCleanOut = captureLog(() =>
      dispatch(["memories", "sync-summaries", sb.memoryMd]),
    );
    assert.match(syncCleanOut, /match their frontmatter/);
    const syncJsonOut = captureLog(() =>
      dispatch(["memories", "sync-summaries", sb.memoryMd, "--fix", "--json"]),
    );
    assert.ok(JSON.parse(syncJsonOut));

    // 3. memories place and move (human and --json)
    const placeOut = captureLog(() =>
      dispatch(["memories", "place", join(sb.storeDir, "topic-a.md"), "projects", "--store", sb.storeDir]),
    );
    assert.match(placeOut, /Placed topic-a\.md/);
    const moveJsonOut = captureLog(() =>
      dispatch([
        "memories",
        "move",
        join(sb.storeDir, "topic-a.md"),
        "--into",
        "archive",
        "--store",
        sb.storeDir,
        "--json",
      ]),
    );
    assert.equal(JSON.parse(moveJsonOut).targetIndex, "index-archive.md");

    // Missing arg on place throws
    assert.throws(() => dispatch(["memories", "place", "only-one-arg"]));

    // 4. dispatch refresh --store --project --fix
    const refOut = captureLog(() =>
      dispatch(["refresh", "--store", sb.storeDir, "--project", projRoot, "--fix"]),
    );
    assert.match(refOut, /refreshed the PROJECT resolver index/i);

    // Also exercise printRefresh with snapshot + dry-run + backup branches
    const snapPrintOut = captureLog(() =>
      printRefresh({
        ...okResult(projectDest(projRoot)),
        project: projRoot,
        backupPath: `${projectDest(projRoot)}.bak`,
        snapshot: {
          committed: true,
          noChange: false,
          sha: "deadbeef",
          mirrored: true,
          message: "Committed and mirrored",
        },
      }),
    );
    assert.match(snapPrintOut, /Committed and mirrored/);

    const dryPrintOut = captureLog(() =>
      printRefresh({
        ...okResult(projectDest(projRoot)),
        project: projRoot,
        dryRun: true,
        wrote: false,
        snapshot: {
          committed: false,
          noChange: true,
          mirrored: false,
          message: "No change",
        },
      }),
    );
    assert.match(dryPrintOut, /--dry-run/);

    // Exercise human-readable (non-JSON) CLI outputs in commands.ts / report.ts / doctor.ts
    captureLog(() => dispatch(["memories", "index", sb.memoryMd, "--lazy"]));
    captureLog(() => dispatch(["memories", "validate", sb.memoryMd, "--max-lines", "200", "--max-bytes", "30000"]));
    captureLog(() => dispatch(["memories", "stats", sb.memoryMd]));
    captureLog(() => dispatch(["memories", "health", sb.memoryMd]));
    captureLog(() => dispatch(["resolve", "--project", projRoot]));
    captureLog(() => dispatch(["explain", "active-board", "--project", projRoot]));
    captureLog(() => dispatch(["validate", projectDest(projRoot)]));
    captureLog(() => dispatch(["overlaps", projectDest(projRoot)]));
    captureLog(() => dispatch(["budget", projectDest(projRoot)]));

    // 5. dispatch hook session-start & pre-compact (--json)
    const ssJson = captureLog(() =>
      dispatch(["hook", "session-start", "--project", projRoot, "--max-lines", "50", "--max-bytes", "5000", "--json"]),
    );
    assert.equal(JSON.parse(ssJson).injectedFiles.length, 1);

    const pcJson = captureLog(() =>
      dispatch(["hook", "pre-compact", "--project", projRoot, "--stale-after-min", "60", "--json"]),
    );
    assert.equal(JSON.parse(pcJson).warnings.length, 0);

    // 6. dispatch hook post-write (clean and error)
    dispatch(["hook", "post-write", "--project", projRoot, "--file", join(sb.storeDir, "BOARD.md")]);
    assert.equal(process.exitCode ?? 0, 0);

    // 7. Exercise doctor and report human output on scratch fixtures
    const usageJsonl = join(sb.storeDir, "usage.jsonl");
    writeFileSync(
      usageJsonl,
      JSON.stringify({
        ts: "2026-11-08T00:00:00.000Z",
        sessionId: "s1",
        taskHash: "t1",
        entryId: "active-board",
        mode: "lazy",
        score: 0.9,
        reason: "keywords: board",
        tokensEst: 20,
        layer: "project",
      }) + "\n",
      "utf-8",
    );
    captureLog(() => dispatch(["usage", usageJsonl]));
    captureLog(() => dispatch(["dead", projectDest(projRoot), "--usage", usageJsonl]));
    captureLog(() => dispatch(["report", "--index", projectDest(projRoot), "--jsonl", usageJsonl]));
    captureLog(() =>
      dispatch([
        "doctor",
        "--store",
        sb.storeDir,
        "--index",
        projectDest(projRoot),
        "--jsonl",
        usageJsonl,
        "--settings",
        join(sb.storeDir, "missing-settings.json"),
      ]),
    );
  } finally {
    process.exitCode = 0;
    sb.cleanup();
  }
});

test("Q3-4: LOCK_WAIT_MS is at least DEFAULT_GIT_TIMEOUT_MS, and a second post-write waits rather than fails while the first holds the lock for a long git step", async () => {
  const sb = makeRefreshSandbox({ valid: true });
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const refreshSrc = readFileSync(resolve(here, "..", "..", "src", "refresh.ts"), "utf-8");
    const mWait = refreshSrc.match(/LOCK_WAIT_MS\s*=\s*([0-9_]+|DEFAULT_GIT_TIMEOUT_MS[^\n;]*)/);
    assert.ok(mWait, "LOCK_WAIT_MS must be defined in refresh.ts");
    const modAny = refreshMod as Record<string, unknown>;
    const gitTimeout = typeof modAny.DEFAULT_GIT_TIMEOUT_MS === "number" ? modAny.DEFAULT_GIT_TIMEOUT_MS : 30_000;
    const lockWait = typeof modAny.LOCK_WAIT_MS === "number" ? modAny.LOCK_WAIT_MS : 15_000;
    assert.ok(
      lockWait >= gitTimeout,
      `LOCK_WAIT_MS (${lockWait}) must be >= DEFAULT_GIT_TIMEOUT_MS (${gitTimeout})`,
    );

    // Simulate a first post-write holding the project index lock during a git step,
    // while a second post-write arrives and waits until the lock is released rather than failing.
    const projRoot = join(sb.dir, "concurrent-proj");
    mkdirSync(projRoot, { recursive: true });
    runRefresh({ store: sb.storeDir, project: projRoot });

    const dest = projectDest(projRoot);
    const lockPath = lockFilePathForKey(dest);
    const fd = openSync(lockPath, "wx");
    writeFileSync(fd, `${process.pid}\n${Date.now()}\n`, "utf-8");

    // Release the lock from a child process after 350ms while the parent is blocked in runPostWrite's Atomics.wait loop
    const releaser = spawn(
      process.execPath,
      [
        "-e",
        'setTimeout(() => { try { require("node:fs").unlinkSync(process.argv[1]); } catch {} }, 350);',
        lockPath,
      ],
      { stdio: "ignore" },
    );
    closeSync(fd);

    const t0 = Date.now();
    const res = runPostWrite({
      project: projRoot,
      store: sb.storeDir,
      filePath: join(sb.storeDir, "topic-a.md"),
    });
    const elapsed = Date.now() - t0;
    await new Promise<void>((r) => releaser.on("close", () => r()));

    assert.equal(res.matchedStore, true);
    assert.equal(res.exitCode, 0, "second post-write must wait and succeed (exit 0) after first releases lock");
    assert.ok(elapsed >= 200, `expected second post-write to wait for lock release, elapsed=${elapsed}ms`);
  } finally {
    sb.cleanup();
  }
});

test("Q2-6 / follow-up 1: runRefresh writes <dest>.tmp.<pid> and renameSyncs over <dest>, leaving old global index intact on mid-write crash", () => {
  const sb = makeRefreshSandbox({ valid: true });
  try {
    // 1. Seed initial valid global index
    const first = runRefresh({ store: sb.storeDir, dest: sb.destPath });
    assert.equal(first.wrote, true);
    const initialDestContent = readFileSync(sb.destPath, "utf-8");
    const initialParsed = JSON.parse(initialDestContent);
    assert.equal(initialParsed.entries.length, 1);

    // 2. Verify refresh.ts uses <dest>.tmp.<pid> and renameSync(tmpDest, dest)
    const here = dirname(fileURLToPath(import.meta.url));
    const refreshSrc = readFileSync(resolve(here, "..", "..", "src", "refresh.ts"), "utf-8");
    assert.match(
      refreshSrc,
      /`\$\{dest\}\.tmp\.\$\{process\.pid\}`/,
      "refresh.ts must stage index to `${dest}.tmp.${process.pid}`",
    );
    assert.match(
      refreshSrc,
      /renameSync\(tmpDest,\s*dest\)/,
      "refresh.ts must atomically renameSync(tmpDest, dest)",
    );

    // 3. Simulate a crash mid-write in a child process (after writing truncated bytes to <dest>.tmp.<pid>, before renameSync)
    writeFileSync(
      join(sb.storeDir, "MEMORY.md"),
      readFileSync(join(sb.storeDir, "MEMORY.md"), "utf-8") +
        "- [Topic C](topic-c.md) — Added before crash\n",
      "utf-8",
    );
    writeFileSync(
      join(sb.storeDir, "topic-c.md"),
      `---\nname: Topic C\ndescription: Added before crash\ntype: project\n---\n\nBody of topic C.\n`,
      "utf-8",
    );

    const refreshJsUrl = new URL("../refresh.js", import.meta.url).href;
    const crashScript = [
      'import { createRequire, syncBuiltinESMExports } from "node:module";',
      "const require = createRequire(import.meta.url);",
      'const fs = require("node:fs");',
      "const origWriteFileSync = fs.writeFileSync;",
      "const [targetDest, refreshUrl, targetStore] = process.argv.slice(1);",
      "fs.writeFileSync = function(file, data, options) {",
      '  if (typeof file === "string" && file === `${targetDest}.tmp.${process.pid}`) {',
      "    origWriteFileSync.call(this, file, String(data).slice(0, 24), options);",
      "    process.exit(137);",
      "  }",
      "  return origWriteFileSync.call(this, file, data, options);",
      "};",
      "syncBuiltinESMExports();",
      "const { runRefresh } = await import(refreshUrl);",
      "runRefresh({ store: targetStore, dest: targetDest });",
    ].join("\n");
    const child = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", crashScript, sb.destPath, refreshJsUrl, sb.storeDir],
      { encoding: "utf-8" },
    );
    assert.equal(child.status, 137, `expected simulated crash exit 137, got ${child.status}: ${child.stderr}`);

    // The truncated <dest>.tmp.<pid> was written by the crashed child, but <dest> must still be intact!
    const afterCrashContent = readFileSync(sb.destPath, "utf-8");
    assert.equal(afterCrashContent, initialDestContent, "old global index must be 100% intact after mid-write crash");
    assert.doesNotThrow(() => JSON.parse(afterCrashContent), "old global index must still be valid JSON");
  } finally {
    sb.cleanup();
  }
});

