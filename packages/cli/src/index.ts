/**
 * Library entry point for @mcptoolshop/loadout-os.
 *
 * Exposes the unified CLI's PURE, composable surface — the dispatcher and the
 * read-only ritual builders (doctor / report / hook test) — so SDK consumers
 * can drive loadout-os in-process without spawning the bin. Importing this
 * barrel is side-effect-free: cli.ts only runs its dispatcher when invoked as
 * the process entrypoint, never on import.
 */

// ── Dispatcher + version ───────────────────────────────────────
export { dispatch, getVersion, topLevelHelp } from "./cli.js";

// ── Console primitives (shared arg parser + structured error) ──
export {
  CliError,
  fail,
  hasFlag,
  flagValue,
  positionalArgs,
} from "./console.js";

// ── Ritual: doctor ─────────────────────────────────────────────
export {
  runDoctor,
  printDoctor,
  defaultDoctorPaths,
} from "./doctor.js";
export type {
  DoctorCheck,
  DoctorResult,
  DoctorPaths,
  CheckStatus,
} from "./doctor.js";

// ── Ritual: report ─────────────────────────────────────────────
export { buildReport, printReport } from "./report.js";
export type { ReportResult, ScoreBucket } from "./report.js";

// ── Ritual: hook test ──────────────────────────────────────────
export { runHookTest, printHookTest, defaultHookPath } from "./hook.js";
export type { HookTestOptions, HookTestResult } from "./hook.js";

// ── Ritual: pre-tool hook (PreToolUse Layer A/B framework) ─────
export {
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
  appendDecisionLog,
  defaultSeatsPath,
  defaultDecisionLogPath,
  DEFAULT_PRETOOL_TIMEOUT_MS,
  READ_ONLY_TOOLS,
} from "./pretool.js";
export type {
  PreToolStdinPayload,
  SeatConfig,
  SeatName,
  CommandRedirection,
  CommandSegment,
  ParsedBashCommand,
  WriteEditItem,
  WritePayload,
  RuleLayer,
  RuleAction,
  RuleMatchInput,
  RuleMatchResult,
  PreToolRule,
  MatchedRuleRecord,
  DecisionLogEntry,
  HookMode,
  DecisionOutcome,
  PreToolOptions,
  PreToolResult,
} from "./pretool.js";
export { PRETOOL_RULES } from "./pretool-rules.js";

// ── Ritual: refresh (Index Freshness Ritual) ───────────────────
export {
  runRefresh,
  printRefresh,
  printRefreshAndon,
  dispatchRefresh,
  rewritePathsAbsolute,
  defaultDest,
  DEFAULT_STORE,
  RefreshError,
} from "./refresh.js";
export type { RefreshOptions, RefreshResult } from "./refresh.js";

// ── Per-command help (Hard Gate C) ─────────────────────────────
export {
  COMMAND_HELP,
  renderCommandHelp,
  interceptHelp,
  wantsHelp,
} from "./help.js";
