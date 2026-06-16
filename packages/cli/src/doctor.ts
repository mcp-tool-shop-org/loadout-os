/**
 * loadout-os doctor — read-only health screen.
 *
 * Composes the three libraries (no new logic) into one pass/warn/fail report
 * over the live knowledge OS: the canonical memory store, the global resolver
 * index, the runtime hook (mirror vs live), and the observability loop. NEVER
 * writes anything — every check is a pure read.
 *
 * Standards compliance (workflow-standards.md — read-only diagnostic, NOT a
 * pipeline with irreversible steps):
 *   EXTERNAL_VERIFIER 2 — each check delegates to a library it does not own
 *     (validateMemory / validateIndex / discoverLayers), not to self-graded
 *     prose; the CLI only renders.
 *   ANDON_AUTHORITY 2 — any ✗ flips overall `ok` to false and the dispatcher
 *     exits 1, halting a caller that gates on doctor.
 *   NAMED_COMPENSATORS skip: no irreversible action — doctor is pure read, so
 *     there is nothing to undo.
 *   PIN_PER_STEP / DECOMPOSE_BY_SECRETS / UNCERTAINTY_GATED_HUMANS skip:
 *     not a multi-model pipeline; this is a single deterministic screen.
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

import { analyzeMemoryMd, validateMemory } from "@mcptoolshop/claude-memories";
import {
  validateIndex,
  discoverLayers,
  type LoadoutIndex,
} from "@mcptoolshop/ai-loadout";

import { BOLD, DIM, RESET, GREEN, YELLOW, RED, log } from "./console.js";

export type CheckStatus = "pass" | "warn" | "fail";

export interface DoctorCheck {
  id: string;
  status: CheckStatus;
  message: string;
  hint?: string;
}

export interface DoctorResult {
  checks: DoctorCheck[];
  ok: boolean; // false iff any check failed (warns do not flip it)
}

export interface DoctorPaths {
  /** Canonical memory store directory (holds MEMORY.md). */
  store: string;
  /** Generated global resolver index (~/.ai-loadout/index.json). */
  index: string;
  /** Claude Code settings.json (hook wiring lives here). */
  settings: string;
  /** Append-only usage log (~/.ai-loadout/usage.jsonl). */
  usage: string;
  /** Source-of-truth hook entrypoint in this repo (apps/hook/loadout-hook.mjs). */
  hookSource: string;
  /** Live mirror of the hook Claude Code actually runs (~/.claude/loadout-hook/loadout-hook.mjs). */
  hookMirror: string;
}

/** ~7 days — a usage.jsonl untouched longer than this is "stale" (warn). */
const RECENT_MS = 7 * 24 * 60 * 60 * 1000;

export function defaultDoctorPaths(repoRoot: string = process.cwd()): DoctorPaths {
  const home = homedir();
  return {
    store: resolve(home, ".claude", "projects", "F--AI", "memory"),
    index: resolve(home, ".ai-loadout", "index.json"),
    settings: resolve(home, ".claude", "settings.json"),
    usage: resolve(home, ".ai-loadout", "usage.jsonl"),
    hookSource: resolve(repoRoot, "apps", "hook", "loadout-hook.mjs"),
    hookMirror: resolve(home, ".claude", "loadout-hook", "loadout-hook.mjs"),
  };
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Load + shape-guard an index file. Returns the index or a fail check. */
function loadIndex(
  path: string,
): { index: LoadoutIndex } | { check: DoctorCheck } {
  if (!existsSync(path)) {
    return {
      check: {
        id: "index-parse",
        status: "fail",
        message: `Global index not found: ${path}`,
        hint: "Run the Index Freshness Ritual (loadout-os refresh, once implemented) to generate it.",
      },
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch (e) {
    return {
      check: {
        id: "index-parse",
        status: "fail",
        message: `Global index is not valid JSON: ${path}`,
        hint: (e as Error).message,
      },
    };
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as LoadoutIndex).entries)
  ) {
    return {
      check: {
        id: "index-parse",
        status: "fail",
        message: `Global index parsed but has no entries[] array: ${path}`,
        hint: "Regenerate the index from the store.",
      },
    };
  }
  return { index: parsed as LoadoutIndex };
}

/**
 * Run all doctor checks. Pure read — no writes, ever.
 */
export function runDoctor(paths: DoctorPaths): DoctorResult {
  const checks: DoctorCheck[] = [];

  // (a) store MEMORY.md validates (0 errors)
  const memoryMd = join(paths.store, "MEMORY.md");
  if (!existsSync(memoryMd)) {
    checks.push({
      id: "store-validates",
      status: "fail",
      message: `Store MEMORY.md not found: ${memoryMd}`,
      hint: "Point --store at the directory containing MEMORY.md.",
    });
  } else {
    try {
      const analysis = analyzeMemoryMd(memoryMd);
      const issues = validateMemory(analysis);
      const errors = issues.filter((i) => i.severity === "error").length;
      const warnings = issues.filter((i) => i.severity === "warning").length;
      if (errors > 0) {
        checks.push({
          id: "store-validates",
          status: "fail",
          message: `Store MEMORY.md has ${errors} error(s), ${warnings} warning(s)`,
          hint: "Run `loadout-os memories validate <MEMORY.md>` for detail.",
        });
      } else if (warnings > 0) {
        checks.push({
          id: "store-validates",
          status: "warn",
          message: `Store MEMORY.md valid (0 errors) with ${warnings} warning(s)`,
          hint: "Run `loadout-os memories validate <MEMORY.md>` for detail.",
        });
      } else {
        checks.push({
          id: "store-validates",
          status: "pass",
          message: `Store MEMORY.md validates (0 errors, ${analysis.refs.length} refs)`,
        });
      }
    } catch (e) {
      checks.push({
        id: "store-validates",
        status: "fail",
        message: `Could not analyze store MEMORY.md: ${(e as Error).message}`,
      });
    }
  }

  // (b) dest index parses + kernel.validateIndex
  const loaded = loadIndex(paths.index);
  let index: LoadoutIndex | null = null;
  if ("check" in loaded) {
    checks.push(loaded.check);
  } else {
    index = loaded.index;
    const issues = validateIndex(index);
    const errors = issues.filter((i) => i.severity === "error").length;
    const warnings = issues.filter((i) => i.severity === "warning").length;
    if (errors > 0) {
      checks.push({
        id: "index-parse",
        status: "fail",
        message: `Global index has ${errors} structural error(s), ${warnings} warning(s)`,
        hint: "Run `loadout-os validate <index>` for detail.",
      });
    } else if (warnings > 0) {
      checks.push({
        id: "index-parse",
        status: "warn",
        message: `Global index valid (0 errors) with ${warnings} warning(s), ${index.entries.length} entries`,
      });
    } else {
      checks.push({
        id: "index-parse",
        status: "pass",
        message: `Global index parses + validates (${index.entries.length} entries)`,
      });
    }
  }

  // (c) drift mirror↔live: hash the source hook vs the installed mirror
  if (!existsSync(paths.hookSource)) {
    checks.push({
      id: "hook-drift",
      status: "warn",
      message: `Hook source not found: ${paths.hookSource}`,
      hint: "Expected apps/hook/loadout-hook.mjs in the repo.",
    });
  } else if (!existsSync(paths.hookMirror)) {
    checks.push({
      id: "hook-drift",
      status: "warn",
      message: `Hook mirror not installed: ${paths.hookMirror}`,
      hint: "The runtime hook has not been copied to ~/.claude/loadout-hook/ yet.",
    });
  } else {
    try {
      const a = sha256(paths.hookSource);
      const b = sha256(paths.hookMirror);
      if (a === b) {
        checks.push({
          id: "hook-drift",
          status: "pass",
          message: "Hook mirror matches repo source (no drift)",
        });
      } else {
        checks.push({
          id: "hook-drift",
          status: "fail",
          message: "Hook mirror DRIFTS from repo source",
          hint: "Re-copy apps/hook/loadout-hook.mjs to ~/.claude/loadout-hook/ (the live hook is stale).",
        });
      }
    } catch (e) {
      checks.push({
        id: "hook-drift",
        status: "warn",
        message: `Could not hash hook files: ${(e as Error).message}`,
      });
    }
  }

  // (d) malformed layers via discoverLayers().searched[].malformed
  try {
    const { searched } = discoverLayers({
      globalDir: paths.index.replace(/[/\\]index\.json$/, ""),
    });
    const malformed = searched.filter((s) => s.malformed);
    if (malformed.length > 0) {
      checks.push({
        id: "layers-malformed",
        status: "fail",
        message: `${malformed.length} layer(s) present but malformed: ${malformed
          .map((m) => m.name)
          .join(", ")}`,
        hint: "Fix or remove the corrupt index file(s) listed.",
      });
    } else {
      checks.push({
        id: "layers-malformed",
        status: "pass",
        message: "No malformed layers in the resolver search path",
      });
    }
  } catch (e) {
    checks.push({
      id: "layers-malformed",
      status: "warn",
      message: `Could not discover layers: ${(e as Error).message}`,
    });
  }

  // (e) "0 core entries" warning
  if (index) {
    const coreCount = index.entries.filter((e) => e.priority === "core").length;
    if (coreCount === 0) {
      checks.push({
        id: "core-entries",
        status: "warn",
        message: "Index has 0 core entries — nothing is always-loaded",
        hint: "Confirm this is intentional; most stores expect at least one core entry.",
      });
    } else {
      checks.push({
        id: "core-entries",
        status: "pass",
        message: `${coreCount} core entr${coreCount === 1 ? "y" : "ies"} present`,
      });
    }
  } else {
    checks.push({
      id: "core-entries",
      status: "warn",
      message: "Skipped core-entries check (no readable index)",
    });
  }

  // (f) observability loop not wired: budget.avg_task_load_observed === null
  if (index) {
    const observed = index.budget?.avg_task_load_observed ?? null;
    if (observed === null) {
      checks.push({
        id: "observability-loop",
        status: "warn",
        message: "Observability loop not wired (budget.avg_task_load_observed is null)",
        hint: "Run `loadout-os report` once usage.jsonl has data, then fold the observed average back into the index.",
      });
    } else {
      checks.push({
        id: "observability-loop",
        status: "pass",
        message: `Observed avg task load recorded: ${observed} tokens`,
      });
    }
  } else {
    checks.push({
      id: "observability-loop",
      status: "warn",
      message: "Skipped observability check (no readable index)",
    });
  }

  // (g) hook wired in settings.json (grep for the loadout-hook command)
  if (!existsSync(paths.settings)) {
    checks.push({
      id: "hook-wired",
      status: "warn",
      message: `settings.json not found: ${paths.settings}`,
      hint: "Wire the UserPromptSubmit hook in ~/.claude/settings.json.",
    });
  } else {
    try {
      const raw = readFileSync(paths.settings, "utf-8");
      if (/loadout-hook/.test(raw)) {
        checks.push({
          id: "hook-wired",
          status: "pass",
          message: "Hook wired in settings.json (loadout-hook command found)",
        });
      } else {
        checks.push({
          id: "hook-wired",
          status: "fail",
          message: "Hook NOT wired in settings.json (no loadout-hook command)",
          hint: "Add a UserPromptSubmit hook that runs the loadout-hook entrypoint.",
        });
      }
    } catch (e) {
      checks.push({
        id: "hook-wired",
        status: "warn",
        message: `Could not read settings.json: ${(e as Error).message}`,
      });
    }
  }

  // (h) usage.jsonl exists + nonzero + recent mtime
  if (!existsSync(paths.usage)) {
    checks.push({
      id: "usage-growing",
      status: "warn",
      message: `usage.jsonl not found: ${paths.usage}`,
      hint: "The hook writes this on first injected prompt; nothing has been recorded yet.",
    });
  } else {
    try {
      const st = statSync(paths.usage);
      if (st.size === 0) {
        checks.push({
          id: "usage-growing",
          status: "warn",
          message: "usage.jsonl exists but is empty",
          hint: "The hook has not injected any pointers yet.",
        });
      } else {
        const ageMs = Date.now() - st.mtimeMs;
        if (ageMs > RECENT_MS) {
          const days = Math.round(ageMs / (24 * 60 * 60 * 1000));
          checks.push({
            id: "usage-growing",
            status: "warn",
            message: `usage.jsonl is stale (last write ${days} day(s) ago)`,
            hint: "The hook may not be firing; check that it is wired and not disabled (AI_LOADOUT_HOOK).",
          });
        } else {
          checks.push({
            id: "usage-growing",
            status: "pass",
            message: `usage.jsonl is growing (${st.size.toLocaleString()} bytes, recent)`,
          });
        }
      }
    } catch (e) {
      checks.push({
        id: "usage-growing",
        status: "warn",
        message: `Could not stat usage.jsonl: ${(e as Error).message}`,
      });
    }
  }

  const ok = !checks.some((c) => c.status === "fail");
  return { checks, ok };
}

/** Render a doctor result as a human screen. */
export function printDoctor(result: DoctorResult, paths: DoctorPaths): void {
  log();
  log(`${BOLD}loadout-os doctor${RESET} ${DIM}— read-only health screen${RESET}`);
  log();
  log(`  ${DIM}store:    ${paths.store}${RESET}`);
  log(`  ${DIM}index:    ${paths.index}${RESET}`);
  log(`  ${DIM}settings: ${paths.settings}${RESET}`);
  log(`  ${DIM}usage:    ${paths.usage}${RESET}`);
  log();
  for (const c of result.checks) {
    const glyph =
      c.status === "pass"
        ? `${GREEN}✓${RESET}`
        : c.status === "warn"
          ? `${YELLOW}!${RESET}`
          : `${RED}✗${RESET}`;
    log(`  ${glyph} ${c.message} ${DIM}[${c.id}]${RESET}`);
    if (c.hint && c.status !== "pass") {
      log(`      ${DIM}${c.hint}${RESET}`);
    }
  }
  const fails = result.checks.filter((c) => c.status === "fail").length;
  const warns = result.checks.filter((c) => c.status === "warn").length;
  const passes = result.checks.filter((c) => c.status === "pass").length;
  log();
  log(
    `  ${passes} pass, ${warns > 0 ? YELLOW : DIM}${warns} warn${RESET}, ${fails > 0 ? RED : DIM}${fails} fail${RESET} — ${
      result.ok ? `${GREEN}healthy${RESET}` : `${RED}needs attention${RESET}`
    }`,
  );
  log();
}
