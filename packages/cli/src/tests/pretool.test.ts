/**
 * Tests for `loadout-os hook pre-tool` — Part 1 (hook entry, seat resolution,
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
  loadSeatConfig,
  resolveSeat,
  normalizePreToolPath,
  parseBashCommand,
  isSegmentReadOnly,
  isBashCommandReadOnly,
  isReadOnlyPassThrough,
  extractWritePayload,
  resolveRuleAction,
  capRuleMessage,
  hashToolInput,
  defaultSeatsPath,
  defaultDecisionLogPath, DEFAULT_PRETOOL_TIMEOUT_MS,
  type PreToolRule,
  type DecisionLogEntry,
} from "../pretool.js";
import { dispatch } from "../cli.js";

describe("Part 1: hook pre-tool entry, seat map, pass-through, rule table, decision log, modes", () => {
  let tempDir: string;
  let seatsPath: string;
  let logPath: string;
  let savedSeatsEnv: string | undefined;
  let savedLogEnv: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "loadout-pretool-p1-"));
    seatsPath = join(tempDir, "seats.json");
    logPath = join(tempDir, "hook-decisions.jsonl");
    savedSeatsEnv = process.env.AI_LOADOUT_SEATS_PATH;
    savedLogEnv = process.env.AI_LOADOUT_DECISIONS_LOG;

    writeFileSync(
      seatsPath,
      JSON.stringify(
        {
          "E:/AI/Research and Development": "rnd",
          "E:/AI/Publisher": "publisher",
          "E:/AI/Research and Development/nested/pub-sandbox": "publisher",
        },
        null,
        2,
      ),
      "utf-8",
    );
  });

  afterEach(() => {
    if (savedSeatsEnv === undefined) {
      delete process.env.AI_LOADOUT_SEATS_PATH;
    } else {
      process.env.AI_LOADOUT_SEATS_PATH = savedSeatsEnv;
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

  // ── 1.2 Seat resolution ───────────────────────────────────────
  describe("1.2 Seat resolution from seats.json", () => {
    it("resolves longest matching prefix of cwd (case- and slash-normalised on Windows)", () => {
      const cfg = loadSeatConfig(seatsPath);

      assert.equal(resolveSeat("E:/AI/Research and Development", cfg), "rnd");
      assert.equal(resolveSeat("e:\\ai\\research and development\\packages\\cli", cfg), "rnd");
      assert.equal(resolveSeat("/e/AI/Publisher/subproject", cfg), "publisher");
      assert.equal(resolveSeat("\\\\?\\E:\\AI\\Publisher\\repo\\", cfg), "publisher");
      // Longest prefix wins over shorter parent prefix
      assert.equal(
        resolveSeat("E:\\AI\\Research and Development\\nested\\pub-sandbox\\work", cfg),
        "publisher",
      );
      // Sibling prefix with shared string prefix must not match (boundary check)
      assert.equal(resolveSeat("E:/AI/Publisher-Extra", cfg), "default");
      // Unmatched path returns default
      assert.equal(resolveSeat("E:/AI/OtherRepo", cfg), "default");
      assert.equal(resolveSeat("", cfg), "default");
    });

    it("honours AI_LOADOUT_SEATS_PATH env override and nested seat objects with stores", () => {
      const customSeats = join(tempDir, "custom-seats.json");
      writeFileSync(
        customSeats,
        JSON.stringify({
          seats: {
            "E:/AI/CustomRnd": { seat: "rnd", store: "E:/AI/CustomRnd/memory" },
          },
          stores: ["E:/AI/SharedStore/memory"],
        }),
        "utf-8",
      );
      process.env.AI_LOADOUT_SEATS_PATH = customSeats;
      assert.equal(defaultSeatsPath(), customSeats);

      const cfg = loadSeatConfig();
      assert.equal(resolveSeat("e:\\ai\\customrnd\\src", cfg), "rnd");
      assert.deepEqual(cfg.storePaths, [
        "E:/AI/SharedStore/memory",
        "E:/AI/CustomRnd/memory",
      ]);
    });

    it("normalizes Windows drive paths, MSYS paths, and trailing slashes", () => {
      assert.equal(
        normalizePreToolPath("E:\\AI\\Research and Development\\"),
        "e:/ai/research and development",
      );
      assert.equal(
        normalizePreToolPath("/e/AI/Publisher/"),
        "e:/ai/publisher",
      );
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
          seatsPath,
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
          seatsPath,
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
  describe("1.4 Typed rule table, matcher inputs, per-seat action, <=5-line message cap", () => {
    it("delivers parsedCommand segments to Bash matchers and writePayload to Write/Edit/MultiEdit matchers", () => {
      let seenSegments: string[][] = [];
      let seenWriteTexts: string[] = [];

      const testRules: PreToolRule[] = [
        {
          id: "test-bash-rule",
          layer: "A",
          tools: ["Bash"],
          action: { default: "warn", rnd: "block", publisher: "off" },
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

      // R&D seat -> block, message capped at 5 lines
      const rndRes = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: "npm test && npm publish" },
          cwd: "E:/AI/Research and Development",
          session_id: "sess-rnd",
        }),
        seatsPath,
        logPath,
        rules: testRules,
      });
      assert.equal(rndRes.exitCode, 2);
      assert.equal(rndRes.outcome, "block");
      assert.deepEqual(seenSegments, [
        ["npm", "test"],
        ["npm", "publish"],
      ]);
      assert.equal(rndRes.stderr.trim().split("\n").length, 5);
      assert.equal(rndRes.stderr.includes("Line 6"), false);

      // Publisher seat -> action is "off", so rule is skipped and call is allowed
      const pubRes = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: "npm publish" },
          cwd: "E:/AI/Publisher",
          session_id: "sess-pub",
        }),
        seatsPath,
        logPath,
        rules: testRules,
      });
      assert.equal(pubRes.exitCode, 0);
      assert.equal(pubRes.outcome, "allow");

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
        seatsPath,
        logPath,
        rules: testRules,
      });
      assert.equal(writeRes.exitCode, 2);
      assert.equal(writeRes.outcome, "block");
      assert.equal(resolveRuleAction(testRules[0], "unknown-seat"), "warn");
      assert.equal(capRuleMessage("1\n2\n3\n4\n5\n6\n7").split("\n").length, 5);
    });
  });

  // ── 1.5 Decision log & privacy ────────────────────────────────
  describe("1.5 Append-only JSONL decision log and input hash privacy", () => {
    it("logs ts, seat, session, tool, evaluated, matched, outcome, latency_ms, input_hash and NEVER logs raw command or payload text", () => {
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
        seatsPath,
        rules: [sampleRule],
        nowMs: Date.parse("2026-11-08T20:00:00.000Z"),
      });

      runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Write",
          tool_input: { file_path: "notes.md", content: secretContent },
          cwd: "E:/AI/Publisher",
          session_id: "sess-hash-2",
        }),
        seatsPath,
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
      assert.equal(lines[0].seat, "rnd");
      assert.equal(lines[0].session, "sess-hash-1");
      assert.equal(lines[0].tool, "Bash");
      assert.deepEqual(lines[0].evaluated, ["sample-warn"]);
      assert.deepEqual(lines[0].matched, [{ id: "sample-warn", layer: "B", action: "warn" }]);
      assert.equal(lines[0].outcome, "warn");
      assert.equal(typeof lines[0].latency_ms, "number");
      assert.equal(lines[0].input_hash, hashToolInput({ command: secretCommand }));
      assert.match(lines[0].input_hash, /^[0-9a-f]{64}$/);

      assert.equal(lines[1].seat, "publisher");
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
        seatsPath,
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
        seatsPath,
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
        seatsPath,
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
        seatsPath,
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
  let seatsPath: string;
  let logPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "loadout-pretool-p2-"));
    seatsPath = join(tempDir, "seats.json");
    logPath = join(tempDir, "hook-decisions.jsonl");
    writeFileSync(
      seatsPath,
      JSON.stringify({ "E:/AI/Research and Development": "rnd" }),
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
          seatsPath,
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

    it("fails open and logs error_open on a bad or missing explicit seat map", () => {
      const corruptSeats = join(tempDir, "corrupt-seats.json");
      writeFileSync(corruptSeats, "{ broken json", "utf-8");

      const resCorrupt = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: "echo hi" },
          cwd: "E:/AI/Research and Development",
        }),
        seatsPath: corruptSeats,
        logPath,
      });
      assert.equal(resCorrupt.exitCode, 0);
      assert.equal(resCorrupt.outcome, "error_open");

      const resMissingExplicit = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: "echo hi" },
        }),
        seatsPath: join(tempDir, "does-not-exist.json"),
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
        seatsPath,
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
        seatsPath,
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
        seatsPath,
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
        seatsPath,
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
        seatsPath,
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
        seatsPath,
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
        seatsPath,
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
  findQuoteViolations,
  quoteTextsFromTool,
  parseToolStampedTime,
} from "../pretool-rules.js";

/**
 * Ported verbatim from `~/.claude/hooks/quote-gate.py` (sha256 af95dd4e...):
 * 15 `_MUST_BLOCK` cases and 19 `_MUST_PASS` cases = 34 total cases.
 * (In the 19th `_MUST_PASS` case, the home directory prefix before
 * `.claude/projects/F--AI/memory/Feedback/feedback_never_quote_the_director.md`
 * is `/home/user` so no home path is committed.)
 */
export const QUOTE_GATE_MUST_BLOCK: ReadonlyArray<readonly [string, string]> = [
  [
    "P1 practice marker",
    "## 1. What he intends\n\nHis words, and these are the load-bearing ones:\n",
  ],
  [
    "P1 possessive",
    "The Director's words: the pipeline ships before the docs do.",
  ],
  [
    "P1 void instruction",
    "Corrections go to Feedback memos immediately, in his words.",
  ],
  [
    "P2 past attribution + long span",
    'Mike said: "the whole thing needs to be rebuilt from the ground up again".',
  ],
  [
    "P2 possessive + first person",
    'His verdict: "I would rather wait than ship this."',
  ],
  [
    "P2 bare colon form",
    'The Director: *"I do not think that shortcut is acceptable at all."* ',
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
    'Director 2026-10-24: "the whole pipeline should be rebuilt before the next window opens".',
  ],
  [
    "P2 dated, parenthetical",
    '(Director, 10-29): "I want every build to go through the card process from now on."',
  ],
  [
    "P2 dated, bold label",
    '**The Director, 2026-11-02:** "I need you to slow down at every outward step."',
  ],
  [
    "P2 dated, qualifier then colon",
    'Director 11-01 evening: "keep three sessions going at once until I tell you otherwise".',
  ],
  [
    "P2 dated, no colon",
    'Director 2026-10-23 "I would rather you delegate the writing to the other seats".',
  ],
];

export const QUOTE_GATE_MUST_PASS: ReadonlyArray<readonly [string, string]> = [
  [
    "trigger phrase, present frame",
    'When Mike says "dogfood swarm" on a repo, execute the funnel above.',
  ],
  [
    "trigger phrase in description",
    'description: When the user says "full treatment," run all 7 phases in order.',
  ],
  [
    "short impersonal directive",
    'The Director set the bar at "high quality 3D"; we A/B-tested on-rig.',
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
    "Mike ruled it a law on the spot: no public surface is ever outsourced.",
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
    "### The scene (Director-authored - render exactly as written)",
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
    "Director 2026-11-05 ruled that auto-update stays off and the rig runs a pinned build.",
  ],
  [
    "dated, short impersonal term",
    'Director 2026-10-22 set the bar at "high quality 3D" for the renders.',
  ],
  [
    "dated heading, no speech",
    "**SETTLED 2026-11-05 (Director answered A, relayed by the Publisher):** auto-update stays off.",
  ],
  [
    "dated mention inside a YAML description (no speech)",
    'description: "Every design starts from its template; if none fits, write it first (Director, 2026-10-13)"',
  ],
  [
    "dated mention mid-description, quote far away",
    'description: "Medium effort, cap 4 cards (Director 11-07); drops to 3 once the memory system is addressed"',
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
    'python - <<PY\np = "/home/user/.claude/projects/F--AI/memory/Feedback/feedback_never_quote_the_director.md"\n# documents git commit -m and the practice markers: his words, the Director\'s words\nPY',
  ],
];

describe("Part 3: the first five rules (unreviewed-merge, director-quote, memory-shell-write, future-stamp, release-reminder)", () => {
  let tempDir: string;
  let seatsPath: string;
  let logPath: string;
  const configuredStore = "E:/AI/CustomSeatStore/memory";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "loadout-pretool-p3-"));
    seatsPath = join(tempDir, "seats.json");
    logPath = join(tempDir, "hook-decisions.jsonl");
    writeFileSync(
      seatsPath,
      JSON.stringify(
        {
          seats: {
            "E:/AI/Research and Development": {
              seat: "rnd",
              store: configuredStore,
            },
            "E:/AI/Publisher": {
              seat: "publisher",
              store: "E:/AI/PublisherStore/memory",
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

  // ── 3.1 unreviewed-merge ──────────────────────────────────────
  describe("3.1 unreviewed-merge (Layer A, permanently warn-only on every seat per Ruling 2)", () => {
    it("warns on `gh pr merge` and `gatemerge` (any path/form) on R&D, Publisher, and default seats (never blocks), naming the seat's memory id", () => {
      const mergeCommands = [
        "gh pr merge 21 --squash",
        "gh -R mcp-tool-shop-org/loadout-os pr merge 21",
        "gatemerge 21",
        "./scripts/gatemerge.ps1 -Pr 21",
        "pwsh E:/AI/scripts/gatemerge.ps1",
      ];

      for (const command of mergeCommands) {
        // R&D seat -> warn (exit 0, permanently warn-only per Ruling 2)
        const rndRes = runPreTool({
          stdinJson: JSON.stringify({
            tool_name: "Bash",
            tool_input: { command },
            cwd: "E:/AI/Research and Development",
          }),
          seatsPath,
          logPath,
        });
        assert.equal(rndRes.exitCode, 0, `R&D should warn (never block): ${command}`);
        assert.equal(rndRes.outcome, "warn");
        assert.match(rndRes.stdout, /R&D hands reviewed PRs to the Publisher to merge/i);
        assert.match(rndRes.stdout, /publisher-merges/);

        // Publisher seat -> warn (exit 0 + Argon-verdict sha reminder mentioning ledger step 2 and publisher-merges-as-coordinator)
        const pubRes = runPreTool({
          stdinJson: JSON.stringify({
            tool_name: "Bash",
            tool_input: { command },
            cwd: "E:/AI/Publisher",
          }),
          seatsPath,
          logPath,
        });
        assert.equal(pubRes.exitCode, 0, `Publisher should warn: ${command}`);
        assert.equal(pubRes.outcome, "warn");
        assert.match(pubRes.stdout, /Argon-verdict sha/);
        assert.match(pubRes.stdout, /step 2/);
        assert.match(pubRes.stdout, /publisher-merges-as-coordinator/);

        // Default seat -> warn
        const defRes = runPreTool({
          stdinJson: JSON.stringify({
            tool_name: "Bash",
            tool_input: { command },
            cwd: "E:/AI/UnmappedRepo",
          }),
          seatsPath,
          logPath,
        });
        assert.equal(defRes.exitCode, 0, `Default should warn: ${command}`);
        assert.equal(defRes.outcome, "warn");
      }
    });

    it("suppresses the warning when a review reply exists in repliesDir whose first line contains `PASS at <head8>` for the PR's head, and still warns for PASS at another head, FIX, or no reply", () => {
      const repliesDir = join(tempDir, "replies");
      mkdirSync(repliesDir, { recursive: true });
      writeFileSync(
        seatsPath,
        JSON.stringify({
          repliesDir,
          seats: {
            "E:/AI/Research and Development": { seat: "rnd", store: configuredStore },
            "E:/AI/Publisher": { seat: "publisher", store: "E:/AI/PublisherStore/memory" },
          },
        }),
        "utf-8",
      );

      const mergeWithMatchHead =
        "gh pr merge 24 -R mcp-tool-shop-org/loadout-os --squash --match-head-commit eb90790a2146c31c";
      const gatemergeWithHead =
        "bash E:/AI/Publisher/scripts/gatemerge.sh mcp-tool-shop-org/loadout-os 24 eb90790a";

      // 1. No reply in repliesDir -> warns
      const noReplyRes = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: mergeWithMatchHead },
          cwd: "E:/AI/Publisher",
        }),
        seatsPath,
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
          cwd: "E:/AI/Publisher",
        }),
        seatsPath,
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
          cwd: "E:/AI/Publisher",
        }),
        seatsPath,
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
            cwd: "E:/AI/Publisher",
          }),
          seatsPath,
          logPath,
        });
        assert.equal(passReplyRes.exitCode, 0);
        assert.equal(passReplyRes.outcome, "allow", `Expected warning suppressed for: ${cmd}`);
        assert.equal(passReplyRes.stdout, "");
      }
    });
  });

  // ── 3.2 director-quote (quote-gate.py port) ───────────────────
  describe("3.2 director-quote (Layer A, all 34 quote-gate.py self-test cases)", () => {
    it("blocks all 15 _MUST_BLOCK cases and passes all 19 _MUST_PASS cases from quote-gate.py (34/34)", () => {
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

        const extracted = quoteTextsFromTool(toolName, toolInput);
        const violations = extracted.flatMap((t) => findQuoteViolations(t));
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
          seatsPath,
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

        const extracted = quoteTextsFromTool(toolName, toolInput);
        const violations = extracted.flatMap((t) => findQuoteViolations(t));
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
          seatsPath,
          logPath,
        });
        assert.equal(
          res.exitCode,
          0,
          `Expected runPreTool to allow _MUST_PASS case '${name}'`,
        );
      }
    });

    it("blocks quotes in Edit, MultiEdit, git tag -m, and gh pr/issue/release, while allowing allowlisted law files", () => {
      const editRes = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Edit",
          tool_input: {
            file_path: "notes.md",
            old_string: "old",
            new_string: 'His verdict: "I would rather wait than ship this."',
          },
          cwd: "E:/AI/Publisher",
        }),
        seatsPath,
        logPath,
      });
      assert.equal(editRes.exitCode, 2);

      const ghPrRes = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: {
            command:
              'gh pr create --title "t" --body "Director 2026-10-24: \\"the whole pipeline should be rebuilt before the next window opens\\""',
          },
          cwd: "E:/AI/Unmapped",
        }),
        seatsPath,
        logPath,
      });
      assert.equal(ghPrRes.exitCode, 2);

      const allowlistedWrite = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Write",
          tool_input: {
            file_path:
              "/home/user/.claude/projects/F--AI/memory/feedback/feedback_never_quote_the_director.md",
            content: 'His verdict: "I would rather wait than ship this."',
          },
          cwd: "E:/AI/Research and Development",
        }),
        seatsPath,
        logPath,
      });
      assert.equal(allowlistedWrite.exitCode, 0);
    });
  });

  // ── 3.3 memory-shell-write ────────────────────────────────────
  describe("3.3 memory-shell-write (Layer A)", () => {
    it("blocks redirection, tee, sed -i, cp, mv, rm, touch, python/node inline/heredoc writes, and git -C <store> commit/checkout/reset", () => {
      const claudeStoreFile =
        "~/.claude/projects/E--AI-Research-and-Development/memory/BOARD.md";
      const seatStoreFile = `${configuredStore}/topic.md`;

      const blockedShellWrites = [
        `echo "hi" > ${claudeStoreFile}`,
        `echo "hi" >> ${seatStoreFile}`,
        `cat notes.md | tee ${claudeStoreFile}`,
        `sed -i 's/old/new/' ${seatStoreFile}`,
        `cp /tmp/draft.md ${claudeStoreFile}`,
        `mv /tmp/draft.md ${seatStoreFile}`,
        `rm -f ${claudeStoreFile}`,
        `touch ${seatStoreFile}`,
        `python -c "open('${seatStoreFile}', 'w').write('x')"`,
        `node -e "fs.writeFileSync('${seatStoreFile}', 'x')"`,
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
          seatsPath,
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
          seatsPath,
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
        seatsPath,
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
          seatsPath,
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
        seatsPath,
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
          seatsPath,
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
        seatsPath,
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
          seatsPath,
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
        seatsPath,
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
        seatsPath,
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
              "# R&D Board\n\n**Last updated:** 2026-11-08 15:03 ET (clock-checked). loadout-os 1.1.1 live.\n\n- Milestone 2: due 2026-12-01 (hard deadline)\n",
          },
          cwd: "E:/AI/Research and Development",
        }),
        seatsPath,
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

      // 1. `# Publisher BOARD — updated 2026-11-08 17:55 ET (stamped from date)` -> allow (clock fixed at 17:57)
      const allowPub1755 = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Edit",
          tool_input: {
            file_path: `${configuredStore}/BOARD.md`,
            old_string: "old",
            new_string:
              "# Publisher BOARD — updated 2026-11-08 17:55 ET (stamped from date)",
          },
          cwd: "E:/AI/Publisher",
        }),
        seatsPath,
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
              "# Publisher BOARD — updated 2026-11-08 23:59 ET (stamped from date)",
          },
          cwd: "E:/AI/Publisher",
        }),
        seatsPath,
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
          cwd: "E:/AI/Publisher",
        }),
        seatsPath,
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
            cwd: "E:/AI/Publisher",
          }),
          seatsPath,
          logPath,
          nowMs: clock1757Ms,
        });
        assert.equal(allowBodyRes.exitCode, 0, `Expected body line to allow: ${bodyLine}`);
        assert.equal(allowBodyRes.outcome, "allow");
      }

      // 5. The same heading in a non-memory file -> allow
      for (const heading of [
        "# Publisher BOARD — updated 2026-11-08 23:59 ET (stamped from date)",
        "## Status — Updated 2026-11-09 08:00 ET",
      ]) {
        const allowNonMemoryRes = runPreTool({
          stdinJson: JSON.stringify({
            tool_name: "Edit",
            tool_input: {
              file_path: "E:/AI/Publisher/docs/STATUS.md",
              old_string: "old",
              new_string: heading,
            },
            cwd: "E:/AI/Publisher",
          }),
          seatsPath,
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
          seatsPath,
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
        seatsPath,
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
  describe("3.5 release-reminder (Layer B, soft warn on all seats)", () => {
    it("warns on `npm publish`, `gh release create`, and `git push --tags` across all seats, and stays silent on dry-run or normal push", () => {
      const releaseCommands = [
        "npm publish",
        "npm publish --access public",
        "gh release create v1.1.2 --generate-notes",
        "git push --tags",
        "git push origin --tags",
      ];

      for (const command of releaseCommands) {
        for (const [cwd, expectedMemId] of [
          ["E:/AI/Research and Development", /publisher-approves-every-publish/],
          ["E:/AI/Publisher", /publishing-tags-need-publisher-ok/],
          ["E:/AI/OtherRepo", /publisher-approves-every-publish/],
        ] as const) {
          const res = runPreTool({
            stdinJson: JSON.stringify({
              tool_name: "Bash",
              tool_input: { command },
              cwd,
            }),
            seatsPath,
            logPath,
          });
          assert.equal(res.exitCode, 0);
          assert.equal(res.outcome, "warn");
          assert.match(res.stdout, expectedMemId);
          assert.match(res.stdout, /full-treatment/);
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
            cwd: "E:/AI/Publisher",
          }),
          seatsPath,
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
  let seatsPath: string;
  let logPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "loadout-pretool-p5-"));
    seatsPath = join(tempDir, "seats.json");
    logPath = join(tempDir, "hook-decisions.jsonl");
    writeFileSync(
      seatsPath,
      JSON.stringify(
        {
          seats: {
            "E:/AI/Research and Development": {
              seat: "rnd",
              store: REPLAY_2026_11_08_STORE,
            },
            "E:/AI/Publisher": {
              seat: "publisher",
              store: REPLAY_2026_11_08_STORE,
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
        seatsPath,
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
          "--seats",
          seatsPath,
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
        seatsPath,
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
          "--seats",
          seatsPath,
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
            "# Design Notes\n\n**Last updated:** 2026-11-08 15:40 ET\n\nParaphrased summary of studio architecture rules.\n",
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
        cwd: "E:/AI/Publisher",
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
          content: 'Director 2026-11-08: "We always verify the build before opening a pull request."\n',
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
        seatsPath,
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
  let seatsPath: string;
  let logPath: string;
  let storeDir: string;
  const fixedClockMs = Date.UTC(2026, 10, 8, 20, 44, 0, 0); // 2026-11-08 15:44 ET

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "loadout-pretool-25-"));
    seatsPath = join(tempDir, "seats.json");
    logPath = join(tempDir, "hook-decisions.jsonl");
    storeDir = join(tempDir, "store", "memory");
    mkdirSync(storeDir, { recursive: true });

    writeFileSync(
      seatsPath,
      JSON.stringify(
        {
          seats: {
            "E:/AI/Research and Development": {
              seat: "rnd",
              store: storeDir,
              worktrees: ["E:/AI/_worktrees/loadout-os-25-pr1"],
            },
            "E:/AI/Publisher": {
              seat: "publisher",
              store: "E:/AI/PublisherStore/memory",
              prefixes: ["E:/AI/_worktrees/publisher-pr"],
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
        seatsPath,
        logPath,
      });
      assert.equal(res.passThrough, false, `Expected passThrough=false for: ${cmd}`);
    }
  });

  it("P1.2: resolves worktree and extra prefix roots per seat from seats.json (`worktrees` / `prefixes`)", () => {
    const cfg = loadSeatConfig(seatsPath);
    assert.equal(resolveSeat("E:/AI/_worktrees/loadout-os-25-pr1/packages/cli", cfg), "rnd");
    assert.equal(resolveSeat("E:/AI/_worktrees/publisher-pr/src", cfg), "publisher");
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
        seatsPath,
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
        seatsPath,
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
        seatsPath,
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
        seatsPath,
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
        seatsPath,
        logPath,
      });
      assert.equal(res.exitCode, 2, `Expected P2.7 block for: ${cmd}`);
      assert.ok(res.logEntry?.matched.some((m) => m.id === "memory-shell-write"));
    }
  });

  it("P2.8: normalizes `%USERPROFILE%`, `$USERPROFILE`, `$HOME`, quoted `~`, and doubled backslashes `\\\\` on store paths", () => {
    // Configure a custom store under ~/custom-seat-store/memory (no .claude/projects fragment)
    // so each test strictly depends on its corresponding path normalization step.
    const customSeatsPath = join(tempDir, "seats-p28.json");
    writeFileSync(
      customSeatsPath,
      JSON.stringify({
        stores: [storeDir],
        seats: {
          "E:/AI/Research and Development": {
            seat: "rnd",
            store: "~/custom-seat-store/memory",
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
      'rm "%USERPROFILE%/custom-seat-store/memory/BOARD.md"',
      'rm "$HOME/custom-seat-store/memory/BOARD.md"',
      'rm "$USERPROFILE/custom-seat-store/memory/BOARD.md"',
      'rm "~/custom-seat-store/memory/BOARD.md"',
      'python -c "open(\'%USERPROFILE%/custom-seat-store/memory/BOARD.md\', \'w\').write(\'x\')"',
      `rm "${storeDir.replace(/[\\/]+/g, "\\\\")}\\\\BOARD.md"`,
    ];
    for (const command of commands) {
      const res = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command },
          cwd: "E:\\\\AI\\\\Research and Development",
        }),
        seatsPath: customSeatsPath,
        logPath,
      });
      assert.equal(res.exitCode, 2, `Expected P2.8 block for: ${command}`);
      assert.equal(res.logEntry?.seat, "rnd");
      assert.ok(res.logEntry?.matched.some((m) => m.id === "memory-shell-write"));
    }
  });

  it("P2.9: allows `sed -i` on a non-store file even when the sed expression mentions a memory store path", () => {
    const storeSlash = storeDir.replace(/\\/g, "/");
    for (const cmd of [
      `sed -i "s|${storeSlash}|/new/path|g" README.md`,
      `sed -i "1,10s|${storeSlash}|/new/path|g" README.md`,
      `sed -i -e "1d" "s|${storeSlash}|/new/path|g"`,
      'sed -i "s|~/.claude/projects/F--AI/memory/BOARD.md|/new/path|g" README.md',
      'sed -i "1,10s|~/.claude/projects/F--AI/memory/BOARD.md|/new/path|g" README.md',
    ]) {
      const res = runPreTool({
        stdinJson: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: cmd },
          cwd: "E:/AI/Research and Development",
        }),
        seatsPath,
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
      "# R&D Board\n\n**Last updated:** 2026-11-08 15:03 ET (clock-checked).\n",
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
      seatsPath,
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
      seatsPath,
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
        seatsPath,
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
      seatsPath,
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
      seatsPath,
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
      seatsPath,
      logPath,
      nowMs: clock0002NextDayMs,
    });
    assert.equal(midnightWrapRes.exitCode, 0, "Midnight wrap ~23:58 ET at 00:02 ET must pass");
  });

  it("Ruling 1: resolves per-seat memory IDs for all 5 rules (`rnd` vs `publisher`) and formats seat-specific memory IDs in messages", () => {
    const expectedMap: Record<string, { rnd: string; publisher: string }> = {
      "unreviewed-merge": {
        rnd: "publisher-merges",
        publisher: "publisher-merges-as-coordinator",
      },
      "director-quote": {
        rnd: "never-quote-director-in-public",
        publisher: "feedback-never-quote-director",
      },
      "memory-shell-write": {
        rnd: "build-in-studio-tools-not-side-scripts",
        publisher: "project-memory-system",
      },
      "future-stamp": {
        rnd: "rnd-memory-system",
        publisher: "feedback-eastern-time",
      },
      "release-reminder": {
        rnd: "publisher-approves-every-publish",
        publisher: "publishing-tags-need-publisher-ok",
      },
    };

    for (const rule of PRETOOL_RULES) {
      assert.equal(resolveRuleMemory(rule, "rnd"), expectedMap[rule.id]!.rnd);
      assert.equal(resolveRuleMemory(rule, "publisher"), expectedMap[rule.id]!.publisher);
    }
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
        seatsPath,
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
      seatsPath,
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
          cwd: "E:/AI/Publisher",
        }),
        seatsPath,
        logPath,
        repliesDir,
      });
      assert.equal(mRes.outcome, "allow", `Expected PASS at d4ddd0e4 suppression for: ${mergeCmd}`);
    }
  });
});

// ════════════════════════════════════════════════════════════════
// Part 7: PR #26 Fix 1 — rig-path default removal, 7 FP fixes + 7 TP guards,
//         hasReviewPassAtHead repo/PR scoping, and doctor --seats help
// ════════════════════════════════════════════════════════════════

import * as pretoolModule from "../pretool.js";
import * as pretoolRulesModule from "../pretool-rules.js";
import * as helpModule from "../help.js";
import { defaultRepliesDir } from "../pretool.js";
import { hasReviewPassAtHead } from "../pretool-rules.js";
import { COMMAND_HELP, renderCommandHelp } from "../help.js";

describe("Part 7: PR #26 Fix 1 — shipped defaults, false-positive fixes, and review-pass scoping", () => {
  let tempDir: string;
  let seatsPath: string;
  let logPath: string;
  let storeDir: string;
  const fixedClockMs = Date.UTC(2026, 10, 8, 20, 44, 0, 0); // 2026-11-08 15:44 ET

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "loadout-pretool-fix1-"));
    seatsPath = join(tempDir, "seats.json");
    logPath = join(tempDir, "hook-decisions.jsonl");
    storeDir = join(tempDir, "store", "memory");
    mkdirSync(storeDir, { recursive: true });

    writeFileSync(
      seatsPath,
      JSON.stringify(
        {
          seats: {
            "E:/AI/Research and Development": {
              seat: "rnd",
              store: storeDir,
            },
            "E:/AI/Publisher": {
              seat: "publisher",
              store: "E:/AI/PublisherStore/memory",
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

  it("Ask 1: no shipped default (exported constant, default argument, or help text) holds a rig path (`E:/AI`, `rnd-local`, `antigravity`, `mikey`, or any drive letter), and suppression is off when unset", () => {
    delete process.env.AI_LOADOUT_REPLIES_DIR;

    // 1. defaultRepliesDir() returns undefined when AI_LOADOUT_REPLIES_DIR is not set
    assert.equal(defaultRepliesDir(), undefined);
    assert.equal("DEFAULT_REPLIES_DIR" in pretoolModule, false);

    // 2. Inspect all exported string/object constants across pretool, pretool-rules, and help
    const forbiddenRigPattern = /e:\/ai|e:\\ai|rnd-local|antigravity|mikey|\b[a-zA-Z]:[\\/]/i;
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

    // 4. With neither seats.json repliesDir nor AI_LOADOUT_REPLIES_DIR set, unreviewed-merge suppression is off
    const res = runPreTool({
      stdinJson: JSON.stringify({
        tool_name: "Bash",
        tool_input: {
          command:
            "gh pr merge 24 -R mcp-tool-shop-org/loadout-os --squash --match-head-commit eb90790a",
        },
        cwd: "E:/AI/Publisher",
      }),
      seatsPath,
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
        seatsPath,
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
        seatsPath,
        logPath,
      });
      assert.equal(blockRes.exitCode, 2, `Expected FP-MSW-1 true-positive block for: ${blockCmd}`);
      assert.ok(blockRes.logEntry?.matched.some((m) => m.id === "memory-shell-write"));
    }
  });

  it("Ask 2 (FP-MSW-2): allows studio CLIs (`claude-memories`, `cli.js`) and read-only inspection scripts given a store argument, while blocking mutating script files", () => {
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
        seatsPath,
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
        seatsPath,
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
        seatsPath,
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
        seatsPath,
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
        seatsPath,
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
      seatsPath,
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
      seatsPath,
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
      seatsPath,
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
      seatsPath,
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
      seatsPath,
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
      seatsPath,
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
          content: "# R&D Board\n\n**Last updated:** 2099-01-01 12:00 ET\n",
        },
        cwd: "E:/AI/Research and Development",
      }),
      seatsPath,
      logPath,
      nowMs: fixedClockMs,
    });
    assert.equal(blockRes.exitCode, 2, "Store BOARD.md with future date must be blocked");
    assert.ok(blockRes.logEntry?.matched.some((m) => m.id === "future-stamp"));
  });

  it("Ask 4: `hasReviewPassAtHead` requires matching repo and PR number on line 1, and `doctor --help` documents `--seats <p>`", () => {
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

    // 4. doctor --help documents --seats <p>
    const doctorHelp = renderCommandHelp("doctor") ?? "";
    assert.ok(
      doctorHelp.includes("--seats <p>"),
      "doctor --help must document --seats <p>",
    );
  });
});


