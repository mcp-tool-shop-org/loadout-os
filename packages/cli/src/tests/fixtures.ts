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
 * The 5 R&D project index entries referenced by the Part 3/Part 4.3 rule table,
 * copied from `.claude/loadout/index.json` with store-relative paths (`memory/<id>.md`)
 * so no home paths are committed.
 */
export const RND_TRIAD_ENTRIES: LoadoutIndex["entries"] = [
  {
    id: "rnd-memory-system",
    path: "memory/rnd-memory-system.md",
    keywords: ["loadout", "memory", "rnd", "system", "works"],
    patterns: ["rnd_memory_system"],
    priority: "domain",
    summary:
      "How R&D memory works since the 2026-11-08 cutover to loadout-os 1.1.0: BOARD injected at start/compaction by loadout-os ",
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
    id: "publisher-approves-every-publish",
    path: "memory/publisher-approves-every-publish.md",
    keywords: ["approves", "publish", "publisher"],
    patterns: ["publisher_approves_every_publish"],
    priority: "domain",
    summary:
      "Director 2026-10-21 via Publisher — nothing publishes (npm/PyPI/binary, a tag or release that triggers one, Store, repo/",
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
    id: "publisher-merges",
    path: "memory/publisher-merges.md",
    keywords: ["merges", "publisher"],
    patterns: ["publisher_merges"],
    priority: "domain",
    summary:
      "R&D never merges PRs, even when its re-check is the last gate; the Publisher merges via gatemerge",
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
    id: "never-quote-director-in-public",
    path: "memory/never-quote-director-in-public.md",
    keywords: ["director", "never", "public", "quote"],
    patterns: ["never_quote_director_in_public"],
    priority: "domain",
    summary:
      "Records carry the Director's decisions, never his words; brief status lines are where the slip happens; nothing is exemp",
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
    id: "build-in-studio-tools-not-side-scripts",
    path: "memory/build-in-studio-tools-not-side-scripts.md",
    keywords: ["build", "scripts", "side", "studio", "tools"],
    patterns: ["build_in_studio_tools_not_side_scripts"],
    priority: "domain",
    summary:
      "Director 2026-11-08 (very unhappy): infrastructure is built INSIDE the studio's own tools (loadout-os etc.) as Argon bui",
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

export const PUBLISHER_TRIAD_ENTRIES: LoadoutIndex["entries"] = [
  {
    id: "feedback-eastern-time",
    path: "memory/feedback-eastern-time.md",
    keywords: ["eastern", "time", "clock"],
    patterns: ["feedback_eastern_time"],
    priority: "domain",
    summary: "All timestamps use Eastern Time checked against the OS clock",
    triggers: { task: true, plan: true, edit: false },
    tokens_est: 200,
    lines: 14,
  },
  {
    id: "publishing-tags-need-publisher-ok",
    path: "memory/publishing-tags-need-publisher-ok.md",
    keywords: ["publish", "tags", "publisher"],
    patterns: ["publishing_tags_need_publisher_ok"],
    priority: "domain",
    summary: "Publishing tags and releases requires Publisher OK and full-treatment",
    triggers: { task: true, plan: true, edit: false },
    tokens_est: 220,
    lines: 15,
  },
  {
    id: "publisher-merges-as-coordinator",
    path: "memory/publisher-merges-as-coordinator.md",
    keywords: ["merges", "coordinator", "publisher"],
    patterns: ["publisher_merges_as_coordinator"],
    priority: "domain",
    summary: "Publisher merges PRs as coordinator after Argon PASS at head",
    triggers: { task: true, plan: true, edit: false },
    tokens_est: 240,
    lines: 16,
  },
  {
    id: "feedback-never-quote-director",
    path: "memory/feedback-never-quote-director.md",
    keywords: ["director", "never", "quote"],
    patterns: ["feedback_never_quote_director"],
    priority: "domain",
    summary: "Never reproduce the Director's words verbatim in any artifact",
    triggers: { task: true, plan: true, edit: false },
    tokens_est: 260,
    lines: 18,
  },
  {
    id: "project-memory-system",
    path: "memory/project-memory-system.md",
    keywords: ["memory", "system", "loadout"],
    patterns: ["project_memory_system"],
    priority: "domain",
    summary: "Publisher project memory system managed via loadout-os",
    triggers: { task: true, plan: true, edit: false },
    tokens_est: 300,
    lines: 20,
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

export const REPLAY_2026_11_08_STORE = "E:/AI/StudioStore/memory";
/** Fixed clock: 2026-11-08 15:44:00 EST (20:44:00 UTC). */
export const REPLAY_2026_11_08_CLOCK_MS = Date.UTC(2026, 10, 8, 20, 44, 0, 0);

/**
 * Canned PreToolUse JSON fixture of the four slips from 2026-11-08 and their
 * matching allowed calls (Part 5.1, with a real board line carrying trailing text).
 * Note: Under Ruling 2 (#25), unreviewed-merge is permanently warn-only on every
 * seat, and suppressed when a matching Argon `PASS at <head8>` reply exists.
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
      cwd: "E:/AI/Publisher",
      tool_name: "Bash",
      tool_input: { command: "gh pr merge 21" },
    },
    expectedAllowedOutcome: "warn",
  },
  {
    id: "slip-2-dated-director-quote",
    ruleId: "director-quote",
    blockedStdin: {
      hook_event_name: "PreToolUse",
      session_id: "replay-2026-11-08",
      cwd: "E:/AI/Research and Development",
      tool_name: "Write",
      tool_input: {
        file_path: "E:/AI/Research and Development/docs/handoff.md",
        content:
          '# Handoff\n\nDirector 2026-11-08: "I want every build to go through the card process before any code is merged."\n',
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
          "# Handoff\n\nDirector 2026-11-08 ruled that every build goes through the card process before any code is merged.\n",
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
    id: "slip-3b-publisher-heading-updated",
    ruleId: "future-stamp",
    blockedStdin: {
      hook_event_name: "PreToolUse",
      session_id: "replay-2026-11-08",
      cwd: "E:/AI/Publisher",
      tool_name: "Edit",
      tool_input: {
        file_path: `${REPLAY_2026_11_08_STORE}/BOARD.md`,
        old_string:
          "# Publisher BOARD — updated 2026-11-08 15:03 ET (stamped from date)",
        new_string:
          "# Publisher BOARD — updated 2026-11-08 23:59 ET (stamped from date)",
      },
    },
    allowedStdin: {
      hook_event_name: "PreToolUse",
      session_id: "replay-2026-11-08",
      cwd: "E:/AI/Publisher",
      tool_name: "Edit",
      tool_input: {
        file_path: `${REPLAY_2026_11_08_STORE}/BOARD.md`,
        old_string:
          "# Publisher BOARD — updated 2026-11-08 15:03 ET (stamped from date)",
        new_string:
          "# Publisher BOARD — updated 2026-11-08 15:44 ET (stamped from date)",
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


