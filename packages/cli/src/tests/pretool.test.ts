/**
 * Tests for `loadout-os hook pre-tool` — Part 1 (hook entry, seat resolution,
 * read-only pass-through, typed rule table, decision log, enforce vs log-only modes).
 *
 * All tests run in isolated temp directories and never touch live ~/.claude or ~/.ai-loadout.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
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

