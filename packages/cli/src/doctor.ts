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

import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, extname, join, resolve } from "node:path";
import { homedir } from "node:os";

import {
  analyzeMemoryMd,
  detectSubindex,
  generateIndex as generateMemoryIndex,
  parseMemoryMd,
  validateMemory,
} from "@mcptoolshop/claude-memories";
import {
  parseFrontmatter,
  validateIndex,
  discoverLayers,
  type LoadoutIndex,
} from "@mcptoolshop/ai-loadout";

import { BOLD, DIM, RESET, GREEN, YELLOW, RED, log } from "./console.js";
import { loadSeatConfig, resolveRuleMemory, type PreToolRule } from "./pretool.js";
import { PRETOOL_RULES } from "./pretool-rules.js";

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
  /** Bundled hook artifact in this repo (apps/hook/dist/loadout-hook.mjs). */
  hookSource: string;
  /** Live mirror of the hook Claude Code actually runs (~/.claude/loadout-hook/loadout-hook.mjs). */
  hookMirror: string;
  /** Skills directory holding `<name>/SKILL.md` (defaults to `<dirname(settings)>/skills` or `~/.claude/skills`). */
  skillsDir?: string;
  /** Additional index paths (e.g. project `.claude/loadout/index.json`) searched by the triad memory check. */
  extraIndexes?: string[];
  /** Optional path to `seats.json` for per-seat triad memory checks. */
  seatsPath?: string;
  /** Optional per-seat memory store directory map (`{ rnd: "<store>", publisher: "<store>" }`) for per-seat triad memory checks. */
  seatStores?: Record<string, string>;
  /** Override pre-tool rule table for the triad check (defaults to `PRETOOL_RULES`). */
  rules?: readonly PreToolRule[];
  /** Warn threshold in bytes for MEMORY.md size (defaults to 60% of 24.4 KB = 14,640 B). */
  memoryWarnBytes?: number;
  /** Warn threshold for entries in a sub-index (`metadata.loadout_role: subindex`, defaults to 60). */
  subindexWarnEntries?: number;
}

/** Claude Code's 24.4 KB read limit for MEMORY.md. */
export const CLAUDE_CODE_MEMORY_READ_LIMIT_BYTES = 24_400;
/** Default warn threshold: 60% of Claude Code's 24.4 KB read limit (14,640 bytes). */
export const DEFAULT_MEMORY_WARN_BYTES = Math.round(
  CLAUDE_CODE_MEMORY_READ_LIMIT_BYTES * 0.6,
);
/** Default warn threshold for sub-index (`metadata.loadout_role: subindex`) entry count. */
export const DEFAULT_SUBINDEX_WARN_ENTRIES = 60;

/** ~7 days — a usage.jsonl untouched longer than this is "stale" (warn). */
const RECENT_MS = 7 * 24 * 60 * 60 * 1000;

function toPositiveNumber(val: unknown): number | undefined {
  if (typeof val === "number" && Number.isFinite(val) && val > 0) {
    return val;
  }
  if (typeof val === "string" && val.trim().length > 0) {
    const parsed = Number(val);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

/**
 * Resolve configurable scaling thresholds for MEMORY.md bytes and sub-index entry counts.
 * Precedence: explicit DoctorPaths / CLI flag > <store>/.loadout.json > MEMORY.md frontmatter > defaults.
 */
export function resolveScaleThresholds(
  paths: DoctorPaths,
  memoryMdContent?: string,
): { memoryWarnBytes: number; subindexWarnEntries: number } {
  let cfgBytes: number | undefined;
  let cfgEntries: number | undefined;

  const storeConfigPath = join(paths.store, ".loadout.json");
  if (existsSync(storeConfigPath)) {
    try {
      const cfg = JSON.parse(readFileSync(storeConfigPath, "utf-8")) as Record<
        string,
        unknown
      >;
      cfgBytes =
        toPositiveNumber(cfg.memoryWarnBytes) ??
        toPositiveNumber(cfg.memory_warn_bytes);
      cfgEntries =
        toPositiveNumber(cfg.subindexWarnEntries) ??
        toPositiveNumber(cfg.subindex_warn_entries);
    } catch {
      // ignore malformed .loadout.json
    }
  }

  let fmBytes: number | undefined;
  let fmEntries: number | undefined;
  if (memoryMdContent) {
    const { frontmatter } = parseFrontmatter(memoryMdContent);
    const meta = frontmatter?.metadata as Record<string, unknown> | undefined;
    fmBytes =
      toPositiveNumber(meta?.memory_warn_bytes) ??
      toPositiveNumber(meta?.memoryWarnBytes);
    fmEntries =
      toPositiveNumber(meta?.subindex_warn_entries) ??
      toPositiveNumber(meta?.subindexWarnEntries);

    // Fallback when MEMORY.md frontmatter has no `name:` or `id:` field
    if (
      (fmBytes === undefined || fmEntries === undefined) &&
      memoryMdContent.startsWith("---")
    ) {
      const firstNewline = memoryMdContent.indexOf("\n");
      const closeIdx =
        firstNewline !== -1
          ? memoryMdContent.indexOf("\n---", firstNewline)
          : -1;
      if (closeIdx !== -1) {
        const block = memoryMdContent.slice(firstNewline + 1, closeIdx);
        for (const rawLine of block.split(/\r?\n/)) {
          const colonIdx = rawLine.indexOf(":");
          if (colonIdx <= 0) continue;
          const k = rawLine.slice(0, colonIdx).trim();
          const val = rawLine
            .slice(colonIdx + 1)
            .trim()
            .replace(/^["']|["']$/g, "");
          if (
            (k === "memory_warn_bytes" || k === "memoryWarnBytes") &&
            fmBytes === undefined
          ) {
            fmBytes = toPositiveNumber(val);
          } else if (
            (k === "subindex_warn_entries" || k === "subindexWarnEntries") &&
            fmEntries === undefined
          ) {
            fmEntries = toPositiveNumber(val);
          }
        }
      }
    }
  }

  return {
    memoryWarnBytes:
      toPositiveNumber(paths.memoryWarnBytes) ??
      cfgBytes ??
      fmBytes ??
      DEFAULT_MEMORY_WARN_BYTES,
    subindexWarnEntries:
      toPositiveNumber(paths.subindexWarnEntries) ??
      cfgEntries ??
      fmEntries ??
      DEFAULT_SUBINDEX_WARN_ENTRIES,
  };
}

export function defaultDoctorPaths(
  repoRoot: string = process.cwd(),
  homeDir: string = homedir(),
): DoctorPaths {
  const home = homeDir;
  const projectIndex = resolve(repoRoot, ".claude", "loadout", "index.json");
  const seatsPath = resolve(home, ".ai-loadout", "seats.json");
  return {
    store: resolve(home, ".claude", "projects", "F--AI", "memory"),
    index: resolve(home, ".ai-loadout", "index.json"),
    settings: resolve(home, ".claude", "settings.json"),
    usage: resolve(home, ".ai-loadout", "usage.jsonl"),
    hookSource: resolve(repoRoot, "apps", "hook", "dist", "loadout-hook.mjs"),
    hookMirror: resolve(home, ".claude", "loadout-hook", "loadout-hook.mjs"),
    skillsDir: resolve(home, ".claude", "skills"),
    extraIndexes: existsSync(projectIndex) ? [projectIndex] : [],
    ...(existsSync(seatsPath) ? { seatsPath } : {}),
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

      // (a2) MEMORY.md size vs 60% of Claude Code's 24.4 KB read limit & sub-index entry counts
      const memoryMdRaw = readFileSync(memoryMd, "utf-8");
      const memoryMdBytes = Buffer.byteLength(memoryMdRaw, "utf-8");
      const { memoryWarnBytes, subindexWarnEntries } = resolveScaleThresholds(
        paths,
        memoryMdRaw,
      );
      const pctOfReadLimit = Math.round(
        (memoryMdBytes / CLAUDE_CODE_MEMORY_READ_LIMIT_BYTES) * 100,
      );

      if (memoryMdBytes > memoryWarnBytes) {
        checks.push({
          id: "memory-read-limit",
          status: "warn",
          message: `MEMORY.md is ${memoryMdBytes} B (${pctOfReadLimit}% of Claude Code's 24.4 KB read limit; warn threshold ${memoryWarnBytes} B)`,
          hint: "Split root entries into sub-indexes with `loadout-os memories split --by <rules.json>`.",
        });
      } else {
        checks.push({
          id: "memory-read-limit",
          status: "pass",
          message: `MEMORY.md size ${memoryMdBytes} B (${pctOfReadLimit}% of 24.4 KB read limit <= ${memoryWarnBytes} B warn threshold)`,
        });
      }

      // Gather sub-index entry counts from analysis and any sub-index files in the store directory
      const subindexCounts = new Map<string, number>();
      if (analysis.subindexEntryCounts) {
        for (const [subFile, count] of Object.entries(
          analysis.subindexEntryCounts,
        )) {
          subindexCounts.set(subFile, count);
        }
      }
      if (existsSync(paths.store)) {
        try {
          for (const entry of readdirSync(paths.store)) {
            if (extname(entry) !== ".md" || entry === "MEMORY.md") continue;
            if (subindexCounts.has(entry)) continue;
            const fullPath = join(paths.store, entry);
            try {
              if (!statSync(fullPath).isFile()) continue;
              const subRaw = readFileSync(fullPath, "utf-8");
              if (detectSubindex(entry, subRaw).isSubindex) {
                subindexCounts.set(entry, parseMemoryMd(subRaw).refs.length);
              }
            } catch {
              // ignore unreadable file
            }
          }
        } catch {
          // ignore unreadable dir
        }
      }

      const overSubindexes: { file: string; count: number }[] = [];
      let maxSubindexEntries = 0;
      for (const [file, count] of subindexCounts) {
        if (count > maxSubindexEntries) maxSubindexEntries = count;
        if (count > subindexWarnEntries) {
          overSubindexes.push({ file, count });
        }
      }

      if (overSubindexes.length > 0) {
        const detail = overSubindexes
          .map((s) => `${s.file} (${s.count} entries)`)
          .join(", ");
        checks.push({
          id: "subindex-entries",
          status: "warn",
          message: `${overSubindexes.length} sub-index(es) exceed ${subindexWarnEntries} entries: ${detail}`,
          hint: "Split large sub-indexes into smaller topic sub-indexes.",
        });
      } else {
        checks.push({
          id: "subindex-entries",
          status: "pass",
          message:
            subindexCounts.size > 0
              ? `${subindexCounts.size} sub-index(es) checked; all <= ${subindexWarnEntries} entries (max ${maxSubindexEntries})`
              : `0 sub-indexes in store (warn threshold ${subindexWarnEntries} entries)`,
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

  // (c) drift mirror↔live: hash the bundled source hook vs the installed mirror
  if (!existsSync(paths.hookSource)) {
    checks.push({
      id: "hook-drift",
      status: "warn",
      message: `Hook bundle not found: ${paths.hookSource}`,
      hint: "Run `npm run build` in the repo to generate apps/hook/dist/loadout-hook.mjs.",
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
          message: "Hook mirror matches repo bundle (no drift)",
        });
      } else {
        checks.push({
          id: "hook-drift",
          status: "fail",
          message: "Hook mirror DRIFTS from repo bundle",
          hint: "Re-copy apps/hook/dist/loadout-hook.mjs to ~/.claude/loadout-hook/ (the live hook is stale).",
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

  // ── Part 4.2: Triad checks (memory, skill, pre-tool hook) ─────
  const rules = paths.rules ?? PRETOOL_RULES;

  // (i) triad-memories: every rule in the table names a memory id that exists in the seat's store/index
  const loadStoreMemoryIds = (storeDir: string): Set<string> => {
    const ids = new Set<string>();
    const storeIndexFile = join(storeDir, "index.json");
    if (existsSync(storeIndexFile)) {
      const loadedStoreIdx = loadIndex(storeIndexFile);
      if ("index" in loadedStoreIdx) {
        for (const e of loadedStoreIdx.index.entries) {
          if (e && typeof e.id === "string") ids.add(e.id);
        }
      }
    }
    const memFile = join(storeDir, "MEMORY.md");
    if (ids.size === 0 && existsSync(memFile)) {
      try {
        const analysis = analyzeMemoryMd(memFile);
        for (const pm of [false, true]) {
          for (const e of generateMemoryIndex(analysis, { projectMode: pm }).entries) {
            if (e && typeof e.id === "string") ids.add(e.id);
          }
        }
      } catch {
        /* ignore malformed store here; store-validates reports it */
      }
    }
    return ids;
  };

  let configuredSeatStores: Record<string, string> = {};
  if (paths.seatStores && Object.keys(paths.seatStores).length > 0) {
    configuredSeatStores = { ...paths.seatStores };
  } else if (paths.seatsPath && existsSync(paths.seatsPath)) {
    try {
      const sc = loadSeatConfig(paths.seatsPath);
      if (sc.seatStores && Object.keys(sc.seatStores).length > 0) {
        configuredSeatStores = { ...sc.seatStores };
      }
    } catch {
      /* ignore unreadable seats.json; falls back to single-store triad check */
    }
  }

  const seatNames = Object.keys(configuredSeatStores);
  if (seatNames.length > 0) {
    const missingSeatMemoryRules: string[] = [];
    for (const seat of seatNames) {
      const storeDir = configuredSeatStores[seat];
      const seatKnownIds = loadStoreMemoryIds(storeDir);
      for (const r of rules) {
        const memId = resolveRuleMemory(r, seat);
        if (!memId || !seatKnownIds.has(memId)) {
          missingSeatMemoryRules.push(`${seat}: ${r.id} -> ${memId || "(empty)"}`);
        }
      }
    }
    if (missingSeatMemoryRules.length > 0) {
      checks.push({
        id: "triad-memories",
        status: "fail",
        message: `Triad memory id missing from seat store(s): ${missingSeatMemoryRules.join(", ")}`,
        hint: "Ensure every rule in PRETOOL_RULES references a memory id present in each configured seat's own store/index.",
      });
    } else {
      checks.push({
        id: "triad-memories",
        status: "pass",
        message: `All ${rules.length} pre-tool rule memory id(s) exist per seat across ${seatNames.length} seat store(s) (${seatNames.join(", ")})`,
      });
    }
  } else {
    const knownMemoryIds = new Set<string>();
    if (index) {
      for (const e of index.entries) {
        if (e && typeof e.id === "string") knownMemoryIds.add(e.id);
      }
    }
    for (const extraPath of paths.extraIndexes ?? []) {
      const extraLoaded = loadIndex(extraPath);
      if ("index" in extraLoaded) {
        for (const e of extraLoaded.index.entries) {
          if (e && typeof e.id === "string") knownMemoryIds.add(e.id);
        }
      }
    }

    const missingMemoryRules: string[] = [];
    for (const r of rules) {
      const memId = resolveRuleMemory(r, "default");
      if (!memId || !knownMemoryIds.has(memId)) {
        missingMemoryRules.push(`${r.id} -> ${memId || "(empty)"}`);
      }
    }
    if (missingMemoryRules.length > 0) {
      checks.push({
        id: "triad-memories",
        status: "fail",
        message: `Triad memory id missing from index(es): ${missingMemoryRules.join(", ")}`,
        hint: "Ensure every rule in PRETOOL_RULES references a memory id present in the global or project index.json.",
      });
    } else {
      checks.push({
        id: "triad-memories",
        status: "pass",
        message: `All ${rules.length} pre-tool rule memory id(s) exist in loaded index(es)`,
      });
    }
  }

  // (j) triad-skills: every rule names a skill under ~/.claude/skills/<name>/SKILL.md, or skill: "none" with a reason
  const skillsDir =
    paths.skillsDir ?? resolve(dirname(paths.settings), "skills");
  const brokenSkillRules: string[] = [];
  const noneWithReasonRules: string[] = [];

  for (const r of rules) {
    if (r.skill === "none") {
      if (r.skillNoneReason && r.skillNoneReason.trim().length > 0) {
        noneWithReasonRules.push(`${r.id} (${r.skillNoneReason.trim()})`);
      } else {
        brokenSkillRules.push(`${r.id} (skill: none without reason)`);
      }
    } else if (!r.skill || !r.skill.trim()) {
      brokenSkillRules.push(`${r.id} (empty skill)`);
    } else {
      const skillFile = join(skillsDir, r.skill, "SKILL.md");
      if (!existsSync(skillFile)) {
        brokenSkillRules.push(`${r.id} -> ${r.skill}/SKILL.md`);
      }
    }
  }

  if (brokenSkillRules.length > 0) {
    checks.push({
      id: "triad-skills",
      status: "fail",
      message: `Triad skill link broken: ${brokenSkillRules.join(", ")}`,
      hint: `Ensure <skillsDir>/<name>/SKILL.md exists (checked ${skillsDir}) or mark skill: "none" with skillNoneReason.`,
    });
  } else if (noneWithReasonRules.length > 0) {
    checks.push({
      id: "triad-skills",
      status: "warn",
      message: `All named skills exist; ${noneWithReasonRules.length} rule(s) marked skill: none — ${noneWithReasonRules.join("; ")}`,
    });
  } else {
    checks.push({
      id: "triad-skills",
      status: "pass",
      message: `All ${rules.length} pre-tool rule skill(s) exist under ${skillsDir}`,
    });
  }

  // (k) triad-pretool-hook: pre-tool hook wired in user settings, with command and mode reported
  if (!existsSync(paths.settings)) {
    checks.push({
      id: "triad-pretool-hook",
      status: "fail",
      message: `Pre-tool hook NOT wired (settings.json not found: ${paths.settings})`,
      hint: "Wire `loadout-os hook pre-tool` under hooks.PreToolUse in ~/.claude/settings.json.",
    });
  } else {
    try {
      const rawSettings = readFileSync(paths.settings, "utf-8");
      const parsedSettings = JSON.parse(rawSettings) as Record<string, unknown>;
      const preToolCmd = findPreToolHookCommand(parsedSettings);
      if (preToolCmd) {
        const mode = parsePreToolCommandMode(preToolCmd);
        checks.push({
          id: "triad-pretool-hook",
          status: "pass",
          message: `Pre-tool hook wired in settings.json (command: "${preToolCmd}", mode: ${mode})`,
        });
      } else {
        checks.push({
          id: "triad-pretool-hook",
          status: "fail",
          message:
            "Pre-tool hook NOT wired in settings.json (no PreToolUse `hook pre-tool` command)",
          hint: "Add a PreToolUse hook running `loadout-os hook pre-tool --mode log-only` (or `--mode enforce`).",
        });
      }
    } catch (e) {
      checks.push({
        id: "triad-pretool-hook",
        status: "fail",
        message: `Could not parse settings.json for PreToolUse hook: ${(e as Error).message}`,
      });
    }
  }

  const ok = !checks.some((c) => c.status === "fail");
  return { checks, ok };
}

function findPreToolHookCommand(settingsObj: Record<string, unknown>): string | null {
  const hooks = settingsObj.hooks;
  if (!hooks || typeof hooks !== "object") return null;
  const preToolUse = (hooks as Record<string, unknown>).PreToolUse;
  const found: string[] = [];

  const walk = (node: unknown) => {
    if (!node) return;
    if (typeof node === "string") {
      if (/\bhook\s+pre-tool\b/.test(node)) found.push(node.trim());
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node === "object") {
      const rec = node as Record<string, unknown>;
      if (typeof rec.command === "string" && /\bhook\s+pre-tool\b/.test(rec.command)) {
        found.push(rec.command.trim());
      }
      if (rec.hooks) walk(rec.hooks);
    }
  };

  walk(preToolUse);
  return found[0] ?? null;
}

function parsePreToolCommandMode(command: string): string {
  const m = command.match(/--mode(?:=|\s+)["']?([a-zA-Z0-9_-]+)["']?/i);
  if (m && m[1]) {
    return m[1].toLowerCase();
  }
  return "enforce";
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
