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

import { runDoctor, defaultDoctorPaths, type DoctorPaths } from "../doctor.js";
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

function find(checks: { id: string; status: string; message: string; hint?: string }[], id: string) {
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
import { RND_TRIAD_ENTRIES, PUBLISHER_TRIAD_ENTRIES } from "./fixtures.js";
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
      "loadout_skill: remote-argon",
      "loadout_triggers: [unreviewed-merge, release-reminder]",
      "author_agent: rnd",
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
    assert.equal(parsedTop.frontmatter.loadout_skill, "remote-argon");
    assert.deepEqual(parsedTop.frontmatter.loadout_triggers, [
      "unreviewed-merge",
      "release-reminder",
    ]);
    assert.equal(parsedTop.frontmatter.author_agent, "rnd");
    assert.equal(parsedTop.frontmatter.created_at, "2026-11-08T15:00:00Z");
    assert.equal(parsedTop.frontmatter.verification_status, "tool_verified");
    assert.equal(parsedTop.frontmatter.evidence_ref, "PR#21");
    assert.equal(parsedTop.frontmatter.supersedes, "old-prov-top");

    // Round-trip via serializeFrontmatter
    const reserialized = serializeFrontmatter(parsedTop.frontmatter);
    const reparsed = parseFrontmatter(reserialized);
    assert.equal(reparsed.frontmatter?.loadout_skill, "remote-argon");
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
      "  author_agent: publisher",
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
    assert.equal(parsedMeta.frontmatter.author_agent, "publisher");
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
    assert.equal(eTop.loadout_skill, "remote-argon");
    assert.deepEqual(eTop.loadout_triggers, ["unreviewed-merge", "release-reminder"]);
    assert.equal(eTop.author_agent, "rnd");
    assert.equal(eTop.created_at, "2026-11-08T15:00:00Z");
    assert.equal(eTop.verification_status, "tool_verified");
    assert.equal(eTop.evidence_ref, "PR#21");
    assert.equal(eTop.supersedes, "old-prov-top");

    assert.ok(eMeta);
    assert.equal(eMeta.loadout_skill, "loadout-os");
    assert.deepEqual(eMeta.loadout_triggers, ["memory-shell-write", "future-stamp"]);
    assert.equal(eMeta.author_agent, "publisher");
    assert.equal(eMeta.verification_status, "human_ruling");
  } finally {
    sb.cleanup();
  }
});

test("Part 4.2 & 4.3: doctor triad check in temp HOME verifies all 5 rules' memories, skills (WARN on skill: none with reason), and PreToolUse hook command+mode", () => {
  const sb = makeSandbox({
    withUsage: true,
    withSettingsHook: true,
    withCore: true,
    observedAvg: 130,
  });
  try {
    // Populate temp HOME's project index with the 5 R&D triad entries from the Part 4.3 fixture
    const projectIndexPath = join(sb.dir, "project-index.json");
    writeFileSync(
      projectIndexPath,
      JSON.stringify(
        {
          version: "1.0.0",
          generated: "2026-11-08T20:00:00.000Z",
          entries: RND_TRIAD_ENTRIES,
          budget: {
            always_loaded_est: 0,
            on_demand_total_est: 2293,
            avg_task_load_est: 458,
            avg_task_load_observed: null,
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    // Populate temp HOME's ~/.claude/skills/<name>/SKILL.md for the 3 skills in the table
    const skillsDir = join(sb.dir, ".claude", "skills");
    for (const skillName of ["remote-argon", "loadout-os", "full-treatment"]) {
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
    };

    const res = runDoctor(basePaths);
    assert.equal(res.ok, true, "healthy triad in temp HOME should have ok=true");

    const memCheck = find(res.checks, "triad-memories");
    assert.equal(memCheck.status, "pass");

    const skillCheck = find(res.checks, "triad-skills");
    // WARN because director-quote is marked `skill: "none"` with a reason
    assert.equal(skillCheck.status, "warn");
    assert.match(skillCheck.message, /director-quote/);

    const hookCheck = find(res.checks, "triad-pretool-hook");
    assert.equal(hookCheck.status, "pass");
    assert.match(hookCheck.message, /loadout-os hook pre-tool --mode log-only/);
    assert.match(hookCheck.message, /mode: log-only/);

    // 1. Broken memory link -> FAIL
    const brokenMemRes = runDoctor({
      ...basePaths,
      extraIndexes: [], // removes the R&D project index so the 5 rule memories are missing
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

test("Issue #25 / Ruling 1: doctor triad-memories check runs per seat across two temp seat stores, passing when each seat's ids resolve only in its own store, and failing naming the seat when one id is missing", () => {
  const sb = makeSandbox({
    withUsage: true,
    withSettingsHook: true,
    withCore: true,
    observedAvg: 130,
  });
  try {
    const rndStoreDir = join(sb.dir, "rnd-store", "memory");
    const pubStoreDir = join(sb.dir, "pub-store", "memory");
    mkdirSync(rndStoreDir, { recursive: true });
    mkdirSync(pubStoreDir, { recursive: true });

    // Write R&D index.json with ONLY R&D's 5 memory IDs
    writeFileSync(
      join(rndStoreDir, "index.json"),
      JSON.stringify(
        {
          version: "1.0.0",
          generated: "2026-11-09T00:00:00.000Z",
          entries: RND_TRIAD_ENTRIES,
          budget: {
            always_loaded_est: 0,
            on_demand_total_est: 2293,
            avg_task_load_est: 458,
            avg_task_load_observed: null,
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    // Write Publisher index.json with ONLY Publisher's 5 memory IDs
    writeFileSync(
      join(pubStoreDir, "index.json"),
      JSON.stringify(
        {
          version: "1.0.0",
          generated: "2026-11-09T00:00:00.000Z",
          entries: PUBLISHER_TRIAD_ENTRIES,
          budget: {
            always_loaded_est: 0,
            on_demand_total_est: 1220,
            avg_task_load_est: 244,
            avg_task_load_observed: null,
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const seatsPath = join(sb.dir, "seats.json");
    writeFileSync(
      seatsPath,
      JSON.stringify(
        {
          seats: {
            "E:/AI/Research and Development": { seat: "rnd", store: rndStoreDir },
            "E:/AI/Publisher": { seat: "publisher", store: pubStoreDir },
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const skillsDir = join(sb.dir, ".claude", "skills");
    for (const skillName of ["remote-argon", "loadout-os", "full-treatment"]) {
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

    // 1. Positive: both seats have their own 5 memory IDs in their own stores (and neither store has the other's IDs) -> PASS
    const passRes = runDoctor({
      ...pathsFor(sb),
      skillsDir,
      seatsPath,
    });
    const passTriad = find(passRes.checks, "triad-memories");
    assert.equal(passTriad.status, "pass");
    assert.match(passTriad.message, /rnd, publisher/);
    assert.equal(passRes.ok, true);

    // 2. Negative: remove one memory ID (`feedback-eastern-time` for `future-stamp`) from Publisher's store -> FAIL naming `publisher`
    writeFileSync(
      join(pubStoreDir, "index.json"),
      JSON.stringify(
        {
          version: "1.0.0",
          generated: "2026-11-09T00:00:00.000Z",
          entries: PUBLISHER_TRIAD_ENTRIES.filter((e) => e.id !== "feedback-eastern-time"),
          budget: {
            always_loaded_est: 0,
            on_demand_total_est: 1020,
            avg_task_load_est: 204,
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
      seatsPath,
    });
    const failTriad = find(failRes.checks, "triad-memories");
    assert.equal(failTriad.status, "fail");
    assert.match(
      failTriad.message,
      /publisher: future-stamp -> feedback-eastern-time/,
      "Failure message must name the seat (`publisher`), rule (`future-stamp`), and missing memory ID (`feedback-eastern-time`)",
    );
    assert.equal(failRes.ok, false);
  } finally {
    sb.cleanup();
  }
});

