/**
 * Shared path-resolution helper for claude-memories.
 *
 * FT-MR10: the same `resolveRefPath` logic was copy-pasted in analyze.ts,
 * index-gen.ts, and (a 2-arg variant) validate.ts. A single implementation
 * here guarantees analyze / index-gen / validate — and the unified loadout-os
 * CLI — all resolve a referenced topic path identically.
 *
 * Strategy (unchanged, behavior-preserving): try each base directory in order,
 * joining the ref path onto it, and return the first that exists on disk;
 * otherwise null. Callers pass MEMORY.md's own directory first, then its
 * parent (for refs written project-root-relative like "memory/foo.md" when
 * MEMORY.md itself lives inside memory/).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Resolve a reference path against one or more base directories.
 * Returns the first `join(base, refPath)` that exists, or null.
 */
export function resolveRefPath(refPath: string, ...baseDirs: string[]): string | null {
  for (const base of baseDirs) {
    const full = join(base, refPath);
    if (existsSync(full)) return full;
  }
  return null;
}
