/**
 * Frontmatter parser and serializer.
 *
 * Parses YAML-like --- delimited blocks from payload files.
 * Hand-rolled: supports strings, inline arrays, booleans, and
 * one level of nested objects (triggers). No deps, deterministic.
 */

import type { Frontmatter, Priority, Triggers } from "./types.js";
import { DEFAULT_TRIGGERS } from "./types.js";

const VALID_PRIORITIES = new Set<string>(["core", "domain", "manual"]);

// ── Parse frontmatter from file content ────────────────────────
export function parseFrontmatter(
  content: string,
): { frontmatter: Frontmatter | null; body: string } {
  const lines = content.split("\n");

  if (lines[0]?.trim() !== "---") {
    return { frontmatter: null, body: content };
  }

  let closeIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      closeIndex = i;
      break;
    }
  }

  if (closeIndex === -1) {
    return { frontmatter: null, body: content };
  }

  const fmLines = lines.slice(1, closeIndex);
  const body = lines.slice(closeIndex + 1).join("\n");

  const data: Record<string, unknown> = {};
  let currentKey = "";
  let currentArray: string[] | null = null;
  let currentObject: Record<string, boolean> | null = null;

  for (const line of fmLines) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    // Block array item
    if (currentArray !== null && trimmed.startsWith("- ")) {
      currentArray.push(trimmed.slice(2).trim());
      continue;
    }

    // Nested object value (indented)
    if (currentObject !== null && line.startsWith("  ")) {
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx !== -1) {
        const key = trimmed.slice(0, colonIdx).trim();
        const val = trimmed.slice(colonIdx + 1).trim();
        currentObject[key] = val === "true";
        continue;
      }
    }

    // Flush pending
    if (currentArray !== null) {
      data[currentKey] = currentArray;
      currentArray = null;
    }
    if (currentObject !== null) {
      data[currentKey] = currentObject;
      currentObject = null;
    }

    // Key: value pair
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const rawVal = trimmed.slice(colonIdx + 1).trim();
    currentKey = key;

    if (rawVal === "") {
      // Peek at next line to determine if block array or object
      const lineIdx = fmLines.indexOf(line);
      if (lineIdx + 1 < fmLines.length) {
        const nextTrimmed = fmLines[lineIdx + 1].trim();
        if (nextTrimmed.startsWith("- ")) {
          currentArray = [];
        } else if (fmLines[lineIdx + 1].startsWith("  ")) {
          currentObject = {};
        }
      }
      continue;
    }

    // Inline array: [a, b, c]
    if (rawVal.startsWith("[") && rawVal.endsWith("]")) {
      const inner = rawVal.slice(1, -1);
      data[key] = inner
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      continue;
    }

    // Boolean
    if (rawVal === "true") { data[key] = true; continue; }
    if (rawVal === "false") { data[key] = false; continue; }

    // String
    data[key] =
      rawVal.startsWith('"') && rawVal.endsWith('"')
        ? rawVal.slice(1, -1)
        : rawVal;
  }

  // Flush trailing
  if (currentArray !== null) data[currentKey] = currentArray;
  if (currentObject !== null) data[currentKey] = currentObject;

  // Validate required fields
  if (typeof data.id !== "string" || !data.id) {
    return { frontmatter: null, body: content };
  }

  const fm: Frontmatter = {
    id: data.id as string,
    keywords: Array.isArray(data.keywords) ? (data.keywords as string[]) : [],
    patterns: Array.isArray(data.patterns) ? (data.patterns as string[]) : [],
    priority: VALID_PRIORITIES.has(data.priority as string)
      ? (data.priority as Priority)
      : "domain",
    triggers: parseTriggers(data.triggers),
  };

  return { frontmatter: fm, body };
}

function parseTriggers(raw: unknown): Triggers {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_TRIGGERS };
  const obj = raw as Record<string, boolean>;
  return {
    task: typeof obj.task === "boolean" ? obj.task : DEFAULT_TRIGGERS.task,
    plan: typeof obj.plan === "boolean" ? obj.plan : DEFAULT_TRIGGERS.plan,
    edit: typeof obj.edit === "boolean" ? obj.edit : DEFAULT_TRIGGERS.edit,
  };
}

// ── Serialize frontmatter to string ────────────────────────────
export function serializeFrontmatter(fm: Frontmatter): string {
  const lines: string[] = ["---"];
  lines.push(`id: ${fm.id}`);
  lines.push(`keywords: [${fm.keywords.join(", ")}]`);
  if (fm.patterns.length > 0) {
    lines.push(`patterns: [${fm.patterns.join(", ")}]`);
  }
  lines.push(`priority: ${fm.priority}`);
  lines.push("triggers:");
  lines.push(`  task: ${fm.triggers.task}`);
  lines.push(`  plan: ${fm.triggers.plan}`);
  lines.push(`  edit: ${fm.triggers.edit}`);
  lines.push("---");
  return lines.join("\n");
}
