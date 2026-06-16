/**
 * loadout-os refresh — the Index Freshness Ritual, folded into one command.
 *
 * Replaces the manual three-step ritual (claude-memories index → validate →
 * copy to ~/.ai-loadout/index.json). It (a) regenerates the store index from
 * MEMORY.md, (b) validates with an ANDON HALT on any error-severity issue,
 * (c) rewrites relative entry paths to absolute paths under the store root and
 * writes the global resolver index the runtime hook reads, then (d) re-validates
 * the written destination (warn-only).
 *
 * Standards compliance (workflow-standards.md — this IS a pipeline with an
 * irreversible write, unlike doctor/report which are pure reads):
 *
 *   ANDON_AUTHORITY 3 — step (b) is a hard halt: if validateMemory /
 *     validateMemoryIndex surface ANY error-severity issue, refresh prints them
 *     and EXITS 1 writing nothing downstream. The bad index never reaches the
 *     live global path the hook reads. Tested: `refresh: andon halt on an
 *     invalid store writes nothing and signals error`.
 *
 *   NAMED_COMPENSATORS 3 — the one irreversible action is the write to --dest
 *     (the live global index ~/.ai-loadout/index.json that the UserPromptSubmit
 *     hook reads on every prompt). COMPENSATOR: before writing, if --dest
 *     already exists we copy it to `<dest>.bak`; on ANY write failure we restore
 *     <dest> from that backup and re-throw, so a half-written or failed write
 *     never leaves the live index corrupt. The undo line is printed for the
 *     human ("undo: copy <dest>.bak back over <dest>"). Owner: the operator who
 *     ran refresh. Tested: `refresh: compensator backs up an existing dest`.
 *
 *   EXTERNAL_VERIFIER 2 — generation (claude-memories generateIndex) and
 *     verification (kernel validateIndex on the written dest) are different
 *     library surfaces; the CLI does not self-grade its own output.
 *
 *   PIN_PER_STEP 1 — the three wrapped library versions are pinned in
 *     package.json (the "model" of a deterministic pipeline is its dep set);
 *     not byte-pinned per invocation. Remediation: not required for a
 *     deterministic (non-LLM) pipeline — there is no sampling to replay.
 *
 *   DECOMPOSE_BY_SECRETS 2 — index generation, validation, path-rewrite, and
 *     the write+compensator are separate functions; the volatile bit (the
 *     irreversible write) is isolated behind one guarded writer.
 *
 *   UNCERTAINTY_GATED_HUMANS 2 — --dry-run is the human gate: when uncertain,
 *     run it first to see the N entries / M paths that WOULD change before
 *     committing the live write. Framed contrastively in output.
 */

import {
  writeFileSync,
  existsSync,
  statSync,
  copyFileSync,
  mkdirSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";

import {
  analyzeMemoryMd,
  generateIndex as generateMemoryIndex,
  validateMemory,
  validateMemoryIndex,
  type MemoryIndex,
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

/** Canonical memory store (holds MEMORY.md + topic files). */
export const DEFAULT_STORE =
  "C:/Users/mikey/.claude/projects/F--AI/memory";

/** Default destination: the live global resolver index the hook reads. */
export function defaultDest(): string {
  return join(homedir(), ".ai-loadout", "index.json");
}

export interface RefreshOptions {
  /** Store directory containing MEMORY.md (default DEFAULT_STORE). */
  store?: string;
  /** Destination global index path (default ~/.ai-loadout/index.json). */
  dest?: string;
  /** Compute everything, write nothing; report what WOULD change. */
  dryRun?: boolean;
}

export interface RefreshResult {
  store: string;
  memoryMd: string;
  storeIndexPath: string;
  dest: string;
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

/**
 * Rewrite each entry's relative `path` to an absolute path under the store
 * root, and stamp `source` = <store>/MEMORY.md. Returns a fresh index object
 * (does not mutate the input) plus a count of how many paths were rewritten.
 */
export function rewritePathsAbsolute(
  index: MemoryIndex,
  storeRoot: string,
  memoryMd: string,
): { index: MemoryIndex; pathsRewritten: number } {
  let pathsRewritten = 0;
  const entries = index.entries.map((e) => {
    if (isAbsolute(e.path)) return { ...e };
    pathsRewritten++;
    return { ...e, path: resolve(storeRoot, e.path) };
  });
  return {
    index: { ...index, entries, source: memoryMd },
    pathsRewritten,
  };
}

/**
 * Core refresh logic. Pure with respect to its inputs (store/dest are
 * parameters), so tests drive it against a SCRATCH store + a temp dest —
 * never the live ~/.ai-loadout or the canonical store.
 *
 * Steps:
 *   (a) index the store          — generateIndex(analyzeMemoryMd(MEMORY.md))
 *   (b) validate (ANDON HALT)    — validateMemory + validateMemoryIndex
 *   (c) path-rewrite + copy      — rewrite to absolute, write --dest (guarded)
 *   (d) re-validate the dest     — kernel.validateIndex (warn-only)
 *
 * Throws RefreshError with the right exitCode on a missing store (2), an andon
 * validation error (1), or a write failure (1, after compensator restore).
 */
export function runRefresh(opts: RefreshOptions): RefreshResult {
  const store = resolve(opts.store ?? DEFAULT_STORE);
  const dest = resolve(opts.dest ?? defaultDest());
  const dryRun = !!opts.dryRun;

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

  // ── (a) index the store ──────────────────────────────────────
  const analysis = analyzeMemoryMd(memoryMd);
  const storeIndex = generateMemoryIndex(analysis);
  const storeIndexPath = join(store, "index.json");

  // ── (b) validate — ANDON HALT on any error-severity issue ────
  const gate: ValidationIssue[] = [
    ...validateMemory(analysis),
    ...validateMemoryIndex(storeIndex),
  ];
  const gateErrors = gate.filter((i) => i.severity === "error");
  const gateWarnings = gate.filter((i) => i.severity === "warning");
  if (gateErrors.length > 0) {
    // Halt the pipeline: nothing downstream (store index.json, dest) is written.
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
  const storeJson = JSON.stringify(storeIndex, null, 2) + "\n";

  // re-validate the rewritten dest payload (warn-only) — kernel structure check
  const destIssues = kernelValidateIndex(rewritten as unknown as LoadoutIndex);

  if (dryRun) {
    return {
      store,
      memoryMd,
      storeIndexPath,
      dest,
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

  // write the store index.json first (idempotent, in-tree, reversible by re-run)
  writeFileSync(storeIndexPath, storeJson, "utf-8");

  // ── COMPENSATOR (NAMED, irreversible write to the live global index) ──
  // The dest is the index the UserPromptSubmit hook reads on every prompt; a
  // corrupt/half-written dest breaks every future session. Before overwriting,
  // back up the existing dest to <dest>.bak; on ANY write failure, restore the
  // dest from that backup and re-throw. Undo command is printed for the human.
  let backupPath: string | null = null;
  if (existsSync(dest)) {
    backupPath = `${dest}.bak`;
    copyFileSync(dest, backupPath);
  }
  try {
    // Create the parent dir for a first-ever write (e.g. a fresh machine with
    // no ~/.ai-loadout yet). mkdir is idempotent + reversible, not the
    // irreversible action the compensator guards — that is the dest write below.
    const destDir = dirname(dest);
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
    writeFileSync(dest, destJson, "utf-8");
  } catch (e) {
    // restore from the backup so the live index is never left corrupt
    if (backupPath && existsSync(backupPath)) {
      try {
        copyFileSync(backupPath, dest);
      } catch {
        /* best-effort restore; surface the original error below */
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

  return {
    store,
    memoryMd,
    storeIndexPath,
    dest,
    dryRun: false,
    entryCount: rewritten.entries.length,
    pathsRewritten,
    gateErrors,
    gateWarnings,
    destIssues,
    backupPath,
    wrote: true,
  };
}

/** Render a refresh result as a human screen. */
export function printRefresh(r: RefreshResult): void {
  log();
  log(`${BOLD}loadout-os refresh${RESET} ${DIM}— Index Freshness Ritual${RESET}`);
  log(`  ${DIM}store: ${r.store}${RESET}`);
  log(`  ${DIM}dest:  ${r.dest}${RESET}`);
  log();

  if (r.dryRun) {
    info(`${BOLD}--dry-run${RESET} — nothing was written.`);
    log(
      `  ${CYAN}Would write${RESET} ${r.storeIndexPath} and ${r.dest}: ` +
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

  ok(`Wrote store index: ${r.storeIndexPath}`);
  ok(`Wrote global index: ${r.dest} (${r.entryCount} entries, ${r.pathsRewritten} paths → absolute)`);
  if (r.backupPath) {
    log(`  ${DIM}compensator: backed up previous dest → ${r.backupPath}${RESET}`);
    log(`  ${DIM}undo: copy ${r.backupPath} back over ${r.dest}${RESET}`);
  } else {
    log(`  ${DIM}compensator: no prior dest existed; nothing to back up (undo = delete ${r.dest})${RESET}`);
  }
  if (r.gateWarnings.length > 0) {
    warn(`${r.gateWarnings.length} validation warning(s) (non-blocking):`);
    for (const i of r.gateWarnings) log(`    ${YELLOW}![${i.code}]${RESET} ${i.message}`);
  }
  if (r.destIssues.length > 0) {
    const errs = r.destIssues.filter((i) => i.severity === "error");
    const wrns = r.destIssues.filter((i) => i.severity === "warning");
    if (errs.length > 0) {
      // dest re-validation is warn-only by contract; surface but do not fail.
      warn(`dest re-validation found ${errs.length} structural error(s) (reported, not blocking):`);
      for (const i of errs) log(`    ${RED}✗[${i.code}]${RESET} ${i.message}`);
    }
    if (wrns.length > 0) {
      for (const i of wrns) log(`    ${DIM}![${i.code}] ${i.message}${RESET}`);
    }
  }
  log();
  log(
    `  ${DIM}Note: this scratch/CLI run wrote the configured --dest. A LIVE run against the canonical store + ~/.ai-loadout is deferred to a coordinator-supervised step.${RESET}`,
  );
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
 * Dispatcher wiring: parse flags, run refresh, render, map exit codes.
 *   0 success · 1 andon validation error OR write failure · 2 store/MEMORY.md missing
 */
export function dispatchRefresh(args: string[]): void {
  const store = flagValue(args, "store") ?? DEFAULT_STORE;
  const dest = flagValue(args, "dest") ?? defaultDest();
  const dryRun = hasFlag(args, "dry-run");

  try {
    const result = runRefresh({ store, dest, dryRun });
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
      // Surface through the shared structured error so the process boundary
      // exits with the mapped code (2 store missing, 1 andon/write).
      fail(e.code, e.message, undefined, e.exitCode);
    }
    throw e;
  }
}
