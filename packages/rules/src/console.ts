/**
 * Console UI + arg-parsing helpers (side-effect-free).
 *
 * Extracted from cli.ts so the logic modules (analyze/validate/split/stats/
 * signals) can import these without transitively pulling in cli.ts — which
 * self-executes main() as a binary entrypoint. Importing this module performs
 * no I/O, parses no argv, and exits no process at load time; only `fail()`
 * exits, and only when explicitly called.
 */

// ── Colors ─────────────────────────────────────────────────────
export const BOLD = "\x1b[1m";
export const GREEN = "\x1b[32m";
export const YELLOW = "\x1b[33m";
export const RED = "\x1b[31m";
export const CYAN = "\x1b[36m";
export const DIM = "\x1b[2m";
export const RESET = "\x1b[0m";

export function log(msg: string): void {
  console.log(msg);
}
export function ok(msg: string): void {
  log(`${GREEN}✓${RESET} ${msg}`);
}
export function warn(msg: string): void {
  log(`${YELLOW}!${RESET} ${msg}`);
}
export function skip(msg: string): void {
  log(`${DIM}  skip${RESET} ${msg}`);
}
export function info(msg: string): void {
  log(`${CYAN}i${RESET} ${msg}`);
}

// ── Structured error + exit ────────────────────────────────────
export function fail(
  code: string,
  message: string,
  hint: string,
  exitCode = 1,
): never {
  console.error(`${RED}Error [${code}]:${RESET} ${message}`);
  console.error(`${DIM}Hint: ${hint}${RESET}`);
  process.exit(exitCode);
}

// ── Flag parsing helpers ───────────────────────────────────────
export function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

export function flagValue(
  args: string[],
  flag: string,
): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  const next = args[idx + 1];
  // Guard against a missing value: `split --rules-dir --dry-run` must not treat
  // the following flag as a directory name (which would create a dir literally
  // named "--dry-run"). A value-flag whose next token is itself a flag has no
  // value — return undefined so callers fall back to their default.
  if (next.startsWith("--")) return undefined;
  return next;
}

// Every flag in the CLI surface that consumes the following argument as its
// value. Kept here as the single source of truth so positionalArgs can always
// skip a value-flag's argument even if a caller forgets to list it — otherwise
// `--rules-dir foo path` would mis-parse `foo` as a positional.
const VALUE_FLAGS = ["--rules-dir", "--signals"];
// Boolean flags take no argument.
const BOOL_FLAGS = ["--memory", "--dry-run", "--help", "-h", "--yes", "--lazy", "--json"];

export function positionalArgs(
  args: string[],
  flags: string[],
): string[] {
  const flagIndices = new Set<number>();
  // Union of the caller-supplied value-flags and the known CLI value-flags,
  // so a value-flag's argument can never be mis-parsed as a positional.
  const valueFlags = new Set([...flags, ...VALUE_FLAGS]);
  for (let i = 0; i < args.length; i++) {
    if (valueFlags.has(args[i])) {
      flagIndices.add(i);
      flagIndices.add(i + 1); // skip the flag's value (if present)
    } else if (BOOL_FLAGS.includes(args[i])) {
      flagIndices.add(i);
    }
  }
  return args.filter((_, i) => !flagIndices.has(i) && !args[i].startsWith("--"));
}
