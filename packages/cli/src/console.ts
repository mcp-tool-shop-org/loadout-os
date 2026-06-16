/**
 * Shared console + arg-parsing layer for the unified loadout-os CLI.
 *
 * One arg parser, one structured-error shape (code/message/hint), one set of
 * colour helpers — so every subcommand (wrapped surface or ritual) behaves
 * identically. The "fail loudly on a swallowed flag value" behaviour is lifted
 * from the kernel + memories CLIs (MEM-B05 / ai-loadout getPathFlag): a path
 * flag whose value is the next flag is a user mistake we name, never a file we
 * silently create named "--lazy".
 */

// ── Colours ────────────────────────────────────────────────────
export const BOLD = "\x1b[1m";
export const GREEN = "\x1b[32m";
export const RED = "\x1b[31m";
export const CYAN = "\x1b[36m";
export const YELLOW = "\x1b[33m";
export const DIM = "\x1b[2m";
export const RESET = "\x1b[0m";

export function log(msg = ""): void {
  console.log(msg);
}
export function ok(msg: string): void {
  log(`  ${GREEN}✓${RESET} ${msg}`);
}
export function warn(msg: string): void {
  log(`  ${YELLOW}!${RESET} ${msg}`);
}
export function info(msg: string): void {
  log(`  ${CYAN}i${RESET} ${msg}`);
}

/**
 * Structured CLI error: a code, a human message, and an optional actionable
 * hint. Thrown by command handlers; caught at the dispatcher boundary, which
 * prints `✗ [CODE] message` (+ hint) to stderr and exits non-zero. Tests catch
 * this type to assert on `code` without scraping stderr.
 */
export class CliError extends Error {
  readonly code: string;
  readonly hint?: string;
  readonly exitCode: number;
  constructor(code: string, message: string, hint?: string, exitCode = 1) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.hint = hint;
    this.exitCode = exitCode;
  }
}

/** Throw a structured error. Mirrors the `fail()` helper of the wrapped CLIs. */
export function fail(
  code: string,
  message: string,
  hint?: string,
  exitCode = 1,
): never {
  throw new CliError(code, message, hint, exitCode);
}

// ── Flag parsing ──────────────────────────────────────────────
export function hasFlag(args: string[], flag: string): boolean {
  return args.includes(`--${flag}`);
}

/**
 * Read a value-bearing flag (`--out path` or `--out=path`).
 *
 * Returns undefined when the flag is absent. FAILS LOUDLY when the flag is
 * present but its value was swallowed by the next flag (`--out --json`): that
 * is the bug the wrapped CLIs guard against, surfaced as a single shared rule
 * here so every loadout-os subcommand inherits it.
 */
export function flagValue(args: string[], flag: string): string | undefined {
  // `--flag=value` form
  const eqPrefix = `--${flag}=`;
  for (const a of args) {
    if (a.startsWith(eqPrefix)) return a.slice(eqPrefix.length);
  }
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return undefined;
  const next = args[idx + 1];
  if (next === undefined || next.startsWith("--")) {
    fail(
      "MISSING_FLAG_VALUE",
      `--${flag} was given without a value${next ? ` (the next token "${next}" is a flag, not a value)` : ""}.`,
      `Provide a value, e.g. '--${flag} <path>' or '--${flag}=<path>'.`,
    );
  }
  return next;
}

/**
 * Positional (non-flag) args.
 *
 * The loadout-os surfaces that take positionals (memories/rules/kernel index
 * paths) always put the path FIRST, before any flags, so a simple "tokens that
 * don't start with `--`" filter is unambiguous here — we never have to guess
 * whether a bare token is a positional or a space-separated flag value. Value
 * flags are read with `flagValue()`, which handles both `--out path` and
 * `--out=path` forms independently.
 */
export function positionalArgs(args: string[]): string[] {
  return args.filter((a) => !a.startsWith("--"));
}
