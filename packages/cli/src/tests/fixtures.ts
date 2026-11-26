/**
 * Test fixtures: build a synthetic memory store + a synthetic loadout index in
 * a temp dir, so doctor/report/wrapped-surface tests run against real files
 * without touching the live ~/.ai-loadout or canonical store.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { LoadoutIndex } from "@mcptoolshop/ai-loadout";

export interface Sandbox {
  dir: string;
  storeDir: string;
  memoryMd: string;
  topicFile: string;
  indexPath: string;
  usagePath: string;
  settingsPath: string;
  /** Synthetic hook "source" file (stands in for apps/hook/loadout-hook.mjs). */
  hookSource: string;
  /** Synthetic hook "mirror" with IDENTICAL bytes (no drift by default). */
  hookMirror: string;
  /** A different-bytes file, for the drift case. */
  hookDrifted: string;
  cleanup: () => void;
}

/**
 * A minimal but VALID MEMORY.md: a frontmatter-bearing topic file referenced by
 * one ref line in the format claude-memories' parser expects
 * (`Name — description → \`path\``).
 */
export function makeSandbox(opts?: {
  observedAvg?: number | null;
  withCore?: boolean;
  withUsage?: boolean;
  withSettingsHook?: boolean;
}): Sandbox {
  const dir = mkdtempSync(join(tmpdir(), "loadout-os-test-"));
  const storeDir = join(dir, "memory");
  mkdirSync(storeDir, { recursive: true });

  const topicFile = join(storeDir, "sample-topic.md");
  writeFileSync(
    topicFile,
    `---
id: sample-topic
keywords: [sample, topic, dogfood, swarm]
patterns: []
priority: domain
triggers:
  task: true
  plan: true
  edit: false
---

# Sample Topic

This is a synthetic topic file used by the loadout-os test fixtures.
It carries frontmatter so it becomes a domain dispatch entry.
`,
  );

  const memoryMd = join(storeDir, "MEMORY.md");
  writeFileSync(
    memoryMd,
    `# MEMORY

## Topics

- Sample Topic — a synthetic topic for tests → \`sample-topic.md\`
`,
  );

  // Synthetic kernel index (structurally valid for validateIndex).
  const entries: LoadoutIndex["entries"] = [
    {
      id: "sample-topic",
      path: "memory/sample-topic.md",
      keywords: ["sample", "topic", "dogfood", "swarm"],
      patterns: [],
      priority: "domain",
      summary: "a synthetic topic for tests",
      triggers: { task: true, plan: true, edit: false },
      tokens_est: 60,
      lines: 14,
    },
    {
      id: "never-loaded",
      path: "memory/never-loaded.md",
      keywords: ["obscure", "unused"],
      patterns: [],
      priority: "domain",
      summary: "an entry that never appears in usage (dead)",
      triggers: { task: true, plan: true, edit: false },
      tokens_est: 200,
      lines: 30,
    },
  ];
  if (opts?.withCore !== false) {
    entries.unshift({
      id: "core-rule",
      path: "memory/core-rule.md",
      keywords: [],
      patterns: [],
      priority: "core",
      summary: "always-loaded core rule",
      triggers: { task: true, plan: true, edit: false },
      tokens_est: 40,
      lines: 8,
    });
  }

  const index: LoadoutIndex = {
    version: "1.0.0",
    generated: new Date().toISOString(),
    entries,
    budget: {
      always_loaded_est: 40,
      on_demand_total_est: 260,
      avg_task_load_est: 130,
      avg_task_load_observed:
        opts?.observedAvg === undefined ? null : opts.observedAvg,
    },
  };

  const aiLoadout = join(dir, ".ai-loadout");
  mkdirSync(aiLoadout, { recursive: true });
  const indexPath = join(aiLoadout, "index.json");
  writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");

  const usagePath = join(aiLoadout, "usage.jsonl");
  if (opts?.withUsage) {
    const now = new Date().toISOString();
    const lines = [
      { timestamp: now, taskHash: "t1", entryId: "sample-topic", trigger: "UserPromptSubmit", mode: "lazy", score: 0.45, tokensEst: 60 },
      { timestamp: now, taskHash: "t2", entryId: "sample-topic", trigger: "UserPromptSubmit", mode: "lazy", score: 0.62, tokensEst: 60 },
      { timestamp: now, taskHash: "t3", entryId: "core-rule", trigger: "UserPromptSubmit", mode: "eager", score: 1.0, tokensEst: 40 },
    ];
    writeFileSync(usagePath, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  }

  // Synthetic hook files — source + an identical mirror (no drift) + a
  // different-bytes file (the drift case). Self-contained so the drift check is
  // exercised without depending on the repo's real apps/hook location or cwd.
  const hookSource = join(dir, "hook-source.mjs");
  const hookMirror = join(dir, "hook-mirror.mjs");
  const hookDrifted = join(dir, "hook-drifted.mjs");
  const hookBody = "// synthetic hook\nprocess.exit(0);\n";
  writeFileSync(hookSource, hookBody);
  writeFileSync(hookMirror, hookBody); // identical → no drift
  writeFileSync(hookDrifted, hookBody + "// extra byte\n"); // differs → drift

  const claudeDir = join(dir, ".claude");
  mkdirSync(claudeDir, { recursive: true });
  const settingsPath = join(claudeDir, "settings.json");
  const settings = opts?.withSettingsHook
    ? { hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "node ~/.claude/loadout-hook/loadout-hook.mjs" }] }] } }
    : { hooks: {} };
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  return {
    dir,
    storeDir,
    memoryMd,
    topicFile,
    indexPath,
    usagePath,
    settingsPath,
    hookSource,
    hookMirror,
    hookDrifted,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    },
  };
}

export interface RefreshSandbox {
  dir: string;
  storeDir: string;
  memoryMd: string;
  /** Where a refresh --dest would write (NOT the live ~/.ai-loadout). */
  destPath: string;
  cleanup: () => void;
}

/**
 * Build a self-contained SCRATCH store for refresh tests: a temp dir with a
 * MEMORY.md + one valid topic file (when `valid`), plus a temp `dest` path that
 * is NEVER the live ~/.ai-loadout/index.json. When `valid: false` the MEMORY.md
 * references a topic file that does not exist (MISSING_TOPIC_FILE) so the andon
 * gate halts. This keeps every refresh test off the canonical store + live
 * global index entirely.
 */
export function makeRefreshSandbox(opts?: { valid?: boolean }): RefreshSandbox {
  const valid = opts?.valid !== false;
  const dir = mkdtempSync(join(tmpdir(), "loadout-os-refresh-"));
  const storeDir = join(dir, "store");
  mkdirSync(storeDir, { recursive: true });

  if (valid) {
    writeFileSync(
      join(storeDir, "alpha-topic.md"),
      `---
id: alpha-topic
keywords: [alpha, scratch, refresh]
patterns: []
priority: domain
triggers:
  task: true
  plan: true
  edit: false
---

# Alpha Topic

A scratch topic for refresh tests.
`,
    );
    writeFileSync(
      join(storeDir, "MEMORY.md"),
      `# MEMORY

## Topics

- Alpha Topic — a scratch topic → \`alpha-topic.md\`
`,
    );
  } else {
    // references a topic file that does NOT exist → MISSING_TOPIC_FILE (error)
    writeFileSync(
      join(storeDir, "MEMORY.md"),
      `# MEMORY

## Topics

- Ghost Topic — points at a missing file → \`ghost-topic.md\`
`,
    );
  }

  const destPath = join(dir, "out", "index.json");
  mkdirSync(join(dir, "out"), { recursive: true });

  return {
    dir,
    storeDir,
    memoryMd: join(storeDir, "MEMORY.md"),
    destPath,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    },
  };
}

/** Capture console.log output produced while `fn` runs. */
export function captureLog(fn: () => void): string {
  const orig = console.log;
  const lines: string[] = [];
  console.log = (...a: unknown[]) => {
    lines.push(a.map(String).join(" "));
  };
  try {
    fn();
  } finally {
    console.log = orig;
  }
  return lines.join("\n");
}

/**
 * Sample docs-profile index entries referenced by the test rule table.
 */
export const DOCS_TRIAD_ENTRIES: LoadoutIndex["entries"] = [
  {
    id: "docs-memory",
    path: "memory/docs-memory.md",
    keywords: ["loadout", "memory", "docs", "system", "works"],
    patterns: ["docs_memory"],
    priority: "domain",
    summary: "How docs memory works: board injection, validation, and Edit-tool writes",
    triggers: { task: true, plan: true, edit: false },
    tokens_est: 977,
    lines: 52,
    metadata: {
      node_type: "memory",
      type: "reference",
      originSessionId: "de321234-740c-46e3-a4de-c1be5fbb071c",
      modified: "2026-11-08T11:25:59.656Z",
    },
  },
  {
    id: "release-approvals",
    path: "memory/release-approvals.md",
    keywords: ["approves", "publish", "release"],
    patterns: ["release_approvals"],
    priority: "domain",
    summary: "Release approval policy before npm/PyPI publish or tag creation",
    triggers: { task: true, plan: true, edit: false },
    tokens_est: 336,
    lines: 18,
    metadata: {
      node_type: "memory",
      type: "feedback",
      originSessionId: "cee64436-f327-4887-b701-506d061395dc",
      modified: "2026-10-21T01:58:06.571Z",
    },
    subindex: true,
  },
  {
    id: "release-merges",
    path: "memory/release-merges.md",
    keywords: ["merges", "release"],
    patterns: ["release_merges"],
    priority: "domain",
    summary: "Release maintainers merge reviewed PRs via the merge gate",
    triggers: { task: true, plan: true, edit: false },
    tokens_est: 228,
    lines: 16,
    metadata: {
      node_type: "memory",
      type: "feedback",
      originSessionId: "4f3291fb-4c6f-4baa-afe7-02032688e512",
      modified: "2026-10-12T02:44:18.541Z",
    },
  },
  {
    id: "quote-policy",
    path: "memory/quote-policy.md",
    keywords: ["quote", "verbatim", "public"],
    patterns: ["quote_policy"],
    priority: "domain",
    summary: "Record decisions rather than verbatim speaker quotes",
    triggers: { task: true, plan: true, edit: false },
    tokens_est: 364,
    lines: 20,
    metadata: {
      node_type: "memory",
      type: "feedback",
      originSessionId: "4f3291fb-4c6f-4baa-afe7-02032688e512",
      modified: "2026-10-14T19:56:53.784Z",
    },
  },
  {
    id: "workspace-tools",
    path: "memory/workspace-tools.md",
    keywords: ["build", "tools", "loadout", "scripts"],
    patterns: ["workspace_tools"],
    priority: "domain",
    summary: "Use loadout-os memory commands instead of ad-hoc shell mutation scripts",
    triggers: { task: true, plan: true, edit: false },
    tokens_est: 388,
    lines: 26,
    metadata: {
      node_type: "memory",
      type: "feedback",
      originSessionId: "de321234-740c-46e3-a4de-c1be5fbb071c",
      modified: "2026-11-08T07:48:45.358Z",
    },
  },
];

/**
 * Sample release-profile entries referenced by the test rule table.
 */
export const RELEASE_TRIAD_ENTRIES: LoadoutIndex["entries"] = [
  {
    id: "release-rules",
    path: "memory/release-rules.md",
    keywords: ["release", "merges", "publish", "gate"],
    patterns: ["release_rules"],
    priority: "domain",
    summary: "Release authority, merge and publish gating, code review verdicts at head",
    triggers: { task: true, plan: true, edit: false },
    tokens_est: 1800,
    lines: 50,
  },
  {
    id: "communication-policy",
    path: "memory/communication-policy.md",
    keywords: ["communication", "quote", "eastern"],
    patterns: ["communication_policy"],
    priority: "domain",
    summary: "Standing communication policy: paraphrase decisions, Eastern time only",
    triggers: { task: true, plan: true, edit: false },
    tokens_est: 1100,
    lines: 50,
  },
  {
    id: "memory-reference",
    path: "memory/memory-reference.md",
    keywords: ["memory", "system", "loadout", "refresh"],
    patterns: ["memory_reference"],
    priority: "domain",
    summary: "How release memory operates: board injection, refresh guard, Edit-tool writes",
    triggers: { task: true, plan: true, edit: false },
    tokens_est: 1200,
    lines: 35,
  },
];

/**
 * Sample global index entry for default profile quote-gate tests.
 */
export const GLOBAL_TRIAD_ENTRIES: LoadoutIndex["entries"] = [
  {
    id: "quote-law",
    path: "memory/quote-law.md",
    keywords: ["quote", "verbatim", "speech"],
    patterns: ["quote_law"],
    priority: "domain",
    summary: "Hard law: never reproduce configured speaker words verbatim in artifacts",
    triggers: { task: true, plan: true, edit: false },
    tokens_est: 2462,
    lines: 154,
    metadata: { type: "feedback" },
  },
];

export interface ReplayCasePair {
  id: string;
  ruleId: string;
  expectedViolatingAction?: "block" | "warn";
  blockedStdin: Record<string, unknown>;
  allowedStdin: Record<string, unknown>;
  expectedAllowedOutcome: "allow" | "warn";
}

export const REPLAY_2026_11_08_STORE = "E:/AI/CustomStore/memory";
/** Fixed clock: 2026-11-08 15:44:00 EST (20:44:00 UTC). */
export const REPLAY_2026_11_08_CLOCK_MS = Date.UTC(2026, 10, 8, 20, 44, 0, 0);

/**
 * Canned PreToolUse JSON fixture of the four slips from 2026-11-08 and their
 * matching allowed calls (Part 5.1, with a real board line carrying trailing text).
 * Note: unreviewed-merge is warn-only by default, and suppressed when a matching
 * `PASS at <head8>` reply exists.
 */
export const REPLAY_2026_11_08_FIXTURE: readonly ReplayCasePair[] = [
  {
    id: "slip-1-unreviewed-merge",
    ruleId: "unreviewed-merge",
    expectedViolatingAction: "warn",
    blockedStdin: {
      hook_event_name: "PreToolUse",
      session_id: "replay-2026-11-08",
      cwd: "E:/AI/Research and Development",
      tool_name: "Bash",
      tool_input: { command: "gh pr merge 21" },
    },
    allowedStdin: {
      hook_event_name: "PreToolUse",
      session_id: "replay-2026-11-08",
      cwd: "E:/AI/ReleaseRepo",
      tool_name: "Bash",
      tool_input: { command: "gh pr merge 21" },
    },
    expectedAllowedOutcome: "warn",
  },
  {
    id: "slip-2-dated-quote-gate",
    ruleId: "quote-gate",
    blockedStdin: {
      hook_event_name: "PreToolUse",
      session_id: "replay-2026-11-08",
      cwd: "E:/AI/Research and Development",
      tool_name: "Write",
      tool_input: {
        file_path: "E:/AI/Research and Development/docs/handoff.md",
        content:
          '# Handoff\n\nLead 2026-11-08: "I want every build to go through the card process before any code is merged."\n',
      },
    },
    allowedStdin: {
      hook_event_name: "PreToolUse",
      session_id: "replay-2026-11-08",
      cwd: "E:/AI/Research and Development",
      tool_name: "Write",
      tool_input: {
        file_path: "E:/AI/Research and Development/docs/handoff.md",
        content:
          "# Handoff\n\nLead 2026-11-08 ruled that every build goes through the card process before any code is merged.\n",
      },
    },
    expectedAllowedOutcome: "allow",
  },
  {
    id: "slip-3-future-last-updated",
    ruleId: "future-stamp",
    blockedStdin: {
      hook_event_name: "PreToolUse",
      session_id: "replay-2026-11-08",
      cwd: "E:/AI/Research and Development",
      tool_name: "Edit",
      tool_input: {
        file_path: `${REPLAY_2026_11_08_STORE}/BOARD.md`,
        old_string:
          "**Last updated:** 2026-11-08 15:03 ET (clock-checked). loadout-os 1.1.1 live; pretool step 1 in flight.",
        new_string:
          "**Last updated:** 2026-11-08 17:00 ET (clock-checked). loadout-os 1.1.1 live; pretool step 1 in flight.",
      },
    },
    allowedStdin: {
      hook_event_name: "PreToolUse",
      session_id: "replay-2026-11-08",
      cwd: "E:/AI/Research and Development",
      tool_name: "Edit",
      tool_input: {
        file_path: `${REPLAY_2026_11_08_STORE}/BOARD.md`,
        old_string:
          "**Last updated:** 2026-11-08 15:03 ET (clock-checked). loadout-os 1.1.1 live; pretool step 1 in flight.",
        new_string:
          "**Last updated:** 2026-11-08 15:44 ET (clock-checked). loadout-os 1.1.1 live; pretool step 1 in flight.",
      },
    },
    expectedAllowedOutcome: "allow",
  },
  {
    id: "slip-3b-release-heading-updated",
    ruleId: "future-stamp",
    blockedStdin: {
      hook_event_name: "PreToolUse",
      session_id: "replay-2026-11-08",
      cwd: "E:/AI/ReleaseRepo",
      tool_name: "Edit",
      tool_input: {
        file_path: `${REPLAY_2026_11_08_STORE}/BOARD.md`,
        old_string:
          "# Release BOARD — updated 2026-11-08 15:03 ET (stamped from date)",
        new_string:
          "# Release BOARD — updated 2026-11-08 23:59 ET (stamped from date)",
      },
    },
    allowedStdin: {
      hook_event_name: "PreToolUse",
      session_id: "replay-2026-11-08",
      cwd: "E:/AI/ReleaseRepo",
      tool_name: "Edit",
      tool_input: {
        file_path: `${REPLAY_2026_11_08_STORE}/BOARD.md`,
        old_string:
          "# Release BOARD — updated 2026-11-08 15:03 ET (stamped from date)",
        new_string:
          "# Release BOARD — updated 2026-11-08 15:44 ET (stamped from date)",
      },
    },
    expectedAllowedOutcome: "allow",
  },
  {
    id: "slip-4-memory-shell-write-python-heredoc",
    ruleId: "memory-shell-write",
    blockedStdin: {
      hook_event_name: "PreToolUse",
      session_id: "replay-2026-11-08",
      cwd: "E:/AI/Research and Development",
      tool_name: "Bash",
      tool_input: {
        command: `python - <<EOF\nwith open('${REPLAY_2026_11_08_STORE}/BOARD.md','w') as f:\n    f.write('# Board\\n')\nEOF`,
      },
    },
    allowedStdin: {
      hook_event_name: "PreToolUse",
      session_id: "replay-2026-11-08",
      cwd: "E:/AI/Research and Development",
      tool_name: "Bash",
      tool_input: {
        command: `loadout-os memories place ${REPLAY_2026_11_08_STORE}/topic.md main --store ${REPLAY_2026_11_08_STORE}`,
      },
    },
    expectedAllowedOutcome: "allow",
  },
];


