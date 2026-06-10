/**
 * MEMORY.md parser.
 *
 * Parses MEMORY.md structure:
 * - Sections delimited by ## headings
 * - Memory references: "Name — description → `path`" or "Name → `path`"
 * - Inline entries: "Name — description" (no path)
 *
 * The arrow format is: Name — description → `path`
 * But MEMORY.md uses the actual format from our file, so we parse both:
 *   - Markdown links: [text](url)
 *   - Arrow references: Name — desc → `path`
 *   - Bullet + arrow: "- Name — desc → path"
 */

import type { MemorySection, MemoryRef } from "./types.js";

// Match: "Name — description → `path`" with optional bullet prefix
const ARROW_REF_RE = /^(?:[-*]\s+)?(.+?)\s+→\s+`?([^\s`]+)`?\s*$/;

// Match inline code path at end: `memory/foo.md`
const INLINE_PATH_RE = /`(memory\/[^\s`]+|[^\s`]+\.md)`/;

/**
 * Parse MEMORY.md content into sections and references.
 */
export function parseMemoryMd(content: string): {
  sections: MemorySection[];
  refs: MemoryRef[];
} {
  const lines = content.split("\n");
  const sections: MemorySection[] = [];
  const allRefs: MemoryRef[] = [];

  let currentSection: MemorySection | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Heading detection
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      // Close previous section
      if (currentSection) {
        currentSection.endLine = i - 1;
        sections.push(currentSection);
      }

      currentSection = {
        heading: headingMatch[2].trim(),
        level: headingMatch[1].length,
        entries: [],
        startLine: i,
        endLine: i,
      };
      continue;
    }

    // Skip empty lines and lines that look like plain prose
    if (!trimmed) continue;

    // Try to parse a memory reference (works with or without bullet prefix)
    const ref = parseRefLine(trimmed, i);
    if (ref) {
      allRefs.push(ref);
      if (currentSection) {
        currentSection.entries.push(ref);
      }
    }
  }

  // Close last section
  if (currentSection) {
    currentSection.endLine = lines.length - 1;
    sections.push(currentSection);
  }

  return { sections, refs: allRefs };
}

/**
 * Parse a single line into a MemoryRef, or null if it doesn't match.
 *
 * Supported formats:
 *   - "- AI Loadout — routing core (v1.0.3) → `memory/ai-loadout.md`"
 *   - "- AI Loadout — routing core → memory/ai-loadout.md"
 *   - "- Hard Rules — Don't Delete, CI Fix Protocol → `memory/hard-rules.md`"
 */
function parseRefLine(line: string, lineNum: number): MemoryRef | null {
  // Strip leading bullet if present
  const stripped = line.replace(/^[-*]\s+/, "").trim();
  if (!stripped) return null;

  // Try arrow pattern first (handles both bulleted and non-bulleted)
  const arrowMatch = line.match(ARROW_REF_RE);
  if (arrowMatch) {
    const [, nameDesc, path] = arrowMatch;
    const { name, description } = splitNameDesc(nameDesc);
    return { name, description, path, line: lineNum };
  }

  // Try inline path pattern (backtick path anywhere in line)
  const pathMatch = stripped.match(INLINE_PATH_RE);
  if (pathMatch) {
    const path = pathMatch[1];
    // Everything before the path reference is name + description
    const pathIdx = stripped.indexOf("`" + path);
    if (pathIdx === -1) return null;
    const beforePath = stripped.slice(0, pathIdx).trim();
    // Remove trailing arrow if present
    const cleaned = beforePath.replace(/\s*→\s*$/, "").trim();
    if (!cleaned) return null;
    const { name, description } = splitNameDesc(cleaned);
    return { name, description, path, line: lineNum };
  }

  return null;
}

/**
 * Split "Name — description" into { name, description }.
 * Uses em-dash (—) or double-hyphen (--) as separator.
 */
function splitNameDesc(text: string): { name: string; description: string } {
  // Try em-dash first
  const emIdx = text.indexOf("—");
  if (emIdx !== -1) {
    return {
      name: text.slice(0, emIdx).trim(),
      description: text.slice(emIdx + 1).trim(),
    };
  }

  // Try double-hyphen
  const hhIdx = text.indexOf("--");
  if (hhIdx !== -1) {
    return {
      name: text.slice(0, hhIdx).trim(),
      description: text.slice(hhIdx + 2).trim(),
    };
  }

  // No separator — entire text is the name
  return { name: text.trim(), description: "" };
}
