/**
 * Frontmatter parser and serializer.
 *
 * Parses YAML-like --- delimited blocks from payload files.
 * Hand-rolled: supports strings, inline arrays, booleans, numbers, and
 * one level of nested objects (triggers, metadata). No deps, deterministic.
 */

import type { Frontmatter, Priority, Triggers } from "./types.js";
import { DEFAULT_TRIGGERS } from "./types.js";

const VALID_PRIORITIES = new Set<string>(["core", "domain", "manual"]);

function slugifyName(name: string): string {
  const parts: string[] = [];
  let current = "";
  const lower = name.toLowerCase();
  for (let i = 0; i < lower.length; i++) {
    const code = lower.charCodeAt(i);
    // Strip ASCII and curly apostrophes the way nameToId does so "Tool's" -> "tools" (Q5-1a)
    if (code === 39 || code === 8217 || code === 8216) {
      continue;
    }
    const isAlphaNum = (code >= 97 && code <= 122) || (code >= 48 && code <= 57);
    if (isAlphaNum) {
      current += lower[i];
    } else if (current.length > 0) {
      parts.push(current);
      current = "";
    }
  }
  if (current.length > 0) {
    parts.push(current);
  }
  return parts.join("-");
}

function unquoteScalar(rawVal: string): string {
  if (rawVal.startsWith('"') && rawVal.endsWith('"') && rawVal.length >= 2) {
    return rawVal.slice(1, -1).replace(/\\"/g, '"');
  }
  if (rawVal.startsWith("'") && rawVal.endsWith("'") && rawVal.length >= 2) {
    return rawVal.slice(1, -1).replace(/\\'/g, "'");
  }
  return rawVal;
}

function parseScalarValue(rawVal: string): string | number | boolean {
  if (rawVal === "true") return true;
  if (rawVal === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(rawVal)) {
    const n = Number(rawVal);
    if (Number.isFinite(n)) return n;
  }
  return unquoteScalar(rawVal);
}

// ── Parse frontmatter from file content ────────────────────────
export function parseFrontmatter(
  content: string,
): { frontmatter: Frontmatter | null; body: string } {
  const normalized = content.startsWith("\ufeff") ? content.slice(1) : content;
  const lines = normalized.split("\n");

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
  let currentObject: Record<string, string | number | boolean> | null = null;

  for (let i = 0; i < fmLines.length; i++) {
    const line = fmLines[i];
    const trimmed = line.trim();
    if (trimmed === "") continue;

    // Block array item
    if (currentArray !== null && trimmed.startsWith("- ")) {
      currentArray.push(unquoteScalar(trimmed.slice(2).trim()));
      continue;
    }

    // Nested object value (indented)
    if (currentObject !== null && line.startsWith("  ")) {
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx !== -1) {
        const key = trimmed.slice(0, colonIdx).trim();
        const val = trimmed.slice(colonIdx + 1).trim();
        currentObject[key] = parseScalarValue(val);
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

    // Indented lines outside a recognized block are not top-level keys
    if (line.startsWith(" ") || line.startsWith("\t")) continue;

    // Key: value pair
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const rawVal = trimmed.slice(colonIdx + 1).trim();
    currentKey = key;

    if (rawVal === "") {
      // Peek at next line to determine if block array or object.
      // Use the loop index `i` directly: indexOf(line) would return the
      // first byte-identical line, mis-resolving duplicate-value keys.
      if (i + 1 < fmLines.length) {
        const nextTrimmed = fmLines[i + 1].trim();
        if (nextTrimmed.startsWith("- ")) {
          currentArray = [];
        } else if (fmLines[i + 1].startsWith("  ")) {
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
        .map((s) => unquoteScalar(s.trim()))
        .filter((s) => s.length > 0);
      continue;
    }

    // Boolean
    if (rawVal === "true") { data[key] = true; continue; }
    if (rawVal === "false") { data[key] = false; continue; }

    // String
    data[key] = unquoteScalar(rawVal);
  }

  // Flush trailing
  if (currentArray !== null) data[currentKey] = currentArray;
  if (currentObject !== null) data[currentKey] = currentObject;

  const metadata: Record<string, string | number | boolean> = {};
  if (data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)) {
    Object.assign(metadata, data.metadata as Record<string, string | number | boolean>);
  }
  for (const TopMetaKey of [
    "loadout_role",
    "loadout_inject",
    "loadout_default_priority",
    "stale_after_min",
    "enforce_limits",
    "max_lines",
    "max_bytes",
  ]) {
    if (data[TopMetaKey] !== undefined && metadata[TopMetaKey] === undefined) {
      const val = data[TopMetaKey];
      if (typeof val === "string") {
        metadata[TopMetaKey] = parseScalarValue(val);
      } else if (typeof val === "number" || typeof val === "boolean") {
        metadata[TopMetaKey] = val;
      }
    }
  }

  // F-03 / #19: Read top-level `id:`, falling back to `metadata.id`, then
  // slugified `name:` so Claude Code memory files parse into Frontmatter even
  // when Claude Code nests frontmatter keys under `metadata:`.
  const topId = typeof data.id === "string" && data.id.trim() ? data.id.trim() : "";
  const metaId = typeof metadata.id === "string" && metadata.id.trim() ? metadata.id.trim() : "";
  const rawId = topId
    ? topId
    : metaId
      ? metaId
      : typeof data.name === "string" && data.name.trim()
        ? slugifyName(data.name.trim())
        : "";

  if (!rawId) {
    return { frontmatter: null, body: content };
  }

  const priority: Priority = VALID_PRIORITIES.has(data.priority as string)
    ? (data.priority as Priority)
    : VALID_PRIORITIES.has(metadata.priority as string)
      ? (metadata.priority as Priority)
      : "domain";

  const fm: Frontmatter = {
    id: rawId,
    ...(typeof data.name === "string" && data.name.trim() ? { name: data.name.trim() } : {}),
    ...(typeof data.description === "string" && data.description.trim()
      ? { description: data.description.trim() }
      : {}),
    keywords: Array.isArray(data.keywords) ? (data.keywords as string[]) : [],
    patterns: Array.isArray(data.patterns) ? (data.patterns as string[]) : [],
    priority,
    triggers: parseTriggers(data.triggers),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };

  return { frontmatter: fm, body };
}

function parseTriggers(raw: unknown): Triggers {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_TRIGGERS };
  const obj = raw as Record<string, unknown>;
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
  if (fm.name) lines.push(`name: ${fm.name}`);
  if (fm.description) lines.push(`description: ${fm.description}`);
  lines.push(`keywords: [${fm.keywords.join(", ")}]`);
  if (fm.patterns.length > 0) {
    lines.push(`patterns: [${fm.patterns.join(", ")}]`);
  }
  lines.push(`priority: ${fm.priority}`);
  lines.push("triggers:");
  lines.push(`  task: ${fm.triggers.task}`);
  lines.push(`  plan: ${fm.triggers.plan}`);
  lines.push(`  edit: ${fm.triggers.edit}`);
  if (fm.metadata && Object.keys(fm.metadata).length > 0) {
    lines.push("metadata:");
    for (const [k, v] of Object.entries(fm.metadata)) {
      lines.push(`  ${k}: ${v}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}
