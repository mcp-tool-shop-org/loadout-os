/**
 * Tests for `loadout-os hook pre-tool` — Part 1 (hook entry, profile resolution,
 * read-only pass-through, typed rule table, decision log, enforce vs log-only modes).
 *
 * All tests run in isolated temp directories and never touch live ~/.claude or ~/.ai-loadout.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  runPreTool,
  parsePreToolStdin,
  loadProfileConfig,
  resolveProfile,
  normalizePreToolPath,
  parseBashCommand,
  isSegmentReadOnly,
  isBashCommandReadOnly,
  isReadOnlyPassThrough,
  extractWritePayload,
  resolveRuleAction,
  resolveRuleSkill,
  resolveRuleNote,
  formatMemorySuffix,
  readDecisionLog,
  capRuleMessage,
  hashToolInput,
  defaultProfilesPath,
  defaultDecisionLogPath,
  DEFAULT_PRETOOL_TIMEOUT_MS,
  ProfileConfigError,
  type PreToolRule,
  type DecisionLogEntry,
} from "../pretool.js";
import { dispatch } from "../cli.js";

describe("Part 1: hook pre-tool entry, profile map, pass-through, rule table, decision log, modes", () => {
  let tempDir: string;
  let profilesPath: string;
  let logPath: string;
  let savedProfilesEnv: string | undefined;
  let savedLogEnv: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "loadout-pretool-p1-"));
    profilesPath = join(tempDir, "profiles.json");
    logPath = join(tempDir, "hook-decisions.jsonl");
    savedProfilesEnv = process.env.AI_LOADOUT_PROFILES_PATH;
    savedLogEnv = process.env.AI_LOADOUT_DECISIONS_LOG;

    writeFileSync(
      profilesPath,
      JSON.stringify(
        {
          profiles: {
            "E:/AI/Research and Development": "docs",
            "E:/AI/ReleaseRepo": "release",
            "E:/AI/Research and Development/nested/pub-sandbox": "release",
          },
        },
        null,
        2,
      ),
      "utf-8",
    );
  });

  afterEach(() => {
    if (savedProfilesEnv === undefined) {
      delete process.env.AI_LOADOUT_PROFILES_PATH;
    } else {
      process.env.AI_LOADOUT_PROFILES_PATH = savedProfilesEnv;
    }
    if (savedLogEnv === undefined) {
      delete process.env.AI_LOADOUT_DECISIONS_LOG;
    } else {
      process.env.AI_LOADOUT_DECISIONS_LOG = savedLogEnv;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── 1.1 Stdin schema parsing ──────────────────────────────────
  describe("1.1 PreToolUse stdin schema parsing", () => {
    it("parses Claude Code 2.1.197 PreToolUse stdin fields (tool_name, tool_input, cwd, session_id, hook_event_name, tool_use_id)", () => {
      const raw = JSON.stringify({
        session_id: "sess-123",
        transcript_path: "/tmp/transcript.jsonl",
        cwd: "E:/AI/Research and Development",
        permission_mode: "default",
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "git status" },
        tool_use_id: "toolu_01ABC",
      });
      const parsed = parsePreToolStdin(raw);
      assert.equal(parsed.tool_name, "Bash");
      assert.deepEqual(parsed.tool_input, { command: "git status" });
      assert.equal(parsed.cwd, "E:/AI/Research and Development");
      assert.equal(parsed.session_id, "sess-123");
      assert.equal(parsed.hook_event_name, "PreToolUse");
      assert.equal(parsed.tool_use_id, "toolu_01ABC");
    });

    it("defaults missing tool_input to empty object and rejects missing tool_name", () => {
      const parsed = parsePreToolStdin(JSON.stringify({ tool_name: "Read" }));
      assert.equal(parsed.tool_name, "Read");
      assert.deepEqual(parsed.tool_input, {});

      assert.throws(() => parsePreToolStdin(""), /Empty PreToolUse stdin/);
      assert.throws(() => parsePreToolStdin("[]"), /not a JSON object/);
      assert.throws(() => parsePreToolStdin("{}"), /missing string 'tool_name'/);
      assert.throws(
        () => parsePreToolStdin(JSON.stringify({ tool_name: "Bash", tool_input: [] })),
        /'tool_input' must be an object/,
      );
    });
  });

  // ── 1.2 Profile resolution ────────────────────────────────────
  describe("1.2 Profile resolution from profiles.json", () => {
    it("resolves longest matching prefix of cwd (case- and slash-normalised on Windows)", () => {
      const cfg = loadProfileConfig(profilesPath);

      assert.equal(resolveProfile("E:/AI/Research and Development", cfg), "docs");
      assert.equal(resolveProfile("e:\\ai\\research and development\\packages\\cli", cfg), "docs");
      assert.equal(resolveProfile("/e/AI/ReleaseRepo/subproject", cfg), "release");
      assert.equal(resolveProfile("\\\\?\\E:\\AI\\ReleaseRepo\\repo\\", cfg), "release");
      // Longest prefix wins over shorter parent prefix
      assert.equal(
        resolveProfile("E:\\AI\\Research and Development\\nested\\pub-sandbox\\work", cfg),
        "release",
      );
      // Sibling prefix with shared string prefix must not match (boundary check)
      assert.equal(resolveProfile("E:/AI/ReleaseRepo-Extra", cfg), "default");
      // Unmatched path returns default
      assert.equal(resolveProfile("E:/AI/OtherRepo", cfg), "default");
      assert.equal(resolveProfile("", cfg), "default");
    });

    it("honours AI_LOADOUT_PROFILES_PATH env override and nested profile objects with stores", () => {
      const customProfiles = join(tempDir, "custom-profiles.json");
      writeFileSync(
        customProfiles,
        JSON.stringify({
          profiles: {
            "E:/AI/CustomDocs": { profile: "docs", store: "E:/AI/CustomDocs/memory" },
          },
          stores: ["E:/AI/SharedStore/memory"],
        }),
        "utf-8",
      );
      process.env.AI_LOADOUT_PROFILES_PATH = customProfiles;
      assert.equal(defaultProfilesPath(), customProfiles);

      const cfg = loadProfileConfig();
      assert.equal(resolveProfile("e:\\ai\\customdocs\\src", cfg), "docs");
      assert.deepEqual(cfg.storePaths, [
        "E:/AI/SharedStore/memory",
        "E:/AI/CustomDocs/memory",
      ]);
    });

    it("normalizes Windows drive paths, MSYS paths, and trailing slashes", () => {
      assert.equal(
        normalizePreToolPath("E:\\AI\\Research and Development\\"),
        "e:/ai/research and development",
      );
      assert.equal(
        normalizePreToolPath("/e/AI/ReleaseRepo/"),
        "e:/ai/releaserepo",
      );
    });

    it("throws ProfileConfigError only on missing explicit/invalid JSON/non-object top level, soft-drops invalid sub-entries with warnings, and keeps other rules enforcing", () => {
      delete process.env.AI_LOADOUT_PROFILES_PATH;
      assert.ok(defaultProfilesPath().replace(/\\/g, "/").endsWith("/.ai-loadout/profiles.json"));
      assert.deepEqual(loadProfileConfig().profiles, {});

      const fatalCases: Array<[string, string]> = [
        ["[]", "PROFILE_CONFIG_NOT_OBJECT"],
        ['"string"', "PROFILE_CONFIG_NOT_OBJECT"],
        ["{ not valid json", "PROFILE_CONFIG_INVALID_JSON"],
      ];

      for (let i = 0; i < fatalCases.length; i++) {
        const [rawBody, expectedCode] = fatalCases[i]!;
        const p = join(tempDir, `fatal-${i}.json`);
        writeFileSync(p, rawBody, "utf-8");
        assert.throws(
          () => loadProfileConfig(p),
          (err: unknown) => err instanceof ProfileConfigError && err.code === expectedCode,
          `Expected ProfileConfigError(${expectedCode}) for case ${i}`,
        );
      }

      // Missing explicit file still throws PROFILE_CONFIG_NOT_FOUND
      assert.throws(
        () => loadProfileConfig(join(tempDir, "does-not-exist.json")),
        (err: unknown) => err instanceof ProfileConfigError && err.code === "PROFILE_CONFIG_NOT_FOUND",
      );

      // Invalid sub-fields do NOT crash or wipe valid entries; each emits a warning naming key + bad value
      const softCases: Array<{ obj: unknown; expectWarn: RegExp }> = [
        { obj: { profiles: "bad" }, expectWarn: /profiles.*"bad"/ },
        { obj: { profiles: { "/repo": 123 } }, expectWarn: /profiles\.\/repo.*123/ },
        { obj: { profiles: { "/repo": {} } }, expectWarn: /profiles\.\/repo\.profile/ },
        { obj: { profiles: { "/repo": "" } }, expectWarn: /profiles\.\/repo.*""/ },
        { obj: { profiles: { "/repo": { profile: "docs", repliesDir: "" } } }, expectWarn: /repliesDir.*""/ },
        { obj: { profiles: { "/repo": { profile: "docs", store: "" } } }, expectWarn: /store.*""/ },
        { obj: { profiles: { "/repo": { profile: "docs", stores: ["ok", 42] } } }, expectWarn: /stores\[1\].*42/ },
        { obj: { profiles: { "/repo": { profile: "docs", prefixes: "bad" } } }, expectWarn: /prefixes.*"bad"/ },
        { obj: { stores: ["ok", ""] }, expectWarn: /stores\[1\].*""/ },
        { obj: { repliesDir: 123 }, expectWarn: /repliesDir.*123/ },
        { obj: { replies_dir: 123 }, expectWarn: /replies_dir.*123/ },
        { obj: { ruleAliases: "bad" }, expectWarn: /ruleAliases.*"bad"/ },
        { obj: { ruleAliases: { old: 42 } }, expectWarn: /ruleAliases\.old.*42/ },
        { obj: { rules: [] }, expectWarn: /rules.*\[\]/ },
        { obj: { rules: { "quote-gate": "bad" } }, expectWarn: /rules\.quote-gate.*"bad"/ },
        { obj: { rules: { "quote-gate": { action: "bad" } } }, expectWarn: /rules\.quote-gate\.action.*"bad"/ },
        { obj: { rules: { "quote-gate": { action: { docs: "explode" } } } }, expectWarn: /rules\.quote-gate\.action\.docs.*"explode"/ },
        { obj: { rules: { "quote-gate": { memory: "bad" } } }, expectWarn: /rules\.quote-gate\.memory.*"bad"/ },
        { obj: { rules: { "quote-gate": { memory: { docs: "" } } } }, expectWarn: /rules\.quote-gate\.memory\.docs.*""/ },
        { obj: { rules: { "quote-gate": { skill: "" } } }, expectWarn: /rules\.quote-gate\.skill.*""/ },
        { obj: { rules: { "quote-gate": { note: "bad" } } }, expectWarn: /rules\.quote-gate\.note.*"bad"/ },
        { obj: { rules: { "quote-gate": { note: { docs: 99 } } } }, expectWarn: /rules\.quote-gate\.note\.docs.*99/ },
        { obj: { quoteGate: "bad" }, expectWarn: /quoteGate.*"bad"/ },
        { obj: { quoteGate: { speakers: [123] } }, expectWarn: /quoteGate\.speakers\[0\].*123/ },
        { obj: { quoteGate: { namedSpeakers: [123] } }, expectWarn: /quoteGate\.namedSpeakers\[0\].*123/ },
        { obj: { quoteGate: { allowlistSuffixes: "bad" } }, expectWarn: /quoteGate\.allowlistSuffixes.*"bad"/ },
      ];

      for (let i = 0; i < softCases.length; i++) {
        const sc = softCases[i]!;
        const p = join(tempDir, `soft-${i}.json`);
        writeFileSync(p, JSON.stringify(sc.obj), "utf-8");
        const cfg = loadProfileConfig(p);
        assert.ok(
          cfg.warnings.some((w) => sc.expectWarn.test(w)),
          `Expected warning matching ${sc.expectWarn} in ${JSON.stringify(cfg.warnings)}`,
        );
      }

      // Config typo in one rule override keeps valid rules enforcing
      const typoProfiles = join(tempDir, "typo-profiles.json");
      writeFileSync(
        typoProfiles,
        JSON.stringify({
          profiles: {
            "/repos/docs": { profile: "docs", store: "/repos/docs/memory" },
          },
          rules: {
            "quote-gate": { action: { default: "Block" } },
            "memory-shell-write": { action: { default: "block" } },
          },
        }),
        "utf-8",
      );
      const typoRes = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: "rm ~/.claude/projects/my-project/memory/BOARD.md" },
          cwd: "/repos/docs",
        }),
        profilesPath: typoProfiles,
        logPath,
      });
      assert.equal(typoRes.exitCode, 2, "Other valid rules must keep blocking despite config typo");
      assert.equal(typoRes.outcome, "block");
      assert.ok(
        typoRes.logEntry?.notes?.some(
          (n) =>
            n.startsWith("config_warning:") &&
            n.includes("rules.quote-gate.action.default") &&
            n.includes('"Block"'),
        ),
        `Expected config_warning naming key & value, got ${JSON.stringify(typoRes.logEntry?.notes)}`,
      );

      // Valid replies_dir, entry-level repliesDir + stores[]
      const extraFormsPath = join(tempDir, "extra-forms.json");
      writeFileSync(
        extraFormsPath,
        JSON.stringify({
          replies_dir: "/tmp/replies-top",
          profiles: {
            "/repos/docs": {
              profile: "docs",
              repliesDir: "/tmp/replies-ignored",
              stores: ["E:/StoreA/memory", "E:/StoreB/memory"],
            },
          },
        }),
        "utf-8",
      );
      const extraCfg = loadProfileConfig(extraFormsPath);
      assert.equal(extraCfg.repliesDir, "/tmp/replies-top");
      assert.deepEqual(extraCfg.storePaths, ["E:/StoreA/memory", "E:/StoreB/memory"]);
      assert.equal(extraCfg.profileStores.docs, "E:/StoreA/memory");

      // Unknown keys warn and do not crash
      const unknownKeysPath = join(tempDir, "unknown-keys.json");
      writeFileSync(
        unknownKeysPath,
        JSON.stringify({
          extraTop: true,
          profiles: {
            "/repos/docs": { profile: "docs", extraEntry: 1 },
          },
          rules: {
            "quote-gate": { action: { docs: "warn" }, extraRuleKey: "x" },
          },
          quoteGate: { speakers: ["He"], extraGateKey: "y" },
        }),
        "utf-8",
      );
      const seenWarnings: string[] = [];
      const loaded = loadProfileConfig(unknownKeysPath, {
        onWarning: (w) => seenWarnings.push(w),
      });
      assert.equal(loaded.warnings.length, 4);
      assert.equal(seenWarnings.length, 4);
      assert.equal(resolveProfile("/repos/docs/sub", loaded), "docs");

      // In runPreTool, unknown keys do not crash and record config_warning notes
      const res = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: "echo hi" },
          cwd: "/repos/docs/sub",
        }),
        profilesPath: unknownKeysPath,
        logPath,
      });
      assert.equal(res.exitCode, 0);
      assert.equal(res.outcome, "allow");
      assert.equal(res.profile, "docs");
      assert.ok(res.logEntry?.notes?.some((n) => n.startsWith("config_warning:")));
    });
  });

  // ── 1.3 Read-only pass-through ────────────────────────────────
  describe("1.3 Read-only pass-through and Bash parser limits", () => {
    it("passes read-only tools (Read, Glob, Grep) silently with zero log lines", () => {
      for (const tool_name of ["Read", "Glob", "Grep", "LS", "ToolSearch"]) {
        const res = runPreTool({
          stdinJson: JSON.stringify({
            tool_name,
            tool_input: { file_path: "README.md" },
            cwd: "E:/AI/Research and Development",
            session_id: "s1",
          }),
          profilesPath,
          logPath,
        });
        assert.equal(res.exitCode, 0);
        assert.equal(res.passThrough, true);
        assert.equal(res.outcome, "pass_through");
        assert.equal(res.stdout, "");
        assert.equal(res.stderr, "");
      }
      assert.equal(existsSync(logPath), false);
    });

    it("passes read-only Bash commands and compound pipelines/subshells silently", () => {
      const allowedBash = [
        "git status",
        "git -C E:/AI/loadout-os diff --stat",
        "git --no-pager log -n 5 --oneline",
        "git show HEAD:package.json",
        "gh pr view 21 --json state",
        "gh -R mcp-tool-shop-org/loadout-os issue list",
        "ls -la packages/cli",
        "cat package.json | head -n 20 | tail -n 5",
        "grep -rn 'runPreTool' packages/cli/src && rg --files packages/cli",
        "sed -n '1,30p' packages/cli/src/cli.ts",
        "sha256sum package.json && wc -l README.md",
        "find packages -name '*.ts' -maxdepth 3",
        "loadout-os refresh --project . --dry-run",
        "(git status && git diff) | head -n 10; (git log -1; ls)",
        "cat $(find . -name '*.md')",
      ];

      for (const command of allowedBash) {
        const parsed = parseBashCommand(command);
        assert.equal(
          isBashCommandReadOnly(parsed),
          true,
          `Expected read-only pass-through for: ${command}`,
        );
        const res = runPreTool({
          stdinJson: JSON.stringify({
            tool_name: "Bash",
            tool_input: { command },
            cwd: "E:/AI/Research and Development",
            session_id: "s1",
          }),
          profilesPath,
          logPath,
        });
        assert.equal(res.exitCode, 0);
        assert.equal(res.passThrough, true);
      }
      assert.equal(existsSync(logPath), false);
    });

    it("disables pass-through when ANY segment, subshell, flag, or redirection is non-read-only", () => {
      const nonReadOnlyBash = [
        "git status && rm -rf build",
        "git status; git commit -m 'msg'",
        "ls | tee listing.txt",
        "cat README.md > copy.md",
        "cat README.md >> copy.md",
        "sed -i 's/foo/bar/g' file.txt",
        "sed 's/foo/bar/g' file.txt",
        "find . -name '*.tmp' -delete",
        "find . -name '*.sh' -exec sh {} ;",
        "git diff --output=out.patch",
        "rg --pre=sh pattern",
        "gh pr merge 21",
        "gh api repos/owner/repo/pulls",
        "loadout-os refresh --project .",
        "ls $(touch injected)",
        "ls `rm -f injected`",
        "/usr/local/bin/ls",
        "cat <<EOF\nhello\nEOF",
        "git status && 'unclosed quote",
      ];

      for (const command of nonReadOnlyBash) {
        const parsed = parseBashCommand(command);
        assert.equal(
          isReadOnlyPassThrough("Bash", parsed),
          false,
          `Expected pass-through disabled for: ${command}`,
        );
      }
    });
  });

  // ── 1.4 Typed rule table & matcher inputs ─────────────────────
  describe("1.4 Typed rule table, matcher inputs, per-profile action, <=5-line message cap", () => {
    it("delivers parsedCommand segments to Bash matchers and writePayload to Write/Edit/MultiEdit matchers", () => {
      let seenSegments: string[][] = [];
      let seenWriteTexts: string[] = [];

      const testRules: PreToolRule[] = [
        {
          id: "test-bash-rule",
          layer: "A",
          tools: ["Bash"],
          action: { default: "warn", docs: "block", release: "off" },
          memory: "mem-bash",
          skill: "skill-bash",
          message: "Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6 should be truncated",
          match: (ctx) => {
            seenSegments = (ctx.parsedCommand?.segments ?? []).map((s) => s.tokens);
            return seenSegments.some((t) => t[0] === "npm" && t[1] === "publish");
          },
        },
        {
          id: "test-write-rule",
          layer: "A",
          tools: ["Write", "Edit", "MultiEdit"],
          action: { default: "block" },
          memory: "mem-write",
          skill: "none",
          skillNoneReason: "test rule",
          message: "Blocked write payload",
          match: (ctx) => {
            seenWriteTexts = ctx.writePayload?.texts ?? [];
            return seenWriteTexts.some((t) => t.includes("FORBIDDEN_TOKEN"));
          },
        },
      ];

      // docs profile -> block, message capped at 5 lines
      const docsRes = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: "npm test && npm publish" },
          cwd: "E:/AI/Research and Development",
          session_id: "sess-docs",
        }),
        profilesPath,
        logPath,
        rules: testRules,
      });
      assert.equal(docsRes.exitCode, 2);
      assert.equal(docsRes.outcome, "block");
      assert.deepEqual(seenSegments, [
        ["npm", "test"],
        ["npm", "publish"],
      ]);
      assert.equal(docsRes.stderr.trim().split("\n").length, 5);
      assert.equal(docsRes.stderr.includes("Line 6"), false);

      // release profile -> action is "off", so rule is skipped and call is allowed
      const relRes = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: "npm publish" },
          cwd: "E:/AI/ReleaseRepo",
          session_id: "sess-rel",
        }),
        profilesPath,
        logPath,
        rules: testRules,
      });
      assert.equal(relRes.exitCode, 0);
      assert.equal(relRes.outcome, "allow");

      // MultiEdit payload extraction
      const multiEditPayload = extractWritePayload("MultiEdit", {
        file_path: "src/a.ts",
        edits: [
          { old_string: "a", new_string: "first edit" },
          { old_string: "b", new_string: "second FORBIDDEN_TOKEN edit" },
        ],
      });
      assert.equal(multiEditPayload?.filePath, "src/a.ts");
      assert.deepEqual(multiEditPayload?.texts, [
        "first edit",
        "second FORBIDDEN_TOKEN edit",
      ]);

      const writeRes = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "MultiEdit",
          tool_input: {
            file_path: "src/a.ts",
            edits: [
              { old_string: "a", new_string: "first edit" },
              { old_string: "b", new_string: "second FORBIDDEN_TOKEN edit" },
            ],
          },
          cwd: "E:/AI/Other",
          session_id: "sess-default",
        }),
        profilesPath,
        logPath,
        rules: testRules,
      });
      assert.equal(writeRes.exitCode, 2);
      assert.equal(writeRes.outcome, "block");
      assert.equal(resolveRuleAction(testRules[0], "unknown-profile"), "warn");
      assert.equal(capRuleMessage("1\n2\n3\n4\n5\n6\n7").split("\n").length, 5);
    });
  });

  // ── 1.5 Decision log & privacy ────────────────────────────────
  describe("1.5 Append-only JSONL decision log and input hash privacy", () => {
    it("logs ts, profile, session, tool, evaluated, matched, outcome, latency_ms, input_hash and NEVER logs raw command or payload text", () => {
      const secretCommand = "echo SUPER_SECRET_API_KEY_99999_DO_NOT_LOG";
      const secretContent = "PRIVATE_PAYLOAD_BODY_88888_DO_NOT_LOG";

      const sampleRule: PreToolRule = {
        id: "sample-warn",
        layer: "B",
        tools: ["Bash", "Write"],
        action: { default: "warn" },
        memory: "mem-1",
        skill: "skill-1",
        message: "Sample warning",
        match: () => true,
      };

      process.env.AI_LOADOUT_DECISIONS_LOG = logPath;
      assert.equal(defaultDecisionLogPath(), logPath);

      runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: secretCommand },
          cwd: "E:/AI/Research and Development",
          session_id: "sess-hash-1",
        }),
        profilesPath,
        rules: [sampleRule],
        nowMs: Date.parse("2026-11-08T20:00:00.000Z"),
      });

      runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Write",
          tool_input: { file_path: "notes.md", content: secretContent },
          cwd: "E:/AI/ReleaseRepo",
          session_id: "sess-hash-2",
        }),
        profilesPath,
        rules: [sampleRule],
        nowMs: Date.parse("2026-11-08T20:01:00.000Z"),
      });

      const rawLog = readFileSync(logPath, "utf-8");
      assert.equal(rawLog.includes("SUPER_SECRET_API_KEY_99999_DO_NOT_LOG"), false);
      assert.equal(rawLog.includes("PRIVATE_PAYLOAD_BODY_88888_DO_NOT_LOG"), false);
      assert.equal(rawLog.includes("notes.md"), false);

      const lines = rawLog
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l) as DecisionLogEntry);
      assert.equal(lines.length, 2);

      assert.equal(lines[0].ts, "2026-11-08T20:00:00.000Z");
      assert.equal(lines[0].profile, "docs");
      assert.equal(lines[0].session, "sess-hash-1");
      assert.equal(lines[0].tool, "Bash");
      assert.deepEqual(lines[0].evaluated, ["sample-warn"]);
      assert.deepEqual(lines[0].matched, [{ id: "sample-warn", layer: "B", action: "warn" }]);
      assert.equal(lines[0].outcome, "warn");
      assert.equal(typeof lines[0].latency_ms, "number");
      assert.equal(lines[0].input_hash, hashToolInput({ command: secretCommand }));
      assert.match(lines[0].input_hash, /^[0-9a-f]{64}$/);

      assert.equal(lines[1].profile, "release");
      assert.equal(lines[1].tool, "Write");
      assert.equal(
        lines[1].input_hash,
        hashToolInput({ file_path: "notes.md", content: secretContent }),
      );
    });
  });

  // ── 1.6 Modes: enforce vs log-only & CLI dispatch ─────────────
  describe("1.6 Modes (--mode enforce vs --mode log-only)", () => {
    const modeRules: PreToolRule[] = [
      {
        id: "block-rule",
        layer: "A",
        tools: ["Bash"],
        action: { default: "block" },
        memory: "mem-block",
        skill: "skill-block",
        message: "Blocked by block-rule",
        match: (ctx) =>
          (ctx.parsedCommand?.segments ?? []).some((s) => s.tokens[0] === "danger"),
      },
      {
        id: "warn-rule",
        layer: "B",
        tools: ["Bash"],
        action: { default: "warn" },
        memory: "mem-warn",
        skill: "skill-warn",
        message: "Warning from warn-rule",
        match: (ctx) =>
          (ctx.parsedCommand?.segments ?? []).some((s) => s.tokens[0] === "caution"),
      },
    ];

    it("enforce mode: exits 2 + stderr on block; exits 0 + additionalContext JSON on warn", () => {
      const blockRes = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: "danger now" },
          cwd: "E:/AI/Research and Development",
          session_id: "s-enforce",
        }),
        mode: "enforce",
        profilesPath,
        logPath,
        rules: modeRules,
      });
      assert.equal(blockRes.exitCode, 2);
      assert.equal(blockRes.stdout, "");
      assert.equal(blockRes.stderr, "Blocked by block-rule\n");
      assert.equal(blockRes.outcome, "block");

      const warnRes = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: "caution ahead" },
          cwd: "E:/AI/Research and Development",
          session_id: "s-enforce",
        }),
        mode: "enforce",
        profilesPath,
        logPath,
        rules: modeRules,
      });
      assert.equal(warnRes.exitCode, 0);
      assert.equal(warnRes.stderr, "");
      const parsedOut = JSON.parse(warnRes.stdout) as {
        suppressOutput: boolean;
        hookSpecificOutput: { hookEventName: string; additionalContext: string };
      };
      assert.equal(parsedOut.suppressOutput, true);
      assert.equal(parsedOut.hookSpecificOutput.hookEventName, "PreToolUse");
      assert.equal(parsedOut.hookSpecificOutput.additionalContext, "Warning from warn-rule");
    });

    it("log-only mode: always exits 0 with empty stdout/stderr but logs block/warn outcome that would have happened", () => {
      const blockRes = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: "danger now" },
          cwd: "E:/AI/Research and Development",
          session_id: "s-logonly",
        }),
        mode: "log-only",
        profilesPath,
        logPath,
        rules: modeRules,
      });
      assert.equal(blockRes.exitCode, 0);
      assert.equal(blockRes.stdout, "");
      assert.equal(blockRes.stderr, "");
      assert.equal(blockRes.outcome, "block");
      assert.equal(blockRes.logEntry?.mode, "log-only");
      assert.equal(blockRes.logEntry?.outcome, "block");
      assert.deepEqual(blockRes.logEntry?.matched, [
        { id: "block-rule", layer: "A", action: "block" },
      ]);

      const warnRes = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: "caution ahead" },
          cwd: "E:/AI/Research and Development",
          session_id: "s-logonly",
        }),
        mode: "log-only",
        profilesPath,
        logPath,
        rules: modeRules,
      });
      assert.equal(warnRes.exitCode, 0);
      assert.equal(warnRes.stdout, "");
      assert.equal(warnRes.stderr, "");
      assert.equal(warnRes.outcome, "warn");
      assert.equal(warnRes.logEntry?.mode, "log-only");
      assert.equal(warnRes.logEntry?.outcome, "warn");
    });

    it("dispatches `loadout-os hook pre-tool --help` without error", () => {
      dispatch(["hook", "pre-tool", "--help"]);
    });
  });
});

// ════════════════════════════════════════════════════════════════
// Part 2: the failure policy
// ════════════════════════════════════════════════════════════════

describe("Part 2: failure policy (fail-open, fail-closed, single exit-2 mechanism, internal timeout)", () => {
  let tempDir: string;
  let profilesPath: string;
  let logPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "loadout-pretool-p2-"));
    profilesPath = join(tempDir, "profiles.json");
    logPath = join(tempDir, "hook-decisions.jsonl");
    writeFileSync(
      profilesPath,
      JSON.stringify({ profiles: { "E:/AI/Research and Development": "docs" } }),
      "utf-8",
    );
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── 2.1 Fail open ─────────────────────────────────────────────
  describe("2.1 Fail open (error_open, exit 0)", () => {
    it("fails open and logs error_open on unreadable/malformed stdin", () => {
      for (const badStdin of ["", "{not-json", JSON.stringify({ no_tool: 1 })]) {
        const res = runPreTool({
          stdinJson: badStdin,
          profilesPath,
          logPath,
        });
        assert.equal(res.exitCode, 0);
        assert.equal(res.outcome, "error_open");
        assert.equal(res.stdout, "");
        assert.equal(res.stderr, "");
      }

      const entries = readFileSync(logPath, "utf-8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l) as DecisionLogEntry);
      assert.equal(entries.length, 3);
      for (const e of entries) {
        assert.equal(e.outcome, "error_open");
      }
    });

    it("fails open and logs error_open on a bad or missing explicit profile config", () => {
      const corruptProfiles = join(tempDir, "corrupt-profiles.json");
      writeFileSync(corruptProfiles, "{ broken json", "utf-8");

      const resCorrupt = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: "echo hi" },
          cwd: "E:/AI/Research and Development",
        }),
        profilesPath: corruptProfiles,
        logPath,
      });
      assert.equal(resCorrupt.exitCode, 0);
      assert.equal(resCorrupt.outcome, "error_open");

      const resMissingExplicit = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: "echo hi" },
        }),
        profilesPath: join(tempDir, "does-not-exist.json"),
        logPath,
      });
      assert.equal(resMissingExplicit.exitCode, 0);
      assert.equal(resMissingExplicit.outcome, "error_open");
    });

    it("fails open and logs error_open on a crash in the Bash parser or pre-match rule error", () => {
      const resParserCrash = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: "npm publish" },
          cwd: "E:/AI/Research and Development",
        }),
        profilesPath,
        logPath,
        bashParser: () => {
          throw new Error("Simulated parser crash");
        },
      });
      assert.equal(resParserCrash.exitCode, 0);
      assert.equal(resParserCrash.outcome, "error_open");

      const throwingBlockRule: PreToolRule = {
        id: "throwing-block-rule",
        layer: "A",
        tools: ["Bash"],
        action: { default: "block" },
        memory: "mem-err",
        skill: "skill-err",
        message: "Should not block when matcher throws",
        match: () => {
          throw new Error("Matcher exploded before matching");
        },
      };

      const resRuleCrash = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: "npm publish" },
          cwd: "E:/AI/Research and Development",
        }),
        profilesPath,
        logPath,
        rules: [throwingBlockRule],
      });
      assert.equal(resRuleCrash.exitCode, 0);
      assert.equal(resRuleCrash.outcome, "error_open");
    });

    it("fails open and logs error_open on an error in the warn layer", () => {
      const throwingWarnRule: PreToolRule = {
        id: "throwing-warn-rule",
        layer: "B",
        tools: ["Bash"],
        action: { default: "warn" },
        memory: "mem-warn",
        skill: "skill-warn",
        message: () => {
          throw new Error("Warn formatter exploded");
        },
        match: () => true,
      };

      const res = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: "npm publish" },
          cwd: "E:/AI/Research and Development",
        }),
        profilesPath,
        logPath,
        rules: [throwingWarnRule],
      });
      assert.equal(res.exitCode, 0);
      assert.equal(res.outcome, "error_open");
      assert.equal(res.stdout, "");
      assert.equal(res.stderr, "");
      assert.equal(res.logEntry?.outcome, "error_open");
    });
  });

  // ── 2.2 Fail closed ───────────────────────────────────────────
  describe("2.2 Fail closed (error_closed, exit 2 once a block rule has matched)", () => {
    it("exits 2 with the block message on stderr even when a subsequent rule throws", () => {
      const rules: PreToolRule[] = [
        {
          id: "first-block",
          layer: "A",
          tools: ["Bash"],
          action: { default: "block" },
          memory: "mem-1",
          skill: "skill-1",
          message: "Hard block from first-block",
          match: () => true,
        },
        {
          id: "second-exploding-rule",
          layer: "A",
          tools: ["Bash"],
          action: { default: "block" },
          memory: "mem-2",
          skill: "skill-2",
          message: "Unreached",
          match: () => {
            throw new Error("Later step crashed after block match");
          },
        },
      ];

      const res = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: "gh pr merge 21" },
          cwd: "E:/AI/Research and Development",
        }),
        profilesPath,
        logPath,
        rules,
      });

      assert.equal(res.exitCode, 2);
      assert.equal(res.outcome, "error_closed");
      assert.equal(res.stdout, "");
      assert.equal(res.stderr, "Hard block from first-block\n");
      assert.equal(res.logEntry?.outcome, "error_closed");
    });

    it("exits 2 with the block message on stderr even when decision log writing throws", () => {
      const rules: PreToolRule[] = [
        {
          id: "first-block",
          layer: "A",
          tools: ["Bash"],
          action: { default: "block" },
          memory: "mem-1",
          skill: "skill-1",
          message: "Hard block survives log write failure",
          match: () => true,
        },
      ];

      const res = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: "gh pr merge 21" },
          cwd: "E:/AI/Research and Development",
        }),
        profilesPath,
        logPath,
        rules,
        logWriter: () => {
          throw new Error("Disk full / permission denied on log");
        },
      });

      assert.equal(res.exitCode, 2);
      assert.equal(res.outcome, "error_closed");
      assert.equal(res.stdout, "");
      assert.equal(res.stderr, "Hard block survives log write failure\n");
    });
  });

  // ── 2.3 Single mechanism: exit 2 + stderr, never JSON deny ────
  describe("2.3 Never emit JSON permissionDecision: deny together with exit 2", () => {
    it("emits strictly empty stdout and stderr message when exiting 2", () => {
      const rule: PreToolRule = {
        id: "strict-block",
        layer: "A",
        tools: ["Bash"],
        action: { default: "block" },
        memory: "mem-1",
        skill: "skill-1",
        message: "Blocked via exit 2 + stderr only",
        match: () => true,
      };

      const res = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: "gh pr merge 21" },
        }),
        profilesPath,
        logPath,
        rules: [rule],
      });

      assert.equal(res.exitCode, 2);
      assert.equal(res.stdout, "");
      assert.equal(res.stdout.includes("permissionDecision"), false);
      assert.equal(res.stdout.includes("deny"), false);
      assert.equal(res.stderr, "Blocked via exit 2 + stderr only\n");
    });
  });

  // ── 2.4 Hard internal timeout ─────────────────────────────────
  describe("2.4 Hard internal timeout (default 300 ms) fails open and logs timeout", () => {
    it("defaults to 300 ms and fails open with outcome 'timeout' when budget is exceeded", () => {
      assert.equal(DEFAULT_PRETOOL_TIMEOUT_MS, 300);

      let ruleEvaluated = false;
      const slowRule: PreToolRule = {
        id: "slow-rule",
        layer: "A",
        tools: ["Bash"],
        action: { default: "block" },
        memory: "mem-slow",
        skill: "skill-slow",
        message: "Should not run after timeout",
        match: () => {
          ruleEvaluated = true;
          return true;
        },
      };

      const res = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: "npm publish" },
          cwd: "E:/AI/Research and Development",
        }),
        profilesPath,
        logPath,
        rules: [slowRule],
        timeoutMs: 300,
        simulatedElapsedMs: 350,
      });

      assert.equal(res.exitCode, 0);
      assert.equal(res.outcome, "timeout");
      assert.equal(res.stdout, "");
      assert.equal(res.stderr, "");
      assert.equal(ruleEvaluated, false);
      assert.equal(res.logEntry?.outcome, "timeout");

      const logged = JSON.parse(readFileSync(logPath, "utf-8").trim()) as DecisionLogEntry;
      assert.equal(logged.outcome, "timeout");
    });
  });
});

// ════════════════════════════════════════════════════════════════
// Part 3: the first rules (each with tests)
// ════════════════════════════════════════════════════════════════

import {
  PRETOOL_RULES,
  DEFAULT_QUOTE_GATE_SPEAKERS,
  DEFAULT_QUOTE_GATE_NAMED_SPEAKERS,
  QUOTE_GATE_ALLOWLIST_SUFFIXES,
  findQuoteViolations,
  quoteTextsFromTool,
  parseToolStampedTime,
  quotedSpanAfter,
  isSpeechSpan,
  type QuoteViolation,
} from "../pretool-rules.js";

const LEGACY_ROLE_SPEAKER = ["Dir", "ector"].join("");
const LEGACY_REL_ROLE = ["Pub", "lisher"].join("");
const LEGACY_BASE_NAME = ["Mi", "ke"].join("");
const LEGACY_LAW_REL = ["feedback/feedback_never_quote_the_", LEGACY_ROLE_SPEAKER.toLowerCase(), ".md"].join("");
const LEGACY_LAW_CAP_REL = ["Feedback/feedback_never_quote_the_", LEGACY_ROLE_SPEAKER.toLowerCase(), ".md"].join("");

/**
 * Ported 34-case quote-gate suite (15 `_MUST_BLOCK` + 19 `_MUST_PASS`).
 * Speaker lists and allowlist suffix are passed via `profiles.json` config rather than
 * hard-coded in source; test strings build legacy role words from parts.
 */
export const QUOTE_GATE_TEST_SPEAKERS: readonly string[] = [
  LEGACY_ROLE_SPEAKER,
  "Ada",
  "He",
  "She",
  "They",
  "the User",
];

export const QUOTE_GATE_TEST_NAMED_SPEAKERS: readonly string[] = [
  LEGACY_ROLE_SPEAKER,
  "Ada",
];

export const QUOTE_GATE_MUST_BLOCK: ReadonlyArray<readonly [string, string]> = [
  [
    "P1 practice marker",
    "## 1. What he intends\n\nHis words, and these are the load-bearing ones:\n",
  ],
  [
    "P1 possessive",
    `The ${LEGACY_ROLE_SPEAKER}'s words: the pipeline ships before the docs do.`,
  ],
  [
    "P1 void instruction",
    "Corrections go to Feedback memos immediately, in his words.",
  ],
  [
    "P2 past attribution + long span",
    'Ada said: "the whole thing needs to be rebuilt from the ground up again".',
  ],
  [
    "P2 possessive + first person",
    'His verdict: "I would rather wait than ship this."',
  ],
  [
    "P2 bare colon form",
    `The ${LEGACY_ROLE_SPEAKER}: *"I do not think that shortcut is acceptable at all."* `,
  ],
  [
    "P3 emphasised block quote",
    '> *"I want the tooling to disappear into the background entirely."* ',
  ],
  [
    "Bash commit message, escaped nested quote",
    'git commit -m "docs: correct the brief\n\nHis verdict: \\"I never asked for any of that in the first place.\\""',
  ],
  [
    "Bash commit message, practice marker",
    'git commit -m "docs: record the ruling in his words, verbatim"',
  ],
  [
    "P1 'her words' as a whole word still blocks",
    "Record the ruling in her words, exactly as delivered.",
  ],
  [
    "P2 dated, colon",
    `${LEGACY_ROLE_SPEAKER} 2026-10-24: "the whole pipeline should be rebuilt before the next window opens".`,
  ],
  [
    "P2 dated, parenthetical",
    `(${LEGACY_ROLE_SPEAKER}, 10-29): "I want every build to go through the card process from now on."`,
  ],
  [
    "P2 dated, bold label",
    `**The ${LEGACY_ROLE_SPEAKER}, 2026-11-02:** "I need you to slow down at every outward step."`,
  ],
  [
    "P2 dated, qualifier then colon",
    `${LEGACY_ROLE_SPEAKER} 11-01 evening: "keep three sessions going at once until I tell you otherwise".`,
  ],
  [
    "P2 dated, no colon",
    `${LEGACY_ROLE_SPEAKER} 2026-10-23 "I would rather you delegate the writing to the other profiles".`,
  ],
];

export const QUOTE_GATE_MUST_PASS: ReadonlyArray<readonly [string, string]> = [
  [
    "trigger phrase, present frame",
    'When Ada says "dogfood swarm" on a repo, execute the funnel above.',
  ],
  [
    "trigger phrase in description",
    'description: When the user says "full treatment," run all 7 phases in order.',
  ],
  [
    "short impersonal directive",
    `The ${LEGACY_ROLE_SPEAKER} set the bar at "high quality 3D"; we A/B-tested on-rig.`,
  ],
  [
    "negated rule statement",
    "**NEVER reproduce his words verbatim in any artifact** - see the law.",
  ],
  [
    "negated rule statement 2",
    "Do not quote him into handoffs. Carried out of context his words read as specs.",
  ],
  [
    "paraphrased decision",
    "Ada ruled it a law on the spot: no public surface is ever outsourced.",
  ],
  [
    "plain block quote / character dialogue",
    '> "It is my name, and you will not have it."',
  ],
  [
    "tool output",
    'I tried to cd there and got "No such file or directory" back.',
  ],
  [
    "authored spec, correctly labelled",
    `### The scene (${LEGACY_ROLE_SPEAKER}-authored - render exactly as written)`,
  ],
  [
    "ordinary bash",
    "git status --short && git log --oneline -5",
  ],
  [
    "'other words' is not 'her words'",
    "In other words, the pipeline stays as it is; together words and whether words too.",
  ],
  [
    "dated decision, no quote",
    `${LEGACY_ROLE_SPEAKER} 2026-11-05 ruled that auto-update stays off and the rig runs a pinned build.`,
  ],
  [
    "dated, short impersonal term",
    `${LEGACY_ROLE_SPEAKER} 2026-10-22 set the bar at "high quality 3D" for the renders.`,
  ],
  [
    "dated heading, no speech",
    `**SETTLED 2026-11-05 (${LEGACY_ROLE_SPEAKER} answered A, relayed by the ${LEGACY_REL_ROLE}):** auto-update stays off.`,
  ],
  [
    "dated mention inside a YAML description (no speech)",
    `description: "Every design starts from its template; if none fits, write it first (${LEGACY_ROLE_SPEAKER}, 2026-10-13)"`,
  ],
  [
    "dated mention mid-description, quote far away",
    `description: "Medium effort, cap 4 cards (${LEGACY_ROLE_SPEAKER} 11-07); drops to 3 once the memory system is addressed"`,
  ],
  [
    "non-publishing bash with prose",
    'echo "He said I should refactor the whole module before Friday"',
  ],
  [
    "commit message with indirect speech (a paraphrase, which is the FIX)",
    'git commit -m "docs: correct the brief\n\nHe replied that he had never asked for any of that, so the framing is withdrawn."',
  ],
  [
    "shell heredoc rewriting the law file itself",
    `python - <<PY\np = "/home/user/.claude/projects/my-project/memory/${LEGACY_LAW_CAP_REL}"\n# documents git commit -m and the practice markers: his words, the ${LEGACY_ROLE_SPEAKER}'s words\nPY`,
  ],
];

describe("Part 3: the five generic rules (unreviewed-merge, quote-gate, memory-shell-write, future-stamp, release-reminder)", () => {
  let tempDir: string;
  let profilesPath: string;
  let logPath: string;
  const configuredStore = "E:/AI/CustomProfileStore/memory";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "loadout-pretool-p3-"));
    profilesPath = join(tempDir, "profiles.json");
    logPath = join(tempDir, "hook-decisions.jsonl");
    writeFileSync(
      profilesPath,
      JSON.stringify(
        {
          profiles: {
            "E:/AI/Research and Development": {
              profile: "docs",
              store: configuredStore,
            },
            "E:/AI/ReleaseRepo": {
              profile: "release",
              store: "E:/AI/ReleaseStore/memory",
            },
          },
          rules: {
            "unreviewed-merge": {
              memory: { docs: "docs-merge-policy", release: "release-merge-policy" },
              note: {
                docs: "Docs profile: route reviewed PRs to release maintainers.",
                release: "Release profile: confirm required checks and ledger entry.",
              },
            },
            "quote-gate": {
              memory: {
                default: "default-quote-policy",
                docs: "docs-quote-policy",
                release: "release-quote-policy",
              },
            },
            "memory-shell-write": {
              memory: { docs: "docs-memory-policy", release: "release-memory-policy" },
            },
            "future-stamp": {
              memory: { docs: "docs-memory-policy", release: "release-memory-policy" },
            },
            "release-reminder": {
              memory: { docs: "docs-release-policy", release: "release-merge-policy" },
              skill: "release-checklist",
              note: {
                release: "Run release checklist before publishing.",
              },
            },
          },
          ruleAliases: {
            "legacy-quote-rule": "quote-gate",
          },
          quoteGate: {
            speakers: QUOTE_GATE_TEST_SPEAKERS,
            namedSpeakers: QUOTE_GATE_TEST_NAMED_SPEAKERS,
            allowlistSuffixes: [LEGACY_LAW_REL],
          },
        },
        null,
        2,
      ),
      "utf-8",
    );
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── 3.1 unreviewed-merge ──────────────────────────────────────
  describe("3.1 unreviewed-merge (Layer A, warn-only across all profiles)", () => {
    it("warns on `gh pr merge` and `gatemerge` (any path/form) on configured and default profiles (never blocks), citing configured memory ids and notes", () => {
      const mergeCommands = [
        "gh pr merge 21 --squash",
        "gh -R mcp-tool-shop-org/loadout-os pr merge 21",
        "gatemerge 21",
        "./scripts/gatemerge.ps1 -Pr 21",
        "pwsh E:/AI/scripts/gatemerge.ps1",
      ];

      for (const command of mergeCommands) {
        // docs profile -> warn with configured memory id & note
        const docsRes = runPreTool({
          stdinJson: JSON.stringify({
            tool_name: "Bash",
            tool_input: { command },
            cwd: "E:/AI/Research and Development",
          }),
          profilesPath,
          logPath,
        });
        assert.equal(docsRes.exitCode, 0, `docs should warn (never block): ${command}`);
        assert.equal(docsRes.outcome, "warn");
        assert.match(docsRes.stdout, /docs-merge-policy/);
        assert.match(docsRes.stdout, /Docs profile: route reviewed PRs to release maintainers/);
        assert.match(docsRes.stdout, /Confirm a recorded review pass matches the exact PR head commit/);

        // release profile -> warn with configured memory id & note
        const relRes = runPreTool({
          stdinJson: JSON.stringify({
            tool_name: "Bash",
            tool_input: { command },
            cwd: "E:/AI/ReleaseRepo",
          }),
          profilesPath,
          logPath,
        });
        assert.equal(relRes.exitCode, 0, `release should warn: ${command}`);
        assert.equal(relRes.outcome, "warn");
        assert.match(relRes.stdout, /release-merge-policy/);
        assert.match(relRes.stdout, /Release profile: confirm required checks and ledger entry/);

        // default profile (no memory configured) -> neutral warn without "(memory:"
        const defRes = runPreTool({
          stdinJson: JSON.stringify({
            tool_name: "Bash",
            tool_input: { command },
            cwd: "E:/AI/UnmappedRepo",
          }),
          profilesPath,
          logPath,
        });
        assert.equal(defRes.exitCode, 0, `Default should warn: ${command}`);
        assert.equal(defRes.outcome, "warn");
        assert.equal(defRes.stdout.includes("(memory:"), false);
      }
    });

    it("suppresses the warning when a review reply exists in repliesDir whose first line contains `PASS at <head8>` for the PR's head, and still warns for PASS at another head, FIX, or no reply", () => {
      const repliesDir = join(tempDir, "replies");
      mkdirSync(repliesDir, { recursive: true });
      writeFileSync(
        profilesPath,
        JSON.stringify({
          repliesDir,
          profiles: {
            "E:/AI/Research and Development": { profile: "docs", store: configuredStore },
            "E:/AI/ReleaseRepo": { profile: "release", store: "E:/AI/ReleaseStore/memory" },
          },
        }),
        "utf-8",
      );

      const mergeWithMatchHead =
        "gh pr merge 24 -R mcp-tool-shop-org/loadout-os --squash --match-head-commit eb90790a2146c31c";
      const gatemergeWithHead =
        "bash E:/AI/ReleaseRepo/scripts/gatemerge.sh mcp-tool-shop-org/loadout-os 24 eb90790a";

      // 1. No reply in repliesDir -> warns
      const noReplyRes = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: mergeWithMatchHead },
          cwd: "E:/AI/ReleaseRepo",
        }),
        profilesPath,
        logPath,
      });
      assert.equal(noReplyRes.outcome, "warn");

      // 2. Reply with FIX at eb90790a -> still warns
      writeFileSync(
        join(repliesDir, "2026-11-08-review.md"),
        "LOADOUT-OS #24 REVIEW: FIX at eb90790a — 1 blocker\n\nDetails...\n",
        "utf-8",
      );
      const fixReplyRes = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: mergeWithMatchHead },
          cwd: "E:/AI/ReleaseRepo",
        }),
        profilesPath,
        logPath,
      });
      assert.equal(fixReplyRes.outcome, "warn");

      // 3. Reply with PASS at another head (deadbeef) -> still warns
      writeFileSync(
        join(repliesDir, "2026-11-08-review.md"),
        "LOADOUT-OS #24 REVIEW: PASS at deadbeef — 472 tests, 94.84% cov\n\nDetails...\n",
        "utf-8",
      );
      const wrongHeadRes = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: mergeWithMatchHead },
          cwd: "E:/AI/ReleaseRepo",
        }),
        profilesPath,
        logPath,
      });
      assert.equal(wrongHeadRes.outcome, "warn");

      // 4. Reply with PASS at eb90790a on first line -> suppressed (allow, exit 0, empty stdout)
      writeFileSync(
        join(repliesDir, "2026-11-08-review.md"),
        "LOADOUT-OS #24 REVIEW: PASS at eb90790a — 472 tests, 94.84% cov, 4/4 slips blocked, 34/34 quote-gate, 13/13 stamps\n\nBody.\n",
        "utf-8",
      );
      for (const cmd of [mergeWithMatchHead, gatemergeWithHead]) {
        const passReplyRes = runPreTool({
          stdinJson: JSON.stringify({
            tool_name: "Bash",
            tool_input: { command: cmd },
            cwd: "E:/AI/ReleaseRepo",
          }),
          profilesPath,
          logPath,
        });
        assert.equal(passReplyRes.exitCode, 0);
        assert.equal(passReplyRes.outcome, "allow", `Expected warning suppressed for: ${cmd}`);
        assert.equal(passReplyRes.stdout, "");
      }
    });
  });

  // ── 3.2 quote-gate (configurable speakers & allowlist) ────────
  describe("3.2 quote-gate (Layer A, default generic speakers + 34/34 cases with speakers from config)", () => {
    it("shipped default speakers include only pronouns and generic role nouns (no personal names) and leave namedSpeakers empty", () => {
      assert.deepEqual(DEFAULT_QUOTE_GATE_SPEAKERS, ["He", "She", "They", "the User"]);
      assert.deepEqual(DEFAULT_QUOTE_GATE_NAMED_SPEAKERS, []);
      assert.deepEqual(QUOTE_GATE_ALLOWLIST_SUFFIXES, [
        "packages/cli/src/pretool-rules.ts",
        "packages/cli/src/tests/pretool.test.ts",
      ]);

      // With no config (shipped default speakers), pronouns and "the User" match, while unconfigured names pass
      const emptyProfiles = join(tempDir, "empty-profiles.json");
      writeFileSync(emptyProfiles, JSON.stringify({}), "utf-8");

      const pronounBlock = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Write",
          tool_input: {
            file_path: "docs/handoff.md",
            content: 'His verdict: "I would rather wait than ship this."',
          },
          cwd: "E:/AI/OtherRepo",
        }),
        profilesPath: emptyProfiles,
        logPath,
      });
      assert.equal(pronounBlock.exitCode, 2);
      assert.equal(pronounBlock.stderr.includes("(memory:"), false);

      const userBlock = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Write",
          tool_input: {
            file_path: "docs/handoff.md",
            content: 'The User said: "I need every change verified before merge."\n',
          },
          cwd: "E:/AI/OtherRepo",
        }),
        profilesPath: emptyProfiles,
        logPath,
      });
      assert.equal(userBlock.exitCode, 2);

      // FIX-1 Item 1: With no config, the three generic "user" forms are allowed (never put into name-only branches)
      for (const allowedUserText of [
        "Store the user's words in the log.",
        'Chat fixture:\nuser: "I need help with my code"\n',
        'the user\'s reply: "I want X"\n',
      ]) {
        assert.deepEqual(findQuoteViolations(allowedUserText), []);
        const allowRes = runPreTool({
          stdinJson: JSON.stringify({
            tool_name: "Write",
            tool_input: {
              file_path: "docs/template.md",
              content: allowedUserText,
            },
            cwd: "E:/AI/OtherRepo",
          }),
          profilesPath: emptyProfiles,
          logPath,
        });
        assert.equal(
          allowRes.exitCode,
          0,
          `Expected default-profile write to be allowed: ${JSON.stringify(allowedUserText)}`,
        );
      }

      // FIX-1 Item 1 (leading \b narrowing): words merely ending in a speaker token must pass
      for (const boundaryAllowedText of [
        'Ashe said "I will finish the migration before tomorrow morning."',
        'The superuser said "I need root permissions to restart the daemon."',
      ]) {
        assert.deepEqual(findQuoteViolations(boundaryAllowedText), []);
        for (const cfgPath of [emptyProfiles, profilesPath]) {
          const boundaryRes = runPreTool({
            stdinJson: JSON.stringify({
              tool_name: "Write",
              tool_input: {
                file_path: "docs/notes.md",
                content: boundaryAllowedText,
              },
              cwd: "E:/AI/OtherRepo",
            }),
            profilesPath: cfgPath,
            logPath,
          });
          assert.equal(
            boundaryRes.exitCode,
            0,
            `Expected leading \\b narrowing to allow: ${boundaryAllowedText}`,
          );
        }
      }

      const unconfiguredNameAllow = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Write",
          tool_input: {
            file_path: "docs/handoff.md",
            content: 'Ada said: "the whole thing needs to be rebuilt from the ground up again".',
          },
          cwd: "E:/AI/OtherRepo",
        }),
        profilesPath: emptyProfiles,
        logPath,
      });
      assert.equal(unconfiguredNameAllow.exitCode, 0);
    });

    it("blocks all 15 _MUST_BLOCK cases and passes all 19 _MUST_PASS cases (34/34) when speakers are supplied by config", () => {
      assert.equal(QUOTE_GATE_MUST_BLOCK.length, 15);
      assert.equal(QUOTE_GATE_MUST_PASS.length, 19);

      for (const [name, text] of QUOTE_GATE_MUST_BLOCK) {
        const isBash =
          text.startsWith("git ") ||
          text.startsWith("echo ") ||
          text.startsWith("python ");
        const toolName = isBash ? "Bash" : "Write";
        const toolInput = isBash
          ? { command: text }
          : { file_path: "docs/handoff.md", content: text };

        const extracted = quoteTextsFromTool(toolName, toolInput, [LEGACY_LAW_REL]);
        const violations = extracted.flatMap((t) =>
          findQuoteViolations(t, QUOTE_GATE_TEST_SPEAKERS, QUOTE_GATE_TEST_NAMED_SPEAKERS),
        );
        assert.ok(
          violations.length > 0,
          `Expected _MUST_BLOCK case '${name}' to produce violations`,
        );

        const res = runPreTool({
          stdinJson: JSON.stringify({
            tool_name: toolName,
            tool_input: toolInput,
            cwd: "E:/AI/Research and Development",
          }),
          profilesPath,
          logPath,
        });
        assert.equal(
          res.exitCode,
          2,
          `Expected runPreTool to block _MUST_BLOCK case '${name}'`,
        );
        assert.equal(res.outcome, "block");
      }

      for (const [name, text] of QUOTE_GATE_MUST_PASS) {
        const isBash =
          text.startsWith("git ") ||
          text.startsWith("echo ") ||
          text.startsWith("python ");
        const toolName = isBash ? "Bash" : "Write";
        const toolInput = isBash
          ? { command: text }
          : { file_path: "docs/handoff.md", content: text };

        const extracted = quoteTextsFromTool(toolName, toolInput, [LEGACY_LAW_REL]);
        const violations = extracted.flatMap((t) =>
          findQuoteViolations(t, QUOTE_GATE_TEST_SPEAKERS, QUOTE_GATE_TEST_NAMED_SPEAKERS),
        );
        assert.equal(
          violations.length,
          0,
          `Expected _MUST_PASS case '${name}' to produce 0 violations, got: ${JSON.stringify(violations)}`,
        );

        const res = runPreTool({
          stdinJson: JSON.stringify({
            tool_name: toolName,
            tool_input: toolInput,
            cwd: "E:/AI/Research and Development",
          }),
          profilesPath,
          logPath,
        });
        assert.equal(
          res.exitCode,
          0,
          `Expected runPreTool to allow _MUST_PASS case '${name}'`,
        );
      }
    });

    it("blocks quotes in Edit, MultiEdit, git tag -m, and gh pr/issue/release, while allowing configured allowlist suffixes", () => {
      const editRes = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Edit",
          tool_input: {
            file_path: "notes.md",
            old_string: "old",
            new_string: 'His verdict: "I would rather wait than ship this."',
          },
          cwd: "E:/AI/ReleaseRepo",
        }),
        profilesPath,
        logPath,
      });
      assert.equal(editRes.exitCode, 2);

      const ghPrRes = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: {
            command:
              `gh pr create --title "t" --body "${LEGACY_ROLE_SPEAKER} 2026-10-24: \\"the whole pipeline should be rebuilt before the next window opens\\""`,
          },
          cwd: "E:/AI/Unmapped",
        }),
        profilesPath,
        logPath,
      });
      assert.equal(ghPrRes.exitCode, 2);

      const allowlistedWrite = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Write",
          tool_input: {
            file_path: `/home/user/.claude/projects/my-project/memory/${LEGACY_LAW_REL}`,
            content: 'His verdict: "I would rather wait than ship this."',
          },
          cwd: "E:/AI/Research and Development",
        }),
        profilesPath,
        logPath,
      });
      assert.equal(allowlistedWrite.exitCode, 0);

      // Without configured allowlistSuffixes, external law file is NOT allowlisted by default
      const defaultProfiles = join(tempDir, "default-only.json");
      writeFileSync(defaultProfiles, JSON.stringify({}), "utf-8");
      const notAllowlistedByDefault = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Write",
          tool_input: {
            file_path: "/home/user/.claude/hooks/quote-gate.py",
            content: 'His verdict: "I would rather wait than ship this."',
          },
          cwd: "E:/AI/Unmapped",
        }),
        profilesPath: defaultProfiles,
        logPath,
      });
      assert.equal(notAllowlistedByDefault.exitCode, 2);
    });

    it("FIX-1/FIX-2 quote-gate oracle: matches base regex on the shared corpus and first-name P1 word-block, proves 6 intentional leading word-boundary narrowings against base, and catches 'the User' in namedSpeakers", () => {
      const legacyPair = `${LEGACY_ROLE_SPEAKER}|${LEGACY_BASE_NAME}`;
      const baseSubject = String.raw`(?:the\s+)?(?:${legacyPair}|He|She|They|User)`;
      const baseP1Re = new RegExp(
        String.raw`\b(?:his|her|their)\s+words` +
          String.raw`|(?:${legacyPair})'s\s+words` +
          String.raw`|${LEGACY_ROLE_SPEAKER}'?s?-word\s+block`,
        "gi",
      );
      const baseNegRe = new RegExp(
        String.raw`\b(?:never|not|no|don'?t|do\s+not|forbid\w*|void|stop|without|instead\s+of` +
          String.raw`|rather\s+than|avoid\w*|quoting|quote|paraphrase\w*)\b`,
        "i",
      );
      const oracleAttrRe = new RegExp(
        baseSubject +
          String.raw`\s+(?:said|replied|answered|asked|corrected|ruled|objected` +
          String.raw`|challenged|directed|wrote|added|noted|told|put\s+it` +
          String.raw`|cut\s+it\s+off|pushed\s+back|framed\s+it|called\s+it)` +
          String.raw`|(?:${legacyPair}|His|Her|Their)'?s?\s+` +
          String.raw`(?:words|reply|answer|verdict|correction|phrasing|directive` +
          String.raw`|live\s+word|own\s+rule|point|question)\s*[:\u2014-]` +
          String.raw`|(?:^|\n)\s*(?:\*\*)?(?:The\s+)?(?:${legacyPair})(?:\*\*)?\s*:` +
          String.raw`|\(?\s*(?:\*\*)?(?:The\s+)?(?:${legacyPair})\s*[,(]?\s*` +
          String.raw`(?:20\d\d-\d\d-\d\d|\d\d-\d\d)\b[^\"\u201c\n:]{0,40}?\)?(?:\*\*)?\s*[:\u2014-]?` +
          String.raw`\s*(?:\*{1,2})?\s*(?=[\"\u201c][^\s\"\u201d])`,
        "gim",
      );
      const baseP3Re = new RegExp(String.raw`^\s*>\s*\*{1,2}[\"\u201c]`, "gm");
      const lineOfOracle = (txt: string, pos: number): string => {
        const start = txt.slice(0, pos).lastIndexOf("\n") + 1;
        const end = txt.indexOf("\n", pos);
        return txt.slice(start, end !== -1 ? end : txt.length).trim().slice(0, 150);
      };
      const findBaseOracleViolations = (rawText: string): QuoteViolation[] => {
        if (!rawText) return [];
        const hits: QuoteViolation[] = [];
        baseP1Re.lastIndex = 0;
        for (const m of rawText.matchAll(baseP1Re)) {
          const st = m.index ?? 0;
          if (baseNegRe.test(rawText.slice(Math.max(0, st - 70), st))) continue;
          hits.push({ rule: "P1", line: lineOfOracle(rawText, st) });
        }
        if (/[\"\u201c]/.test(rawText)) {
          oracleAttrRe.lastIndex = 0;
          for (const m of rawText.matchAll(oracleAttrRe)) {
            const st = m.index ?? 0;
            const span = quotedSpanAfter(rawText, st + m[0].length);
            if (span && isSpeechSpan(span)) {
              hits.push({ rule: "P2", line: lineOfOracle(rawText, st) });
            }
          }
          baseP3Re.lastIndex = 0;
          for (const m of rawText.matchAll(baseP3Re)) {
            const st = m.index ?? 0;
            const span = quotedSpanAfter(rawText, st + m[0].length - 1);
            if (span && /\b(?:I|I'?m|I'?ve|I'?ll|I'?d|my|me|myself|mine|we|we'?re|we'?ve|our|us|let'?s)\b/i.test(span)) {
              hits.push({ rule: "P3", line: lineOfOracle(rawText, st) });
            }
          }
        }
        const seen = new Set<string>();
        return hits.filter((h) => (seen.has(h.line) ? false : (seen.add(h.line), true)));
      };

      const oracleSpeakers = [LEGACY_ROLE_SPEAKER, LEGACY_BASE_NAME, "He", "She", "They", "the User"];
      const oracleNamedSpeakers = [LEGACY_ROLE_SPEAKER, LEGACY_BASE_NAME];

      const corpus: Array<[string, string]> = [
        ...[...QUOTE_GATE_MUST_BLOCK, ...QUOTE_GATE_MUST_PASS].map(([label, raw]): [string, string] => [
          label,
          raw.replace(/\bAda\b/g, LEGACY_BASE_NAME),
        ]),
        ["base P1 second named", `Do not use ${LEGACY_BASE_NAME}'s words in the changelog.`],
        ["base P1 second named unnegated", `We kept ${LEGACY_BASE_NAME}'s words in the changelog.`],
        ["base P1 word-block first name only", `Remove the ${LEGACY_ROLE_SPEAKER}-word block.`],
        ["base P1 word-block second name allow", `Remove the ${LEGACY_BASE_NAME}-word block.`],
        ["base P1 70-char negation outside window", `never ${"a".repeat(70)} The ${LEGACY_ROLE_SPEAKER}'s words remain.`],
        ["base P1 70-char negation inside window", `never ${"a".repeat(58)} The ${LEGACY_ROLE_SPEAKER}'s words stay forbidden.`],
        ["base P2 bare second named", `${LEGACY_BASE_NAME}: "I want the changelog updated today."`],
        ["base P2 dated second named", `${LEGACY_BASE_NAME} 2026-11-08: "I want every check verified."`],
        ["base user possessive-words allow", "Store the user's words in the log."],
        ["base user line-start allow", 'Chat fixture:\nuser: "I need help with my code"\n'],
        ["base user possessive-reply allow", 'the user\'s reply: "I want X"\n'],
      ];

      for (const [label, text] of corpus) {
        const extracted = quoteTextsFromTool(
          text.startsWith("git ") || text.startsWith("echo ") || text.startsWith("python ")
            ? "Bash"
            : "Write",
          text.startsWith("git ") || text.startsWith("echo ") || text.startsWith("python ")
            ? { command: text }
            : { file_path: "docs/handoff.md", content: text },
          [LEGACY_LAW_REL],
        );
        const got = extracted.flatMap((t) => findQuoteViolations(t, oracleSpeakers, oracleNamedSpeakers));
        const expected = extracted.flatMap((t) => findBaseOracleViolations(t));
        assert.deepEqual(got, expected, `Oracle mismatch on case '${label}'`);
      }

      // Explicit boundary probes: base matched substring glued to a preceding word; new leading \b prevents false positives across all 6 branches
      const gluedName = `sub${LEGACY_ROLE_SPEAKER.toLowerCase()}`;
      const intentionalBoundaryNarrowings: Array<[string, string]> = [
        ["P2 subject glued (pronoun)", 'Ashe said "I will finish the migration before tomorrow morning."'],
        ["P2 subject glued (role)", 'superuser said "I will restart the service right now."'],
        ["P2 pronoun possessive glued", 'cypher\'s reply: "I want to rotate the signing keys before release."'],
        ["P2 named possessive glued", `${gluedName}'s verdict: "I think we should split this module first."`],
        ["P2 dated glued", `${gluedName} 2026-11-08: "I want to review the schema changes today."`],
        ["P1 possessive-words glued", `Record the ${gluedName}'s words in the meeting notes.`],
        ["P1 word-block glued", `Trim the ${gluedName}-word block from the draft.`],
      ];
      for (const [branch, probe] of intentionalBoundaryNarrowings) {
        const baseHits = findBaseOracleViolations(probe);
        const newHits = findQuoteViolations(probe, oracleSpeakers, oracleNamedSpeakers);
        assert.equal(baseHits.length, 1, `Expected base oracle to false-positive on ${branch}: ${probe}`);
        assert.equal(newHits.length, 0, `Expected leading \\b to narrow away false-positive on ${branch}: ${probe}`);
      }

      // Negative proof: putting "the User" back into namedSpeakers breaks oracle equivalence on P1 user's words
      const widenedGot = findQuoteViolations(
        "Store the user's words in the log.",
        oracleSpeakers,
        [...oracleNamedSpeakers, "the User"],
      );
      const baseExpected = findBaseOracleViolations("Store the user's words in the log.");
      assert.equal(baseExpected.length, 0);
      assert.equal(widenedGot.length, 1);
      assert.notDeepEqual(widenedGot, baseExpected);
    });

    it("FIX-1 Item 4: caps rule message at 5 lines before appending configured note so multi-line notes are never truncated", () => {
      const sixLineRule = {
        id: "release-reminder",
        layer: "B" as const,
        tools: ["Bash"],
        action: { default: "warn" as const },
        memory: {},
        skill: "none",
        skillNoneReason: "Test rule.",
        message: () => [
          "Line 1: rule header",
          "Line 2: detail A",
          "Line 3: detail B",
          "Line 4: detail C",
          "Line 5: detail D",
          "Line 6: truncated base line",
        ].join("\n"),
        match: () => ({ matched: true }),
      };

      const noteProfiles = join(tempDir, "note-cap-profiles.json");
      writeFileSync(
        noteProfiles,
        JSON.stringify({
          rules: {
            "release-reminder": {
              note: {
                default: "Configured Note Line 1: verify tags.\nConfigured Note Line 2: check release log.",
              },
            },
          },
        }),
        "utf-8",
      );

      const res = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: "echo hi" },
          cwd: "E:/AI/OtherRepo",
        }),
        profilesPath: noteProfiles,
        logPath,
        rules: [sixLineRule],
      });
      assert.equal(res.exitCode, 0);
      assert.equal(res.outcome, "warn");
      assert.match(res.stdout, /Line 5: detail D/);
      assert.equal(res.stdout.includes("Line 6: truncated base line"), false);
      assert.match(res.stdout, /Configured Note Line 1: verify tags\./);
      assert.match(res.stdout, /Configured Note Line 2: check release log\./);
    });
  });

  // ── 3.3 memory-shell-write ────────────────────────────────────
  describe("3.3 memory-shell-write (Layer A)", () => {
    it("blocks redirection, tee, sed -i, cp, mv, rm, touch, python/node inline/heredoc writes, and git -C <store> commit/checkout/reset", () => {
      const claudeStoreFile =
        "~/.claude/projects/E--AI-Research-and-Development/memory/BOARD.md";
      const profileStoreFile = `${configuredStore}/topic.md`;

      const blockedShellWrites = [
        `echo "hi" > ${claudeStoreFile}`,
        `echo "hi" >> ${profileStoreFile}`,
        `cat notes.md | tee ${claudeStoreFile}`,
        `sed -i 's/old/new/' ${profileStoreFile}`,
        `cp /tmp/draft.md ${claudeStoreFile}`,
        `mv /tmp/draft.md ${profileStoreFile}`,
        `rm -f ${claudeStoreFile}`,
        `touch ${profileStoreFile}`,
        `python -c "open('${profileStoreFile}', 'w').write('x')"`,
        `node -e "fs.writeFileSync('${profileStoreFile}', 'x')"`,
        `python - <<EOF\nwith open('${claudeStoreFile}', 'w') as f:\n    f.write('hi')\nEOF`,
        `git -C ${configuredStore} commit -m "manual store commit"`,
        `git -C ${configuredStore} checkout -- MEMORY.md`,
        `git -C ${configuredStore} reset --hard HEAD~1`,
      ];

      for (const command of blockedShellWrites) {
        const res = runPreTool({
          stdinJson: JSON.stringify({
            tool_name: "Bash",
            tool_input: { command },
            cwd: "E:/AI/Research and Development",
          }),
          profilesPath,
          logPath,
        });
        assert.equal(
          res.exitCode,
          2,
          `Expected memory-shell-write to block: ${command}`,
        );
        assert.equal(res.outcome, "block");
        assert.ok(
          res.logEntry?.matched.some((m) => m.id === "memory-shell-write"),
        );
      }
    });

    it("allows `loadout-os ...` commands, read-only commands on store paths, and Write/Edit tool calls", () => {
      const allowedCommands = [
        `loadout-os memories place ${configuredStore}/topic.md main --store ${configuredStore}`,
        `loadout-os refresh --store ${configuredStore} --project .`,
        `cat ${configuredStore}/MEMORY.md`,
        `git -C ${configuredStore} status`,
        `python -c "print(open('${configuredStore}/MEMORY.md').read())"`,
      ];

      for (const command of allowedCommands) {
        const res = runPreTool({
          stdinJson: JSON.stringify({
            tool_name: "Bash",
            tool_input: { command },
            cwd: "E:/AI/Research and Development",
          }),
          profilesPath,
          logPath,
        });
        assert.equal(
          res.exitCode,
          0,
          `Expected memory-shell-write to allow: ${command}`,
        );
      }

      // Claude Code's Write/Edit tools are out of scope for memory-shell-write
      const writeRes = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Write",
          tool_input: {
            file_path: `${configuredStore}/topic.md`,
            content: "# Clean topic\n\nBody text without future stamps.\n",
          },
          cwd: "E:/AI/Research and Development",
        }),
        profilesPath,
        logPath,
      });
      assert.equal(writeRes.exitCode, 0);
    });
  });

  // ── 3.4 future-stamp ──────────────────────────────────────────
  describe("3.4 future-stamp (Layer A)", () => {
    // Fixed clocks in America/New_York (EST on 2026-11-08 = UTC-5):
    // 15:44 ET = 20:44 UTC; 17:39 ET = 22:39 UTC
    const fixedClockMs = Date.UTC(2026, 10, 8, 20, 44, 0, 0);
    const clock1739Ms = Date.UTC(2026, 10, 8, 22, 39, 0, 0);

    it("blocks tool-stamped fields (> 5 min ahead of OS clock) in `2026-11-08 15:03 ET`, `~15:05 ET`, and ISO 8601 forms", () => {
      const futurePayloads = [
        "**Last updated:** 2026-11-08 17:00 ET\n",
        "**Last updated:** ~15:55 ET\n",
        "---\ncreated_at: 2026-11-08T16:30:00\n---\n",
        "---\nmodified: 2026-11-08 16:00 ET\n---\n",
        "---\nverified_at: 2026-11-09\n---\n",
      ];

      for (const new_string of futurePayloads) {
        const res = runPreTool({
          stdinJson: JSON.stringify({
            tool_name: "Edit",
            tool_input: {
              file_path: `${configuredStore}/BOARD.md`,
              old_string: "old",
              new_string,
            },
            cwd: "E:/AI/Research and Development",
          }),
          profilesPath,
          logPath,
          nowMs: fixedClockMs,
        });
        assert.equal(
          res.exitCode,
          2,
          `Expected future-stamp to block: ${new_string.trim()}`,
        );
        assert.equal(res.outcome, "block");
        assert.ok(res.logEntry?.matched.some((m) => m.id === "future-stamp"));
      }
    });

    it("handles real-world board lines with trailing text, zones (ET/EST/EDT/UTC/Z/±HH:MM), bare dates (end-of-day), prose values, and body deadlines (8/8 real-line cases)", () => {
      // 1. Real board line at 15:03 ET with trailing text -> allow (clock fixed at 15:44 ET)
      const allow1503 = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Edit",
          tool_input: {
            file_path: `${configuredStore}/BOARD.md`,
            old_string: "old",
            new_string:
              "**Last updated:** 2026-11-08 15:03 ET (clock-checked). loadout-os 1.1.1 live …",
          },
          cwd: "E:/AI/Research and Development",
        }),
        profilesPath,
        logPath,
        nowMs: fixedClockMs,
      });
      assert.equal(allow1503.exitCode, 0);
      assert.equal(allow1503.outcome, "allow");

      // 2. The same real board line at 23:59 (and `23:59 ET. x` at 17:39 ET) -> block
      for (const [line, clock] of [
        [
          "**Last updated:** 2026-11-08 23:59 ET (clock-checked). loadout-os 1.1.1 live …",
          fixedClockMs,
        ],
        ["**Last updated:** 2026-11-08 23:59 ET. x", clock1739Ms],
      ] as const) {
        const block2359 = runPreTool({
          stdinJson: JSON.stringify({
            tool_name: "Edit",
            tool_input: {
              file_path: `${configuredStore}/BOARD.md`,
              old_string: "old",
              new_string: line,
            },
            cwd: "E:/AI/Research and Development",
          }),
          profilesPath,
          logPath,
          nowMs: clock,
        });
        assert.equal(block2359.exitCode, 2, `Expected block on: ${line}`);
        assert.equal(block2359.outcome, "block");
        assert.ok(block2359.logEntry?.matched.some((m) => m.id === "future-stamp"));
      }

      // 3. `**Last updated:** 2026-11-08 ~15:05 ET. Cutover: …` -> allow (clock 17:39 ET)
      const allowApprox1505 = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Edit",
          tool_input: {
            file_path: `${configuredStore}/BOARD.md`,
            old_string: "old",
            new_string: "**Last updated:** 2026-11-08 ~15:05 ET. Cutover: …",
          },
          cwd: "E:/AI/Research and Development",
        }),
        profilesPath,
        logPath,
        nowMs: clock1739Ms,
      });
      assert.equal(allowApprox1505.exitCode, 0);
      assert.equal(allowApprox1505.outcome, "allow");

      // 4. `~19:30 ET` (both full date+~time and time-only with trailing text) -> block (clock 17:39 ET)
      for (const line of [
        "**Last updated:** 2026-11-08 ~19:30 ET. Cutover: …",
        "**Last updated:** ~19:30 ET. Cutover: …",
      ]) {
        const blockApprox1930 = runPreTool({
          stdinJson: JSON.stringify({
            tool_name: "Edit",
            tool_input: {
              file_path: `${configuredStore}/BOARD.md`,
              old_string: "old",
              new_string: line,
            },
            cwd: "E:/AI/Research and Development",
          }),
          profilesPath,
          logPath,
          nowMs: clock1739Ms,
        });
        assert.equal(blockApprox1930.exitCode, 2, `Expected block on: ${line}`);
        assert.equal(blockApprox1930.outcome, "block");
      }

      // 5. `**Last updated**: 2026-11-08T23:59:00Z — …` -> block
      const blockIsoZ = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Edit",
          tool_input: {
            file_path: `${configuredStore}/BOARD.md`,
            old_string: "old",
            new_string: "**Last updated**: 2026-11-08T23:59:00Z — …",
          },
          cwd: "E:/AI/Research and Development",
        }),
        profilesPath,
        logPath,
        nowMs: fixedClockMs,
      });
      assert.equal(blockIsoZ.exitCode, 2);
      assert.equal(blockIsoZ.outcome, "block");

      // 6. A value that is pure prose -> allow and log hashed note (never raw prose, P4.14)
      const proseRes = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Edit",
          tool_input: {
            file_path: `${configuredStore}/BOARD.md`,
            old_string: "old",
            new_string: "**Last updated:** stamped by the CLI on next refresh",
          },
          cwd: "E:/AI/Research and Development",
        }),
        profilesPath,
        logPath,
        nowMs: fixedClockMs,
      });
      assert.equal(proseRes.exitCode, 0);
      assert.equal(proseRes.outcome, "allow");
      assert.ok(
        proseRes.logEntry?.notes?.some((n) =>
          /^unparseable_timestamp:Last updated=sha256:[0-9a-f]{12}\(len=\d+\)$/.test(n),
        ),
      );
      assert.equal(
        JSON.stringify(proseRes.logEntry).includes("stamped by the CLI"),
        false,
        "notes must never leak raw unparseable timestamp text (P4.14)",
      );

      // 7. A deadline elsewhere in the body (`due 2026-12-01`) -> allow (not a stamped field)
      const deadlineRes = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Write",
          tool_input: {
            file_path: `${configuredStore}/BOARD.md`,
            content:
              "# Project Board\n\n**Last updated:** 2026-11-08 15:03 ET (clock-checked). loadout-os 1.1.1 live.\n\n- Milestone 2: due 2026-12-01 (hard deadline)\n",
          },
          cwd: "E:/AI/Research and Development",
        }),
        profilesPath,
        logPath,
        nowMs: fixedClockMs,
      });
      assert.equal(deadlineRes.exitCode, 0);
      assert.equal(deadlineRes.outcome, "allow");

      // 8. Frontmatter fields (`created_at`, `modified`, `verified_at`), zones (`EST`, `EDT`, `UTC`, `Z`, `±HH:MM`, EDT summer), and bare `YYYY-MM-DD` (compared at start-of-day per P3.13 so same-day bare dates pass)
      // Bare date `2026-11-07` (start of day 2026-11-07 00:00:00 ET <= 2026-11-08 15:44 ET) -> allow
      assert.ok(parseToolStampedTime("2026-11-07 (yesterday)", fixedClockMs)! < fixedClockMs);
      // Bare date `2026-11-08` (start of day 2026-11-08 00:00:00 ET <= 2026-11-08 15:44 ET) -> allow (same-day bare date passes per P3.13)
      assert.ok(parseToolStampedTime("2026-11-08 (today date-only)", fixedClockMs)! <= fixedClockMs);
      // Bare date `2026-11-09` (tomorrow) -> > fixedClockMs (blocks)
      assert.ok(parseToolStampedTime("2026-11-09 (tomorrow date-only)", fixedClockMs)! > fixedClockMs);
      // Explicit zones (`EST`, `EDT`, `UTC`, `Z`, `-05:00`) and summer EDT (`2026-07-15 12:00 ET` = 16:00 UTC)
      assert.equal(
        parseToolStampedTime("2026-07-15 12:00 ET (summer EDT)", fixedClockMs),
        Date.UTC(2026, 6, 15, 16, 0, 0, 0),
      );
      assert.equal(
        parseToolStampedTime("2026-11-08 15:03 EST (winter EST)", fixedClockMs),
        Date.UTC(2026, 10, 8, 20, 3, 0, 0),
      );
      assert.equal(
        parseToolStampedTime("2026-11-08 20:03 UTC — note", fixedClockMs),
        Date.UTC(2026, 10, 8, 20, 3, 0, 0),
      );
      assert.equal(
        parseToolStampedTime("~2026-11-08 15:03 -05:00 (offset)", fixedClockMs),
        Date.UTC(2026, 10, 8, 20, 3, 0, 0),
      );
    });

    it("handles Markdown heading stamp lines (`^#{1,6} ... updated <timestamp>`) in memory-store files (5/5 heading-stamp cases)", () => {
      // Clock fixed at 2026-11-08 17:57:00 EST (22:57:00 UTC)
      const clock1757Ms = Date.UTC(2026, 10, 8, 22, 57, 0, 0);

      // 1. `# Release BOARD — updated 2026-11-08 17:55 ET (stamped from date)` -> allow (clock fixed at 17:57)
      const allowPub1755 = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Edit",
          tool_input: {
            file_path: `${configuredStore}/BOARD.md`,
            old_string: "old",
            new_string:
              "# Release BOARD — updated 2026-11-08 17:55 ET (stamped from date)",
          },
          cwd: "E:/AI/ReleaseRepo",
        }),
        profilesPath,
        logPath,
        nowMs: clock1757Ms,
      });
      assert.equal(allowPub1755.exitCode, 0);
      assert.equal(allowPub1755.outcome, "allow");

      // 2. The same line at 23:59 -> block
      const blockPub2359 = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Edit",
          tool_input: {
            file_path: `${configuredStore}/BOARD.md`,
            old_string: "old",
            new_string:
              "# Release BOARD — updated 2026-11-08 23:59 ET (stamped from date)",
          },
          cwd: "E:/AI/ReleaseRepo",
        }),
        profilesPath,
        logPath,
        nowMs: clock1757Ms,
      });
      assert.equal(blockPub2359.exitCode, 2);
      assert.equal(blockPub2359.outcome, "block");
      assert.ok(blockPub2359.logEntry?.matched.some((m) => m.id === "future-stamp"));

      // 3. `## Status — Updated 2026-11-09 08:00 ET` in a memory-store file -> block
      const blockStatusHeading = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Edit",
          tool_input: {
            file_path: `${configuredStore}/status.md`,
            old_string: "old",
            new_string: "## Status — Updated 2026-11-09 08:00 ET",
          },
          cwd: "E:/AI/ReleaseRepo",
        }),
        profilesPath,
        logPath,
        nowMs: clock1757Ms,
      });
      assert.equal(blockStatusHeading.exitCode, 2);
      assert.equal(blockStatusHeading.outcome, "block");
      assert.ok(blockStatusHeading.logEntry?.matched.some((m) => m.id === "future-stamp"));

      // 4. A body line `- updated the docs 2026-12-01` (and `updated the README on 2026-12-01`) -> allow
      for (const bodyLine of [
        "- updated the docs 2026-12-01",
        "updated the README on 2026-12-01",
      ]) {
        const allowBodyRes = runPreTool({
          stdinJson: JSON.stringify({
            tool_name: "Edit",
            tool_input: {
              file_path: `${configuredStore}/BOARD.md`,
              old_string: "old",
              new_string: bodyLine,
            },
            cwd: "E:/AI/ReleaseRepo",
          }),
          profilesPath,
          logPath,
          nowMs: clock1757Ms,
        });
        assert.equal(allowBodyRes.exitCode, 0, `Expected body line to allow: ${bodyLine}`);
        assert.equal(allowBodyRes.outcome, "allow");
      }

      // 5. The same heading in a non-memory file -> allow
      for (const heading of [
        "# Release BOARD — updated 2026-11-08 23:59 ET (stamped from date)",
        "## Status — Updated 2026-11-09 08:00 ET",
      ]) {
        const allowNonMemoryRes = runPreTool({
          stdinJson: JSON.stringify({
            tool_name: "Edit",
            tool_input: {
              file_path: "E:/AI/ReleaseRepo/docs/STATUS.md",
              old_string: "old",
              new_string: heading,
            },
            cwd: "E:/AI/ReleaseRepo",
          }),
          profilesPath,
          logPath,
          nowMs: clock1757Ms,
        });
        assert.equal(
          allowNonMemoryRes.exitCode,
          0,
          `Expected heading in non-memory file to allow: ${heading}`,
        );
        assert.equal(allowNonMemoryRes.outcome, "allow");
      }
    });

    it("allows current/past stamps (<= +5 min), ignores non-stamped future deadlines, and logs unparseable stamps without blocking", () => {
      // Current stamp (15:44 ET) and +4 min (~15:48 ET) pass
      for (const stamp of [
        "**Last updated:** 2026-11-08 15:44 ET",
        "**Last updated:** ~15:48 ET",
        "created_at: 2026-11-08T15:03:00",
        // Future deadline in prose is ignored
        "**Last updated:** 2026-11-08 15:44 ET\nDeadline: 2026-12-31 23:59 ET",
      ]) {
        const res = runPreTool({
          stdinJson: JSON.stringify({
            tool_name: "Edit",
            tool_input: {
              file_path: `${configuredStore}/BOARD.md`,
              old_string: "old",
              new_string: stamp,
            },
            cwd: "E:/AI/Research and Development",
          }),
          profilesPath,
          logPath,
          nowMs: fixedClockMs,
        });
        assert.equal(res.exitCode, 0, `Expected future-stamp to allow: ${stamp}`);
      }

      // Unparseable form on a stamped field passes and is logged in `notes`
      const unparseableRes = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Edit",
          tool_input: {
            file_path: `${configuredStore}/BOARD.md`,
            old_string: "old",
            new_string: "**Last updated:** <stamped-by-cli-later>",
          },
          cwd: "E:/AI/Research and Development",
        }),
        profilesPath,
        logPath,
        nowMs: fixedClockMs,
      });
      assert.equal(unparseableRes.exitCode, 0);
      assert.equal(unparseableRes.outcome, "allow");
      assert.ok(
        unparseableRes.logEntry?.notes?.some((n) =>
          n.startsWith("unparseable_timestamp:Last updated="),
        ),
      );
      assert.equal(parseToolStampedTime("not-a-timestamp", fixedClockMs), null);
    });
  });

  // ── 3.5 release-reminder (Layer B) ────────────────────────────
  describe("3.5 release-reminder (Layer B, soft warn on all profiles)", () => {
    it("warns on `npm publish`, `gh release create`, and `git push --tags` across all profiles, and stays silent on dry-run or normal push", () => {
      const releaseCommands = [
        "npm publish",
        "npm publish --access public",
        "gh release create v1.1.2 --generate-notes",
        "git push --tags",
        "git push origin --tags",
      ];

      for (const command of releaseCommands) {
        for (const [cwd, expectedMemId] of [
          ["E:/AI/Research and Development", /docs-release-policy/],
          ["E:/AI/ReleaseRepo", /release-merge-policy/],
          ["E:/AI/OtherRepo", /Confirm release readiness/],
        ] as const) {
          const res = runPreTool({
            stdinJson: JSON.stringify({
              tool_name: "Bash",
              tool_input: { command },
              cwd,
            }),
            profilesPath,
            logPath,
          });
          assert.equal(res.exitCode, 0);
          assert.equal(res.outcome, "warn");
          assert.match(res.stdout, expectedMemId);
        }
      }

      // Non-firing commands (dry-run or ordinary branch push)
      for (const safeCmd of [
        "npm publish --dry-run",
        "git push origin feat/pretool-framework",
        "git push --tags --dry-run",
      ]) {
        const res = runPreTool({
          stdinJson: JSON.stringify({
            tool_name: "Bash",
            tool_input: { command: safeCmd },
            cwd: "E:/AI/ReleaseRepo",
          }),
          profilesPath,
          logPath,
        });
        assert.equal(res.exitCode, 0);
        assert.equal(res.outcome, "allow");
        assert.equal(res.stdout, "");
      }

      assert.equal(PRETOOL_RULES.length, 5);
    });
  });
});

// ════════════════════════════════════════════════════════════════
// Part 5: acceptance (2026-11-08 four-slip replay fixture & subprocess check)
// ════════════════════════════════════════════════════════════════

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REPLAY_2026_11_08_FIXTURE,
  REPLAY_2026_11_08_STORE,
  REPLAY_2026_11_08_CLOCK_MS,
  type ReplayCasePair,
} from "./fixtures.js";

export {
  REPLAY_2026_11_08_FIXTURE,
  REPLAY_2026_11_08_STORE,
  REPLAY_2026_11_08_CLOCK_MS,
  type ReplayCasePair,
};

describe("Part 5: 2026-11-08 four-slip replay fixture (4/4 blocked, 4/4 matching calls pass)", () => {
  let tempDir: string;
  let profilesPath: string;
  let logPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "loadout-pretool-p5-"));
    profilesPath = join(tempDir, "profiles.json");
    logPath = join(tempDir, "hook-decisions.jsonl");
    writeFileSync(
      profilesPath,
      JSON.stringify(
        {
          profiles: {
            "E:/AI/Research and Development": {
              profile: "docs",
              store: REPLAY_2026_11_08_STORE,
            },
            "E:/AI/ReleaseRepo": {
              profile: "release",
              store: REPLAY_2026_11_08_STORE,
            },
          },
          quoteGate: {
            speakers: [...QUOTE_GATE_TEST_SPEAKERS, "Lead"],
            namedSpeakers: ["Lead"],
          },
        },
        null,
        2,
      ),
      "utf-8",
    );
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("replays all 4 slips from 2026-11-08 in-process and via the built CLI subprocess: 4/4 blocked (exit 2) and 4/4 matching calls pass (exit 0)", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const cliEntry = resolve(here, "..", "cli.js");

    let blockedCount = 0;
    let allowedCount = 0;

    for (const pair of REPLAY_2026_11_08_FIXTURE) {
      const expectedAction = pair.expectedViolatingAction ?? "block";
      const expectedExit = expectedAction === "block" ? 2 : 0;

      // 1. In-process check: violating slip
      const blockRes = runPreTool({
        stdinJson: JSON.stringify(pair.blockedStdin),
        profilesPath,
        logPath,
        nowMs: REPLAY_2026_11_08_CLOCK_MS,
      });
      assert.equal(
        blockRes.exitCode,
        expectedExit,
        `In-process slip ${pair.id} must exit ${expectedExit}`,
      );
      assert.equal(blockRes.outcome, expectedAction);
      if (expectedAction === "block") {
        assert.equal(blockRes.stdout, "");
        assert.ok(blockRes.stderr.length > 0);
      } else {
        assert.match(blockRes.stdout, /additionalContext/);
        assert.equal(blockRes.stderr, "");
      }
      assert.ok(
        blockRes.logEntry?.matched.some(
          (m) => m.id === pair.ruleId && m.action === expectedAction,
        ),
        `Expected rule ${pair.ruleId} to ${expectedAction} ${pair.id}`,
      );

      // 2. Subprocess check: violating slip
      const childEnv = { ...process.env, NODE_TEST_CONTEXT: "" };
      const blockProc = spawnSync(
        process.execPath,
        [
          cliEntry,
          "hook",
          "pre-tool",
          "--profiles",
          profilesPath,
          "--log",
          logPath,
          "--now",
          String(REPLAY_2026_11_08_CLOCK_MS),
        ],
        {
          input: JSON.stringify(pair.blockedStdin),
          encoding: "utf-8",
          env: childEnv,
        },
      );
      assert.equal(
        blockProc.status,
        expectedExit,
        `Subprocess slip ${pair.id} must exit ${expectedExit}`,
      );
      if (expectedAction === "block") {
        assert.equal(blockProc.stdout, "");
        assert.ok(blockProc.stderr.length > 0);
      } else {
        assert.match(blockProc.stdout, /additionalContext/);
      }
      blockedCount++;

      // 3. In-process check: matching allowed call
      const allowRes = runPreTool({
        stdinJson: JSON.stringify(pair.allowedStdin),
        profilesPath,
        logPath,
        nowMs: REPLAY_2026_11_08_CLOCK_MS,
      });
      assert.equal(allowRes.exitCode, 0, `In-process allowed pair for ${pair.id} must exit 0`);
      assert.equal(allowRes.outcome, pair.expectedAllowedOutcome);
      if (pair.expectedAllowedOutcome === "warn") {
        assert.match(allowRes.stdout, /additionalContext/);
      } else {
        assert.equal(allowRes.stdout, "");
      }

      // 4. Subprocess check: matching allowed call
      const allowProc = spawnSync(
        process.execPath,
        [
          cliEntry,
          "hook",
          "pre-tool",
          "--profiles",
          profilesPath,
          "--log",
          logPath,
          "--now",
          String(REPLAY_2026_11_08_CLOCK_MS),
        ],
        {
          input: JSON.stringify(pair.allowedStdin),
          encoding: "utf-8",
          env: childEnv,
        },
      );
      assert.equal(allowProc.status, 0, `Subprocess allowed pair for ${pair.id} must exit 0`);
      allowedCount++;
    }

    assert.equal(blockedCount, 5);
    assert.equal(allowedCount, 5);
  });

  it("evaluates the 10 replay calls + 1,000 mixed synthetic calls within p50 < 10 ms and p99 < 50 ms in-process", () => {
    const payloads: string[] = [];
    for (const pair of REPLAY_2026_11_08_FIXTURE) {
      payloads.push(JSON.stringify(pair.blockedStdin));
      payloads.push(JSON.stringify(pair.allowedStdin));
    }

    const syntheticTemplates: Record<string, unknown>[] = [
      {
        hook_event_name: "PreToolUse",
        session_id: "bench-session",
        cwd: "E:/AI/Research and Development",
        tool_name: "Read",
        tool_input: { file_path: "E:/AI/Research and Development/README.md" },
      },
      {
        hook_event_name: "PreToolUse",
        session_id: "bench-session",
        cwd: "E:/AI/Research and Development",
        tool_name: "Grep",
        tool_input: { pattern: "loadout_skill", path: "packages" },
      },
      {
        hook_event_name: "PreToolUse",
        session_id: "bench-session",
        cwd: "E:/AI/Research and Development",
        tool_name: "Bash",
        tool_input: { command: "git status && git diff --stat | head -n 20" },
      },
      {
        hook_event_name: "PreToolUse",
        session_id: "bench-session",
        cwd: "E:/AI/Research and Development",
        tool_name: "Write",
        tool_input: {
          file_path: "E:/AI/Research and Development/notes/design.md",
          content:
            "# Design Notes\n\n**Last updated:** 2026-11-08 15:40 ET\n\nParaphrased summary of project architecture rules.\n",
        },
      },
      {
        hook_event_name: "PreToolUse",
        session_id: "bench-session",
        cwd: "E:/AI/Research and Development",
        tool_name: "Edit",
        tool_input: {
          file_path: `${REPLAY_2026_11_08_STORE}/BOARD.md`,
          old_string: "**Last updated:** 2026-11-08 15:00 ET",
          new_string: "**Last updated:** 2026-11-08 15:44 ET",
        },
      },
      {
        hook_event_name: "PreToolUse",
        session_id: "bench-session",
        cwd: "E:/AI/Research and Development",
        tool_name: "Bash",
        tool_input: { command: "gh pr merge 21 --squash" },
      },
      {
        hook_event_name: "PreToolUse",
        session_id: "bench-session",
        cwd: "E:/AI/ReleaseRepo",
        tool_name: "Bash",
        tool_input: { command: "npm publish --access public" },
      },
      {
        hook_event_name: "PreToolUse",
        session_id: "bench-session",
        cwd: "E:/AI/Research and Development",
        tool_name: "Write",
        tool_input: {
          file_path: "E:/AI/Research and Development/docs/post.md",
          content: `${LEGACY_ROLE_SPEAKER} 2026-11-08: "We always verify the build before opening a pull request."\n`,
        },
      },
      {
        hook_event_name: "PreToolUse",
        session_id: "bench-session",
        cwd: "E:/AI/Research and Development",
        tool_name: "Bash",
        tool_input: {
          command: `echo "overwrite" > "${REPLAY_2026_11_08_STORE}/BOARD.md"`,
        },
      },
      {
        hook_event_name: "PreToolUse",
        session_id: "bench-session",
        cwd: "E:/AI/Research and Development",
        tool_name: "Edit",
        tool_input: {
          file_path: `${REPLAY_2026_11_08_STORE}/BOARD.md`,
          old_string: "**Last updated:** 2026-11-08 15:00 ET",
          new_string: "**Last updated:** 2026-11-08 18:30 ET",
        },
      },
    ];

    for (let i = 0; i < 1000; i++) {
      const tpl = syntheticTemplates[i % syntheticTemplates.length]!;
      payloads.push(JSON.stringify({ ...tpl, call_seq: i }));
    }

    assert.equal(payloads.length, 1010);

    const wallTimesMs: number[] = [];
    for (const stdinJson of payloads) {
      const t0 = performance.now();
      runPreTool({
        stdinJson,
        profilesPath,
        logPath,
        nowMs: REPLAY_2026_11_08_CLOCK_MS,
      });
      const elapsed = performance.now() - t0;
      wallTimesMs.push(elapsed);
    }

    wallTimesMs.sort((a, b) => a - b);
    const p50 = wallTimesMs[Math.floor(wallTimesMs.length * 0.5)]!;
    const p95 = wallTimesMs[Math.floor(wallTimesMs.length * 0.95)]!;
    const p99 = wallTimesMs[Math.floor(wallTimesMs.length * 0.99)]!;

    console.log(
      `[benchmark] 1,010 synthetic calls covering all 5 rules: p50=${p50.toFixed(2)}ms, p95=${p95.toFixed(2)}ms, p99=${p99.toFixed(2)}ms`,
    );

    assert.ok(p50 < 10, `Expected in-process p50 < 10 ms, got ${p50.toFixed(3)} ms`);
    assert.ok(p95 < 10, `Expected in-process p95 < 10 ms, got ${p95.toFixed(3)} ms`);
    assert.ok(p99 <= 10, `Expected in-process p99 <= 10 ms (design line), got ${p99.toFixed(3)} ms`);
  });
});

// ════════════════════════════════════════════════════════════════
// Part 6: Issue #25 (all 15 items P1.1–P4.15) & Ruling 1/2/3 tests
// ════════════════════════════════════════════════════════════════

import { resolveRuleMemory } from "../pretool.js";

describe("Part 6: Issue #25 (P1.1–P4.15) and log-only rulings", () => {
  let tempDir: string;
  let profilesPath: string;
  let logPath: string;
  let storeDir: string;
  const fixedClockMs = Date.UTC(2026, 10, 8, 20, 44, 0, 0); // 2026-11-08 15:44 ET

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "loadout-pretool-25-"));
    profilesPath = join(tempDir, "profiles.json");
    logPath = join(tempDir, "hook-decisions.jsonl");
    storeDir = join(tempDir, "store", "memory");
    mkdirSync(storeDir, { recursive: true });

    writeFileSync(
      profilesPath,
      JSON.stringify(
        {
          profiles: {
            "E:/AI/Research and Development": {
              profile: "docs",
              store: storeDir,
              worktrees: ["E:/AI/_worktrees/loadout-os-25-pr1"],
            },
            "E:/AI/ReleaseRepo": {
              profile: "release",
              store: "E:/AI/ReleaseStore/memory",
              prefixes: ["E:/AI/_worktrees/release-pr"],
            },
          },
        },
        null,
        2,
      ),
      "utf-8",
    );
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("P1.1: disables read-only pass-through on `git -c <key>=<val>` and leading env assignments (`GIT_EXTERNAL_DIFF=...`, `LESSOPEN=...`)", () => {
    const bypassed = [
      "git -c core.fsmonitor=evil status",
      "git -c diff.external=evil diff",
      "git -c core.pager=evil log -n 1",
      "GIT_EXTERNAL_DIFF=evil git diff",
      "GIT_PAGER=evil git log -1",
      "LESSOPEN='|evil %s' head -n 5 README.md",
      "FOO=bar ls",
    ];
    for (const cmd of bypassed) {
      const parsed = parseBashCommand(cmd);
      assert.equal(
        isBashCommandReadOnly(parsed),
        false,
        `Expected read-only pass-through disabled for: ${cmd}`,
      );
      const res = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: cmd },
          cwd: "E:/AI/Research and Development",
        }),
        profilesPath,
        logPath,
      });
      assert.equal(res.passThrough, false, `Expected passThrough=false for: ${cmd}`);
    }
  });

  it("P1.2: resolves worktree and extra prefix roots per profile from profiles.json (`worktrees` / `prefixes`)", () => {
    const cfg = loadProfileConfig(profilesPath);
    assert.equal(resolveProfile("E:/AI/_worktrees/loadout-os-25-pr1/packages/cli", cfg), "docs");
    assert.equal(resolveProfile("E:/AI/_worktrees/release-pr/src", cfg), "release");
  });

  it("P1.3: disables read-only pass-through on `sed -n` scripts containing the `w` or `W` write command", () => {
    for (const badSed of [
      "sed -n 'w /tmp/pwn' README.md",
      "sed -n '1,10w out.txt' README.md",
      "sed -n -e '1,5p' -e 'w leaked.txt' README.md",
      "sed -n 's/a/b/w out.txt' README.md",
    ]) {
      const parsed = parseBashCommand(badSed);
      assert.equal(
        isSegmentReadOnly(parsed.segments[0]!),
        false,
        `Expected sed -n write command rejected: ${badSed}`,
      );
    }
    // Pure print sed -n still passes
    const goodParsed = parseBashCommand("sed -n '1,20p' README.md");
    assert.equal(isSegmentReadOnly(goodParsed.segments[0]!), true);
  });

  it("P2.4: blocks PowerShell (`pwsh -c`, `powershell -Command`), subshell (`bash -c`, `sh -c`), `env`/`command`/`xargs` wrappers, and `find <store> -delete|-exec`", () => {
    const target = `${storeDir.replace(/\\/g, "/")}/BOARD.md`;
    const storeSlash = storeDir.replace(/\\/g, "/");
    const commands = [
      `pwsh -Command "Set-Content -Path '${target}' -Value 'x'"`,
      `powershell -c "Out-File -FilePath '${target}'"`,
      `bash -c "rm -f '${target}'"`,
      `sh -c "cp /tmp/a '${target}'"`,
      `env rm -f "${target}"`,
      `command rm -f "${target}"`,
      `echo "${target}" | xargs rm`,
      `find "${storeSlash}" -name "*.md" -delete`,
      `find "${storeSlash}" -name "*.md" -exec rm {} ;`,
    ];

    for (const command of commands) {
      const res = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command },
          cwd: "E:/AI/Research and Development",
        }),
        profilesPath,
        logPath,
      });
      assert.equal(res.exitCode, 2, `Expected P2.4 block for: ${command}`);
      assert.ok(res.logEntry?.matched.some((m) => m.id === "memory-shell-write"));
    }
  });

  it("P2.5: blocks expanded Python/Node file-write APIs (`shutil.copy|move`, `os.replace|remove|rename`, `Path.unlink|rename|write_bytes`, `fs.unlinkSync|copyFileSync|renameSync`, nested `open(..., 'w')`, and script file arguments)", () => {
    const target = `${storeDir.replace(/\\/g, "/")}/BOARD.md`;
    const commands = [
      `python -c "import shutil; shutil.copy('a.md', '${target}')"`,
      `python -c "import shutil; shutil.move('a.md', '${target}')"`,
      `python -c "import os; os.replace('a.md', '${target}')"`,
      `python -c "import os; os.remove('${target}')"`,
      `python -c "from pathlib import Path; Path('${target}').unlink()"`,
      `python -c "from pathlib import Path; Path('${target}').write_bytes(b'hi')"`,
      `python -c "f = open(str('${target}'), 'w'); f.write('x')"`,
      `node -e "fs.unlinkSync('${target}')"`,
      `node -e "fs.copyFileSync('a.md', '${target}')"`,
      `node -e "fs.renameSync('a.md', '${target}')"`,
      `python scripts/mutate.py "${target}"`,
    ];

    for (const command of commands) {
      const res = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command },
          cwd: "E:/AI/Research and Development",
        }),
        profilesPath,
        logPath,
      });
      assert.equal(res.exitCode, 2, `Expected P2.5 block for: ${command}`);
      assert.ok(res.logEntry?.matched.some((m) => m.id === "memory-shell-write"));
    }
  });

  it("P2.6: blocks relative paths after `cd <store>` and when `cwd` is already inside a memory store", () => {
    const storeSlash = storeDir.replace(/\\/g, "/");

    // 1. `cd <store> && echo x > BOARD.md` and `cd <store> && rm BOARD.md`
    for (const cmd of [
      `cd "${storeSlash}" && echo x > BOARD.md`,
      `cd "${storeSlash}" && rm -f BOARD.md`,
      `pushd "${storeSlash}" && sed -i 's/a/b/' MEMORY.md`,
      `cd "${storeSlash}" && python -c "open('BOARD.md', 'w').write('x')"`,
    ]) {
      const res = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: cmd },
          cwd: "E:/AI/Research and Development",
        }),
        profilesPath,
        logPath,
      });
      assert.equal(res.exitCode, 2, `Expected P2.6 block after cd <store> for: ${cmd}`);
      assert.ok(res.logEntry?.matched.some((m) => m.id === "memory-shell-write"));
    }

    // 2. When `cwd` itself is inside the store
    for (const cmd of [
      "echo x > BOARD.md",
      "rm MEMORY.md",
      "cp /tmp/draft.md ./topic.md",
    ]) {
      const res = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: cmd },
          cwd: storeSlash,
        }),
        profilesPath,
        logPath,
      });
      assert.equal(res.exitCode, 2, `Expected P2.6 block when cwd is inside store for: ${cmd}`);
      assert.ok(res.logEntry?.matched.some((m) => m.id === "memory-shell-write"));
    }
  });

  it("P2.7: blocks `git -C <store> restore|switch|apply|am|cherry-pick|pull`", () => {
    const storeSlash = storeDir.replace(/\\/g, "/");
    for (const sub of ["restore", "switch", "apply", "am", "cherry-pick", "pull"]) {
      const cmd = `git -C "${storeSlash}" ${sub} .`;
      const res = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: cmd },
          cwd: "E:/AI/Research and Development",
        }),
        profilesPath,
        logPath,
      });
      assert.equal(res.exitCode, 2, `Expected P2.7 block for: ${cmd}`);
      assert.ok(res.logEntry?.matched.some((m) => m.id === "memory-shell-write"));
    }
  });

  it("P2.8: normalizes `%USERPROFILE%`, `$USERPROFILE`, `$HOME`, quoted `~`, and doubled backslashes `\\\\` on store paths", () => {
    // Configure a custom store under ~/custom-profile-store/memory (no .claude/projects fragment)
    // so each test strictly depends on its corresponding path normalization step.
    const customProfilesPath = join(tempDir, "profiles-p28.json");
    writeFileSync(
      customProfilesPath,
      JSON.stringify({
        stores: [storeDir],
        profiles: {
          "E:/AI/Research and Development": {
            profile: "docs",
            store: "~/custom-profile-store/memory",
          },
        },
      }),
      "utf-8",
    );
    assert.equal(
      normalizePreToolPath("E:\\\\AI\\\\Research and Development"),
      "e:/ai/research and development",
    );
    const commands = [
      'rm "%USERPROFILE%/custom-profile-store/memory/BOARD.md"',
      'rm "$HOME/custom-profile-store/memory/BOARD.md"',
      'rm "$USERPROFILE/custom-profile-store/memory/BOARD.md"',
      'rm "~/custom-profile-store/memory/BOARD.md"',
      'python -c "open(\'%USERPROFILE%/custom-profile-store/memory/BOARD.md\', \'w\').write(\'x\')"',
      `rm "${storeDir.replace(/[\\/]+/g, "\\\\")}\\\\BOARD.md"`,
    ];
    for (const command of commands) {
      const res = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command },
          cwd: "E:\\\\AI\\\\Research and Development",
        }),
        profilesPath: customProfilesPath,
        logPath,
      });
      assert.equal(res.exitCode, 2, `Expected P2.8 block for: ${command}`);
      assert.equal(res.logEntry?.profile, "docs");
      assert.ok(res.logEntry?.matched.some((m) => m.id === "memory-shell-write"));
    }
  });

  it("P2.9: allows `sed -i` on a non-store file even when the sed expression mentions a memory store path", () => {
    const storeSlash = storeDir.replace(/\\/g, "/");
    for (const cmd of [
      `sed -i "s|${storeSlash}|/new/path|g" README.md`,
      `sed -i "1,10s|${storeSlash}|/new/path|g" README.md`,
      `sed -i -e "1d" "s|${storeSlash}|/new/path|g"`,
      'sed -i "s|~/.claude/projects/my-project/memory/BOARD.md|/new/path|g" README.md',
      'sed -i "1,10s|~/.claude/projects/my-project/memory/BOARD.md|/new/path|g" README.md',
    ]) {
      const res = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: cmd },
          cwd: "E:/AI/Research and Development",
        }),
        profilesPath,
        logPath,
      });
      assert.equal(res.exitCode, 0, `sed -i on non-store file should be allowed: ${cmd}`);
      assert.equal(res.outcome, "allow");
    }
  });

  it("P3.10: blocks an Edit that replaces only the time substring (`old_string: '15:03 ET'` -> `new_string: '23:59 ET'`) by reconstructing the edited line from the file on disk", () => {
    const boardPath = join(storeDir, "BOARD.md");
    writeFileSync(
      boardPath,
      "# Project Board\n\n**Last updated:** 2026-11-08 15:03 ET (clock-checked).\n",
      "utf-8",
    );

    // Substring edit to future time 23:59 ET -> blocked!
    const blockRes = runPreTool({
      stdinJson: JSON.stringify({
        tool_name: "Edit",
        tool_input: {
          file_path: boardPath,
          old_string: "15:03 ET",
          new_string: "23:59 ET",
        },
        cwd: "E:/AI/Research and Development",
      }),
      profilesPath,
      logPath,
      nowMs: fixedClockMs,
    });
    assert.equal(blockRes.exitCode, 2, "Substring edit to future time must be blocked");
    assert.equal(blockRes.outcome, "block");
    assert.ok(blockRes.logEntry?.matched.some((m) => m.id === "future-stamp"));

    // Substring edit to current time 15:44 ET -> allowed!
    const allowRes = runPreTool({
      stdinJson: JSON.stringify({
        tool_name: "Edit",
        tool_input: {
          file_path: boardPath,
          old_string: "15:03 ET",
          new_string: "15:44 ET",
        },
        cwd: "E:/AI/Research and Development",
      }),
      profilesPath,
      logPath,
      nowMs: fixedClockMs,
    });
    assert.equal(allowRes.exitCode, 0, "Substring edit to current time must be allowed");
    assert.equal(allowRes.outcome, "allow");
  });

  it("P3.11 & P3.12 & P3.13: handles non-bold `Last updated:`, time-only `~HH:MM` without zone, heading `updated 2026-12-01 schedule` (no time -> allowed), and midnight wrap (`~23:58 ET` at `00:02 ET`)", () => {
    const boardPath = join(storeDir, "BOARD.md");

    // P3.11: non-bold `Last updated: 2026-11-08 23:59 ET` and time-only `~19:30` without zone -> blocked
    for (const line of [
      "Last updated: 2026-11-08 23:59 ET",
      "**Last updated:** ~19:30",
    ]) {
      const res = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Edit",
          tool_input: {
            file_path: boardPath,
            old_string: "old",
            new_string: line,
          },
          cwd: "E:/AI/Research and Development",
        }),
        profilesPath,
        logPath,
        nowMs: fixedClockMs,
      });
      assert.equal(res.exitCode, 2, `Expected P3.11 block for: ${line}`);
    }

    // P3.12: `### Milestones — updated 2026-12-01 schedule` (no time component on heading) -> allowed
    const headingDateOnlyRes = runPreTool({
      stdinJson: JSON.stringify({
        tool_name: "Edit",
        tool_input: {
          file_path: boardPath,
          old_string: "old",
          new_string: "### Milestones — updated 2026-12-01 schedule",
        },
        cwd: "E:/AI/Research and Development",
      }),
      profilesPath,
      logPath,
      nowMs: fixedClockMs,
    });
    assert.equal(headingDateOnlyRes.exitCode, 0);
    assert.equal(headingDateOnlyRes.outcome, "allow");

    // P3.13: Same-day bare date `created_at: 2026-11-08` at 15:44 ET -> allowed; `created_at: 2026-11-09` -> blocked
    const sameDayBareRes = runPreTool({
      stdinJson: JSON.stringify({
        tool_name: "Write",
        tool_input: {
          file_path: boardPath,
          content: "---\ncreated_at: 2026-11-08\n---\n# Board\n",
        },
        cwd: "E:/AI/Research and Development",
      }),
      profilesPath,
      logPath,
      nowMs: fixedClockMs,
    });
    assert.equal(sameDayBareRes.exitCode, 0, "Same-day bare date must be allowed");

    // P3.13: Midnight wrap (`~23:58 ET` when clock is `00:02 ET` on 2026-11-09 = 05:02 UTC) -> allowed (yesterday's 23:58 ET, 4 min ago)
    const clock0002NextDayMs = Date.UTC(2026, 10, 9, 5, 2, 0, 0);
    const midnightWrapRes = runPreTool({
      stdinJson: JSON.stringify({
        tool_name: "Edit",
        tool_input: {
          file_path: boardPath,
          old_string: "old",
          new_string: "**Last updated:** ~23:58 ET",
        },
        cwd: "E:/AI/Research and Development",
      }),
      profilesPath,
      logPath,
      nowMs: clock0002NextDayMs,
    });
    assert.equal(midnightWrapRes.exitCode, 0, "Midnight wrap ~23:58 ET at 00:02 ET must pass");
  });

  it("Ruling 1: resolves per-profile memory IDs, skills, notes, ruleAliases, and decision-log remapping from profiles.json", () => {
    const ruling1Profiles = join(tempDir, "ruling1-profiles.json");
    writeFileSync(
      ruling1Profiles,
      JSON.stringify({
        profiles: {
          "E:/AI/Research and Development": { profile: "docs", store: storeDir },
          "E:/AI/ReleaseRepo": { profile: "release", store: "E:/AI/ReleaseStore/memory" },
        },
        rules: {
          "unreviewed-merge": {
            memory: { docs: "docs-merge-policy", release: "release-merge-policy" },
            note: {
              docs: "Docs profile: route reviewed PRs to release maintainers.",
              release: "Release profile: confirm required checks and ledger entry.",
            },
          },
          "quote-gate": {
            memory: { default: "default-quote-policy" },
          },
          "release-reminder": {
            skill: "release-checklist",
            note: { release: "Run release checklist before publishing." },
          },
        },
      }),
      "utf-8",
    );
    const cfg = loadProfileConfig(ruling1Profiles);

    assert.deepEqual(
      PRETOOL_RULES.map((r) => r.id).sort(),
      ["future-stamp", "memory-shell-write", "quote-gate", "release-reminder", "unreviewed-merge"],
    );

    // Without config, memory ids are empty and formatMemorySuffix omits "(memory: ...)"
    for (const rule of PRETOOL_RULES) {
      assert.equal(resolveRuleMemory(rule, "default"), "");
      assert.equal(resolveRuleMemory(rule, "docs"), "");
      assert.equal(resolveRuleSkill(rule), "none");
      assert.equal(formatMemorySuffix(""), "");
    }

    // With profiles.json, configured per-profile memory ids, skills, notes, and aliases resolve
    assert.equal(resolveRuleMemory(PRETOOL_RULES[0]!, "docs", cfg), "docs-merge-policy");
    assert.equal(resolveRuleMemory(PRETOOL_RULES[0]!, "release", cfg), "release-merge-policy");
    assert.equal(resolveRuleMemory(PRETOOL_RULES[1]!, "default", cfg), "default-quote-policy");
    assert.equal(resolveRuleSkill(PRETOOL_RULES[4]!, cfg), "release-checklist");
    assert.equal(
      resolveRuleNote(PRETOOL_RULES[4]!, "release", cfg),
      "Run release checklist before publishing.",
    );

    // Alias in rules override maps old id -> new id, and canonical key wins over alias in either order
    const aliasedProfiles = join(tempDir, "aliased-profiles.json");
    writeFileSync(
      aliasedProfiles,
      JSON.stringify({
        ruleAliases: { "old-quote-id": "quote-gate" },
        rules: {
          "old-quote-id": {
            action: { docs: "warn", default: "warn" },
            memory: { docs: "aliased-quote-mem", default: "fallback-quote-mem" },
            note: { docs: "Note via alias.", default: "Default note." },
          },
          "quote-gate": {
            action: { docs: "block" },
          },
          "future-stamp": {
            action: { default: "warn" },
            memory: { default: "default-stamp-mem" },
          },
          "unreviewed-merge": {
            note: { docs: "Only docs note" },
          },
          "memory-shell-write": {
            action: { release: "off" },
          },
        },
      }),
      "utf-8",
    );
    const aliasedCfg = loadProfileConfig(aliasedProfiles);
    assert.equal(resolveRuleAction(PRETOOL_RULES[1]!, "docs", aliasedCfg), "block");
    assert.equal(resolveRuleAction(PRETOOL_RULES[1]!, "release", aliasedCfg), "warn");
    assert.equal(resolveRuleMemory(PRETOOL_RULES[1]!, "docs", aliasedCfg), "aliased-quote-mem");
    assert.equal(resolveRuleMemory(PRETOOL_RULES[1]!, "release", aliasedCfg), "fallback-quote-mem");
    assert.equal(resolveRuleMemory(PRETOOL_RULES[3]!, "release", aliasedCfg), "default-stamp-mem");
    assert.equal(
      resolveRuleMemory({ ...PRETOOL_RULES[0]!, memory: "string-mem-id" }, "docs"),
      "string-mem-id",
    );
    assert.equal(
      resolveRuleMemory({ ...PRETOOL_RULES[0]!, memory: { docs: "inline-docs-mem" } }, "docs"),
      "inline-docs-mem",
    );
    assert.equal(resolveRuleNote(PRETOOL_RULES[1]!, "docs", aliasedCfg), "Note via alias.");
    assert.equal(resolveRuleNote(PRETOOL_RULES[1]!, "release", aliasedCfg), "Default note.");

    // Canonical key listed BEFORE alias still wins
    const reverseOrderProfiles = join(tempDir, "reverse-order-profiles.json");
    writeFileSync(
      reverseOrderProfiles,
      JSON.stringify({
        ruleAliases: { "old-quote-id": "quote-gate" },
        rules: {
          "quote-gate": { action: { docs: "block" }, skill: "canonical-skill" },
          "old-quote-id": { action: { docs: "warn" }, skill: "alias-skill" },
        },
      }),
      "utf-8",
    );
    const revCfg = loadProfileConfig(reverseOrderProfiles);
    assert.equal(resolveRuleAction(PRETOOL_RULES[1]!, "docs", revCfg), "block");
    assert.equal(resolveRuleSkill(PRETOOL_RULES[1]!, revCfg), "canonical-skill");

    // readDecisionLog remaps old rule ids in evaluated, matched, and rule_error notes
    const legacyLog = join(tempDir, "legacy-decisions.jsonl");
    writeFileSync(
      legacyLog,
      [
        JSON.stringify({
          ts: "2026-11-08T20:00:00.000Z",
          profile: "docs",
          session: "s1",
          tool: "Write",
          mode: "enforce",
          evaluated: ["old-quote-id", "future-stamp"],
          matched: [{ id: "old-quote-id", layer: "A", action: "block" }],
          outcome: "block",
          latency_ms: 1.2,
          input_hash: "0".repeat(64),
          notes: ["rule_error:old-quote-id", "config_warning:extra"],
        }),
        "{ malformed line",
        "",
      ].join("\n"),
      "utf-8",
    );
    const entries = readDecisionLog(legacyLog, { profilesPath: aliasedProfiles });
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0]!.evaluated, ["quote-gate", "future-stamp"]);
    assert.deepEqual(entries[0]!.matched, [{ id: "quote-gate", layer: "A", action: "block" }]);
    assert.deepEqual(entries[0]!.notes, ["rule_error:quote-gate", "config_warning:extra"]);
  });

  it("covers additional sed write patterns, wrapper flags (`nice`, `nohup`, `time`, `env -u`, `xargs -I`), `cp -t`/`--target-directory=`, `dd of=`, `MultiEdit` disk reconstruction, and `=sha` merge flags", () => {
    const target = `${storeDir.replace(/\\/g, "/")}/BOARD.md`;
    const storeSlash = storeDir.replace(/\\/g, "/");
    const repliesDir = join(tempDir, "replies");
    mkdirSync(repliesDir, { recursive: true });
    writeFileSync(
      join(repliesDir, "review.md"),
      "LOADOUT-OS #24 REVIEW: PASS at d4ddd0e4\n",
      "utf-8",
    );

    // 1. Additional sed -n write patterns (`s/a\/b/c/gw out.txt`, `/pat/w out.txt`)
    for (const sedCmd of [
      "sed -n 's/a\\/b/c/gw out.txt' README.md",
      "sed -n '/pattern/w out.txt' README.md",
      "sed -n --expression='w out.txt' README.md",
      "sed -n -ew\\ out.txt README.md",
    ]) {
      const p = parseBashCommand(sedCmd);
      assert.equal(isSegmentReadOnly(p.segments[0]!), false);
    }

    // 2. Wrapper flags (`nice -n 5`, `nohup`, `time`, `env -u FOO BAR=1`, `xargs -I {}`) + `cp -t` / `--target-directory=` / `dd` / `sed w <store>`
    for (const cmd of [
      `nice -n 5 rm -f "${target}"`,
      `nohup rm -f "${target}"`,
      `time -p rm -f "${target}"`,
      `env -u FOO BAR=1 rm -f "${target}"`,
      `echo "${target}" | xargs -I {} rm -f "${target}"`,
      `cp -t "${storeSlash}" README.md`,
      `cp --target-directory="${storeSlash}" README.md`,
      `dd if=/dev/zero of="${target}" count=1`,
      `sed -n 'w ${target}' README.md`,
    ]) {
      const res = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: cmd },
          cwd: "E:/AI/Research and Development",
        }),
        profilesPath,
        logPath,
      });
      assert.equal(res.exitCode, 2, `Expected block for: ${cmd}`);
    }

    // 3. `MultiEdit` disk reconstruction
    writeFileSync(target, "# Board\n\n**Last updated:** 2026-11-08 15:03 ET\n", "utf-8");
    const multiRes = runPreTool({
      stdinJson: JSON.stringify({
        tool_name: "MultiEdit",
        tool_input: {
          file_path: target,
          edits: [{ old_string: "15:03 ET", new_string: "23:59 ET" }],
        },
        cwd: "E:/AI/Research and Development",
      }),
      profilesPath,
      logPath,
      nowMs: fixedClockMs,
    });
    assert.equal(multiRes.exitCode, 2);

    // 4. `=sha` merge flags (`--match-head-commit=d4ddd0e4`, `gatemerge.sh --head=d4ddd0e4`, `gatemerge.sh --head d4ddd0e4`)
    for (const mergeCmd of [
      "gh pr merge 24 -R mcp-tool-shop-org/loadout-os --squash --match-head-commit=d4ddd0e4",
      "bash scripts/gatemerge.sh mcp-tool-shop-org/loadout-os 24 --head=d4ddd0e4",
      "bash scripts/gatemerge.sh mcp-tool-shop-org/loadout-os 24 --head d4ddd0e4",
    ]) {
      const mRes = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: mergeCmd },
          cwd: "E:/AI/ReleaseRepo",
        }),
        profilesPath,
        logPath,
        repliesDir,
      });
      assert.equal(mRes.outcome, "allow", `Expected PASS at d4ddd0e4 suppression for: ${mergeCmd}`);
    }
  });
});

// ════════════════════════════════════════════════════════════════
// Part 7: PR #26 Fix 1 — rig-path default removal, 7 FP fixes + 7 TP guards,
//         hasReviewPassAtHead repo/PR scoping, and doctor --profiles help
// ════════════════════════════════════════════════════════════════

import * as pretoolModule from "../pretool.js";
import * as pretoolRulesModule from "../pretool-rules.js";
import * as helpModule from "../help.js";
import { defaultRepliesDir } from "../pretool.js";
import { hasReviewPassAtHead } from "../pretool-rules.js";
import { COMMAND_HELP, renderCommandHelp } from "../help.js";

describe("Part 7: PR #26 Fix 1 — shipped defaults, false-positive fixes, and review-pass scoping", () => {
  let tempDir: string;
  let profilesPath: string;
  let logPath: string;
  let storeDir: string;
  const fixedClockMs = Date.UTC(2026, 10, 8, 20, 44, 0, 0); // 2026-11-08 15:44 ET

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "loadout-pretool-fix1-"));
    profilesPath = join(tempDir, "profiles.json");
    logPath = join(tempDir, "hook-decisions.jsonl");
    storeDir = join(tempDir, "store", "memory");
    mkdirSync(storeDir, { recursive: true });

    writeFileSync(
      profilesPath,
      JSON.stringify(
        {
          profiles: {
            "E:/AI/Research and Development": {
              profile: "docs",
              store: storeDir,
            },
            "E:/AI/ReleaseRepo": {
              profile: "release",
              store: "E:/AI/ReleaseStore/memory",
            },
          },
        },
        null,
        2,
      ),
      "utf-8",
    );
  });

  afterEach(() => {
    delete process.env.AI_LOADOUT_REPLIES_DIR;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("Ask 1: no shipped default (exported constant, default argument, or help text) holds a rig path, user account, or drive letter, and suppression is off when unset", () => {
    delete process.env.AI_LOADOUT_REPLIES_DIR;

    // 1. defaultRepliesDir() returns undefined when AI_LOADOUT_REPLIES_DIR is not set
    assert.equal(defaultRepliesDir(), undefined);
    assert.equal("DEFAULT_REPLIES_DIR" in pretoolModule, false);

    // 2. Inspect all exported string/object constants across pretool, pretool-rules, and help
    const accountNeedle = ["mi", "key"].join("");
    const localNeedle = ["rn", "d-local"].join("");
    const forbiddenRigPattern = new RegExp(
      `e:\\/ai|e:\\\\ai|${localNeedle}|antigravity|${accountNeedle}|\\b[a-zA-Z]:[\\\\/]`,
      "i",
    );
    for (const [modName, mod] of [
      ["pretool", pretoolModule],
      ["pretool-rules", pretoolRulesModule],
      ["help", helpModule],
    ] as const) {
      for (const [key, val] of Object.entries(mod)) {
        if (typeof val === "function") continue;
        const serialized = JSON.stringify(val) ?? "";
        assert.equal(
          forbiddenRigPattern.test(serialized),
          false,
          `Export ${modName}.${key} must not contain a rig path or drive letter: ${serialized}`,
        );
      }
    }

    // 3. Help text (every command's --help) contains no rig path or drive letter
    for (const cmd of Object.keys(COMMAND_HELP)) {
      const rendered = renderCommandHelp(cmd) ?? "";
      assert.equal(
        forbiddenRigPattern.test(rendered),
        false,
        `Help for '${cmd}' must not contain a rig path or drive letter`,
      );
    }

    // 4. With neither profiles.json repliesDir nor AI_LOADOUT_REPLIES_DIR set, unreviewed-merge suppression is off
    const res = runPreTool({
      stdinJson: JSON.stringify({
        tool_name: "Bash",
        tool_input: {
          command:
            "gh pr merge 24 -R mcp-tool-shop-org/loadout-os --squash --match-head-commit eb90790a",
        },
        cwd: "E:/AI/ReleaseRepo",
      }),
      profilesPath,
      logPath,
    });
    assert.equal(res.outcome, "warn");
  });

  it("Ask 2 (FP-MSW-1): allows inline python/node/heredoc reading from a memory store and writing to a non-store path, while blocking inline scripts that write to a memory store", () => {
    const storeSlash = storeDir.replace(/\\/g, "/");
    const outSlash = join(tempDir, "report.txt").replace(/\\/g, "/");

    // False-positive shape: read from store, write to /tmp/report.txt -> allow
    for (const allowCmd of [
      `python -c "data = open('${storeSlash}/MEMORY.md').read(); open('${outSlash}', 'w').write(data)"`,
      `node -e "const fs=require('fs'); const d=fs.readFileSync('${storeSlash}/MEMORY.md','utf8'); fs.writeFileSync('${outSlash}', d)"`,
      `python - << 'EOF'\ndata = open('${storeSlash}/MEMORY.md').read()\nopen('${outSlash}', 'w').write(data)\nEOF`,
    ]) {
      const allowRes = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: allowCmd },
          cwd: "E:/AI/Research and Development",
        }),
        profilesPath,
        logPath,
      });
      assert.equal(allowRes.exitCode, 0, `Expected FP-MSW-1 allow for: ${allowCmd}`);
      assert.equal(allowRes.outcome, "allow");
    }

    // True-positive shape: inline script writing to store -> block
    for (const blockCmd of [
      `python -c "open('${storeSlash}/MEMORY.md', 'w').write('x')"`,
      `python -c "p='${storeSlash}/MEMORY.md'; open(p, 'w').write('x')"`,
      `node -e "require('fs').writeFileSync('${storeSlash}/MEMORY.md', 'x')"`,
      `python - << 'EOF'\nfrom pathlib import Path\nPath('${storeSlash}/MEMORY.md').write_text('x')\nEOF`,
    ]) {
      const blockRes = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: blockCmd },
          cwd: "E:/AI/Research and Development",
        }),
        profilesPath,
        logPath,
      });
      assert.equal(blockRes.exitCode, 2, `Expected FP-MSW-1 true-positive block for: ${blockCmd}`);
      assert.ok(blockRes.logEntry?.matched.some((m) => m.id === "memory-shell-write"));
    }
  });

  it("Ask 2 (FP-MSW-2): allows memory CLIs (`claude-memories`, `cli.js`) and read-only inspection scripts given a store argument, while blocking mutating script files", () => {
    const storeSlash = storeDir.replace(/\\/g, "/");
    const roScript = join(tempDir, "inspect_store.py");
    writeFileSync(
      roScript,
      "import sys, pathlib\np = pathlib.Path(sys.argv[1])\nprint(len(p.read_text().splitlines()))\n",
      "utf-8",
    );
    const rwScript = join(tempDir, "rewrite_store.py");
    writeFileSync(
      rwScript,
      "import sys, pathlib\np = pathlib.Path(sys.argv[1])\np.write_text('mutated')\n",
      "utf-8",
    );

    // False-positive shapes -> allow
    for (const allowCmd of [
      `claude-memories sync --apply --store "${storeSlash}/MEMORY.md"`,
      `node packages/cli/dist/cli.js split --store "${storeSlash}/MEMORY.md" --apply`,
      `python scripts/count_entries.py "${storeSlash}/MEMORY.md"`,
      `python "${roScript.replace(/\\/g, "/")}" "${storeSlash}/MEMORY.md"`,
      `python scripts/migrate.py --dry-run "${storeSlash}/MEMORY.md"`,
    ]) {
      const allowRes = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: allowCmd },
          cwd: "E:/AI/Research and Development",
        }),
        profilesPath,
        logPath,
      });
      assert.equal(allowRes.exitCode, 0, `Expected FP-MSW-2 allow for: ${allowCmd}`);
      assert.equal(allowRes.outcome, "allow");
    }

    // True-positive shapes -> block
    for (const blockCmd of [
      `python scripts/mutate.py "${storeSlash}/BOARD.md"`,
      `python "${rwScript.replace(/\\/g, "/")}" "${storeSlash}/BOARD.md"`,
    ]) {
      const blockRes = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: blockCmd },
          cwd: "E:/AI/Research and Development",
        }),
        profilesPath,
        logPath,
      });
      assert.equal(blockRes.exitCode, 2, `Expected FP-MSW-2 true-positive block for: ${blockCmd}`);
      assert.ok(blockRes.logEntry?.matched.some((m) => m.id === "memory-shell-write"));
    }
  });

  it("Ask 2 (FP-MSW-3): allows `pwsh -Command Copy-Item <store>/MEMORY.md <non-store>`, while blocking `Copy-Item` or `Set-Content` targeting a store", () => {
    const storeSlash = storeDir.replace(/\\/g, "/");
    const destSlash = join(tempDir, "MEMORY-copy.md").replace(/\\/g, "/");

    // False-positive shape: Copy-Item FROM store TO non-store -> allow
    for (const allowCmd of [
      `pwsh -Command "Copy-Item '${storeSlash}/MEMORY.md' '${destSlash}'"`,
      `pwsh -Command "Copy-Item -Path '${storeSlash}/MEMORY.md' -Destination '${destSlash}'"`,
    ]) {
      const allowRes = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: allowCmd },
          cwd: "E:/AI/Research and Development",
        }),
        profilesPath,
        logPath,
      });
      assert.equal(allowRes.exitCode, 0, `Expected FP-MSW-3 allow for: ${allowCmd}`);
      assert.equal(allowRes.outcome, "allow");
    }

    // True-positive shape: Copy-Item TO store or Set-Content on store -> block
    for (const blockCmd of [
      `pwsh -Command "Copy-Item '${destSlash}' '${storeSlash}/MEMORY.md'"`,
      `pwsh -Command "Copy-Item -Destination '${storeSlash}/MEMORY.md' -Path '${destSlash}'"`,
      `pwsh -Command "Set-Content -Path '${storeSlash}/MEMORY.md' -Value 'x'"`,
    ]) {
      const blockRes = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: blockCmd },
          cwd: "E:/AI/Research and Development",
        }),
        profilesPath,
        logPath,
      });
      assert.equal(blockRes.exitCode, 2, `Expected FP-MSW-3 true-positive block for: ${blockCmd}`);
      assert.ok(blockRes.logEntry?.matched.some((m) => m.id === "memory-shell-write"));
    }
  });

  it("Ask 2 (FP-MSW-4): tracks `pushd`/`popd` and `cd ~` so `pushd <store> && ls && popd && rm scratch.txt` is allowed while `pushd <store> && rm scratch.txt && popd` is blocked", () => {
    const storeSlash = storeDir.replace(/\\/g, "/");

    // False-positive shapes: popd or cd ~ returns to non-store cwd before rm -> allow
    for (const allowCmd of [
      `pushd "${storeSlash}" && ls && popd && rm scratch.txt`,
      `cd "${storeSlash}" && ls && cd ~ && rm scratch.txt`,
      `cd "${storeSlash}" && ls && cd - && rm scratch.txt`,
    ]) {
      const allowRes = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: allowCmd },
          cwd: "E:/AI/Research and Development",
        }),
        profilesPath,
        logPath,
      });
      assert.equal(allowRes.exitCode, 0, `Expected FP-MSW-4 allow for: ${allowCmd}`);
      assert.equal(allowRes.outcome, "allow");
    }

    // True-positive shape: rm while still inside pushd <store> -> block
    const blockCmd = `pushd "${storeSlash}" && rm scratch.txt && popd`;
    const blockRes = runPreTool({
      stdinJson: JSON.stringify({
        tool_name: "Bash",
        tool_input: { command: blockCmd },
        cwd: "E:/AI/Research and Development",
      }),
      profilesPath,
      logPath,
    });
    assert.equal(blockRes.exitCode, 2, "Expected FP-MSW-4 true-positive block while inside store");
    assert.ok(blockRes.logEntry?.matched.some((m) => m.id === "memory-shell-write"));
  });

  it("Ask 2 (FP-FS-1): allows earlier same-day time-only stamps (`~08:30 ET` edited at `21:30 ET`), while blocking genuinely future same-day stamps (`~22:30 ET` at `21:30 ET`)", () => {
    const boardPath = join(storeDir, "BOARD.md");
    const clock2130Ms = Date.UTC(2026, 10, 9, 2, 30, 0, 0); // 2026-11-08 21:30 ET (EST = UTC-5)

    // False-positive shape: ~08:30 ET edited at 21:30 ET on the same day -> allow
    const allowRes = runPreTool({
      stdinJson: JSON.stringify({
        tool_name: "Edit",
        tool_input: {
          file_path: boardPath,
          old_string: "old",
          new_string: "**Last updated:** ~08:30 ET",
        },
        cwd: "E:/AI/Research and Development",
      }),
      profilesPath,
      logPath,
      nowMs: clock2130Ms,
    });
    assert.equal(allowRes.exitCode, 0, "Earlier same-day ~08:30 ET at 21:30 ET must be allowed");
    assert.equal(allowRes.outcome, "allow");

    // True-positive shape: ~22:30 ET edited at 21:30 ET on the same day -> block
    const blockRes = runPreTool({
      stdinJson: JSON.stringify({
        tool_name: "Edit",
        tool_input: {
          file_path: boardPath,
          old_string: "old",
          new_string: "**Last updated:** ~22:30 ET",
        },
        cwd: "E:/AI/Research and Development",
      }),
      profilesPath,
      logPath,
      nowMs: clock2130Ms,
    });
    assert.equal(blockRes.exitCode, 2, "Future same-day ~22:30 ET at 21:30 ET must be blocked");
    assert.ok(blockRes.logEntry?.matched.some((m) => m.id === "future-stamp"));
  });

  it("Ask 2 (FP-FS-2): ignores `created_at:` / `modified:` / `verified_at:` inside fenced code blocks in memory files, while blocking future dates in real YAML frontmatter", () => {
    const memFile = join(storeDir, "Feedback", "example.md");

    // False-positive shape: fenced YAML example in body with future date -> allow
    const fencedBody = [
      "---",
      "created_at: 2026-11-08",
      "---",
      "# Schema Example",
      "",
      "```yaml",
      "created_at: 2099-01-01",
      "verified_at: 2099-12-31",
      "```",
      "",
    ].join("\n");
    const allowRes = runPreTool({
      stdinJson: JSON.stringify({
        tool_name: "Write",
        tool_input: { file_path: memFile, content: fencedBody },
        cwd: "E:/AI/Research and Development",
      }),
      profilesPath,
      logPath,
      nowMs: fixedClockMs,
    });
    assert.equal(allowRes.exitCode, 0, "Fenced code block example must not trigger future-stamp");
    assert.equal(allowRes.outcome, "allow");

    // True-positive shape: future date in actual YAML frontmatter -> block
    const futureFrontmatter = [
      "---",
      "created_at: 2099-01-01",
      "---",
      "# Real Entry",
      "",
    ].join("\n");
    const blockRes = runPreTool({
      stdinJson: JSON.stringify({
        tool_name: "Write",
        tool_input: { file_path: memFile, content: futureFrontmatter },
        cwd: "E:/AI/Research and Development",
      }),
      profilesPath,
      logPath,
      nowMs: fixedClockMs,
    });
    assert.equal(blockRes.exitCode, 2, "Future date in real YAML frontmatter must be blocked");
    assert.ok(blockRes.logEntry?.matched.some((m) => m.id === "future-stamp"));
  });

  it("Ask 2 (FP-FS-3): allows edits to non-store `*board.md` files (`docs/job-board.md`), while blocking future stamps on `<store>/BOARD.md`", () => {
    // False-positive shape: non-store docs/job-board.md with future date -> allow
    const allowRes = runPreTool({
      stdinJson: JSON.stringify({
        tool_name: "Write",
        tool_input: {
          file_path: "E:/AI/Research and Development/docs/job-board.md",
          content: "# Job Board\n\n**Last updated:** 2099-01-01 12:00 ET\n",
        },
        cwd: "E:/AI/Research and Development",
      }),
      profilesPath,
      logPath,
      nowMs: fixedClockMs,
    });
    assert.equal(allowRes.exitCode, 0, "Non-store docs/job-board.md must not trigger future-stamp");
    assert.equal(allowRes.outcome, "allow");

    // True-positive shape: <store>/BOARD.md with future date -> block
    const blockRes = runPreTool({
      stdinJson: JSON.stringify({
        tool_name: "Write",
        tool_input: {
          file_path: join(storeDir, "BOARD.md"),
          content: "# Project Board\n\n**Last updated:** 2099-01-01 12:00 ET\n",
        },
        cwd: "E:/AI/Research and Development",
      }),
      profilesPath,
      logPath,
      nowMs: fixedClockMs,
    });
    assert.equal(blockRes.exitCode, 2, "Store BOARD.md with future date must be blocked");
    assert.ok(blockRes.logEntry?.matched.some((m) => m.id === "future-stamp"));
  });

  it("Ask 4: `hasReviewPassAtHead` requires matching repo and PR number on line 1, and `doctor --help` documents `--profiles <p>`", () => {
    const repliesDir = join(tempDir, "replies");
    mkdirSync(repliesDir, { recursive: true });

    // 1. Reply for different PR number (#99) at same head -> does NOT suppress #24
    writeFileSync(
      join(repliesDir, "wrong-pr.md"),
      "LOADOUT-OS #99 REVIEW: PASS at eb90790a — all green\n",
      "utf-8",
    );
    assert.equal(
      hasReviewPassAtHead(repliesDir, "eb90790a", "mcp-tool-shop-org/loadout-os", "24"),
      false,
    );

    // 2. Reply for different repo (OTHER-REPO #24) at same head -> does NOT suppress loadout-os #24
    writeFileSync(
      join(repliesDir, "wrong-repo.md"),
      "OTHER-REPO #24 REVIEW: PASS at eb90790a — all green\n",
      "utf-8",
    );
    assert.equal(
      hasReviewPassAtHead(repliesDir, "eb90790a", "mcp-tool-shop-org/loadout-os", "24"),
      false,
    );

    // 3. Matching repo and PR number on line 1 -> suppresses warning
    writeFileSync(
      join(repliesDir, "matching.md"),
      "LOADOUT-OS #24 REVIEW: PASS at eb90790a — all green\n",
      "utf-8",
    );
    assert.equal(
      hasReviewPassAtHead(repliesDir, "eb90790a", "mcp-tool-shop-org/loadout-os", "24"),
      true,
    );

    // 4. doctor --help documents --profiles <p>
    const doctorHelp = renderCommandHelp("doctor") ?? "";
    assert.ok(
      doctorHelp.includes("--profiles <p>"),
      "doctor --help must document --profiles <p>",
    );
  });
});


