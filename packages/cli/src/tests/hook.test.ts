/**
 * hook test: drives the real apps/hook/loadout-hook.mjs in an isolated HOME so
 * the live usage.jsonl is never touched. Confirms it runs, returns structured
 * output, and (crucially) does not write to the user's real ~/.ai-loadout.
 *
 * Also exercises Part A (project-layer resolution, walk-up, malformed fallback,
 * id collision, manual/core/session-start filtering, 5-entry fair-share cap,
 * sub-index preference, env override, and usage.jsonl layer tagging).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  statSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  utimesSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";

import { runHookTest, defaultHookPath, runSessionStart } from "../hook.js";
import { runRefresh } from "../refresh.js";

const HOOK = defaultHookPath(process.cwd());

test("hook test: runs the hook against a sample prompt (when hook present)", () => {
  if (!existsSync(HOOK)) {
    // repo without the hook checked out — skip rather than fail
    return;
  }
  const result = runHookTest({
    prompt: "scaffold a new game and run the dogfood swarm",
    hookPath: HOOK,
  });
  assert.equal(result.ran, true);
  // exit code is 0 whether it injects or stays silent (fail-silent contract)
  assert.equal(result.exitCode, 0);
  assert.equal(typeof result.note, "string");
});

test("hook test: does NOT write the live ~/.ai-loadout/usage.jsonl", () => {
  if (!existsSync(HOOK)) return;
  const liveUsage = join(homedir(), ".ai-loadout", "usage.jsonl");
  const before = existsSync(liveUsage) ? statSync(liveUsage).size : -1;
  runHookTest({ prompt: "a test prompt that should not touch live state", hookPath: HOOK });
  const after = existsSync(liveUsage) ? statSync(liveUsage).size : -1;
  assert.equal(after, before, "hook test must not append to the live usage.jsonl");
});

test("hook test: absent hook → ran:false, structured note", () => {
  const result = runHookTest({
    prompt: "x",
    hookPath: resolve(process.cwd(), "apps", "hook", "does-not-exist.mjs"),
  });
  assert.equal(result.ran, false);
  assert.match(result.note, /not found/i);
});

// ── Part A: Project-layer hook tests ─────────────────────────────────────────

interface TestEntry {
  id: string;
  path?: string;
  keywords: string[];
  patterns?: string[];
  priority?: "core" | "domain" | "manual";
  summary?: string;
  tokens_est?: number;
  lines?: number;
  metadata?: Record<string, string | number | boolean>;
  subindex?: boolean;
}

function makeTestIndex(entries: TestEntry[]) {
  return {
    version: "1.0.0",
    generated: "2026-11-08T00:00:00.000Z",
    entries: entries.map((e) => ({
      id: e.id,
      path: e.path ?? `/mock/store/${e.id}.md`,
      keywords: e.keywords,
      patterns: e.patterns ?? [],
      priority: e.priority ?? "domain",
      summary: e.summary ?? `Summary for ${e.id}`,
      triggers: { task: true, plan: true, edit: false },
      tokens_est: e.tokens_est ?? 100,
      lines: e.lines ?? 10,
      ...(e.metadata ? { metadata: e.metadata } : {}),
      ...(e.subindex !== undefined ? { subindex: e.subindex } : {}),
    })),
    budget: {
      always_loaded_est: 0,
      on_demand_total_est: 0,
      avg_task_load_est: 0,
      avg_task_load_observed: null,
    },
  };
}

function invokeHookRaw(opts: {
  sandboxHome: string;
  cwd: string;
  prompt: string;
  payloadCwd?: string;
  sessionId?: string;
  extraEnv?: Record<string, string>;
}): { status: number | null; stdout: string; stderr: string } {
  const payload: Record<string, unknown> = {
    prompt: opts.prompt,
    session_id: opts.sessionId ?? "session-part-a-test",
  };
  if (opts.payloadCwd !== undefined) {
    payload.cwd = opts.payloadCwd;
  }

  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: opts.sandboxHome,
    USERPROFILE: opts.sandboxHome,
    AI_LOADOUT_PROJECT_INDEX: "",
    ...(opts.extraEnv ?? {}),
  };

  const res = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    env: env as NodeJS.ProcessEnv,
    encoding: "utf-8",
    cwd: opts.cwd,
  });

  return {
    status: res.status,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

/**
 * Exact formula used by origin/main (de45f3e) apps/hook/loadout-hook.mjs
 * for global-only output, used as the golden reference for byte-identical comparison.
 */
function mainGoldenGlobalStdout(lines: string[]): string {
  const additionalContext =
    "[loadout-hook] Memory entries relevant to this prompt (open the file pointer before acting, do not paraphrase from the summary):\n" +
    lines.join("\n");
  return JSON.stringify({
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext,
    },
  });
}

describe("Part A: loadout-hook.mjs project-layer support", () => {
  test("1. byte-identical global-only output for 3 prompts (golden from main)", () => {
    if (!existsSync(HOOK)) return;
    const root = mkdtempSync(join(tmpdir(), "loadout-part-a-golden-"));
    try {
      const globalDir = join(root, "home", ".ai-loadout");
      const emptyWorkdir = join(root, "workspace");
      mkdirSync(globalDir, { recursive: true });
      mkdirSync(emptyWorkdir, { recursive: true });

      const globalIndex = makeTestIndex([
        {
          id: "release-ritual",
          path: "/global/release-ritual.md",
          keywords: ["release", "publish", "npm", "tag"],
          summary: "Run full checks before npm publish and git tag",
          priority: "domain",
        },
        {
          id: "ci-matrix",
          path: "/global/ci-matrix.md",
          keywords: ["ci", "workflow", "github", "actions"],
          summary: "Verify node 20 and 22 matrix legs in GitHub Actions",
          priority: "domain",
        },
        {
          id: "security-gate",
          path: "/global/security-gate.md",
          keywords: ["secret", "token", "scan"],
          summary: "Never commit credentials or tokens",
          priority: "domain",
        },
      ]);
      writeFileSync(join(globalDir, "index.json"), JSON.stringify(globalIndex));

      // Prompt 1: matches release-ritual (3 keywords: release, publish, npm → score 0.75)
      const r1 = invokeHookRaw({
        sandboxHome: join(root, "home"),
        cwd: emptyWorkdir,
        prompt: "prepare a release and publish to npm",
      });
      const golden1 = mainGoldenGlobalStdout([
        "- release-ritual — Run full checks before npm publish and git tag → /global/release-ritual.md",
      ]);
      assert.equal(r1.status, 0);
      assert.equal(r1.stdout, golden1);

      // Prompt 2: matches both ci-matrix and release-ritual
      const r2 = invokeHookRaw({
        sandboxHome: join(root, "home"),
        cwd: emptyWorkdir,
        prompt: "check the ci workflow in github actions before we publish a release to npm",
      });
      const golden2 = mainGoldenGlobalStdout([
        "- ci-matrix — Verify node 20 and 22 matrix legs in GitHub Actions → /global/ci-matrix.md",
        "- release-ritual — Run full checks before npm publish and git tag → /global/release-ritual.md",
      ]);
      assert.equal(r2.status, 0);
      assert.equal(r2.stdout, golden2);

      // Prompt 3: below floor (0 matches → silent, empty stdout)
      const r3 = invokeHookRaw({
        sandboxHome: join(root, "home"),
        cwd: emptyWorkdir,
        prompt: "refactor the parser AST",
      });
      assert.equal(r3.status, 0);
      assert.equal(r3.stdout, "");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("2. a project entry surfaces under its own header", () => {
    if (!existsSync(HOOK)) return;
    const root = mkdtempSync(join(tmpdir(), "loadout-part-a-proj-"));
    try {
      const homeDir = join(root, "home");
      const globalDir = join(homeDir, ".ai-loadout");
      const projectRoot = join(root, "proj");
      const projLoadout = join(projectRoot, ".claude", "loadout");
      mkdirSync(globalDir, { recursive: true });
      mkdirSync(projLoadout, { recursive: true });

      writeFileSync(
        join(globalDir, "index.json"),
        JSON.stringify(
          makeTestIndex([
            {
              id: "global-ci",
              path: "/global/ci.md",
              keywords: ["ci", "workflow", "actions"],
              summary: "Global CI workflow rule",
            },
          ])
        )
      );
      writeFileSync(
        join(projLoadout, "index.json"),
        JSON.stringify(
          makeTestIndex([
            {
              id: "proj-colab",
              path: "/proj/colab.md",
              keywords: ["colab", "kernel", "notebook"],
              summary: "Project Colab notebook rule",
            },
          ])
        )
      );

      const res = invokeHookRaw({
        sandboxHome: homeDir,
        cwd: projectRoot,
        payloadCwd: projectRoot,
        prompt: "update the ci workflow and colab notebook kernel",
      });
      assert.equal(res.status, 0);
      const parsed = JSON.parse(res.stdout);
      const ctx: string = parsed.hookSpecificOutput.additionalContext;
      assert.ok(
        ctx.includes("[loadout-hook] Memory entries relevant to this prompt"),
        "Global header present"
      );
      assert.ok(
        ctx.includes("[loadout-hook] Project memory entries relevant to this prompt"),
        "Project header present"
      );
      assert.ok(ctx.includes("- global-ci — Global CI workflow rule → /global/ci.md"));
      assert.ok(ctx.includes("- proj-colab — Project Colab notebook rule → /proj/colab.md"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("3. the project index is found by walking up from a nested cwd", () => {
    if (!existsSync(HOOK)) return;
    const root = mkdtempSync(join(tmpdir(), "loadout-part-a-walkup-"));
    try {
      const homeDir = join(root, "home");
      const projectRoot = join(root, "project");
      const nestedCwd = join(projectRoot, "packages", "deep", "src");
      mkdirSync(join(homeDir, ".ai-loadout"), { recursive: true });
      mkdirSync(join(projectRoot, ".claude", "loadout"), { recursive: true });
      mkdirSync(nestedCwd, { recursive: true });

      writeFileSync(
        join(projectRoot, ".claude", "loadout", "index.json"),
        JSON.stringify(
          makeTestIndex([
            {
              id: "nested-hit",
              path: "/proj/nested-hit.md",
              keywords: ["telemetry", "metrics", "dashboard"],
              summary: "Project telemetry metrics rule",
            },
          ])
        )
      );

      const res = invokeHookRaw({
        sandboxHome: homeDir,
        cwd: root,
        payloadCwd: nestedCwd,
        prompt: "check telemetry metrics on the dashboard",
      });
      assert.equal(res.status, 0);
      const parsed = JSON.parse(res.stdout);
      const ctx: string = parsed.hookSpecificOutput.additionalContext;
      assert.ok(ctx.includes("[loadout-hook] Project memory entries"));
      assert.ok(ctx.includes("- nested-hit — Project telemetry metrics rule → /proj/nested-hit.md"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("4. a malformed project index gives global-only output (fail-open)", () => {
    if (!existsSync(HOOK)) return;
    const root = mkdtempSync(join(tmpdir(), "loadout-part-a-malformed-"));
    try {
      const homeDir = join(root, "home");
      const projectRoot = join(root, "project");
      mkdirSync(join(homeDir, ".ai-loadout"), { recursive: true });
      mkdirSync(join(projectRoot, ".claude", "loadout"), { recursive: true });

      writeFileSync(
        join(homeDir, ".ai-loadout", "index.json"),
        JSON.stringify(
          makeTestIndex([
            {
              id: "global-fallback",
              path: "/global/fallback.md",
              keywords: ["deploy", "release", "rollback"],
              summary: "Global deploy rule",
            },
          ])
        )
      );
      writeFileSync(
        join(projectRoot, ".claude", "loadout", "index.json"),
        "{ broken json ::::"
      );

      const res = invokeHookRaw({
        sandboxHome: homeDir,
        cwd: projectRoot,
        payloadCwd: projectRoot,
        prompt: "deploy release and rollback",
      });
      assert.equal(res.status, 0);
      const expected = mainGoldenGlobalStdout([
        "- global-fallback — Global deploy rule → /global/fallback.md",
      ]);
      assert.equal(res.stdout, expected);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("5. an id collision is won by the project", () => {
    if (!existsSync(HOOK)) return;
    const root = mkdtempSync(join(tmpdir(), "loadout-part-a-collision-"));
    try {
      const homeDir = join(root, "home");
      const projectRoot = join(root, "project");
      mkdirSync(join(homeDir, ".ai-loadout"), { recursive: true });
      mkdirSync(join(projectRoot, ".claude", "loadout"), { recursive: true });

      writeFileSync(
        join(homeDir, ".ai-loadout", "index.json"),
        JSON.stringify(
          makeTestIndex([
            {
              id: "shared-rule",
              path: "/global/shared-rule.md",
              keywords: ["publish", "package", "registry"],
              summary: "GLOBAL summary should be overridden",
            },
          ])
        )
      );
      writeFileSync(
        join(projectRoot, ".claude", "loadout", "index.json"),
        JSON.stringify(
          makeTestIndex([
            {
              id: "shared-rule",
              path: "/project/shared-rule.md",
              keywords: ["publish", "package", "registry"],
              summary: "PROJECT summary wins collision",
            },
          ])
        )
      );

      const res = invokeHookRaw({
        sandboxHome: homeDir,
        cwd: projectRoot,
        payloadCwd: projectRoot,
        prompt: "publish the package to the registry",
      });
      assert.equal(res.status, 0);
      const parsed = JSON.parse(res.stdout);
      const ctx: string = parsed.hookSpecificOutput.additionalContext;
      assert.ok(ctx.includes("PROJECT summary wins collision"));
      assert.ok(!ctx.includes("GLOBAL summary should be overridden"));
      assert.ok(ctx.includes("[loadout-hook] Project memory entries"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("6. manual stays out, core surfaces, and session-start injected core entries stay out of prompt slots (F-20)", () => {
    if (!existsSync(HOOK)) return;
    const root = mkdtempSync(join(tmpdir(), "loadout-part-a-priority-"));
    try {
      const homeDir = join(root, "home");
      const projectRoot = join(root, "project");
      mkdirSync(join(homeDir, ".ai-loadout"), { recursive: true });
      mkdirSync(join(projectRoot, ".claude", "loadout"), { recursive: true });

      writeFileSync(
        join(projectRoot, ".claude", "loadout", "index.json"),
        JSON.stringify(
          makeTestIndex([
            {
              id: "core-standing-law",
              path: "/project/core-law.md",
              keywords: ["unrelated"],
              priority: "core",
              summary: "Core standing law always surfaces",
            },
            {
              id: "rd-board",
              path: "/project/BOARD.md",
              keywords: ["archive", "deploy", "migration"],
              priority: "core",
              summary: "Session-start board must NOT take a prompt slot",
              metadata: { loadout_inject: "session-start" },
            },
            {
              id: "archived-manual",
              path: "/project/archived.md",
              keywords: ["archive", "deploy", "migration"],
              priority: "manual",
              summary: "Manual entry must never auto-surface",
            },
          ])
        )
      );

      const res = invokeHookRaw({
        sandboxHome: homeDir,
        cwd: projectRoot,
        payloadCwd: projectRoot,
        prompt: "run archive deploy migration",
      });
      assert.equal(res.status, 0);
      const parsed = JSON.parse(res.stdout);
      const ctx: string = parsed.hookSpecificOutput.additionalContext;
      assert.ok(ctx.includes("core-standing-law"), "core entry surfaces");
      assert.ok(!ctx.includes("archived-manual"), "manual entry excluded");
      assert.ok(!ctx.includes("rd-board"), "session-start injected board excluded from prompt slots (F-20)");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("7. at most 5 entries total, with fair share across layers and sub-index preference (F-22)", () => {
    if (!existsSync(HOOK)) return;
    const root = mkdtempSync(join(tmpdir(), "loadout-part-a-cap-"));
    try {
      const homeDir = join(root, "home");
      const projectRoot = join(root, "project");
      mkdirSync(join(homeDir, ".ai-loadout"), { recursive: true });
      mkdirSync(join(projectRoot, ".claude", "loadout"), { recursive: true });

      // 5 global core entries (all score 1.0) — without fair share (F-22), these 5 would
      // starve all project domain entries.
      writeFileSync(
        join(homeDir, ".ai-loadout", "index.json"),
        JSON.stringify(
          makeTestIndex([
            { id: "g1", keywords: ["alpha"], priority: "core", summary: "G1" },
            { id: "g2", keywords: ["alpha"], priority: "core", summary: "G2" },
            { id: "g3", keywords: ["alpha"], priority: "core", summary: "G3" },
            { id: "g4", keywords: ["alpha"], priority: "core", summary: "G4" },
            { id: "g5", keywords: ["alpha"], priority: "core", summary: "G5" },
          ])
        )
      );

      // Project has 2 top-level MEMORY.md domain entries and 3 sub-index domain entries
      writeFileSync(
        join(projectRoot, ".claude", "loadout", "index.json"),
        JSON.stringify(
          makeTestIndex([
            { id: "p-main-1", keywords: ["alpha", "beta", "gamma"], summary: "Main 1", subindex: false },
            { id: "p-main-2", keywords: ["alpha", "beta", "gamma"], summary: "Main 2", subindex: false },
            { id: "p-sub-1", keywords: ["alpha", "beta", "gamma"], summary: "Sub 1", subindex: true },
            { id: "p-sub-2", keywords: ["alpha", "beta", "gamma"], summary: "Sub 2", subindex: true },
            { id: "p-sub-3", keywords: ["alpha", "beta", "gamma"], summary: "Sub 3", subindex: true },
          ])
        )
      );

      const res = invokeHookRaw({
        sandboxHome: homeDir,
        cwd: projectRoot,
        payloadCwd: projectRoot,
        prompt: "alpha beta gamma",
      });
      assert.equal(res.status, 0);
      const parsed = JSON.parse(res.stdout);
      const ctx: string = parsed.hookSpecificOutput.additionalContext;
      const pointerLines = ctx.split("\n").filter((l) => l.startsWith("- "));
      assert.equal(pointerLines.length, 5, "At most 5 entries total");

      // Fair share: project entries are NOT starved by the 5 global core entries,
      // and project sub-index entries (p-sub-*) are preferred over top-level p-main-* entries.
      const projLines = pointerLines.filter((l) => l.includes("p-sub-") || l.includes("p-main-"));
      const globLines = pointerLines.filter((l) => l.includes("- g"));
      assert.ok(projLines.length >= 2, `Expected >=2 project entries, got ${projLines.length}`);
      assert.ok(globLines.length >= 2, `Expected >=2 global entries, got ${globLines.length}`);
      assert.ok(ctx.includes("p-sub-1"), "Sub-index entry 1 preferred over top-level MEMORY.md entry");
      assert.ok(ctx.includes("p-sub-2"), "Sub-index entry 2 preferred over top-level MEMORY.md entry");
      assert.ok(!ctx.includes("p-main-1"), "Top-level MEMORY.md entry yielded to sub-index entries");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("8. the AI_LOADOUT_PROJECT_INDEX env override works", () => {
    if (!existsSync(HOOK)) return;
    const root = mkdtempSync(join(tmpdir(), "loadout-part-a-env-"));
    try {
      const homeDir = join(root, "home");
      const projectRoot = join(root, "project");
      mkdirSync(join(homeDir, ".ai-loadout"), { recursive: true });
      mkdirSync(join(projectRoot, ".claude", "loadout"), { recursive: true });

      // Write default project index that should be ignored when override is set
      writeFileSync(
        join(projectRoot, ".claude", "loadout", "index.json"),
        JSON.stringify(
          makeTestIndex([
            {
              id: "default-proj",
              keywords: ["override", "check", "custom"],
              summary: "Default project entry",
            },
          ])
        )
      );

      const overridePath = join(root, "override-index.json");
      writeFileSync(
        overridePath,
        JSON.stringify(
          makeTestIndex([
            {
              id: "env-override-entry",
              keywords: ["override", "check", "custom"],
              summary: "Env override project entry",
            },
          ])
        )
      );

      const res = invokeHookRaw({
        sandboxHome: homeDir,
        cwd: projectRoot,
        payloadCwd: projectRoot,
        prompt: "test override check custom",
        extraEnv: { AI_LOADOUT_PROJECT_INDEX: overridePath },
      });
      assert.equal(res.status, 0);
      const parsed = JSON.parse(res.stdout);
      const ctx: string = parsed.hookSpecificOutput.additionalContext;
      assert.ok(ctx.includes("env-override-entry"));
      assert.ok(!ctx.includes("default-proj"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("9. usage.jsonl events carry layer: 'global' | 'project' in ~/.ai-loadout/usage.jsonl (F-08)", () => {
    if (!existsSync(HOOK)) return;
    const root = mkdtempSync(join(tmpdir(), "loadout-part-a-usage-"));
    try {
      const homeDir = join(root, "home");
      const globalDir = join(homeDir, ".ai-loadout");
      const projectRoot = join(root, "project");
      mkdirSync(globalDir, { recursive: true });
      mkdirSync(join(projectRoot, ".claude", "loadout"), { recursive: true });

      writeFileSync(
        join(globalDir, "index.json"),
        JSON.stringify(
          makeTestIndex([
            {
              id: "global-logged",
              keywords: ["audit", "telemetry", "trace"],
              summary: "Global telemetry entry",
            },
          ])
        )
      );
      writeFileSync(
        join(projectRoot, ".claude", "loadout", "index.json"),
        JSON.stringify(
          makeTestIndex([
            {
              id: "project-logged",
              keywords: ["audit", "telemetry", "trace"],
              summary: "Project telemetry entry",
            },
          ])
        )
      );

      const res = invokeHookRaw({
        sandboxHome: homeDir,
        cwd: projectRoot,
        payloadCwd: projectRoot,
        prompt: "run audit telemetry trace",
        sessionId: "sess-1234567890",
      });
      assert.equal(res.status, 0);

      const usageFile = join(globalDir, "usage.jsonl");
      assert.ok(existsSync(usageFile), "usage.jsonl created in ~/.ai-loadout");
      const lines = readFileSync(usageFile, "utf-8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));

      assert.equal(lines.length, 2);
      const globalEvt = lines.find((e) => e.entryId === "global-logged");
      const projectEvt = lines.find((e) => e.entryId === "project-logged");
      assert.ok(globalEvt, "global event recorded");
      assert.ok(projectEvt, "project event recorded");
      assert.equal(globalEvt.layer, "global");
      assert.equal(projectEvt.layer, "project");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});


describe("Part C: loadout-os hook session-start and pre-compact", () => {
  const CLI_BIN = resolve(process.cwd(), "dist", "cli.js");

  test("1. the injected file is printed in full under a header naming the file, and non-ASCII text survives as UTF-8 on Windows (F-05)", () => {
    const root = mkdtempSync(join(tmpdir(), "loadout-part-c-utf8-"));
    try {
      const storeDir = join(root, "store");
      const projDir = join(root, "proj");
      mkdirSync(storeDir, { recursive: true });
      mkdirSync(projDir, { recursive: true });

      const boardContent = [
        "---",
        "name: R&D Active Board",
        "description: Current active R&D board state",
        "priority: core",
        "metadata:",
        "  loadout_inject: session-start",
        "  stale_after_min: 60",
        "---",
        "# Active Board — R&D → Antigravity ⭐",
        "- Status: Healthy ≈ 100% (no ⚠ alerts)",
        "- Next: Verify UTF-8 em-dash — arrow → star ⭐ warning ⚠ approx ≈",
        "",
      ].join("\n");

      writeFileSync(join(storeDir, "BOARD.md"), boardContent, "utf-8");
      writeFileSync(
        join(storeDir, "MEMORY.md"),
        "# Memory Index\n- [Board](BOARD.md) — Current active R&D board state\n",
        "utf-8",
      );

      runRefresh({ store: storeDir, project: projDir });

      // 1a. Programmatic check
      const res = runSessionStart({ project: projDir });
      assert.equal(res.warnings.length, 0);
      assert.equal(res.injectedFiles.length, 1);
      assert.match(res.output, /=== \[loadout-os session-start\] BOARD\.md/);
      assert.ok(res.output.includes("Active Board — R&D → Antigravity ⭐"));
      assert.ok(res.output.includes("Healthy ≈ 100% (no ⚠ alerts)"));

      // 1b. Subprocess check (proves Buffer.from(..., 'utf-8') stdout survives Windows console codepage)
      if (existsSync(CLI_BIN)) {
        const proc = spawnSync(
          process.execPath,
          [CLI_BIN, "hook", "session-start", "--project", projDir],
          { encoding: "utf-8", input: "" },
        );
        assert.equal(proc.status, 0);
        assert.ok(proc.stdout.includes("Active Board — R&D → Antigravity ⭐"));
        assert.ok(proc.stdout.includes("em-dash — arrow → star ⭐ warning ⚠ approx ≈"));
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("2. the stale warning fires in session-start, --user-prompt-submit, and pre-compact when mtime exceeds stale_after_min (F-01, F-17)", () => {
    const root = mkdtempSync(join(tmpdir(), "loadout-part-c-stale-"));
    try {
      const storeDir = join(root, "store");
      const projDir = join(root, "proj");
      mkdirSync(storeDir, { recursive: true });
      mkdirSync(projDir, { recursive: true });

      const boardPath = join(storeDir, "BOARD.md");
      writeFileSync(
        boardPath,
        [
          "---",
          "name: R&D Board",
          "description: Active board",
          "priority: core",
          "metadata:",
          "  loadout_inject: session-start",
          "  stale_after_min: 30",
          "---",
          "# Board Body",
          "",
        ].join("\n"),
        "utf-8",
      );
      writeFileSync(
        join(storeDir, "MEMORY.md"),
        "# Memory\n- [Board](BOARD.md) — Active board\n",
        "utf-8",
      );

      runRefresh({ store: storeDir, project: projDir });

      // Simulate 90 minutes in the future (board stale_after_min is 30)
      const futureMs = Date.now() + 90 * 60_000;

      // 2a. session-start prints BOTH stale warning AND board body
      const fullRes = runSessionStart({ project: projDir, nowMs: futureMs });
      assert.equal(fullRes.warnings.length, 1);
      assert.match(fullRes.warnings[0], /BOARD\.md is stale/);
      assert.match(fullRes.output, /WARNING: BOARD\.md is stale/);
      assert.match(fullRes.output, /# Board Body/);

      // 2b. --user-prompt-submit prints ONLY the stale warning (not the full board)
      const promptRes = runSessionStart({
        project: projDir,
        userPromptSubmit: true,
        nowMs: futureMs,
      });
      assert.equal(promptRes.warnings.length, 1);
      assert.match(promptRes.output, /WARNING: BOARD\.md is stale/);
      assert.doesNotMatch(promptRes.output, /# Board Body/);

      // 2c. pre-compact prints the stale warning before compaction (F-01)
      const preCompactRes = runSessionStart({
        project: projDir,
        preCompact: true,
        nowMs: futureMs,
      });
      assert.equal(preCompactRes.warnings.length, 1);
      assert.match(preCompactRes.output, /WARNING: BOARD\.md is stale/);
      assert.doesNotMatch(preCompactRes.output, /# Board Body/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("3. enforces line and byte caps with a visible truncation note (F-29)", () => {
    const root = mkdtempSync(join(tmpdir(), "loadout-part-c-cap-"));
    try {
      const storeDir = join(root, "store");
      const projDir = join(root, "proj");
      mkdirSync(storeDir, { recursive: true });
      mkdirSync(projDir, { recursive: true });

      const manyLines = [
        "---",
        "name: Giant Board",
        "description: Oversized board",
        "priority: core",
        "metadata:",
        "  loadout_inject: session-start",
        "---",
        ...Array.from({ length: 80 }, (_, i) => `- Item line ${i + 1}`),
      ].join("\n");

      writeFileSync(join(storeDir, "BOARD.md"), manyLines, "utf-8");
      writeFileSync(
        join(storeDir, "MEMORY.md"),
        "# Memory\n- [Giant Board](BOARD.md) — Oversized board\n",
        "utf-8",
      );

      runRefresh({ store: storeDir, project: projDir });

      const res = runSessionStart({ project: projDir, maxLines: 20, maxBytes: 4000 });
      assert.equal(res.truncatedFiles.length, 1);
      assert.match(res.output, /\[truncated: BOARD\.md exceeded session-start cap/);
      assert.ok(!res.output.includes("- Item line 75"), "lines past the cap must be truncated");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("4. a missing board file or corrupt index fails open with a visible warning note (F-11)", () => {
    const root = mkdtempSync(join(tmpdir(), "loadout-part-c-missing-"));
    try {
      const storeDir = join(root, "store");
      const projDir = join(root, "proj");
      mkdirSync(storeDir, { recursive: true });
      mkdirSync(projDir, { recursive: true });

      const boardPath = join(storeDir, "BOARD.md");
      writeFileSync(
        boardPath,
        [
          "---",
          "name: Ephemeral Board",
          "description: Board that will go missing",
          "priority: core",
          "metadata:",
          "  loadout_inject: session-start",
          "---",
          "# Ephemeral Board",
          "",
        ].join("\n"),
        "utf-8",
      );
      writeFileSync(
        join(storeDir, "MEMORY.md"),
        "# Memory\n- [Ephemeral Board](BOARD.md) — Board that will go missing\n",
        "utf-8",
      );

      runRefresh({ store: storeDir, project: projDir });

      // Delete BOARD.md after indexing to simulate missing file on disk
      rmSync(boardPath);

      const missingRes = runSessionStart({ project: projDir });
      assert.ok(missingRes.warnings.length >= 1, "must warn when session-start file is missing");
      assert.match(missingRes.output, /WARNING: session-start file missing on disk/);

      // Corrupt the project index.json and confirm it warns visibly and fails open
      const indexPath = join(projDir, ".claude", "loadout", "index.json");
      writeFileSync(indexPath, "{not-valid-json", "utf-8");
      const corruptRes = runSessionStart({ project: projDir });
      assert.ok(corruptRes.warnings.length >= 1, "must warn when project index is corrupt");
      assert.match(corruptRes.output, /WARNING: failed to parse project index/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("5. checks whether any <store>/*.md is newer than project index.json and auto-refreshes (F-13)", () => {
    const root = mkdtempSync(join(tmpdir(), "loadout-part-c-newer-"));
    try {
      const storeDir = join(root, "store");
      const projDir = join(root, "proj");
      mkdirSync(storeDir, { recursive: true });
      mkdirSync(projDir, { recursive: true });

      const boardPath = join(storeDir, "BOARD.md");
      writeFileSync(
        boardPath,
        [
          "---",
          "name: Board",
          "description: Active board",
          "priority: core",
          "metadata:",
          "  loadout_inject: session-start",
          "---",
          "# Board v1",
          "",
        ].join("\n"),
        "utf-8",
      );
      writeFileSync(
        join(storeDir, "MEMORY.md"),
        "# Memory\n- [Board](BOARD.md) — Active board\n",
        "utf-8",
      );

      runRefresh({ store: storeDir, project: projDir });

      // Simulate a shell edit to BOARD.md that happened 10 seconds after index.json was written
      writeFileSync(
        boardPath,
        [
          "---",
          "name: Board",
          "description: Active board",
          "priority: core",
          "metadata:",
          "  loadout_inject: session-start",
          "---",
          "# Board v2 (shell-edited)",
          "",
        ].join("\n"),
        "utf-8",
      );
      const futureSec = (Date.now() + 10_000) / 1000;
      utimesSync(boardPath, futureSec, futureSec);

      const res = runSessionStart({ project: projDir });
      assert.equal(res.refreshedStore, true, "session-start must auto-refresh when store .md is newer than index.json");
      assert.match(res.output, /# Board v2 \(shell-edited\)/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
