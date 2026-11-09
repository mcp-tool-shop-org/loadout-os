/**
 * MEMORY.md analyzer.
 *
 * Reads MEMORY.md, parses references (including linked sub-indexes `index-*.md`
 * or files marked `metadata.loadout_role: subindex` in frontmatter), checks
 * topic files on disk, extracts keywords, and produces an analysis report.
 *
 * Path resolution: tries paths relative to MEMORY.md's directory first,
 * then relative to its parent (for when MEMORY.md lives inside memory/
 * but references use project-root-relative paths like "memory/foo.md").
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative, extname, basename, resolve } from "node:path";
import { estimateTokens, parseFrontmatter } from "@mcptoolshop/ai-loadout";
import type { Priority } from "@mcptoolshop/ai-loadout";
import { parseMemoryMd } from "./parser.js";
import { resolveRefPath } from "./paths.js";
import type { MemoryAnalysis, MemoryRef, Diagnostic } from "./types.js";

const VALID_PRIORITIES = new Set<string>(["core", "domain", "manual"]);

/**
 * Determine whether a referenced file is a sub-index rather than a topic entry:
 * 1. Its basename matches `index-*.md`, OR
 * 2. Its frontmatter carries `metadata.loadout_role === "subindex"`.
 * Also returns the sub-index's `defaultPriority` if specified via
 * `metadata.loadout_default_priority` or if the file is `index-archive.md`.
 */
export function detectSubindex(
  refPath: string,
  content: string,
): { isSubindex: boolean; defaultPriority?: Priority } {
  const base = basename(refPath).toLowerCase();
  const isNamedSubindex = /^index-.+\.md$/i.test(base);
  const { frontmatter } = parseFrontmatter(content);
  const role = frontmatter?.metadata?.loadout_role;
  const isRoleSubindex = role === "subindex";

  if (!isNamedSubindex && !isRoleSubindex) {
    return { isSubindex: false };
  }

  let defaultPriority: Priority | undefined;
  const rawDefault = frontmatter?.metadata?.loadout_default_priority;
  if (typeof rawDefault === "string" && VALID_PRIORITIES.has(rawDefault)) {
    defaultPriority = rawDefault as Priority;
  } else if (base === "index-archive.md") {
    defaultPriority = "manual";
  }

  return { isSubindex: true, defaultPriority };
}

/**
 * Analyze a MEMORY.md file and its referenced topic files (including sub-indexes).
 */
export function analyzeMemoryMd(filePath: string): MemoryAnalysis {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read MEMORY.md at ${filePath}: ${msg}`);
  }

  const fileDir = dirname(resolve(filePath));
  const parentDir = dirname(fileDir);
  const { sections, refs: topRefs } = parseMemoryMd(content);

  const inlineTokens = estimateTokens(content);

  const diagnostics: Diagnostic[] = [];
  const missingFiles: string[] = [];
  const subindexFiles: string[] = [];
  const subindexEntryCounts: Record<string, number> = {};
  const expandedRefs: MemoryRef[] = [];
  const referencedBasenames = new Set<string>();
  const visitedIndexFiles = new Set<string>([resolve(filePath)]);
  let topicTokens = 0;

  const recordMissing = (ref: MemoryRef, sourceLabel: string) => {
    missingFiles.push(ref.path);
    diagnostics.push({
      severity: "error",
      code: "MISSING_TOPIC_FILE",
      message: `Referenced topic file not found: ${ref.path}`,
      refPath: ref.path,
      line: ref.line,
      hint: `Create the file or remove the reference from ${sourceLabel}`,
    });
  };

  const expandIndexRefs = (
    refs: MemoryRef[],
    currentDir: string,
    currentParentDir: string,
    sourceLabel: string,
    inSubindex: boolean,
    subindexPathLabel?: string,
    inheritedDefaultPriority?: Priority,
  ) => {
    for (const ref of refs) {
      const effectiveRef: MemoryRef = inSubindex
        ? {
            ...ref,
            subindex: true,
            subindexPath: subindexPathLabel,
            ...(inheritedDefaultPriority ? { defaultPriority: inheritedDefaultPriority } : {}),
          }
        : ref;

      referencedBasenames.add(ref.path);
      referencedBasenames.add(basename(ref.path));

      const resolved =
        resolveRefPath(ref.path, currentDir, currentParentDir) ??
        (inSubindex ? resolveRefPath(ref.path, fileDir, parentDir) : null);

      if (!resolved) {
        expandedRefs.push(effectiveRef);
        recordMissing(effectiveRef, sourceLabel);
        continue;
      }

      const relResolved = relative(fileDir, resolved).replace(/\\/g, "/");
      referencedBasenames.add(relResolved);
      referencedBasenames.add(basename(resolved));

      let refContent: string;
      try {
        refContent = readFileSync(resolved, "utf-8");
      } catch {
        expandedRefs.push(effectiveRef);
        recordMissing(effectiveRef, sourceLabel);
        continue;
      }

      const subCheck = detectSubindex(ref.path, refContent);
      if (subCheck.isSubindex) {
        const canonicalSub = resolve(resolved);
        if (visitedIndexFiles.has(canonicalSub)) {
          diagnostics.push({
            severity: "warning",
            code: "SUBINDEX_CYCLE",
            message: `Circular sub-index reference skipped: ${ref.path} (from ${sourceLabel})`,
            refPath: ref.path,
            line: ref.line,
            hint: `Remove the circular sub-index link in ${sourceLabel}`,
          });
          continue;
        }
        visitedIndexFiles.add(canonicalSub);

        const subLabel = inSubindex
          ? relResolved && !relResolved.startsWith("..")
            ? relResolved
            : ref.path
          : ref.path;
        if (!subindexFiles.includes(subLabel)) {
          subindexFiles.push(subLabel);
        }

        const subDir = dirname(resolved);
        const subParent = dirname(subDir);
        const { refs: subRefs } = parseMemoryMd(refContent);
        subindexEntryCounts[subLabel] = subRefs.length;

        const nextDefaultPriority = subCheck.defaultPriority ?? inheritedDefaultPriority;
        expandIndexRefs(
          subRefs,
          subDir,
          subParent,
          subLabel,
          true,
          subLabel,
          nextDefaultPriority,
        );
      } else {
        expandedRefs.push(effectiveRef);
        topicTokens += estimateTokens(refContent);
      }
    }
  };

  expandIndexRefs(topRefs, fileDir, parentDir, "MEMORY.md", false);

  const orphanFiles: string[] = [];

  // Scan MEMORY.md's own directory for unreferenced .md files
  if (existsSync(fileDir)) {
    try {
      for (const entry of readdirSync(fileDir)) {
        const fullPath = join(fileDir, entry);
        try {
          const stat = statSync(fullPath);
          if (stat.isFile() && extname(entry) === ".md" && entry !== "MEMORY.md") {
            if (!referencedBasenames.has(entry)) {
              orphanFiles.push(entry);
              diagnostics.push(orphanDiagnostic(entry));
            }
          }
          // Also scan subdirectories
          if (stat.isDirectory()) {
            scanDir(fullPath, fileDir, referencedBasenames, orphanFiles, diagnostics);
          }
        } catch {
          // Skip entries we can't stat (permission denied, broken symlinks)
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  return {
    filePath,
    sections,
    refs: expandedRefs,
    subindexFiles,
    subindexEntryCounts,
    orphanFiles,
    missingFiles,
    diagnostics,
    totalTokens: inlineTokens + topicTokens,
    inlineTokens,
    topicTokens,
  };
}

/** FT-MR3: build the structured Diagnostic for an orphan topic file. */
function orphanDiagnostic(path: string): Diagnostic {
  return {
    severity: "warning",
    code: "ORPHAN_TOPIC_FILE",
    message: `Topic file not referenced in MEMORY.md: ${path}`,
    refPath: path,
    hint: "Add a reference in MEMORY.md or delete the file",
  };
}

/**
 * Recursively scan a directory for .md files not in the referenced set.
 */
function scanDir(
  dir: string,
  baseDir: string,
  referenced: Set<string>,
  orphans: string[],
  diagnostics: Diagnostic[],
): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return; // Skip unreadable directories
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    try {
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        scanDir(fullPath, baseDir, referenced, orphans, diagnostics);
      } else if (extname(entry) === ".md") {
        const relPath = relative(baseDir, fullPath).replace(/\\/g, "/");
        if (!referenced.has(relPath) && !referenced.has(basename(relPath))) {
          orphans.push(relPath);
          diagnostics.push(orphanDiagnostic(relPath));
        }
      }
    } catch {
      // Skip entries we can't stat
    }
  }
}

/**
 * Extract keywords from a memory topic file name, content, and optional file path.
 *
 * F-04: Strips punctuation (`[^a-z0-9\s-]`) before splitting title/name words so
 * tokens like `udlab:`, `(PRIVATE)`, or `v1.0.2` yield clean matchable `[a-z0-9]{3,}`
 * keywords, and includes file-stem tokens when `filePath` is provided.
 */
export function extractKeywords(name: string, content: string, filePath?: string): string[] {
  const words = new Set<string>();

  const addCleanedTokens = (text: string) => {
    const cleaned = text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ");
    for (const w of cleaned.split(/[\s-]+/)) {
      if (w.length > 2 && !STOP_WORDS.has(w) && !/^\d+$/.test(w)) {
        words.add(w);
      }
    }
  };

  // From the display name (strip punctuation first — F-04)
  addCleanedTokens(name);

  // From the file stem when available (F-04)
  if (filePath) {
    const stem = basename(filePath).replace(/\.md$/i, "");
    addCleanedTokens(stem);
  }

  // From the file content — extract heading words
  for (const line of content.split("\n")) {
    const headingMatch = line.match(/^#{1,3}\s+(.+)/);
    if (headingMatch) {
      addCleanedTokens(headingMatch[1]);
    }
  }

  return [...words].sort();
}

const STOP_WORDS = new Set([
  "the", "and", "for", "are", "not", "but", "with", "from",
  "this", "that", "have", "has", "had", "was", "were", "been",
  "will", "can", "may", "should", "would", "could", "about",
  "into", "than", "then", "when", "where", "which", "what",
  "how", "all", "each", "every", "both", "few", "more", "most",
  "other", "some", "such", "only", "own", "same", "just",
  "also", "very", "often", "once", "here", "there", "why",
  "use", "used", "using", "note", "notes",
]);
