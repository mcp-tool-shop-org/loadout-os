/**
 * Pure, side-effect-free helpers for the ai-loadout CLI.
 *
 * These live in their own module (separate from cli.ts) so they can be unit
 * tested without executing the CLI's top-level argv parsing / process.exit.
 * Nothing here writes to stdout or exits the process — callers decide how to
 * report. The CLI wires these into its structured `fail(code, message, hint)`.
 */

import type { LoadoutIndex } from "./types.js";

// ── Index shape validation (KER-B1) ──────────────────────────────
//
// `JSON.parse` happily returns null / numbers / arrays / wrong-shaped objects.
// Before we hand a parsed value to validate/budget/dead/overlaps/merge — all of
// which dereference `.entries` — confirm it actually looks like a loadout index.
// This turns a downstream raw `TypeError: Cannot read properties of … (reading
// 'entries')` into an actionable, structured failure at the trust boundary.

/**
 * Structural type-guard for a parsed loadout index.
 *
 * Minimal by design: we only assert what every consumer relies on — a plain
 * object with an `entries` array. Per-entry validation is the job of
 * `validateIndex`; this guard just stops the obviously-wrong file (null, a
 * number, an array, `{}`, a missing `entries`) before it crashes elsewhere.
 */
export function isLoadoutIndex(value: unknown): value is LoadoutIndex {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Array.isArray((value as { entries?: unknown }).entries)
  );
}

/**
 * Human-readable description of why a parsed value is not a loadout index.
 *
 * Returned so the CLI can put a precise reason in the failure hint instead of a
 * generic "invalid". `null` means the value *is* a valid index (no problem).
 */
export function describeIndexShapeProblem(value: unknown): string | null {
  if (value === null) return "got null";
  if (Array.isArray(value)) return "got a JSON array, expected an object";
  const t = typeof value;
  if (t !== "object") return `got a JSON ${t}, expected an object`;
  if (!Array.isArray((value as { entries?: unknown }).entries)) {
    return "object is missing an 'entries' array";
  }
  return null;
}

// ── Flag value parsing (KER-B6) ──────────────────────────────────
//
// `--project --json` must NOT let `--project` swallow `--json` as its value.
// A value that itself starts with `--` is treated as absent: the user almost
// certainly forgot the value, and silently consuming the next flag produces
// confusing, hard-to-debug behavior downstream.

/**
 * Read the value of `--<flag>` from args, supporting both `--flag value` and
 * `--flag=value` forms.
 *
 * Guard: if the token following `--flag` itself starts with `--`, the value is
 * treated as ABSENT (returns `undefined`) rather than swallowing the next flag.
 * The `--flag=` form is honored verbatim, even if the value starts with `--`,
 * because there the user was explicit about the pairing.
 */
export function getFlagValue(args: string[], flag: string): string | undefined {
  const prefix = `--${flag}=`;
  for (const a of args) {
    if (a.startsWith(prefix)) return a.slice(prefix.length);
  }
  const idx = args.indexOf(`--${flag}`);
  if (idx !== -1 && idx + 1 < args.length && !args[idx + 1].startsWith("--")) {
    return args[idx + 1];
  }
  return undefined;
}

/**
 * Classify why `getFlagValue` returned undefined for a bare `--flag`.
 *
 * Lets the CLI tailor its error message:
 *   - "missing"  → `--flag` was the last token, or absent entirely.
 *   - "swallowed"→ `--flag` was immediately followed by another `--flag`,
 *                  so we refused to consume it as a value.
 *   - null       → a value WAS present (no problem).
 */
export function diagnoseFlagValue(
  args: string[],
  flag: string
): "missing" | "swallowed" | null {
  if (getFlagValue(args, flag) !== undefined) return null;
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return "missing";
  const next = args[idx + 1];
  if (next !== undefined && next.startsWith("--")) return "swallowed";
  return "missing";
}
