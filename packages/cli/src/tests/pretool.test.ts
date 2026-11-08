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
  describe("3.1 unreviewed-merge (Layer A)", () => {
    it("blocks `gh pr merge` and `gatemerge` (any path/form) on R&D seat, and warns on Publisher and default seats", () => {
      const mergeCommands = [
        "gh pr merge 21 --squash",
        "gh -R mcp-tool-shop-org/loadout-os pr merge 21",
        "gatemerge 21",
        "./scripts/gatemerge.ps1 -Pr 21",
        "pwsh E:/AI/scripts/gatemerge.ps1",
      ];

      for (const command of mergeCommands) {
        // R&D seat -> block (exit 2)
        const rndRes = runPreTool({
          stdinJson: JSON.stringify({
            tool_name: "Bash",
            tool_input: { command },
            cwd: "E:/AI/Research and Development",
          }),
          seatsPath,
          logPath,
        });
        assert.equal(rndRes.exitCode, 2, `R&D should block: ${command}`);
        assert.equal(rndRes.outcome, "block");
        assert.match(rndRes.stderr, /R&D never merges/i);

        // Publisher seat -> warn (exit 0 + Argon-verdict sha reminder mentioning ledger step 2)
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
    // Fixed clock: 2026-11-08 15:44:00 local time
    const fixedClockMs = new Date(2026, 10, 8, 15, 44, 0, 0).getTime();

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
              file_path: "E:/AI/Research and Development/BOARD.md",
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
            file_path: "E:/AI/Research and Development/BOARD.md",
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
        for (const cwd of [
          "E:/AI/Research and Development",
          "E:/AI/Publisher",
          "E:/AI/OtherRepo",
        ]) {
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
          assert.match(res.stdout, /publisher-approves-every-publish/);
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


