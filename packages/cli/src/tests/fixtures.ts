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
