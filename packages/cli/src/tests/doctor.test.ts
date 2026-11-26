/**
 * doctor: run against a synthetic store/index/settings/usage sandbox and assert
 * each check's status. Confirms it is read-only (no files created) and that the
 * overall `ok` flips on a hard ✗.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runDoctor, defaultDoctorPaths, type DoctorCheck, type DoctorPaths } from "../doctor.js";
import { dispatch } from "../cli.js";
import { makeSandbox } from "./fixtures.js";

function pathsFor(sb: ReturnType<typeof makeSandbox>): DoctorPaths {
  return {
    store: sb.storeDir,
    index: sb.indexPath,
    settings: sb.settingsPath,
    usage: sb.usagePath,
    // self-contained synthetic hook files (identical bytes → no drift); the
    // drift test swaps hookMirror for the different-bytes file. This keeps the
    // suite independent of cwd and the repo's real apps/hook location.
    hookSource: sb.hookSource,
    hookMirror: sb.hookMirror,
  };
}

function find(checks: DoctorCheck[], id: string): DoctorCheck {
  const c = checks.find((x) => x.id === id);
  assert.ok(c, `expected a check with id "${id}"`);
  return c!;
}

test("doctor: healthy sandbox passes the structural checks", () => {
  const sb = makeSandbox({
    withUsage: true,
    withSettingsHook: true,
    withCore: true,
    observedAvg: 130,
  });
  try {
    const result = runDoctor(pathsFor(sb));

    // store + index parse cleanly
    assert.notEqual(find(result.checks, "store-validates").status, "fail");
    assert.notEqual(find(result.checks, "index-parse").status, "fail");
    // core entries present → pass
    assert.equal(find(result.checks, "core-entries").status, "pass");
    // observed avg set → pass
    assert.equal(find(result.checks, "observability-loop").status, "pass");
    // hook wired in settings → pass
    assert.equal(find(result.checks, "hook-wired").status, "pass");
    // usage recent + nonzero → pass
    assert.equal(find(result.checks, "usage-growing").status, "pass");
    // identical source/mirror → no drift
    assert.equal(find(result.checks, "hook-drift").status, "pass");
  } finally {
    sb.cleanup();
  }
});

test("doctor: missing hook in settings → hook-wired fail flips ok=false", () => {
  const sb = makeSandbox({ withSettingsHook: false, withCore: true });
  try {
    const result = runDoctor(pathsFor(sb));
    assert.equal(find(result.checks, "hook-wired").status, "fail");
    assert.equal(result.ok, false);
  } finally {
    sb.cleanup();
  }
});

test("doctor: 0 core entries → core-entries warn (not fail)", () => {
  const sb = makeSandbox({ withCore: false, withSettingsHook: true, withUsage: true });
  try {
    const result = runDoctor(pathsFor(sb));
    assert.equal(find(result.checks, "core-entries").status, "warn");
  } finally {
    sb.cleanup();
  }
});

test("doctor: null observed avg → observability-loop warn", () => {
  const sb = makeSandbox({ observedAvg: null, withSettingsHook: true });
  try {
    const result = runDoctor(pathsFor(sb));
    assert.equal(find(result.checks, "observability-loop").status, "warn");
  } finally {
    sb.cleanup();
  }
});

test("doctor: missing index → index-parse fail, ok=false", () => {
  const sb = makeSandbox({ withSettingsHook: true });
  try {
    const paths = pathsFor(sb);
    paths.index = `${sb.dir}/.ai-loadout/does-not-exist.json`;
    const result = runDoctor(paths);
    assert.equal(find(result.checks, "index-parse").status, "fail");
    assert.equal(result.ok, false);
  } finally {
    sb.cleanup();
  }
});

test("doctor: drifting hook mirror → hook-drift fail", () => {
  const sb = makeSandbox({ withSettingsHook: true });
  try {
    const paths = pathsFor(sb);
    // mirror = the different-bytes hook file → drift vs. the source
    paths.hookMirror = sb.hookDrifted;
    const result = runDoctor(paths);
    assert.equal(find(result.checks, "hook-drift").status, "fail");
  } finally {
    sb.cleanup();
  }
});

test("doctor: NEVER writes — sandbox dir file count is unchanged", () => {
  const sb = makeSandbox({ withUsage: true, withSettingsHook: true });
  try {
    const before = readdirSync(sb.dir).length;
    runDoctor(pathsFor(sb));
    const after = readdirSync(sb.dir).length;
    assert.equal(before, after, "doctor must not create files");
    // and it must not have created the missing never-loaded topic file
    assert.equal(existsSync(`${sb.storeDir}/never-loaded.md`), false);
  } finally {
    sb.cleanup();
  }
});

test("doctor: defaultDoctorPaths points hookSource at bundled apps/hook/dist/loadout-hook.mjs and root npm run build includes apps/hook (Q7-3)", () => {
  const sb = makeSandbox({ withSettingsHook: true });
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const repoRoot = resolve(here, "..", "..", "..", "..");
    const pkgJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8"));
    assert.match(
      String(pkgJson.scripts?.build ?? ""),
      /apps\/hook/,
      "root package.json build script must build apps/hook",
    );

    const defaults = defaultDoctorPaths(repoRoot);
    assert.equal(
      defaults.hookSource,
      resolve(repoRoot, "apps", "hook", "dist", "loadout-hook.mjs"),
      "defaultDoctorPaths must compare against bundled apps/hook/dist/loadout-hook.mjs",
    );

    const fakeRepo = join(sb.dir, "fake-repo");
    const unbundledDir = join(fakeRepo, "apps", "hook");
    const bundledDir = join(unbundledDir, "dist");
    mkdirSync(bundledDir, { recursive: true });
    writeFileSync(join(unbundledDir, "loadout-hook.mjs"), "// unbundled source\n", "utf-8");
    writeFileSync(join(bundledDir, "loadout-hook.mjs"), "// bundled standalone\n", "utf-8");

    const mirrorFile = join(sb.dir, "installed-mirror.mjs");
    writeFileSync(mirrorFile, "// bundled standalone\n", "utf-8");

    const p = {
      ...pathsFor(sb),
      hookSource: defaultDoctorPaths(fakeRepo).hookSource,
      hookMirror: mirrorFile,
    };
    const passRes = runDoctor(p);
    assert.equal(
      find(passRes.checks, "hook-drift").status,
      "pass",
      "mirror matching bundled dist/loadout-hook.mjs must pass hook-drift",
    );

    writeFileSync(mirrorFile, "// unbundled source\n", "utf-8");
    const failRes = runDoctor(p);
    const driftCheck = find(failRes.checks, "hook-drift") as { id: string; status: string; hint?: string };
    assert.equal(driftCheck.status, "fail");
    assert.match(driftCheck.hint ?? "", /apps\/hook\/dist\/loadout-hook\.mjs/);
  } finally {
    sb.cleanup();
  }
});
// ════════════════════════════════════════════════════════════════
// Part 4: provenance frontmatter fields & doctor triad checks
// ════════════════════════════════════════════════════════════════

import { parseFrontmatter, serializeFrontmatter } from "@mcptoolshop/ai-loadout";
import { analyzeMemoryMd, generateIndex } from "@mcptoolshop/claude-memories";
import { PRETOOL_RULES } from "../pretool-rules.js";

test("Part 4.1: provenance & triad frontmatter fields read at top-level or under metadata, and carried into index entries", () => {
  const sb = makeSandbox({ withCore: true });
  try {
    // 1. Top-level provenance fields
    const topMd = [
      "---",
      "id: prov-top",
      "name: Provenance Top",
      "description: Tests top-level provenance fields",
      "keywords: [provenance, top]",
      "priority: domain",
      "loadout_skill: review-flow",
      "loadout_triggers: [unreviewed-merge, release-reminder]",
      "author_agent: docs",
      "created_at: 2026-11-08T15:00:00Z",
      "verification_status: tool_verified",
      "evidence_ref: PR#21",
      "supersedes: old-prov-top",
      "---",
      "",
      "# Provenance Top",
    ].join("\n");

    const parsedTop = parseFrontmatter(topMd);
    assert.ok(parsedTop.frontmatter);
    assert.equal(parsedTop.frontmatter.loadout_skill, "review-flow");
    assert.deepEqual(parsedTop.frontmatter.loadout_triggers, [
      "unreviewed-merge",
      "release-reminder",
    ]);
    assert.equal(parsedTop.frontmatter.author_agent, "docs");
    assert.equal(parsedTop.frontmatter.created_at, "2026-11-08T15:00:00Z");
    assert.equal(parsedTop.frontmatter.verification_status, "tool_verified");
    assert.equal(parsedTop.frontmatter.evidence_ref, "PR#21");
    assert.equal(parsedTop.frontmatter.supersedes, "old-prov-top");

    // Round-trip via serializeFrontmatter
    const reserialized = serializeFrontmatter(parsedTop.frontmatter);
    const reparsed = parseFrontmatter(reserialized);
    assert.equal(reparsed.frontmatter?.loadout_skill, "review-flow");
    assert.deepEqual(reparsed.frontmatter?.loadout_triggers, [
      "unreviewed-merge",
      "release-reminder",
    ]);
    assert.equal(reparsed.frontmatter?.verification_status, "tool_verified");

    // 2. Nested under `metadata:`
    const metaMd = [
      "---",
      "name: Provenance Meta",
      "description: Tests metadata-nested provenance fields",
      "metadata:",
      "  id: prov-meta",
      "  priority: domain",
      "  loadout_skill: loadout-os",
      "  loadout_triggers: [memory-shell-write, future-stamp]",
      "  author_agent: release",
      "  created_at: 2026-11-08 15:03 ET",
      "  verification_status: human_ruling",
      "  evidence_ref: ruling-2026-11-08",
      "  supersedes: legacy-gate",
      "---",
      "",
      "# Provenance Meta",
    ].join("\n");

    const parsedMeta = parseFrontmatter(metaMd);
    assert.ok(parsedMeta.frontmatter);
    assert.equal(parsedMeta.frontmatter.id, "prov-meta");
    assert.equal(parsedMeta.frontmatter.loadout_skill, "loadout-os");
    assert.deepEqual(parsedMeta.frontmatter.loadout_triggers, [
      "memory-shell-write",
      "future-stamp",
    ]);
    assert.equal(parsedMeta.frontmatter.author_agent, "release");
    assert.equal(parsedMeta.frontmatter.created_at, "2026-11-08 15:03 ET");
    assert.equal(parsedMeta.frontmatter.verification_status, "human_ruling");
    assert.equal(parsedMeta.frontmatter.evidence_ref, "ruling-2026-11-08");
    assert.equal(parsedMeta.frontmatter.supersedes, "legacy-gate");

    // 3. Indexer carries provenance fields into generated LoadoutEntry items
    writeFileSync(join(sb.storeDir, "prov-top.md"), topMd, "utf-8");
    writeFileSync(join(sb.storeDir, "prov-meta.md"), metaMd, "utf-8");
    writeFileSync(
      sb.memoryMd,
      [
        "# MEMORY",
        "",
        "## Topics",
        "",
        "- [Provenance Top](prov-top.md) — Tests top-level provenance fields",
        "- [Provenance Meta](prov-meta.md) — Tests metadata-nested provenance fields",
      ].join("\n"),
      "utf-8",
    );

    const analysis = analyzeMemoryMd(sb.memoryMd);
    const idx = generateIndex(analysis, { projectMode: true });
    const eTop = idx.entries.find((e) => e.id === "prov-top");
    const eMeta = idx.entries.find((e) => e.id === "prov-meta");
    assert.ok(eTop);
    assert.equal(eTop.loadout_skill, "review-flow");
    assert.deepEqual(eTop.loadout_triggers, ["unreviewed-merge", "release-reminder"]);
    assert.equal(eTop.author_agent, "docs");
    assert.equal(eTop.created_at, "2026-11-08T15:00:00Z");
    assert.equal(eTop.verification_status, "tool_verified");
    assert.equal(eTop.evidence_ref, "PR#21");
    assert.equal(eTop.supersedes, "old-prov-top");

    assert.ok(eMeta);
    assert.equal(eMeta.loadout_skill, "loadout-os");
    assert.deepEqual(eMeta.loadout_triggers, ["memory-shell-write", "future-stamp"]);
    assert.equal(eMeta.author_agent, "release");
    assert.equal(eMeta.verification_status, "human_ruling");
  } finally {
    sb.cleanup();
  }
});

test("Part 4.2 & 4.3: doctor triad check in temp HOME verifies configured rule memories, skills (WARN on skill: none with reason), and PreToolUse hook command+mode", () => {
  const sb = makeSandbox({
    withUsage: true,
    withSettingsHook: true,
    withCore: true,
    observedAvg: 130,
  });
  try {
    // Populate temp HOME's project index with neutral default rule memory ids configured via profiles.json
    const projectIndexPath = join(sb.dir, "project-index.json");
    const defaultTriadIds = [
      "merge-review-policy",
      "quote-gate-policy",
      "memory-store-policy",
      "timestamp-policy",
      "release-checklist-policy",
    ];
    writeFileSync(
      projectIndexPath,
      JSON.stringify(
        {
          version: "1.0.0",
          generated: "2026-11-08T20:00:00.000Z",
          entries: defaultTriadIds.map((id) => ({
            id,
            path: `memory/${id}.md`,
            keywords: [id],
            patterns: [],
            priority: "domain",
            summary: `Policy entry for ${id}`,
            triggers: { task: true, plan: true, edit: false },
            tokens_est: 100,
            lines: 10,
          })),
          budget: {
            always_loaded_est: 0,
            on_demand_total_est: 500,
            avg_task_load_est: 100,
            avg_task_load_observed: null,
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const profilesPath = join(sb.dir, "profiles.json");
    writeFileSync(
      profilesPath,
      JSON.stringify(
        {
          rules: {
            "unreviewed-merge": { memory: { default: "merge-review-policy" }, skill: "review-gate" },
            "quote-gate": { memory: { default: "quote-gate-policy" } },
            "memory-shell-write": { memory: { default: "memory-store-policy" }, skill: "loadout-os" },
            "future-stamp": { memory: { default: "timestamp-policy" }, skill: "loadout-os" },
            "release-reminder": { memory: { default: "release-checklist-policy" }, skill: "release-flow" },
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    // Populate temp HOME's ~/.claude/skills/<name>/SKILL.md for the configured skills
    const skillsDir = join(sb.dir, ".claude", "skills");
    for (const skillName of ["review-gate", "loadout-os", "release-flow"]) {
      const sDir = join(skillsDir, skillName);
      mkdirSync(sDir, { recursive: true });
      writeFileSync(
        join(sDir, "SKILL.md"),
        `---\nname: ${skillName}\ndescription: Synthetic skill fixture\n---\n# ${skillName}\n`,
        "utf-8",
      );
    }

    // Wire both UserPromptSubmit (loadout-hook) and PreToolUse (loadout-os hook pre-tool --mode log-only)
    writeFileSync(
      sb.settingsPath,
      JSON.stringify(
        {
          hooks: {
            UserPromptSubmit: [
              {
                hooks: [
                  {
                    type: "command",
                    command: "node ~/.claude/loadout-hook/loadout-hook.mjs",
                  },
                ],
              },
            ],
            PreToolUse: [
              {
                matcher: "Bash|Write|Edit|MultiEdit",
                hooks: [
                  {
                    type: "command",
                    command: "loadout-os hook pre-tool --mode log-only",
                  },
                ],
              },
            ],
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const basePaths: DoctorPaths = {
      ...pathsFor(sb),
      skillsDir,
      extraIndexes: [projectIndexPath],
      profilesPath,
    };

    const res = runDoctor(basePaths);
    assert.equal(res.ok, true, "healthy triad in temp HOME should have ok=true");

    const memCheck = find(res.checks, "triad-memories");
    assert.equal(memCheck.status, "pass");

    const skillCheck = find(res.checks, "triad-skills");
    // WARN because quote-gate is marked `skill: "none"` with a reason
    assert.equal(skillCheck.status, "warn");
    assert.match(skillCheck.message, /quote-gate/);

    const hookCheck = find(res.checks, "triad-pretool-hook");
    assert.equal(hookCheck.status, "pass");
    assert.match(hookCheck.message, /loadout-os hook pre-tool --mode log-only/);
    assert.match(hookCheck.message, /mode: log-only/);

    // 0. With no profiles.json (no memory refs configured), triad-memories passes cleanly
    const unconfiguredRes = runDoctor({
      ...pathsFor(sb),
      skillsDir,
    });
    assert.equal(find(unconfiguredRes.checks, "triad-memories").status, "pass");

    // 1. Broken memory link -> FAIL
    const brokenMemRes = runDoctor({
      ...basePaths,
      extraIndexes: [], // removes the project index so configured rule memories are missing
    });
    assert.equal(find(brokenMemRes.checks, "triad-memories").status, "fail");
    assert.equal(brokenMemRes.ok, false);

    // 2. Broken skill link (missing SKILL.md) -> FAIL
    const emptySkillsDir = join(sb.dir, "empty-skills");
    mkdirSync(emptySkillsDir, { recursive: true });
    const brokenSkillRes = runDoctor({
      ...basePaths,
      skillsDir: emptySkillsDir,
    });
    assert.equal(find(brokenSkillRes.checks, "triad-skills").status, "fail");
    assert.equal(brokenSkillRes.ok, false);

    // 3. Broken skill link (`skill: "none"` without skillNoneReason) -> FAIL
    const badNoneRuleRes = runDoctor({
      ...basePaths,
      rules: [
        {
          ...PRETOOL_RULES[1],
          skill: "none",
          skillNoneReason: "",
        },
      ],
    });
    assert.equal(find(badNoneRuleRes.checks, "triad-skills").status, "fail");
    assert.equal(badNoneRuleRes.ok, false);

    // 4. Missing PreToolUse hook in settings.json -> FAIL
    writeFileSync(
      sb.settingsPath,
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            {
              hooks: [
                {
                  type: "command",
                  command: "node ~/.claude/loadout-hook/loadout-hook.mjs",
                },
              ],
            },
          ],
        },
      }),
      "utf-8",
    );
    const missingPreToolRes = runDoctor(basePaths);
    assert.equal(
      find(missingPreToolRes.checks, "triad-pretool-hook").status,
      "fail",
    );
    assert.equal(missingPreToolRes.ok, false);
  } finally {
    sb.cleanup();
  }
});

test("Issue #25 / Ruling 1: doctor triad-memories check runs per profile across two temp profile stores, passing when each profile's ids resolve only in its own store, and failing naming the profile when one id is missing", () => {
  const sb = makeSandbox({
    withUsage: true,
    withSettingsHook: true,
    withCore: true,
    observedAvg: 130,
  });
  try {
    const docsStoreDir = join(sb.dir, "docs-store", "memory");
    const relStoreDir = join(sb.dir, "release-store", "memory");
    mkdirSync(docsStoreDir, { recursive: true });
    mkdirSync(relStoreDir, { recursive: true });

    const makeEntries = (ids: string[]) =>
      ids.map((id) => ({
        id,
        path: `memory/${id}.md`,
        keywords: [id],
        patterns: [id.replace(/-/g, "_")],
        priority: "domain" as const,
        summary: `Entry for ${id}`,
        triggers: { task: true, plan: true, edit: false },
        tokens_est: 100,
        lines: 10,
      }));

    const docsEntries = makeEntries([
      "docs-merge-rule",
      "docs-quote-rule",
      "docs-shell-rule",
      "docs-stamp-rule",
      "docs-release-rule",
    ]);
    const relEntries = makeEntries([
      "rel-merge-rule",
      "rel-quote-rule",
      "rel-memory-system",
    ]);

    writeFileSync(
      join(docsStoreDir, "index.json"),
      JSON.stringify(
        {
          version: "1.0.0",
          generated: "2026-11-09T00:00:00.000Z",
          entries: docsEntries,
          budget: {
            always_loaded_est: 0,
            on_demand_total_est: 500,
            avg_task_load_est: 100,
            avg_task_load_observed: null,
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    writeFileSync(
      join(relStoreDir, "index.json"),
      JSON.stringify(
        {
          version: "1.0.0",
          generated: "2026-11-09T00:00:00.000Z",
          entries: relEntries,
          budget: {
            always_loaded_est: 0,
            on_demand_total_est: 300,
            avg_task_load_est: 100,
            avg_task_load_observed: null,
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const profilesPath = join(sb.dir, "profiles.json");
    writeFileSync(
      profilesPath,
      JSON.stringify(
        {
          profiles: {
            "/repos/docs": { profile: "docs", store: docsStoreDir },
            "/repos/release": { profile: "release", store: relStoreDir },
          },
          rules: {
            "unreviewed-merge": {
              memory: { docs: "docs-merge-rule", release: "rel-merge-rule" },
              skill: "review-gate",
            },
            "quote-gate": {
              memory: { docs: "docs-quote-rule", release: "rel-quote-rule" },
            },
            "memory-shell-write": {
              memory: { docs: "docs-shell-rule", release: "rel-memory-system" },
              skill: "loadout-os",
            },
            "future-stamp": {
              memory: { docs: "docs-stamp-rule", release: "rel-memory-system" },
              skill: "loadout-os",
            },
            "release-reminder": {
              memory: { docs: "docs-release-rule", release: "rel-merge-rule" },
              skill: "release-flow",
            },
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const skillsDir = join(sb.dir, ".claude", "skills");
    for (const skillName of ["review-gate", "loadout-os", "release-flow"]) {
      const sDir = join(skillsDir, skillName);
      mkdirSync(sDir, { recursive: true });
      writeFileSync(
        join(sDir, "SKILL.md"),
        `---\nname: ${skillName}\ndescription: Synthetic skill fixture\n---\n# ${skillName}\n`,
        "utf-8",
      );
    }

    writeFileSync(
      sb.settingsPath,
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            {
              hooks: [
                {
                  type: "command",
                  command: "node ~/.claude/loadout-hook/loadout-hook.mjs",
                },
              ],
            },
          ],
          PreToolUse: [
            {
              matcher: "Bash|Write|Edit|MultiEdit",
              hooks: [
                {
                  type: "command",
                  command: "loadout-os hook pre-tool --mode enforce",
                },
              ],
            },
          ],
        },
      }),
      "utf-8",
    );

    // 1. Positive: both profiles have their own configured memory IDs in their own stores -> PASS
    const passRes = runDoctor({
      ...pathsFor(sb),
      skillsDir,
      profilesPath,
    });
    const passTriad = find(passRes.checks, "triad-memories");
    assert.equal(passTriad.status, "pass");
    assert.match(passTriad.message, /docs, release/);
    assert.equal(passRes.ok, true);

    // Exercise dispatchDoctor `--profiles` CLI wiring
    dispatch([
      "doctor",
      "--store",
      sb.storeDir,
      "--index",
      sb.indexPath,
      "--settings",
      sb.settingsPath,
      "--usage",
      sb.usagePath,
      "--skills",
      skillsDir,
      "--profiles",
      profilesPath,
      "--json",
    ]);
    process.exitCode = 0;

    // 2. Negative: remove `rel-quote-rule` from release store -> FAIL naming `release`
    writeFileSync(
      join(relStoreDir, "index.json"),
      JSON.stringify(
        {
          version: "1.0.0",
          generated: "2026-11-09T00:00:00.000Z",
          entries: relEntries.filter((e) => e.id !== "rel-quote-rule"),
          budget: {
            always_loaded_est: 0,
            on_demand_total_est: 200,
            avg_task_load_est: 100,
            avg_task_load_observed: null,
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const failRes = runDoctor({
      ...pathsFor(sb),
      skillsDir,
      profilesPath,
    });
    const failTriad = find(failRes.checks, "triad-memories");
    assert.equal(failTriad.status, "fail");
    assert.match(
      failTriad.message,
      /release: quote-gate -> rel-quote-rule/,
      "Failure message must name the profile (`release`), rule (`quote-gate`), and missing memory ID (`rel-quote-rule`)",
    );
    assert.doesNotMatch(
      failTriad.message,
      /docs: /,
      "A release-store gap must not be reported against the docs profile",
    );
    assert.equal(failRes.ok, false);

    // 2b. Stale ids after a store rebuild: a store carrying old ids fails for every rule
    const preRebuildIds = ["legacy-a", "legacy-b"];
    writeFileSync(
      join(relStoreDir, "index.json"),
      JSON.stringify(
        {
          version: "1.0.0",
          generated: "2026-11-09T00:00:00.000Z",
          entries: makeEntries(preRebuildIds),
          budget: {
            always_loaded_est: 0,
            on_demand_total_est: 200,
            avg_task_load_est: 100,
            avg_task_load_observed: null,
          },
        },
        null,
        2,
      ),
      "utf-8",
    );
    const staleRes = runDoctor({
      ...pathsFor(sb),
      skillsDir,
      profilesPath,
    });
    const staleTriad = find(staleRes.checks, "triad-memories");
    assert.equal(staleTriad.status, "fail");
    for (const pair of [
      "unreviewed-merge -> rel-merge-rule",
      "quote-gate -> rel-quote-rule",
      "memory-shell-write -> rel-memory-system",
      "future-stamp -> rel-memory-system",
      "release-reminder -> rel-merge-rule",
    ]) {
      assert.ok(
        staleTriad.message.includes(`release: ${pair}`),
        `Stale release store must report \`release: ${pair}\`; got: ${staleTriad.message}`,
      );
    }
    assert.doesNotMatch(staleTriad.message, /docs: /);
    assert.equal(staleRes.ok, false);

    // 3. Direct `profileStores` option in DoctorPaths also validates per profile
    const directRes = runDoctor({
      ...pathsFor(sb),
      skillsDir,
      profileStores: { docs: docsStoreDir, release: relStoreDir },
    });
    assert.equal(find(directRes.checks, "triad-memories").status, "pass");
  } finally {
    sb.cleanup();
  }
});

// ════════════════════════════════════════════════════════════════
// PR 2 (Items 6, 7, 8): memory-index scaling, nested sub-indexes,
// and `loadout-os memories split --by <rules.json>`
// ════════════════════════════════════════════════════════════════

import {
  CLAUDE_CODE_MEMORY_READ_LIMIT_BYTES,
  DEFAULT_MEMORY_WARN_BYTES,
  DEFAULT_SUBINDEX_WARN_ENTRIES,
  resolveScaleThresholds,
} from "../doctor.js";
import { CliError } from "../console.js";

test("PR2 Item 6: doctor warns when MEMORY.md passes 60% of 24.4 KB read limit (14,640 B) and when a sub-index passes 60 entries; both thresholds configurable", () => {
  const sb = makeSandbox({
    withUsage: true,
    withSettingsHook: true,
    withCore: true,
    observedAvg: 130,
  });
  try {
    assert.equal(CLAUDE_CODE_MEMORY_READ_LIMIT_BYTES, 24_400);
    assert.equal(DEFAULT_MEMORY_WARN_BYTES, 14_640);
    assert.equal(DEFAULT_SUBINDEX_WARN_ENTRIES, 60);

    // 1. Small sandbox passes both memory-read-limit and subindex-entries
    const initialRes = runDoctor(pathsFor(sb));
    assert.equal(find(initialRes.checks, "memory-read-limit").status, "pass");
    assert.equal(find(initialRes.checks, "subindex-entries").status, "pass");

    // 2. Grow MEMORY.md past 14,640 bytes (60% of 24.4 KB) -> memory-read-limit warns
    const baseMem = readFileSync(sb.memoryMd, "utf-8");
    const paddedMem = `${baseMem}\n## Notes\n${"A".repeat(15_000)}\n`;
    writeFileSync(sb.memoryMd, paddedMem, "utf-8");

    const overBytesRes = runDoctor(pathsFor(sb));
    const memLimitCheck = find(overBytesRes.checks, "memory-read-limit");
    assert.equal(memLimitCheck.status, "warn");
    assert.match(memLimitCheck.message, /24\.4 KB read limit/);
    assert.match(memLimitCheck.message, /14640 B/);

    // Raising memoryWarnBytes via DoctorPaths silences the warning
    const customBytesRes = runDoctor({
      ...pathsFor(sb),
      memoryWarnBytes: 20_000,
    });
    assert.equal(find(customBytesRes.checks, "memory-read-limit").status, "pass");

    // 3. Create a sub-index (metadata.loadout_role: subindex) with 61 entries -> subindex-entries warns
    const subLines = [
      "---",
      "name: Large Subindex",
      "description: Subindex with 61 entries",
      "metadata:",
      "  loadout_role: subindex",
      "---",
      "# Large Subindex",
    ];
    for (let i = 1; i <= 61; i++) {
      const fname = `sub_entry_${String(i).padStart(2, "0")}.md`;
      writeFileSync(
        join(sb.storeDir, fname),
        `---\nid: sub-${i}\nname: Sub ${i}\ndescription: Sub entry ${i}\n---\n# Sub ${i}\n`,
        "utf-8",
      );
      subLines.push(`- [Sub ${i}](${fname}) — Sub entry ${i}`);
    }
    writeFileSync(join(sb.storeDir, "custom-sub.md"), subLines.join("\n") + "\n", "utf-8");
    writeFileSync(
      sb.memoryMd,
      `${baseMem.trimEnd()}\n- [Large Subindex](custom-sub.md) — Subindex with 61 entries\n`,
      "utf-8",
    );

    const overSubRes = runDoctor(pathsFor(sb));
    const subCheck = find(overSubRes.checks, "subindex-entries");
    assert.equal(subCheck.status, "warn");
    assert.match(subCheck.message, /custom-sub\.md \(61 entries\)/);

    // Raising subindexWarnEntries via .loadout.json or DoctorPaths silences the warning
    writeFileSync(
      join(sb.storeDir, ".loadout.json"),
      JSON.stringify({ memoryWarnBytes: 18_000, subindexWarnEntries: 70 }),
      "utf-8",
    );
    const resolvedThresholds = resolveScaleThresholds(pathsFor(sb));
    assert.equal(resolvedThresholds.memoryWarnBytes, 18_000);
    assert.equal(resolvedThresholds.subindexWarnEntries, 70);

    const configOverrideRes = runDoctor(pathsFor(sb));
    assert.equal(find(configOverrideRes.checks, "subindex-entries").status, "pass");

    // Also test frontmatter metadata thresholds when .loadout.json is absent
    writeFileSync(join(sb.storeDir, ".loadout.json"), "{ invalid", "utf-8");
    const fmThresholdMem = [
      "---",
      "metadata:",
      "  memory_warn_bytes: 16000",
      "  subindex_warn_entries: 65",
      "---",
      baseMem,
    ].join("\n");
    const fmResolved = resolveScaleThresholds(pathsFor(sb), fmThresholdMem);
    assert.equal(fmResolved.memoryWarnBytes, 16_000);
    assert.equal(fmResolved.subindexWarnEntries, 65);

    // CLI dispatch with --memory-warn-bytes and --subindex-warn-entries
    dispatch([
      "doctor",
      "--store",
      sb.storeDir,
      "--index",
      sb.indexPath,
      "--settings",
      sb.settingsPath,
      "--usage",
      sb.usagePath,
      "--memory-warn-bytes",
      "50",
      "--subindex-warn-entries",
      "10",
      "--json",
    ]);
    process.exitCode = 0;

    assert.throws(
      () => dispatch(["doctor", "--memory-warn-bytes", "0"]),
      (err: unknown) => err instanceof CliError && err.code === "INVALID_FLAG_VALUE",
    );
    assert.throws(
      () => dispatch(["doctor", "--subindex-warn-entries", "-5"]),
      (err: unknown) => err instanceof CliError && err.code === "INVALID_FLAG_VALUE",
    );
  } finally {
    sb.cleanup();
  }
});

test("PR2 Item 8: `loadout-os memories split --by <rules.json>` splits 85-entry temp store, proves count & priorities unchanged, writes nothing on --dry-run, and refuses on count mismatch", () => {
  const sb = makeSandbox({
    withUsage: true,
    withSettingsHook: true,
    withCore: true,
    observedAvg: 130,
  });
  try {
    // Populate sb.storeDir with 115 entries (core, domain, manual) so MEMORY.md exceeds 14,640 bytes
    const memLines = ["# Workspace Memory", "", "## Core", ""];
    for (let i = 1; i <= 5; i++) {
      const f = `core_${i}.md`;
      const desc = `Core entry ${i} with mandatory architecture invariants and session routing policy rules`;
      writeFileSync(
        join(sb.storeDir, f),
        `---\nid: core-${i}\nname: Core ${i}\ndescription: ${desc}\npriority: core\n---\n# Core ${i}\n`,
        "utf-8",
      );
      memLines.push(`- [Core ${i}](${f}) — ${desc}`);
    }

    memLines.push("", "## Feedback", "");
    for (let i = 1; i <= 55; i++) {
      const f = `feedback_${String(i).padStart(2, "0")}.md`;
      const prio = i % 4 === 0 ? "manual" : "domain";
      const desc = `Feedback entry ${i} documenting operational lesson, verification guard, and workflow rule`;
      writeFileSync(
        join(sb.storeDir, f),
        `---\nid: fb-${i}\nname: Feedback ${i}\ndescription: ${desc}\npriority: ${prio}\n---\n# Feedback ${i}\n`,
        "utf-8",
      );
      memLines.push(`- [Feedback ${i}](${f}) — ${desc}`);
    }

    memLines.push("", "## Projects", "");
    for (let i = 1; i <= 55; i++) {
      const f = `project_${String(i).padStart(2, "0")}.md`;
      const desc = `Project entry ${i} covering repository roadmap, package boundaries, and release targets`;
      writeFileSync(
        join(sb.storeDir, f),
        `---\nid: proj-${i}\nname: Project ${i}\ndescription: ${desc}\n---\n# Project ${i}\n`,
        "utf-8",
      );
      memLines.push(`- [Project ${i}](${f}) — ${desc}`);
    }

    memLines.push("", "## Archive", "");
    for (let i = 1; i <= 30; i++) {
      const f = `archive_${String(i).padStart(2, "0")}.md`;
      const desc = `Archive entry ${i} retaining historical audit trail, benchmark record, and context`;
      writeFileSync(
        join(sb.storeDir, f),
        `---\nid: arch-${i}\nname: Archive ${i}\ndescription: ${desc}\npriority: manual\n---\n# Archive ${i}\n`,
        "utf-8",
      );
      memLines.push(`- [Archive ${i}](${f}) — ${desc}`);
    }

    writeFileSync(sb.memoryMd, memLines.join("\n") + "\n", "utf-8");

    // Reference any existing sandbox default topic files in MEMORY.md with matching frontmatter description
    for (const f of readdirSync(sb.storeDir)) {
      if (
        f.endsWith(".md") &&
        f !== "MEMORY.md" &&
        !f.startsWith("core_") &&
        !f.startsWith("feedback_") &&
        !f.startsWith("project_") &&
        !f.startsWith("archive_")
      ) {
        const p = join(sb.storeDir, f);
        writeFileSync(
          p,
          `---\nid: ${f.replace(/\.md$/, "")}\nname: ${f}\ndescription: Sandbox fixture entry\n---\n# ${f}\n`,
          "utf-8",
        );
        writeFileSync(
          sb.memoryMd,
          readFileSync(sb.memoryMd, "utf-8").trimEnd() +
            `\n- [${f}](${f}) — Sandbox fixture entry\n`,
          "utf-8",
        );
      }
    }

    // Before split: MEMORY.md is > 14,640 bytes, so doctor warns on `memory-read-limit`
    const preSplitDoctor = runDoctor(pathsFor(sb));
    assert.equal(find(preSplitDoctor.checks, "memory-read-limit").status, "warn");

    const rulesPath = join(sb.dir, "rules.json");
    writeFileSync(
      rulesPath,
      JSON.stringify({
        keepInRoot: { prefixes: ["core_"] },
        rules: [
          {
            subindex: "index-feedback.md",
            title: "Feedback",
            description: "Feedback memories sub-index",
            prefix: "feedback_",
          },
          {
            subindex: "index-projects.md",
            title: "Projects",
            description: "Project memories sub-index",
            prefix: "project_",
          },
          {
            subindex: "index-archive.md",
            title: "Archive",
            description: "Archive memories sub-index",
            prefix: "archive_",
          },
        ],
      }),
      "utf-8",
    );

    const beforeBytes = readFileSync(sb.memoryMd, "utf-8");

    // 0. Missing --by throws MISSING_ARG
    assert.throws(
      () => dispatch(["memories", "split", sb.memoryMd]),
      (err: unknown) => err instanceof CliError && err.code === "MISSING_ARG",
    );

    // 1. CLI --dry-run (both --json and human output, plus directory positional arg) writes nothing
    dispatch([
      "memories",
      "split",
      sb.memoryMd,
      "--by",
      rulesPath,
      "--dry-run",
      "--json",
    ]);
    dispatch([
      "memories",
      "split",
      sb.storeDir,
      "--by",
      rulesPath,
      "--dry-run",
    ]);
    assert.equal(readFileSync(sb.memoryMd, "utf-8"), beforeBytes);
    assert.equal(existsSync(join(sb.storeDir, "index-feedback.md")), false);

    // 2. CLI refusal when a rule drops entries (entry count differs)
    const badRulesPath = join(sb.dir, "bad-rules.json");
    writeFileSync(
      badRulesPath,
      JSON.stringify({
        rules: [{ subindex: "index-feedback.md", prefix: "feedback_", drop: true }],
      }),
      "utf-8",
    );
    assert.throws(
      () => dispatch(["memories", "split", sb.memoryMd, "--by", badRulesPath]),
      (err: unknown) => err instanceof CliError && err.code === "ENTRY_COUNT_MISMATCH",
    );
    assert.equal(readFileSync(sb.memoryMd, "utf-8"), beforeBytes);

    // 3. Real CLI split
    dispatch(["memories", "split", "--store", sb.storeDir, "--by", rulesPath]);
    assert.ok(existsSync(join(sb.storeDir, "index-feedback.md")));
    assert.ok(existsSync(join(sb.storeDir, "index-projects.md")));

    // After split: MEMORY.md is now small (< 2 KB) and both sub-indexes have 40 entries (<= 60),
    // so both `memory-read-limit` and `subindex-entries` pass in doctor!
    const postSplitDoctor = runDoctor(pathsFor(sb));
    assert.equal(find(postSplitDoctor.checks, "store-validates").status, "pass");
    assert.equal(find(postSplitDoctor.checks, "memory-read-limit").status, "pass");
    assert.equal(find(postSplitDoctor.checks, "subindex-entries").status, "pass");
  } finally {
    sb.cleanup();
  }
});

test("FIX-1 Item 2: doctor reports profiles.json config warnings without failing, and exits non-zero on malformed profiles.json", () => {
  const sb = makeSandbox();
  const prevExitCode = process.exitCode;
  try {
    // 1. Typo in profiles.json reports status: "warn" naming key & bad value, keeping ok: true
    const warnProfiles = join(sb.dir, "warn-profiles.json");
    writeFileSync(
      warnProfiles,
      JSON.stringify({
        rules: {
          "quote-gate": {
            action: { default: "Block" },
          },
        },
      }),
      "utf-8",
    );
    const warnDoctor = runDoctor({ ...pathsFor(sb), profilesPath: warnProfiles });
    const warnCheck = find(warnDoctor.checks, "profiles-config");
    assert.equal(warnCheck.status, "warn");
    assert.match(warnCheck.message, /rules\.quote-gate\.action\.default/);
    assert.match(warnCheck.message, /"Block"/);

    // 2. Malformed JSON in profiles.json reports status: "fail", ok: false, and CLI exits non-zero
    const badJsonProfiles = join(sb.dir, "bad-profiles.json");
    writeFileSync(badJsonProfiles, "{ malformed json", "utf-8");
    const paths = pathsFor(sb);
    const failDoctor = runDoctor({ ...paths, profilesPath: badJsonProfiles });
    const failCheck = find(failDoctor.checks, "profiles-config");
    assert.equal(failCheck.status, "fail");
    assert.equal(failDoctor.ok, false);

    process.exitCode = undefined;
    dispatch([
      "doctor",
      "--store",
      paths.store,
      "--index",
      paths.index,
      "--settings",
      paths.settings,
      "--usage",
      paths.usage,
      "--skills",
      paths.skillsDir ?? "",
      "--profiles",
      badJsonProfiles,
      "--repo-root",
      sb.dir,
      "--json",
    ]);
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = prevExitCode;
    sb.cleanup();
  }
});

test("FIX-2 Item 1: doctor reports DEFAULT_STORE_REQUIRED fail when no default store is configured, and resolves profiles.json defaultStore / AI_LOADOUT_STORE regardless of cwd", () => {
  const sb = makeSandbox({ withSettingsHook: true });
  const sbDecoy = makeSandbox();
  const prevCwd = process.cwd();
  const prevEnvStore = process.env.AI_LOADOUT_STORE;
  const prevEnvProfiles = process.env.AI_LOADOUT_PROFILES_PATH;

  try {
    delete process.env.AI_LOADOUT_STORE;
    delete process.env.AI_LOADOUT_PROFILES_PATH;

    // 1. No --store, no AI_LOADOUT_STORE, no defaultStore -> store-validates fails with DEFAULT_STORE_REQUIRED
    const emptyProfiles = join(sb.dir, "empty-profiles.json");
    writeFileSync(emptyProfiles, JSON.stringify({}), "utf-8");

    process.chdir(sbDecoy.storeDir);
    const defaultPathsNoCfg = defaultDoctorPaths(sbDecoy.dir, sb.dir);
    assert.equal(defaultPathsNoCfg.store, "", "defaultDoctorPaths must never derive store from repoRoot/cwd");

    const missingStoreDoc = runDoctor({
      ...pathsFor(sb),
      store: "",
      profilesPath: emptyProfiles,
    });
    const missingCheck = find(missingStoreDoc.checks, "store-validates");
    assert.equal(missingCheck.status, "fail");
    assert.equal(missingCheck.code, "DEFAULT_STORE_REQUIRED");
    assert.equal(missingStoreDoc.ok, false);
    assert.match(missingCheck.hint ?? "", /--store/);
    assert.match(missingCheck.hint ?? "", /AI_LOADOUT_STORE/);
    assert.match(missingCheck.hint ?? "", /defaultStore/);

    // 2. defaultStore in profiles.json resolves regardless of cwd
    const cfgProfiles = join(sb.dir, "cfg-profiles.json");
    writeFileSync(cfgProfiles, JSON.stringify({ defaultStore: sb.storeDir }), "utf-8");
    const cfgDoc = runDoctor({
      ...pathsFor(sb),
      store: "",
      profilesPath: cfgProfiles,
    });
    assert.equal(find(cfgDoc.checks, "store-validates").status, "pass");

    // 3. AI_LOADOUT_STORE overrides defaultStore in profiles.json
    const sbEnv = makeSandbox({ withSettingsHook: true });
    try {
      process.env.AI_LOADOUT_STORE = sbEnv.storeDir;
      process.env.AI_LOADOUT_PROFILES_PATH = cfgProfiles;
      const envPaths = defaultDoctorPaths(sbDecoy.dir, sb.dir);
      assert.equal(envPaths.store, resolve(sbEnv.storeDir));
    } finally {
      sbEnv.cleanup();
    }
  } finally {
    process.chdir(prevCwd);
    if (prevEnvStore === undefined) delete process.env.AI_LOADOUT_STORE;
    else process.env.AI_LOADOUT_STORE = prevEnvStore;
    if (prevEnvProfiles === undefined) delete process.env.AI_LOADOUT_PROFILES_PATH;
    else process.env.AI_LOADOUT_PROFILES_PATH = prevEnvProfiles;
    sb.cleanup();
    sbDecoy.cleanup();
  }
});
