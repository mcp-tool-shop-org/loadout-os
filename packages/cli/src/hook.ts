/**
 * loadout-os hook test — drive the runtime hook with a sample prompt.
 *
 * Spawns `apps/hook/loadout-hook.mjs` as Claude Code would (a JSON payload on
 * stdin) and shows what it injects. READ-ONLY with respect to the user's real
 * state: we isolate HOME/USERPROFILE to a throwaway temp dir and copy the live
 * global index into it, so the hook reads a faithful copy of the real index but
 * its usage.jsonl append lands in the temp dir (and is discarded), never the
 * live ~/.ai-loadout/usage.jsonl.
 *
 * Standards compliance (workflow-standards.md):
 *   NAMED_COMPENSATORS 2 — the only write the hook performs (usage.jsonl
 *     append) is redirected into a temp HOME we create and delete; the live log
 *     is never touched, so there is nothing to undo. The temp dir is the
 *     compensator: removed in `finally`.
 *   EXTERNAL_VERIFIER 2 — we run the real hook binary unmodified and observe its
 *     output, rather than re-implementing match logic here.
 *   Remaining standards skip: single deterministic invocation, not a pipeline.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir, homedir } from "node:os";

import { BOLD, DIM, RESET, GREEN, YELLOW, CYAN, log, ok, warn, info } from "./console.js";

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
      note: `Hook not found: ${hookPath}`,
    };
  }

  // Isolated HOME so the hook's index read + usage append both stay in /tmp.
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
