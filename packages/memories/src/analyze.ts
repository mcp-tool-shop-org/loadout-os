/**
 * MEMORY.md analyzer.
 *
 * Reads MEMORY.md, parses references, checks topic files on disk,
 * extracts keywords, and produces an analysis report.
 *
 * Path resolution: tries paths relative to MEMORY.md's directory first,
 * then relative to its parent (for when MEMORY.md lives inside memory/
 * but references use project-root-relative paths like "memory/foo.md").
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative, extname, basename, resolve } from "node:path";
import { estimateTokens } from "@mcptoolshop/ai-loadout";
import { parseMemoryMd } from "./parser.js";
import { resolveRefPath } from "./paths.js";
import type { MemoryAnalysis, MemoryRef, Diagnostic } from "./types.js";

/**
 * Analyze a MEMORY.md file and its referenced topic files.
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
  const { sections, refs } = parseMemoryMd(content);

  const inlineTokens = estimateTokens(content);

  // Check which referenced files exist
  // Try: relative to MEMORY.md, then relative to parent dir
  //
  // FT-MR3: every missing/orphan signal is recorded as a structured Diagnostic
  // here, at the point of detection — the flat string[] arrays below are derived
  // views kept for back-compat. Library consumers read `diagnostics`; the CLI
  // renders it uniformly. Nothing goes to stderr.
  const diagnostics: Diagnostic[] = [];
  const missingFiles: string[] = [];
  let topicTokens = 0;

  for (const ref of refs) {
    const resolved = resolveRefPath(ref.path, fileDir, parentDir);
    if (resolved) {
      try {
        const topicContent = readFileSync(resolved, "utf-8");
        topicTokens += estimateTokens(topicContent);
      } catch {
        missingFiles.push(ref.path);
        diagnostics.push({
          severity: "error",
          code: "MISSING_TOPIC_FILE",
          message: `Referenced topic file not found: ${ref.path}`,
          refPath: ref.path,
          line: ref.line,
          hint: "Create the file or remove the reference from MEMORY.md",
        });
      }
    } else {
      missingFiles.push(ref.path);
      diagnostics.push({
        severity: "error",
        code: "MISSING_TOPIC_FILE",
        message: `Referenced topic file not found: ${ref.path}`,
        refPath: ref.path,
        line: ref.line,
        hint: "Create the file or remove the reference from MEMORY.md",
      });
    }
  }

  // Find orphan files — build a set of referenced basenames for matching
  const referencedBasenames = new Set<string>();
  for (const ref of refs) {
    referencedBasenames.add(ref.path);
    // Also add just the filename for when refs use "memory/foo.md"
    // but files live alongside MEMORY.md as "foo.md"
    referencedBasenames.add(basename(ref.path));
  }

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
    refs,
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
 * Extract keywords from a memory topic file name and content.
 */
export function extractKeywords(name: string, content: string): string[] {
  const words = new Set<string>();

  // From the name (e.g. "AI Loadout" → ["ai", "loadout"])
  for (const w of name.toLowerCase().split(/[\s-]+/)) {
    if (w.length > 2 && !STOP_WORDS.has(w)) {
      words.add(w);
    }
  }

  // From the file content — extract heading words
  for (const line of content.split("\n")) {
    const headingMatch = line.match(/^#{1,3}\s+(.+)/);
    if (headingMatch) {
      for (const w of headingMatch[1].toLowerCase().split(/[\s-]+/)) {
        const cleaned = w.replace(/[^a-z0-9]/g, "");
        if (cleaned.length > 2 && !STOP_WORDS.has(cleaned)) {
          words.add(cleaned);
        }
      }
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
