/**
 * Markdown section parser.
 *
 * This is CLAUDE.md-specific document surgery. It stays in claude-rules,
 * not in ai-loadout (which handles payload routing, not document splitting).
 *
 * Contract:
 * - Splits on ATX headings (## and ###) only
 * - ### under a ## groups with its parent
 * - Standalone ### treated as its own section
 * - Unsupported structures are reported, not guessed
 */

import { estimateTokens } from "@mcptoolshop/ai-loadout";
import type { Section } from "./types.js";

// Re-export ai-loadout functions that other claude-rules modules need
export { estimateTokens } from "@mcptoolshop/ai-loadout";
export { parseFrontmatter, serializeFrontmatter } from "@mcptoolshop/ai-loadout";

// ── ATX heading detection ──────────────────────────────────────
const HEADING_RE = /^(#{1,6})\s+(.+)$/;

interface HeadingMatch {
  level: number;
  text: string;
  lineIndex: number;
}

function detectHeadings(lines: string[]): HeadingMatch[] {
  const headings: HeadingMatch[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = HEADING_RE.exec(lines[i]);
    if (match) {
      headings.push({
        level: match[1].length,
        text: match[2].trim(),
        lineIndex: i,
      });
    }
  }
  return headings;
}

// ── Section extraction ─────────────────────────────────────────
export function parseSections(content: string): Section[] {
  const lines = content.split("\n");
  const headings = detectHeadings(lines);

  const splitHeadings = headings.filter((h) => h.level === 2 || h.level === 3);

  if (splitHeadings.length === 0) {
    if (lines.length === 0 || (lines.length === 1 && lines[0].trim() === "")) {
      return [];
    }
    return [
      {
        heading: "(preamble)",
        level: 0,
        startLine: 0,
        endLine: lines.length,
        content: content,
        lines: lines.length,
        tokens_est: estimateTokens(content),
      },
    ];
  }

  const sections: Section[] = [];

  // Content before first heading (preamble)
  if (splitHeadings[0].lineIndex > 0) {
    const preambleLines = lines.slice(0, splitHeadings[0].lineIndex);
    const preambleContent = preambleLines.join("\n");
    if (preambleContent.trim().length > 0) {
      sections.push({
        heading: "(preamble)",
        level: 0,
        startLine: 0,
        endLine: splitHeadings[0].lineIndex,
        content: preambleContent,
        lines: preambleLines.length,
        tokens_est: estimateTokens(preambleContent),
      });
    }
  }

  // Group headings: ## owns everything until the next ##
  for (let i = 0; i < splitHeadings.length; i++) {
    const h = splitHeadings[i];

    if (h.level === 3) {
      let ownedByParent = false;
      for (let j = i - 1; j >= 0; j--) {
        if (splitHeadings[j].level === 2) {
          ownedByParent = true;
          break;
        }
        if (splitHeadings[j].level < 3) break;
      }
      if (ownedByParent) continue;
    }

    let endLine = lines.length;
    for (let j = i + 1; j < splitHeadings.length; j++) {
      if (splitHeadings[j].level <= h.level) {
        endLine = splitHeadings[j].lineIndex;
        break;
      }
    }

    while (endLine > h.lineIndex + 1 && lines[endLine - 1].trim() === "") {
      endLine--;
    }

    const sectionLines = lines.slice(h.lineIndex, endLine);
    const sectionContent = sectionLines.join("\n");

    sections.push({
      heading: h.text,
      level: h.level,
      startLine: h.lineIndex,
      endLine: endLine,
      content: sectionContent,
      lines: sectionLines.length,
      tokens_est: estimateTokens(sectionContent),
    });
  }

  return sections;
}

// ── Heading to kebab-case ID ───────────────────────────────────
const NOISE_WORDS = new Set([
  "rules", "rule", "non-negotiable", "nonnegotiable", "contract",
  "source", "of", "truth", "the", "a", "an", "and", "for", "in",
  "required", "before", "after", "hard",
]);

export function headingToId(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !NOISE_WORDS.has(w))
    .slice(0, 3)
    .join("-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "unnamed";
}
