/**
 * Index maintenance utilities for claude-memories:
 * - syncSummaries: check or fix (`--fix`) bullet summaries in MEMORY.md and linked
 *   sub-indexes against each topic file's frontmatter `description` (F-02 / F-09 / F-21).
 * - placeMemoryEntry / moveMemoryEntry: place or move a topic file bullet into a target
 *   index file (`MEMORY.md` or `index-<name>.md`) atomically (F-19 / F-21).
 */

import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseFrontmatter } from "@mcptoolshop/ai-loadout";
import { parseMemoryMd } from "./parser.js";
import { detectSubindex } from "./analyze.js";
import { resolveRefPath } from "./paths.js";
import { summariesMatch } from "./validate.js";

const MAIN_CLIP = 120;
const SUBINDEX_CLIP = 140;

function clipSummary(s: string, maxLen: number): string {
  const clean = s.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen - 1).trimEnd() + "…";
}

function writeAtomic(filePath: string, content: string): void {
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  writeFileSync(tmpPath, content, "utf-8");
  renameSync(tmpPath, filePath);
}

export interface SyncChange {
  indexFile: string;
  line: number;
  refPath: string;
  before: string;
  after: string;
}

export interface SyncSummariesResult {
  memoryMd: string;
  fixed: boolean;
  changes: SyncChange[];
}

/**
 * Rewrite a single reference line's description while preserving its link or arrow format.
 */
function rewriteRefLine(line: string, newDesc: string): string {
  // Markdown link format: `- [Title](file.md) — desc`
  const linkRe = /^([-*]\s+(?:\*\*)?(?:[^\[\]\w\s*]{1,4}\s*)?\[[^\]]+\]\([^)\s]+?\.md(?:#[^)\s]*)?\)(?:\*\*)?)(.*)$/;
  const linkMatch = line.match(linkRe);
  if (linkMatch) {
    return `${linkMatch[1]} — ${newDesc}`;
  }

  // Arrow format: `- Name — old desc → \`path\`` or `Name — old desc → path`
  const arrowRe = /^((?:[-*]\s+)?)(.+?)(\s+→\s+`?[^\s`]+`?\s*)$/;
  const arrowMatch = line.match(arrowRe);
  if (arrowMatch) {
    const [, prefix, nameDesc, suffix] = arrowMatch;
    const emIdx = nameDesc.indexOf("—");
    const hhIdx = nameDesc.indexOf("--");
    const nameOnly = emIdx !== -1
      ? nameDesc.slice(0, emIdx).trim()
      : hhIdx !== -1
        ? nameDesc.slice(0, hhIdx).trim()
        : nameDesc.trim();
    return `${prefix}${nameOnly} — ${newDesc}${suffix}`;
  }

  return line;
}

/**
 * Scan MEMORY.md and all linked sub-index files for bullet summaries that differ
 * from their topic files' frontmatter `description`. When `opts.fix` is true,
 * rewrites the drifted index lines atomically on disk.
 */
export function syncSummaries(
  memoryMdPath: string,
  opts: { fix?: boolean } = {},
): SyncSummariesResult {
  const absMemoryMd = resolve(memoryMdPath);
  const storeDir = dirname(absMemoryMd);
  const parentDir = dirname(storeDir);
  const fix = !!opts.fix;
  const changes: SyncChange[] = [];

  const indexFilesToScan: { absPath: string; label: string; clipLen: number }[] = [
    { absPath: absMemoryMd, label: "MEMORY.md", clipLen: MAIN_CLIP },
  ];

  // Discover linked sub-index files from MEMORY.md
  const mainContent = readFileSync(absMemoryMd, "utf-8");
  const { refs: topRefs } = parseMemoryMd(mainContent);
  for (const ref of topRefs) {
    const resolved = resolveRefPath(ref.path, storeDir, parentDir);
    if (!resolved || !existsSync(resolved)) continue;
    try {
      const refContent = readFileSync(resolved, "utf-8");
      if (detectSubindex(ref.path, refContent).isSubindex) {
        indexFilesToScan.push({
          absPath: resolved,
          label: ref.path,
          clipLen: SUBINDEX_CLIP,
        });
      }
    } catch {
      // ignore unreadable
    }
  }

  for (const idxFile of indexFilesToScan) {
    const raw = readFileSync(idxFile.absPath, "utf-8");
    const lines = raw.split(/\r?\n/);
    const { refs } = parseMemoryMd(lines.join("\n"));
    let fileChanged = false;

    for (const ref of refs) {
      const resolvedTopic = resolveRefPath(ref.path, dirname(idxFile.absPath), dirname(dirname(idxFile.absPath)))
        ?? resolveRefPath(ref.path, storeDir, parentDir);
      if (!resolvedTopic || !existsSync(resolvedTopic)) continue;

      let topicContent: string;
      try {
        topicContent = readFileSync(resolvedTopic, "utf-8");
      } catch {
        continue;
      }

      // Skip sub-index bullets themselves in MEMORY.md
      if (detectSubindex(ref.path, topicContent).isSubindex) continue;

      const { frontmatter } = parseFrontmatter(topicContent);
      const fmDesc = frontmatter?.description?.trim();
      if (!fmDesc) continue;

      const clipped = clipSummary(fmDesc, idxFile.clipLen);
      const currentDesc = ref.description?.trim() ?? "";

      if (!currentDesc || !summariesMatch(currentDesc, fmDesc)) {
        const oldLine = lines[ref.line];
        const newLine = rewriteRefLine(oldLine, clipped);
        if (newLine !== oldLine) {
          changes.push({
            indexFile: idxFile.label,
            line: ref.line + 1,
            refPath: ref.path,
            before: oldLine,
            after: newLine,
          });
          lines[ref.line] = newLine;
          fileChanged = true;
        }
      }
    }

    if (fix && fileChanged) {
      const joined = lines.join("\n");
      writeAtomic(idxFile.absPath, joined.endsWith("\n") ? joined : joined + "\n");
    }
  }

  return {
    memoryMd: absMemoryMd,
    fixed: fix && changes.length > 0,
    changes,
  };
}

/**
 * Resolve an index target shorthand (`"main"`, `"MEMORY.md"`, `"cards"`, `"index-cards.md"`, etc.)
 * to an absolute file path inside `storeDir`.
 */
export function resolveTargetIndexFile(storeDir: string, targetIndex: string): string {
  const trimmed = targetIndex.trim();
  if (!trimmed) {
    throw new Error("Target index name cannot be empty");
  }
  if (trimmed === "main" || trimmed.toLowerCase() === "memory.md") {
    return join(storeDir, "MEMORY.md");
  }
  if (existsSync(resolve(storeDir, trimmed))) {
    return resolve(storeDir, trimmed);
  }
  if (trimmed.endsWith(".md")) {
    return join(storeDir, trimmed);
  }
  const candidate = join(storeDir, `index-${trimmed}.md`);
  return candidate;
}

export interface PlaceMoveResult {
  action: "place" | "move";
  topicFile: string;
  targetIndex: string;
  removedFrom: string[];
  bullet: string;
}

/**
 * Place or move a topic `.md` file into a target index (`MEMORY.md` or `index-<name>.md`).
 * Removes any existing reference to the topic file across `MEMORY.md` and all linked
 * sub-indexes so the file is never listed twice (F-19 / F-21).
 */
export function placeOrMoveEntry(opts: {
  storeDir: string;
  topicFile: string;
  targetIndex: string;
  action?: "place" | "move";
}): PlaceMoveResult {
  const storeDir = resolve(opts.storeDir);
  const memoryMd = join(storeDir, "MEMORY.md");
  if (!existsSync(memoryMd)) {
    throw new Error(`MEMORY.md not found in store: ${memoryMd}`);
  }

  const rawFile = opts.topicFile.trim();
  if (!rawFile) {
    throw new Error("Topic file name is required");
  }
  const fileName = rawFile.endsWith(".md") ? basename(rawFile) : `${basename(rawFile)}.md`;
  const topicAbs = join(storeDir, fileName);
  if (!existsSync(topicAbs)) {
    throw new Error(`Topic file not found in store: ${topicAbs}`);
  }

  const targetAbs = resolveTargetIndexFile(storeDir, opts.targetIndex);
  if (!existsSync(targetAbs)) {
    throw new Error(`Target index file not found: ${targetAbs}`);
  }

  // Read topic file frontmatter for title + description
  const topicContent = readFileSync(topicAbs, "utf-8");
  const { frontmatter } = parseFrontmatter(topicContent);
  let title = frontmatter?.name?.trim() || fileName.replace(/\.md$/i, "").replace(/-/g, " ");
  const descText = frontmatter?.description?.trim() || "";

  // Gather all index files in the store (MEMORY.md + linked sub-indexes + targetAbs)
  const indexPaths = new Set<string>([memoryMd, targetAbs]);
  const mainRaw = readFileSync(memoryMd, "utf-8");
  const { refs: topRefs } = parseMemoryMd(mainRaw);
  for (const ref of topRefs) {
    const resolved = resolveRefPath(ref.path, storeDir, dirname(storeDir));
    if (resolved && existsSync(resolved)) {
      try {
        const c = readFileSync(resolved, "utf-8");
        if (detectSubindex(ref.path, c).isSubindex) {
          indexPaths.add(resolved);
        }
      } catch {
        // ignore
      }
    }
  }

  const removedFrom: string[] = [];

  // Remove existing bullet for `fileName` from all index files (preserving its title if present)
  for (const idxPath of indexPaths) {
    if (!existsSync(idxPath)) continue;
    const content = readFileSync(idxPath, "utf-8");
    const lines = content.split(/\r?\n/);
    const { refs } = parseMemoryMd(lines.join("\n"));
    const matchingLines = new Set<number>();

    for (const ref of refs) {
      if (basename(ref.path) === fileName || ref.path === fileName) {
        if (ref.name && ref.name.trim()) {
          title = ref.name.trim();
        }
        matchingLines.add(ref.line);
      }
    }

    if (matchingLines.size > 0) {
      const filtered = lines.filter((_, idx) => !matchingLines.has(idx));
      const joined = filtered.join("\n");
      writeAtomic(idxPath, joined.endsWith("\n") ? joined : joined + "\n");
      removedFrom.push(basename(idxPath));
    }
  }

  // Append bullet to targetAbs
  const isMain = resolve(targetAbs) === resolve(memoryMd);
  const clipLen = isMain ? MAIN_CLIP : SUBINDEX_CLIP;
  const clippedDesc = descText ? clipSummary(descText, clipLen) : `Memory: ${title}`;
  const bullet = `- [${title}](${fileName}) — ${clippedDesc}`;

  const targetContent = readFileSync(targetAbs, "utf-8");
  const trimmedTarget = targetContent.replace(/\s+$/, "");
  const updatedTarget = trimmedTarget ? `${trimmedTarget}\n${bullet}\n` : `${bullet}\n`;
  writeAtomic(targetAbs, updatedTarget);

  return {
    action: opts.action ?? "place",
    topicFile: fileName,
    targetIndex: basename(targetAbs),
    removedFrom,
    bullet,
  };
}
