/**
 * loadout-os hook — runtime hook commands:
 *   - loadout-os hook test           (drive the UserPromptSubmit router on a sample prompt)
 *   - loadout-os hook session-start  (SessionStart / UserPromptSubmit board injector & staleness check)
 *   - loadout-os hook pre-compact    (PreCompact board staleness check before context compaction)
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  rmSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { tmpdir, homedir } from "node:os";

import {
  findProjectIndex,
  parseFrontmatter,
  type LoadoutEntry,
  type LoadoutIndex,
} from "@mcptoolshop/ai-loadout";

import { BOLD, DIM, RESET, YELLOW, CYAN, log, ok, warn, info } from "./console.js";
import { runRefresh, projectDest } from "./refresh.js";

export interface HookTestOptions {
  prompt: string;
  hookPath: string;
  /** Live global index to copy into the isolated HOME (default ~/.ai-loadout/index.json). */
  liveIndex?: string;
}

export interface HookTestResult {
  ran: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  injected: boolean;
  /** Parsed additionalContext when the hook injected, else null. */
  additionalContext: string | null;
  note: string;
}

const DEFAULT_PROMPT =
  "How do I run the dogfood swarm and full-treatment on a repo before npm publish?";

export function defaultHookPath(repoRoot: string = process.cwd()): string {
  return resolve(repoRoot, "apps", "hook", "loadout-hook.mjs");
}

/**
 * Write a string to stdout as explicit UTF-8 bytes so non-ASCII characters
 * (em-dash, arrows, stars, warning symbols) never mojibake on Windows (F-05).
 */
export function writeUtf8Stdout(text: string): void {
  if (!text) return;
  process.stdout.write(Buffer.from(text, "utf-8"));
}

/**
 * Read stdin synchronously if piped/redirected; returns empty string on TTY or error.
 */
export function readHookStdin(): string {
  try {
    if (process.stdin.isTTY) return "";
    return readFileSync(0, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Run the hook against a sample prompt in an isolated HOME so the live
 * usage.jsonl is never written. Returns a structured result; never throws for
 * an absent hook (returns ran:false).
 */
export function runHookTest(opts: HookTestOptions): HookTestResult {
  const prompt = opts.prompt || DEFAULT_PROMPT;
  const hookPath = opts.hookPath;
  const liveIndex = opts.liveIndex ?? join(homedir(), ".ai-loadout", "index.json");

  if (!existsSync(hookPath)) {
    return {
      ran: false,
      exitCode: null,
      stdout: "",
      stderr: "",
      injected: false,
      additionalContext: null,
      note:
        `hook test runs from the loadout-os repo; apps/hook not found ` +
        `(${hookPath}). Clone/run from the repo to exercise the runtime hook.`,
    };
  }

  const sandbox = mkdtempSync(join(tmpdir(), "loadout-hook-test-"));
  try {
    const sandboxAiLoadout = join(sandbox, ".ai-loadout");
    mkdirSync(sandboxAiLoadout, { recursive: true });

    let indexCopied = false;
    if (existsSync(liveIndex)) {
      copyFileSync(liveIndex, join(sandboxAiLoadout, "index.json"));
      indexCopied = true;
    }

    const payload = JSON.stringify({
      prompt,
      session_id: "loadout-os-hook-test",
    });

    const env = {
      ...process.env,
      HOME: sandbox,
      USERPROFILE: sandbox,
    };

    const res = spawnSync(process.execPath, [hookPath], {
      input: payload,
      env,
      encoding: "utf-8",
      cwd: dirname(hookPath),
    });

    const stdout = res.stdout ?? "";
    const stderr = res.stderr ?? "";

    let injected = false;
    let additionalContext: string | null = null;
    if (stdout.trim()) {
      try {
        const parsed = JSON.parse(stdout);
        additionalContext =
          parsed?.hookSpecificOutput?.additionalContext ?? null;
        injected = !!additionalContext;
      } catch {
        // non-JSON stdout — leave injected false, surface raw stdout
      }
    }

    const note = indexCopied
      ? "Ran against an isolated copy of the live index (usage.jsonl write sandboxed)."
      : `No live index at ${liveIndex} — hook ran but had nothing to match (expected silent).`;

    return {
      ran: true,
      exitCode: res.status,
      stdout,
      stderr,
      injected,
      additionalContext,
      note,
    };
  } finally {
    try {
      rmSync(sandbox, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
}

/** Render a hook-test result. */
export function printHookTest(prompt: string, r: HookTestResult): void {
  log();
  log(`${BOLD}loadout-os hook test${RESET}`);
  log(`  ${DIM}prompt:${RESET} ${CYAN}${prompt}${RESET}`);
  log();
  if (!r.ran) {
    warn(r.note);
    return;
  }
  info(r.note);
  log(`  ${DIM}exit code: ${r.exitCode}${RESET}`);
  log();
  if (r.injected && r.additionalContext) {
    ok("Hook injected pointers:");
    for (const line of r.additionalContext.split("\n")) {
      log(`    ${line}`);
    }
  } else {
    log(`  ${YELLOW}!${RESET} Hook was silent (no pointer met the score floor for this prompt).`);
    if (r.stderr.trim()) {
      log(`  ${DIM}stderr:${RESET}`);
      for (const line of r.stderr.split("\n")) {
        if (line.trim()) log(`    ${DIM}${line}${RESET}`);
      }
    }
  }
  log();
}

// ── Part C: Session-Start Board & Pre-Compact Staleness Hook ──────────

export const DEFAULT_BOARD_MAX_LINES = 60;
export const DEFAULT_BOARD_MAX_BYTES = 6_000;
export const DEFAULT_PRECOMPACT_STALE_MIN = 60;

export interface SessionStartOptions {
  /** Explicit project root containing `.claude/loadout/index.json`. */
  project?: string;
  /** Explicit memory store directory containing `MEMORY.md` and topic files. */
  store?: string;
  /** Working directory fallback (e.g. from stdin hook payload `cwd`). */
  cwd?: string;
  /** When true, emit only staleness/health warnings (for UserPromptSubmit). */
  userPromptSubmit?: boolean;
  /** When true, check board staleness before compaction (for PreCompact). */
  preCompact?: boolean;
  /** Maximum lines per injected session-start file (default 60). */
  maxLines?: number;
  /** Maximum UTF-8 bytes per injected session-start file (default 6,000). */
  maxBytes?: number;
  /** Override stale threshold in minutes. */
  staleAfterMin?: number;
  /** Optional clock override for deterministic tests (epoch ms). */
  nowMs?: number;
}

export interface SessionStartResult {
  output: string;
  warnings: string[];
  injectedFiles: string[];
  refreshedStore: boolean;
  truncatedFiles: string[];
}

interface DiscoveredBoard {
  id: string;
  filePath: string;
  staleAfterMin?: number;
  maxLines?: number;
  maxBytes?: number;
}

/**
 * Check whether any `.md` file in `storeDir` has an `mtimeMs` newer than `indexPath` (F-13).
 */
function isStoreNewerThanIndex(storeDir: string, indexPath: string): boolean {
  try {
    if (!existsSync(storeDir) || !existsSync(indexPath)) return false;
    const indexMtime = statSync(indexPath).mtimeMs;
    const entries = readdirSync(storeDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        const mdPath = join(storeDir, entry.name);
        if (statSync(mdPath).mtimeMs > indexMtime) {
          return true;
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Truncate `content` to at most `maxLines` lines and `maxBytes` UTF-8 bytes,
 * appending a visible truncation note when either cap is exceeded (F-29).
 */
export function capBoardContent(
  content: string,
  fileName: string,
  maxLines: number,
  maxBytes: number,
): { text: string; truncated: boolean } {
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const totalLines = lines.length;
  const totalBytes = Buffer.byteLength(normalized, "utf-8");

  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return { text: normalized.endsWith("\n") ? normalized : normalized + "\n", truncated: false };
  }

  const keptLines: string[] = [];
  let runningBytes = 0;
  for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
    const lineWithNl = lines[i] + "\n";
    const lineBytes = Buffer.byteLength(lineWithNl, "utf-8");
    if (runningBytes + lineBytes > maxBytes) {
      if (keptLines.length === 0) {
        // First line alone exceeds maxBytes: slice buffer safely on UTF-8 boundary
        const buf = Buffer.from(lines[i], "utf-8").subarray(0, Math.max(1, maxBytes));
        keptLines.push(buf.toString("utf-8"));
      }
      break;
    }
    keptLines.push(lines[i]);
    runningBytes += lineBytes;
  }

  const note =
    `[truncated: ${fileName} exceeded session-start cap ` +
    `(${totalLines} lines / ${totalBytes} bytes > cap ${maxLines} lines / ${maxBytes} bytes) ` +
    `— trim the board or archive completed items]\n`;

  return {
    text: keptLines.join("\n") + "\n" + note,
    truncated: true,
  };
}

/**
 * Run `session-start` (or its `--user-prompt-submit` / `pre-compact` variants).
 * Always fails open (never throws) and surfaces visible warnings when the index
 * or board is missing, corrupt, or stale (F-01, F-11, F-13, F-17, F-29).
 */
export function runSessionStart(opts: SessionStartOptions = {}): SessionStartResult {
  const warnings: string[] = [];
  const injectedFiles: string[] = [];
  const truncatedFiles: string[] = [];
  let refreshedStore = false;
  const nowMs = opts.nowMs ?? Date.now();

  const startDir = opts.project
    ? resolve(opts.project)
    : opts.cwd
      ? resolve(opts.cwd)
      : process.cwd();

  const envProjectIndex = process.env.AI_LOADOUT_PROJECT_INDEX?.trim();
  const explicitProject = Boolean(opts.project || envProjectIndex);

  let indexPath: string | null = null;
  if (envProjectIndex) {
    indexPath = resolve(envProjectIndex);
  } else if (opts.project) {
    indexPath = projectDest(opts.project);
  } else {
    indexPath = findProjectIndex(startDir);
  }

  let loadedIndex: LoadoutIndex | null = null;
  let indexBaseDir = startDir;

  if (indexPath) {
    indexBaseDir = dirname(dirname(dirname(indexPath)));
    if (!existsSync(indexPath)) {
      if (explicitProject) {
        warnings.push(
          `[loadout-os] WARNING: project index not found at ${indexPath}. Run 'loadout-os refresh --project <root> --store <dir>' to build it.`,
        );
      }
    } else {
      try {
        const raw = readFileSync(indexPath, "utf-8");
        const parsed = JSON.parse(raw) as LoadoutIndex;
        if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.entries)) {
          warnings.push(
            `[loadout-os] WARNING: project index at ${indexPath} is malformed (missing entries array).`,
          );
        } else {
          loadedIndex = parsed;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(
          `[loadout-os] WARNING: failed to parse project index at ${indexPath}: ${msg}`,
        );
      }
    }
  }

  // Determine store directory from --store or loadedIndex.source (F-13, F-23)
  let storeDir: string | null = opts.store ? resolve(opts.store) : null;
  if (!storeDir && loadedIndex?.source) {
    storeDir = dirname(resolve(loadedIndex.source));
  }

  // F-13: If any <store>/*.md is newer than the project index.json, auto-refresh or warn
  if (storeDir && indexPath && existsSync(indexPath) && isStoreNewerThanIndex(storeDir, indexPath)) {
    try {
      const refreshRes = runRefresh({
        store: storeDir,
        dest: indexPath,
        project: indexBaseDir,
      });
      if (refreshRes.wrote) {
        refreshedStore = true;
        const raw = readFileSync(indexPath, "utf-8");
        loadedIndex = JSON.parse(raw) as LoadoutIndex;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(
        `[loadout-os] WARNING: store files in ${storeDir} are newer than ${indexPath} and auto-refresh failed: ${msg}`,
      );
    }
  }

  // Discover all core entries with metadata.loadout_inject === "session-start"
  const boards: DiscoveredBoard[] = [];
  const seenPaths = new Set<string>();

  if (loadedIndex && Array.isArray(loadedIndex.entries)) {
    for (const entry of loadedIndex.entries) {
      if (entry.priority !== "core") continue;
      if (entry.metadata?.loadout_inject !== "session-start") continue;

      const resolvedPath = resolve(indexBaseDir, entry.path);
      const normKey = process.platform === "win32" ? resolvedPath.toLowerCase() : resolvedPath;
      if (seenPaths.has(normKey)) continue;
      seenPaths.add(normKey);

      const staleMin =
        typeof entry.metadata?.stale_after_min === "number"
          ? entry.metadata.stale_after_min
          : undefined;
      const entryMaxLines =
        typeof entry.metadata?.max_lines === "number" ? entry.metadata.max_lines : undefined;
      const entryMaxBytes =
        typeof entry.metadata?.max_bytes === "number" ? entry.metadata.max_bytes : undefined;

      boards.push({
        id: entry.id,
        filePath: resolvedPath,
        staleAfterMin: staleMin,
        maxLines: entryMaxLines,
        maxBytes: entryMaxBytes,
      });
    }
  }

  // Fallback: if index was missing/corrupt or had no entries, scan storeDir for session-start files
  if (boards.length === 0 && storeDir && existsSync(storeDir)) {
    try {
      const files = readdirSync(storeDir, { withFileTypes: true });
      for (const f of files) {
        if (!f.isFile() || !f.name.endsWith(".md") || f.name === "MEMORY.md") continue;
        const fullPath = join(storeDir, f.name);
        const normKey = process.platform === "win32" ? fullPath.toLowerCase() : fullPath;
        if (seenPaths.has(normKey)) continue;
        try {
          const raw = readFileSync(fullPath, "utf-8");
          const { frontmatter } = parseFrontmatter(raw);
          if (
            frontmatter &&
            frontmatter.priority === "core" &&
            frontmatter.metadata?.loadout_inject === "session-start"
          ) {
            seenPaths.add(normKey);
            boards.push({
              id: frontmatter.id,
              filePath: fullPath,
              staleAfterMin:
                typeof frontmatter.metadata?.stale_after_min === "number"
                  ? frontmatter.metadata.stale_after_min
                  : undefined,
              maxLines:
                typeof frontmatter.metadata?.max_lines === "number"
                  ? frontmatter.metadata.max_lines
                  : undefined,
              maxBytes:
                typeof frontmatter.metadata?.max_bytes === "number"
                  ? frontmatter.metadata.max_bytes
                  : undefined,
            });
          }
        } catch {
          // ignore unreadable store file during fallback scan
        }
      }
    } catch {
      // ignore unreadable storeDir
    }
  }

  if (boards.length === 0 && (explicitProject || Boolean(opts.store)) && warnings.length === 0) {
    warnings.push(
      `[loadout-os] WARNING: no core entry with metadata.loadout_inject: session-start found.`,
    );
  }

  const sections: string[] = [];

  for (const board of boards) {
    if (!existsSync(board.filePath)) {
      warnings.push(
        `[loadout-os] WARNING: session-start file missing on disk: ${board.filePath} (entry '${board.id}').`,
      );
      continue;
    }

    let rawContent: string;
    let mtimeMs: number;
    try {
      rawContent = readFileSync(board.filePath, "utf-8");
      mtimeMs = statSync(board.filePath).mtimeMs;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(
        `[loadout-os] WARNING: session-start file unreadable: ${board.filePath} (${msg}).`,
      );
      continue;
    }

    // Parse frontmatter in the file itself in case stale_after_min was updated directly
    const { frontmatter } = parseFrontmatter(rawContent);
    const fmStale =
      typeof frontmatter?.metadata?.stale_after_min === "number"
        ? frontmatter.metadata.stale_after_min
        : undefined;
    const effectiveStaleMin =
      opts.staleAfterMin ??
      fmStale ??
      board.staleAfterMin ??
      (opts.preCompact ? DEFAULT_PRECOMPACT_STALE_MIN : undefined);

    if (typeof effectiveStaleMin === "number" && effectiveStaleMin > 0) {
      const ageMin = (nowMs - mtimeMs) / 60_000;
      if (ageMin > effectiveStaleMin) {
        warnings.push(
          `[loadout-os] WARNING: ${basename(board.filePath)} is stale (${Math.round(ageMin)}m old > threshold ${effectiveStaleMin}m). Refresh ${board.filePath} before acting or compacting.`,
        );
      }
    }

    if (!opts.userPromptSubmit && !opts.preCompact) {
      const maxLines = opts.maxLines ?? board.maxLines ?? DEFAULT_BOARD_MAX_LINES;
      const maxBytes = opts.maxBytes ?? board.maxBytes ?? DEFAULT_BOARD_MAX_BYTES;
      const capped = capBoardContent(rawContent, basename(board.filePath), maxLines, maxBytes);
      if (capped.truncated) {
        truncatedFiles.push(board.filePath);
      }
      injectedFiles.push(board.filePath);
      sections.push(
        `=== [loadout-os session-start] ${basename(board.filePath)} (${board.filePath}) ===\n${capped.text}`,
      );
    }
  }

  const outParts: string[] = [];
  if (warnings.length > 0) {
    outParts.push(warnings.join("\n"));
  }
  if (sections.length > 0) {
    outParts.push(sections.join("\n"));
  }

  const output = outParts.length > 0 ? outParts.join("\n\n").replace(/\n*$/, "\n") : "";
  return {
    output,
    warnings,
    injectedFiles,
    refreshedStore,
    truncatedFiles,
  };
}
