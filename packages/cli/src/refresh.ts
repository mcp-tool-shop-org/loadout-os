/**
 * loadout-os refresh — the Index Freshness Ritual, folded into one command.
 *
 * Replaces the manual three-step ritual (claude-memories index → validate →
 * copy to ~/.ai-loadout/index.json or <projectRoot>/.claude/loadout/index.json).
 * It (a) regenerates the store index from MEMORY.md (including linked sub-indexes),
 * (b) validates with an ANDON HALT on any error-severity issue,
 * (c) rewrites relative entry paths to absolute paths under the store root and
 * writes the target resolver index (global or project), then (d) re-validates
 * the written destination (warn-only), and (e) optionally snapshots the store's
 * `.md` files into a git history repository and pushes to a bare mirror repo,
 * all under an OS file lock (F-07, F-10, F-12, F-16, F-21, F-23, F-31).
 */

import {
  writeFileSync,
  readFileSync,
  existsSync,
  statSync,
  copyFileSync,
  renameSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  openSync,
  closeSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";

import {
  analyzeMemoryMd,
  generateIndex as generateMemoryIndex,
  validateMemory,
  validateMemoryIndex,
  syncSummaries,
  type IdSource,
  type MemoryIndex,
  type ValidateMemoryOptions,
} from "@mcptoolshop/claude-memories";

import {
  validateIndex as kernelValidateIndex,
  type LoadoutIndex,
  type ValidationIssue,
} from "@mcptoolshop/ai-loadout";

import {
  BOLD,
  DIM,
  RESET,
  GREEN,
  YELLOW,
  RED,
  CYAN,
  log,
  ok,
  warn,
  info,
  fail,
  hasFlag,
  flagValue,
} from "./console.js";
import { loadSeatConfig, normalizePreToolPath } from "./pretool.js";

/**
 * Canonical memory store (holds MEMORY.md + topic files).
 */
export const DEFAULT_STORE = join(
  homedir(),
  ".claude",
  "projects",
  "F--AI",
  "memory",
);

/** Default destination: the live global resolver index the hook reads. */
export function defaultDest(): string {
  return join(homedir(), ".ai-loadout", "index.json");
}

/** Project layer destination: `<projectRoot>/.claude/loadout/index.json`. */
export function projectDest(projectRoot: string): string {
  return join(resolve(projectRoot), ".claude", "loadout", "index.json");
}

/**
 * True when two paths resolve to the SAME file on disk. On Windows —
 * case-insensitive volumes — drive-letter and path case are folded.
 */
export function sameResolvedPath(a: string, b: string): boolean {
  const ra = resolve(a);
  const rb = resolve(b);
  return process.platform === "win32"
    ? ra.toLowerCase() === rb.toLowerCase()
    : ra === rb;
}

export interface RefreshOptions {
  /** Store directory containing MEMORY.md (default DEFAULT_STORE). */
  store?: string;
  /** Destination index path (default ~/.ai-loadout/index.json, or <project>/.claude/loadout/index.json when project is set). */
  dest?: string;
  /** Project root: writes <project>/.claude/loadout/index.json and leaves global index untouched. */
  project?: string;
  /** Compute everything, write nothing; report what WOULD change. */
  dryRun?: boolean;
  /** Sync drifted bullet summaries from topic frontmatter descriptions before validating (--fix). */
  fixSummaries?: boolean;
  /** Optional git working tree to snapshot all store `.md` files into (F-10 / F-21). */
  snapshotRepo?: string;
  /** Optional bare git mirror repository to push `main` to (F-10 / F-31). */
  mirrorRepo?: string;
  /** Commit message note for `--snapshot-repo` (default "loadout-os refresh snapshot"). */
  note?: string;
  /** Configurable MEMORY.md line limit (default 180). */
  maxLines?: number;
  /** Configurable MEMORY.md byte limit (default 24,000). */
  maxBytes?: number;
  /** Explicit ID source override (`"title"` or `"name"`). Wins over store setting and mode default. */
  idSource?: IdSource;
  /** Subprocess timeout in milliseconds for git commands (default 30,000). */
  gitTimeoutMs?: number;
  /** Optional path to `seats.json` for resolving `--project` store when `--store` is omitted. */
  seatsPath?: string;
  /** Explicit override allowing `refresh` to replace an index whose recorded source store differs. */
  allowStoreChange?: boolean;
}

export interface SnapshotResult {
  committed: boolean;
  noChange: boolean;
  sha?: string;
  mirrored: boolean;
  message: string;
}

export interface RefreshResult {
  store: string;
  memoryMd: string;
  storeIndexPath: string;
  dest: string;
  project?: string;
  dryRun: boolean;
  /** Entries in the generated index. */
  entryCount: number;
  /** How many entry paths were rewritten to absolute (i.e. were relative). */
  pathsRewritten: number;
  /** Validation issues from the ANDON gate (memory + memory-index). */
  gateErrors: ValidationIssue[];
  gateWarnings: ValidationIssue[];
  /** Issues from re-validating the written dest (warn-only). */
  destIssues: ValidationIssue[];
  /** Backup path written by the compensator (when dest pre-existed + not dry-run). */
  backupPath: string | null;
  /** True once the dest was written (false on dry-run or andon halt). */
  wrote: boolean;
  /** Snapshot/mirror result when `--snapshot-repo` was provided. */
  snapshot?: SnapshotResult;
}

/** Structured error carrying an exit code, so the caller maps it 1:1. */
export class RefreshError extends Error {
  readonly code: string;
  readonly exitCode: number;
  readonly issues?: ValidationIssue[];
  constructor(code: string, message: string, exitCode: number, issues?: ValidationIssue[]) {
    super(message);
    this.name = "RefreshError";
    this.code = code;
    this.exitCode = exitCode;
    this.issues = issues;
  }
}

// ── OS File Lock (F-07 / Q3-4) ─────────────────────────────────

export const DEFAULT_GIT_TIMEOUT_MS = 30_000;
export const LOCK_STALE_MS = 60_000;
export const LOCK_WAIT_MS = DEFAULT_GIT_TIMEOUT_MS + 5_000;

function sleepSync(ms: number): void {
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  Atomics.wait(view, 0, 0, ms);
}

export function lockFilePathForKey(lockKey: string): string {
  const hash = createHash("sha1")
    .update(process.platform === "win32" ? resolve(lockKey).toLowerCase() : resolve(lockKey))
    .digest("hex")
    .slice(0, 16);
  return join(tmpdir(), `loadout-os-lock-${hash}.lock`);
}

/**
 * Execute `fn` while holding an exclusive atomic OS lockfile (`wx`) keyed to `lockKey`.
 * Prevents overlapping async `refresh` / `post-write` runs from racing on `index.json`
 * or git history snapshots (F-07 / Q3-4).
 */
export function withFileLock<T>(
  lockKey: string,
  fn: () => T,
  waitMs: number = LOCK_WAIT_MS,
): T {
  const lockPath = lockFilePathForKey(lockKey);
  const deadline = Date.now() + Math.max(waitMs, LOCK_WAIT_MS);
  let acquiredFd: number | null = null;

  while (Date.now() < deadline) {
    try {
      acquiredFd = openSync(lockPath, "wx");
      writeFileSync(acquiredFd, `${process.pid}\n${Date.now()}\n`, "utf-8");
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw err;
      }
      // Check if existing lock is stale
      try {
        const st = statSync(lockPath);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          unlinkSync(lockPath);
          continue;
        }
      } catch {
        // Lock was just released by another process
        continue;
      }
      sleepSync(40);
    }
  }

  if (acquiredFd === null) {
    throw new RefreshError(
      "LOCK_TIMEOUT",
      `Timed out waiting for file lock on ${lockKey} (${lockPath})`,
      2,
    );
  }

  try {
    return fn();
  } finally {
    try {
      closeSync(acquiredFd);
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(lockPath);
    } catch {
      /* ignore */
    }
  }
}

// ── Git History Snapshot & Mirror (F-10 / F-12 / F-21 / F-31) ───

function runGit(
  cwd: string,
  args: string[],
  timeoutMs: number,
): { status: number; stdout: string; stderr: string } {
  const res = spawnSync("git", args, {
    cwd,
    encoding: "utf-8",
    timeout: timeoutMs,
    windowsHide: true,
  });

  if (res.error) {
    const errCode = (res.error as NodeJS.ErrnoException).code;
    if (errCode === "ETIMEDOUT" || /ETIMEDOUT|timed out/i.test(res.error.message)) {
      // F-12: A subprocess timeout exits 2 with a message, never 1.
      throw new RefreshError(
        "SUBPROCESS_TIMEOUT",
        `git ${args[0] ?? ""} timed out after ${timeoutMs}ms in ${cwd}`,
        2,
      );
    }
    throw new RefreshError(
      "GIT_EXEC_FAILED",
      `git ${args[0] ?? ""} failed to spawn: ${res.error.message}`,
      1,
    );
  }

  return {
    status: res.status ?? 1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

/**
 * Snapshot all `.md` files from `storeDir` into `snapshotRepo` on branch `main`,
 * and optionally push `main` to `mirrorRepo` (initialising bare mirror with `-b main`).
 * Exits non-zero on a failed commit or push; "no change" is success (F-10, F-31).
 */
export function runSnapshotAndMirror(opts: {
  storeDir: string;
  snapshotRepo: string;
  mirrorRepo?: string;
  note?: string;
  timeoutMs?: number;
}): SnapshotResult {
  const storeDir = resolve(opts.storeDir);
  const snapshotRepo = resolve(opts.snapshotRepo);
  const mirrorRepo = opts.mirrorRepo ? resolve(opts.mirrorRepo) : undefined;
  const note = opts.note?.trim() || "loadout-os refresh snapshot";
  const timeoutMs = opts.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS;

  // Ensure snapshotRepo exists and is an initialized git repo on branch `main`
  if (!existsSync(snapshotRepo)) {
    mkdirSync(snapshotRepo, { recursive: true });
  }
  if (!existsSync(join(snapshotRepo, ".git"))) {
    const init = runGit(snapshotRepo, ["init", "-q", "-b", "main", snapshotRepo], timeoutMs);
    if (init.status !== 0) {
      throw new RefreshError(
        "SNAPSHOT_INIT_FAILED",
        `Failed to initialize snapshot repo at ${snapshotRepo}: ${init.stderr.trim()}`,
        1,
      );
    }
  }

  // Copy store *.md files into snapshotRepo and remove deleted *.md files
  const storeMdFiles = new Set<string>();
  for (const entry of readdirSync(storeDir)) {
    const full = join(storeDir, entry);
    try {
      if (statSync(full).isFile() && extname(entry) === ".md") {
        storeMdFiles.add(entry);
        copyFileSync(full, join(snapshotRepo, entry));
      }
    } catch {
      /* ignore unreadable */
    }
  }

  for (const entry of readdirSync(snapshotRepo)) {
    if (entry === ".git") continue;
    const full = join(snapshotRepo, entry);
    try {
      if (statSync(full).isFile() && extname(entry) === ".md" && !storeMdFiles.has(entry)) {
        unlinkSync(full);
      }
    } catch {
      /* ignore */
    }
  }

  const addRes = runGit(snapshotRepo, ["add", "-A"], timeoutMs);
  if (addRes.status !== 0) {
    throw new RefreshError(
      "SNAPSHOT_COMMIT_FAILED",
      `git add failed in ${snapshotRepo}: ${addRes.stderr.trim()}`,
      1,
    );
  }

  const diffRes = runGit(snapshotRepo, ["diff", "--cached", "--quiet"], timeoutMs);
  let committed = false;
  let noChange = false;
  let sha: string | undefined;

  if (diffRes.status === 0) {
    // No staged changes — "No change" is success (F-10)
    noChange = true;
  } else {
    const commitRes = runGit(
      snapshotRepo,
      [
        "-c",
        "user.name=loadout-os",
        "-c",
        "user.email=loadout-os@localhost",
        "commit",
        "-q",
        "-m",
        note,
      ],
      timeoutMs,
    );
    if (commitRes.status !== 0) {
      throw new RefreshError(
        "SNAPSHOT_COMMIT_FAILED",
        `git commit failed in ${snapshotRepo}: ${(commitRes.stderr || commitRes.stdout).trim()}`,
        1,
      );
    }
    committed = true;
    const rev = runGit(snapshotRepo, ["rev-parse", "--short", "HEAD"], timeoutMs);
    if (rev.status === 0) {
      sha = rev.stdout.trim();
    }
  }

  let mirrored = false;
  if (mirrorRepo) {
    // Check if snapshotRepo has at least one commit to push
    const headCheck = runGit(snapshotRepo, ["rev-parse", "--verify", "HEAD"], timeoutMs);
    if (headCheck.status === 0) {
      const mirrorParent = dirname(mirrorRepo);
      if (!existsSync(mirrorParent)) {
        throw new RefreshError(
          "MIRROR_PUSH_FAILED",
          `Mirror parent directory does not exist: ${mirrorParent}`,
          1,
        );
      }
      if (!existsSync(mirrorRepo)) {
        // F-31: Initialise bare repos with `-b main`
        const bareInit = runGit(mirrorParent, ["init", "-q", "--bare", "-b", "main", mirrorRepo], timeoutMs);
        if (bareInit.status !== 0) {
          throw new RefreshError(
            "MIRROR_INIT_FAILED",
            `Failed to initialize bare mirror repo at ${mirrorRepo}: ${bareInit.stderr.trim()}`,
            1,
          );
        }
      }
      const pushRes = runGit(snapshotRepo, ["push", "-q", mirrorRepo, "HEAD:refs/heads/main"], timeoutMs);
      if (pushRes.status !== 0) {
        throw new RefreshError(
          "MIRROR_PUSH_FAILED",
          `git push to mirror ${mirrorRepo} failed: ${(pushRes.stderr || pushRes.stdout).trim()}`,
          1,
        );
      }
      mirrored = true;
    }
  }

  const msgParts: string[] = [];
  if (noChange) {
    msgParts.push("history: no change");
  } else {
    msgParts.push(`history: committed ${sha ?? "HEAD"}`);
  }
  if (mirrored) {
    msgParts.push(`(mirrored to ${mirrorRepo})`);
  }

  return {
    committed,
    noChange,
    sha,
    mirrored,
    message: msgParts.join(" "),
  };
}

/**
 * Rewrite each entry's relative `path` to an absolute path under the store
 * root, and stamp `source` = <store>/MEMORY.md and `source_store` = <store> (F-23).
 * Returns a fresh index object (does not mutate the input) plus a count of how
 * many paths were rewritten.
 */
export function rewritePathsAbsolute(
  index: MemoryIndex,
  storeRoot: string,
  memoryMd: string,
): { index: MemoryIndex & { source_store?: string }; pathsRewritten: number } {
  let pathsRewritten = 0;
  const entries = index.entries.map((e) => {
    if (isAbsolute(e.path)) return { ...e };
    pathsRewritten++;
    return { ...e, path: resolve(storeRoot, e.path) };
  });
  return {
    index: {
      ...index,
      entries,
      source: memoryMd,
      source_store: resolve(storeRoot),
    },
    pathsRewritten,
  };
}

/**
 * Extract the recorded source store directory from a parsed index JSON object,
 * if `source_store` or `source` (`<store>/MEMORY.md`) was recorded.
 */
export function extractIndexSourceStore(rawJson: string): string | null {
  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.source_store === "string" && parsed.source_store.trim()) {
      return resolve(parsed.source_store.trim());
    }
    if (typeof parsed.source === "string" && parsed.source.trim()) {
      return resolve(dirname(parsed.source.trim()));
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Look up the memory store configured for `projectRoot` in `seats.json`.
 */
export function resolveStoreForProject(
  projectRoot: string,
  seatsPath?: string,
): string | null {
  try {
    const sc = loadSeatConfig(seatsPath);
    const normProj = normalizePreToolPath(projectRoot).toLowerCase();
    if (!normProj) return null;

    let bestStore: string | null = null;
    let bestLen = -1;
    for (const [rawPrefix, storeDir] of Object.entries(sc.projectStores ?? {})) {
      const normPrefix = normalizePreToolPath(rawPrefix).toLowerCase();
      if (!normPrefix) continue;
      if (
        (normProj === normPrefix || normProj.startsWith(normPrefix + "/")) &&
        normPrefix.length > bestLen
      ) {
        bestLen = normPrefix.length;
        bestStore = storeDir;
      }
    }
    return bestStore ? resolve(bestStore) : null;
  } catch {
    return null;
  }
}

/**
 * Core refresh logic.
 *
 * When `opts.project` is provided (`loadout-os refresh --store <dir> --project <root>`):
 * - Writes `<root>/.claude/loadout/index.json` (with `source: <store>/MEMORY.md` and `source_store: <store>` — F-23)
 * - Leaves the global `~/.ai-loadout/index.json` untouched (and does not drop a stale
 *   `index.json` inside the live memory store directory — F-36).
 * - Keeps the ANDON HALT and `<dest>.bak` COMPENSATOR natively (F-16).
 * - Runs under an OS file lock (F-07).
 */
export function runRefresh(opts: RefreshOptions): RefreshResult {
  const project = opts.project ? resolve(opts.project) : undefined;
  let resolvedStorePath: string;
  if (opts.store && opts.store.trim()) {
    resolvedStorePath = resolve(opts.store);
  } else if (project) {
    const projectStore = resolveStoreForProject(project, opts.seatsPath);
    if (!projectStore) {
      throw new RefreshError(
        "PROJECT_STORE_REQUIRED",
        `Refusing to refresh --project (${project}) without --store: no store is recorded for this project in seats.json. Pass --store <dir> explicitly or configure the project's store in seats.json.`,
        2,
      );
    }
    resolvedStorePath = projectStore;
  } else {
    resolvedStorePath = resolve(DEFAULT_STORE);
  }
  const store = resolvedStorePath;
  const dest = resolve(
    opts.dest ?? (project ? projectDest(project) : defaultDest()),
  );
  const dryRun = !!opts.dryRun;
  const lockWaitMs =
    opts.gitTimeoutMs !== undefined && Number.isFinite(opts.gitTimeoutMs)
      ? Math.max(LOCK_WAIT_MS, opts.gitTimeoutMs + 5_000)
      : LOCK_WAIT_MS;

  return withFileLock(
    dest,
    () => {
    // ── precondition: store + MEMORY.md present (exit 2 when missing) ──
    const memoryMd = join(store, "MEMORY.md");
    if (!existsSync(store) || !statSync(store).isDirectory()) {
      throw new RefreshError(
        "STORE_NOT_FOUND",
        `Store directory not found: ${store}`,
        2,
      );
    }
    if (!existsSync(memoryMd)) {
      throw new RefreshError(
        "MEMORY_MD_NOT_FOUND",
        `MEMORY.md not found in store: ${memoryMd}`,
        2,
      );
    }

    // ── precondition: check existing dest source_store against store ──
    if (existsSync(dest) && !opts.allowStoreChange) {
      const existingDestStore = extractIndexSourceStore(readFileSync(dest, "utf-8"));
      if (existingDestStore && !sameResolvedPath(existingDestStore, store)) {
        throw new RefreshError(
          "STORE_MISMATCH",
          `Destination index (${dest}) was built from store "${existingDestStore}", which differs from requested store "${store}". Refusing to overwrite across stores (pass --allow-store-change to override).`,
          2,
        );
      }
    }

    // Optional pre-validation summary sync (--fix)
    if (opts.fixSummaries && !dryRun) {
      syncSummaries(memoryMd, { fix: true });
    }

    // ── (a) index the store ──────────────────────────────────────
    const projectMode = !!project;
    const analysis = analyzeMemoryMd(memoryMd);
    const storeIndex = generateMemoryIndex(analysis, {
      idSource: opts.idSource,
      projectMode,
    });
    const storeIndexPath = project ? dest : join(store, "index.json");

    // ── (b) validate — ANDON HALT on any error-severity issue ────
    const valOpts: ValidateMemoryOptions = {
      idSource: opts.idSource,
      projectMode,
    };
    if (opts.maxLines !== undefined) valOpts.maxLines = opts.maxLines;
    if (opts.maxBytes !== undefined) valOpts.maxBytes = opts.maxBytes;

    const gate: ValidationIssue[] = [
      ...validateMemory(analysis, valOpts),
      ...validateMemoryIndex(storeIndex),
    ];
    const gateErrors = gate.filter((i) => i.severity === "error");
    const gateWarnings = gate.filter((i) => i.severity === "warning");
    if (gateErrors.length > 0) {
      // Halt the pipeline: nothing downstream is written.
      throw new RefreshError(
        "VALIDATION_FAILED",
        `${gateErrors.length} validation error(s) — halting, nothing written`,
        1,
        gateErrors,
      );
    }

    // ── (c) path-rewrite (compute always; write only when not dry-run) ──
    const { index: rewritten, pathsRewritten } = rewritePathsAbsolute(
      storeIndex,
      store,
      memoryMd,
    );
    const destJson = JSON.stringify(rewritten, null, 2) + "\n";
    const storeJson =
      JSON.stringify({ ...storeIndex, source_store: resolve(store) }, null, 2) +
      "\n";

    // re-validate the rewritten dest payload (warn-only) — kernel structure check
    const destIssues = kernelValidateIndex(rewritten as unknown as LoadoutIndex);

    if (dryRun) {
      return {
        store,
        memoryMd,
        storeIndexPath,
        dest,
        ...(project ? { project } : {}),
        dryRun: true,
        entryCount: rewritten.entries.length,
        pathsRewritten,
        gateErrors,
        gateWarnings,
        destIssues,
        backupPath: null,
        wrote: false,
      };
    }

    // For global refresh (no --project), write the in-tree store index.json too for back-compat.
    // For --project refresh, only write <project>/.claude/loadout/index.json so we don't leave
    // an unrequested index.json inside the project's memory store (F-36).
    if (!project) {
      const tmpStoreIndex = `${storeIndexPath}.tmp.${process.pid}`;
      writeFileSync(tmpStoreIndex, storeJson, "utf-8");
      renameSync(tmpStoreIndex, storeIndexPath);
    }

    // ── COMPENSATOR (NAMED, irreversible write to the resolver index) ──
    let backupPath: string | null = null;
    if (existsSync(dest)) {
      const defaultBak = `${dest}.bak`;
      if (existsSync(defaultBak)) {
        const destStore = extractIndexSourceStore(readFileSync(dest, "utf-8")) ?? store;
        const bakStore = extractIndexSourceStore(readFileSync(defaultBak, "utf-8"));
        if (bakStore && !sameResolvedPath(bakStore, destStore)) {
          // Never overwrite an existing .bak whose source store differs: keep both
          const storeHash = createHash("sha1")
            .update(process.platform === "win32" ? destStore.toLowerCase() : destStore)
            .digest("hex")
            .slice(0, 8);
          backupPath = `${dest}.${storeHash}.bak`;
        } else {
          backupPath = defaultBak;
        }
      } else {
        backupPath = defaultBak;
      }
      copyFileSync(dest, backupPath);
    }
    const tmpDest = `${dest}.tmp.${process.pid}`;
    try {
      const destDir = dirname(dest);
      if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
      writeFileSync(tmpDest, destJson, "utf-8");
      renameSync(tmpDest, dest);
    } catch (e) {
      try {
        if (existsSync(tmpDest)) unlinkSync(tmpDest);
      } catch {
        /* ignore */
      }
      if (backupPath && existsSync(backupPath)) {
        try {
          copyFileSync(backupPath, dest);
        } catch {
          /* best-effort restore */
        }
      }
      if (e instanceof RefreshError) throw e;
      throw new RefreshError(
        "WRITE_FAILED",
        `Failed to write dest (${dest}): ${(e as Error).message}${
          backupPath ? ` — restored from ${backupPath}` : ""
        }`,
        1,
      );
    }

    // ── (e) Optional git snapshot & bare mirror push (F-10 / F-21 / F-31) ──
    let snapshot: SnapshotResult | undefined;
    if (opts.snapshotRepo) {
      snapshot = runSnapshotAndMirror({
        storeDir: store,
        snapshotRepo: opts.snapshotRepo,
        mirrorRepo: opts.mirrorRepo,
        note: opts.note,
        timeoutMs: opts.gitTimeoutMs,
      });
    }

    return {
      store,
      memoryMd,
      storeIndexPath,
      dest,
      ...(project ? { project } : {}),
      dryRun: false,
      entryCount: rewritten.entries.length,
      pathsRewritten,
      gateErrors,
      gateWarnings,
      destIssues,
      backupPath,
      wrote: true,
      ...(snapshot ? { snapshot } : {}),
    };
  }, lockWaitMs);
}

/** Render a refresh result as a human screen. */
export function printRefresh(r: RefreshResult): void {
  log();
  log(`${BOLD}loadout-os refresh${RESET} ${DIM}— Index Freshness Ritual${RESET}`);
  log(`  ${DIM}store: ${r.store}${RESET}`);
  if (r.project) {
    log(`  ${DIM}project: ${r.project}${RESET}`);
  }
  log(`  ${DIM}dest:  ${r.dest}${RESET}`);
  log();

  if (r.dryRun) {
    info(`${BOLD}--dry-run${RESET} — nothing was written.`);
    log(
      `  ${CYAN}Would write${RESET} ${r.dest}: ` +
        `${r.entryCount} entr${r.entryCount === 1 ? "y" : "ies"}, ` +
        `${r.pathsRewritten} relative path(s) → absolute.`,
    );
    if (existsSync(r.dest)) {
      log(`  ${DIM}A live dest exists; a real run would back it up to ${r.dest}.bak first.${RESET}`);
    } else {
      log(`  ${DIM}No live dest yet; a real run would create it (no backup needed).${RESET}`);
    }
    if (r.gateWarnings.length > 0) warn(`${r.gateWarnings.length} validation warning(s) (non-blocking).`);
    log();
    return;
  }

  if (!r.project) {
    ok(`Wrote store index: ${r.storeIndexPath}`);
  }
  const label = r.project ? "project index" : "global index";
  ok(`Wrote ${label}: ${r.dest} (${r.entryCount} entries, ${r.pathsRewritten} paths → absolute)`);
  if (r.backupPath) {
    log(`  ${DIM}compensator: backed up previous dest → ${r.backupPath}${RESET}`);
    log(`  ${DIM}undo: copy ${r.backupPath} back over ${r.dest}${RESET}`);
  } else {
    log(`  ${DIM}compensator: no prior dest existed; nothing to back up (undo = delete ${r.dest})${RESET}`);
  }
  if (r.snapshot) {
    ok(r.snapshot.message);
  }
  if (r.gateWarnings.length > 0) {
    warn(`${r.gateWarnings.length} validation warning(s) (non-blocking):`);
    for (const i of r.gateWarnings) log(`    ${YELLOW}![${i.code}]${RESET} ${i.message}`);
  }
  if (r.destIssues.length > 0) {
    const errs = r.destIssues.filter((i) => i.severity === "error");
    const wrns = r.destIssues.filter((i) => i.severity === "warning");
    if (errs.length > 0) {
      warn(`dest re-validation found ${errs.length} structural error(s) (reported, not blocking):`);
      for (const i of errs) log(`    ${RED}✗[${i.code}]${RESET} ${i.message}`);
    }
    if (wrns.length > 0) {
      for (const i of wrns) log(`    ${DIM}![${i.code}] ${i.message}${RESET}`);
    }
  }
  log();
  if (r.project) {
    log(
      `  ${DIM}This refreshed the PROJECT resolver index (${r.dest}); the global index (${defaultDest()}) was NOT modified.${RESET}`,
    );
  } else if (sameResolvedPath(r.dest, defaultDest())) {
    log(
      `  ${DIM}This refreshed the LIVE global resolver index the UserPromptSubmit hook reads on every prompt — the change is live now.${RESET}`,
    );
  } else {
    log(
      `  ${DIM}Note: --dest is a custom path, not the live resolver index (${defaultDest()}) — the index the hook reads was NOT modified. Re-run without --dest to refresh the live one.${RESET}`,
    );
  }
  log();
}

/**
 * Print the validation errors that triggered the andon halt, in the shared
 * structured shape, for the dispatcher to render before exiting 1.
 */
export function printRefreshAndon(issues: ValidationIssue[]): void {
  log();
  log(`${RED}${BOLD}loadout-os refresh — ANDON HALT${RESET}`);
  log(`  ${DIM}validation failed; nothing was written downstream.${RESET}`);
  log();
  for (const i of issues) {
    log(`  ${RED}✗ [${i.code}]${RESET} ${i.message}`);
    if (i.hint) log(`    ${DIM}${i.hint}${RESET}`);
  }
  log();
}

/**
 * Parse and validate `--id-source title|name` from CLI args.
 */
export function parseIdSourceFlag(args: string[]): IdSource | undefined {
  const raw = flagValue(args, "id-source");
  if (raw === undefined) return undefined;
  const val = raw.trim().toLowerCase();
  if (val === "title" || val === "name") return val;
  fail(
    "INVALID_FLAG_VALUE",
    `Invalid --id-source "${raw}": expected "title" or "name".`,
    "Use '--id-source title' or '--id-source name'.",
    1,
  );
}

/**
 * Dispatcher wiring: parse flags, run refresh, render, map exit codes.
 *   0 success · 1 andon validation error OR write/git failure · 2 store/MEMORY.md missing or timeout
 */
export function dispatchRefresh(args: string[]): void {
  const store = flagValue(args, "store");
  const project = flagValue(args, "project");
  const dest = flagValue(args, "dest");
  const seatsPath = flagValue(args, "seats");
  const allowStoreChange = hasFlag(args, "allow-store-change");
  const dryRun = hasFlag(args, "dry-run");
  const fixSummaries = hasFlag(args, "fix") || hasFlag(args, "sync-summaries");
  const snapshotRepo = flagValue(args, "snapshot-repo");
  const mirrorRepo = flagValue(args, "mirror-repo");
  const note = flagValue(args, "note");
  const idSource = parseIdSourceFlag(args);
  const maxLinesStr = flagValue(args, "max-lines");
  const maxBytesStr = flagValue(args, "max-bytes");
  const maxLines = maxLinesStr !== undefined ? Number(maxLinesStr) : undefined;
  const maxBytes = maxBytesStr !== undefined ? Number(maxBytesStr) : undefined;

  try {
    const result = runRefresh({
      store,
      project,
      dest,
      seatsPath,
      allowStoreChange,
      dryRun,
      fixSummaries,
      snapshotRepo,
      mirrorRepo,
      note,
      idSource,
      maxLines: Number.isFinite(maxLines) ? maxLines : undefined,
      maxBytes: Number.isFinite(maxBytes) ? maxBytes : undefined,
    });
    printRefresh(result);
  } catch (e) {
    if (e instanceof RefreshError) {
      if (e.code === "VALIDATION_FAILED" && e.issues) {
        printRefreshAndon(e.issues);
      } else {
        log();
        log(`  ${RED}✗ [${e.code}]${RESET} ${e.message}`);
        log();
      }
      fail(e.code, e.message, undefined, e.exitCode);
    }
    throw e;
  }
}
