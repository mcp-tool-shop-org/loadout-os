/**
 * Mechanical split of root MEMORY.md entries into sub-indexes (`index-*.md` with
 * `metadata.loadout_role: subindex`).
 *
 * Guarantees:
 * 1. Keeps every entry and its priority (`core`, `domain`, `manual`).
 * 2. Writes nothing to the store on `--dry-run`.
 * 3. Proves the entry count (and per-entry priority) is unchanged by running
 *    `analyzeMemoryMd` + `generateIndex` against a staged verification copy
 *    before touching the store; refuses (`SplitError`) if the count or any
 *    entry's priority differs.
 */

import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import type { LoadoutEntry, Priority } from "@mcptoolshop/ai-loadout";
import { analyzeMemoryMd, detectSubindex } from "./analyze.js";
import { generateIndex, hasExplicitPriority } from "./index-gen.js";
import { parseMemoryMd } from "./parser.js";
import { resolveRefPath } from "./paths.js";
import type { IdSource, MemoryRef } from "./types.js";

const VALID_PRIORITIES = new Set<string>(["core", "domain", "manual"]);

export class SplitError extends Error {
  readonly code: string;
  readonly hint?: string;

  constructor(code: string, message: string, hint?: string) {
    super(message);
    this.name = "SplitError";
    this.code = code;
    this.hint = hint;
  }
}

export interface SplitMatcher {
  sections?: string[];
  prefixes?: string[];
  pattern?: string;
  globs?: string[];
  ids?: string[];
  files?: string[];
  keywords?: string[];
  priorities?: Priority[];
  catchAll?: boolean;
}

export interface SplitRule extends SplitMatcher {
  /** Target sub-index filename (e.g. `index-feedback.md` or shorthand `feedback`). */
  subindex: string;
  /** Human-readable heading / link title for the sub-index. */
  title: string;
  /** Summary description used in the sub-index frontmatter and MEMORY.md link bullet. */
  description: string;
  /** Optional `metadata.loadout_default_priority` to set on the generated sub-index. */
  defaultPriority?: Priority;
  /**
   * Optional rule flag that drops matched entries instead of writing them to a
   * sub-index (used to verify that the entry-count proof refuses lossy splits).
   */
  drop?: boolean;
}

export interface SplitRulesConfig {
  rules: SplitRule[];
  keepInRoot?: SplitMatcher;
}

export interface SplitSubindexSummary {
  subindex: string;
  title: string;
  description: string;
  movedCount: number;
  totalEntries: number;
  created: boolean;
  entryIds: string[];
}

export interface SplitResult {
  memoryMd: string;
  storeDir: string;
  dryRun: boolean;
  beforeEntryCount: number;
  afterEntryCount: number;
  entryCountUnchanged: boolean;
  prioritiesUnchanged: boolean;
  movedEntryCount: number;
  keptInRootCount: number;
  beforeMemoryMdBytes: number;
  afterMemoryMdBytes: number;
  subindexes: SplitSubindexSummary[];
}

export interface ProposedSplitFiles {
  memoryMdContent: string;
  subindexContents: Map<string, string>;
}

export interface SplitMemoryOptions {
  dryRun?: boolean;
  idSource?: IdSource;
  projectMode?: boolean;
  /** Optional hook for testing post-split verification against tampered output. */
  _transformProposed?: (proposed: ProposedSplitFiles) => ProposedSplitFiles;
}

function toStringArray(val: unknown): string[] | undefined {
  if (typeof val === "string" && val.trim().length > 0) {
    return [val.trim()];
  }
  if (Array.isArray(val)) {
    const out = val
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .map((x) => x.trim());
    return out.length > 0 ? out : undefined;
  }
  return undefined;
}

function toPriorityArray(val: unknown): Priority[] | undefined {
  const arr = toStringArray(val);
  if (!arr) return undefined;
  const valid = arr.filter((p): p is Priority => VALID_PRIORITIES.has(p));
  return valid.length > 0 ? valid : undefined;
}

/**
 * Normalize a sub-index target name (e.g. `"feedback"`, `"index-feedback"`, `"index-feedback.md"`)
 * into an `index-*.md` filename.
 */
export function normalizeSubindexFilename(raw: string): string {
  const clean = basename(raw.trim());
  if (!clean) {
    throw new SplitError(
      "INVALID_SPLIT_RULES",
      "Sub-index target filename cannot be empty",
      "Specify a subindex name such as \"index-feedback.md\" or \"feedback\"",
    );
  }
  const withExt = clean.toLowerCase().endsWith(".md") ? clean : `${clean}.md`;
  if (/^index-.+\.md$/i.test(withExt)) {
    return withExt;
  }
  return `index-${withExt}`;
}

function deriveTitleFromSubindex(subindexFile: string): string {
  const stem = basename(subindexFile, ".md").replace(/^index-/i, "");
  return stem
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function parseMatcherObject(obj: Record<string, unknown>): SplitMatcher {
  const matchSub =
    obj.match && typeof obj.match === "object" && !Array.isArray(obj.match)
      ? (obj.match as Record<string, unknown>)
      : {};
  const merged = { ...obj, ...matchSub };

  const sections =
    toStringArray(merged.sections) ?? toStringArray(merged.section);
  const prefixes =
    toStringArray(merged.prefixes) ?? toStringArray(merged.prefix);
  const pattern =
    typeof merged.pattern === "string" && merged.pattern.trim()
      ? merged.pattern.trim()
      : typeof merged.regex === "string" && merged.regex.trim()
        ? merged.regex.trim()
        : undefined;
  const globs =
    toStringArray(merged.globs) ??
    toStringArray(merged.glob) ??
    (typeof obj.match === "string" ? [obj.match.trim()] : undefined);
  const ids = toStringArray(merged.ids) ?? toStringArray(merged.id);
  const files =
    toStringArray(merged.files) ??
    toStringArray(merged.paths) ??
    (Array.isArray(merged.file) ? toStringArray(merged.file) : undefined);
  const keywords =
    toStringArray(merged.keywords) ?? toStringArray(merged.keyword);
  const priorities =
    toPriorityArray(merged.priorities) ?? toPriorityArray(merged.priority);
  const catchAll =
    merged.catchAll === true ||
    merged.default === true ||
    merged.all === true ||
    merged.match === "*";

  return {
    ...(sections ? { sections } : {}),
    ...(prefixes ? { prefixes } : {}),
    ...(pattern ? { pattern } : {}),
    ...(globs ? { globs } : {}),
    ...(ids ? { ids } : {}),
    ...(files ? { files } : {}),
    ...(keywords ? { keywords } : {}),
    ...(priorities ? { priorities } : {}),
    ...(catchAll ? { catchAll: true } : {}),
  };
}

function parseSingleRule(raw: unknown, fallbackTarget?: string): SplitRule {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new SplitError(
      "INVALID_SPLIT_RULES",
      "Each split rule must be a JSON object",
      "Provide rules as objects with a target subindex and matching criteria",
    );
  }
  const obj = raw as Record<string, unknown>;
  const rawTarget =
    (typeof obj.subindex === "string" && obj.subindex) ||
    (typeof obj.target === "string" && obj.target) ||
    (typeof obj.index === "string" && obj.index) ||
    (typeof obj.file === "string" && obj.file) ||
    (typeof obj.name === "string" && obj.name) ||
    fallbackTarget;

  const isDrop = obj.drop === true || obj.action === "drop";
  const subindex = rawTarget
    ? normalizeSubindexFilename(rawTarget)
    : isDrop
      ? "index-dropped.md"
      : "";
  if (!subindex) {
    throw new SplitError(
      "INVALID_SPLIT_RULES",
      "Split rule is missing a target `subindex` (or `target` / `name`) field",
      "Add e.g. \"subindex\": \"index-feedback.md\" to each rule in rules.json",
    );
  }

  const title =
    (typeof obj.title === "string" && obj.title.trim()) ||
    (typeof obj.heading === "string" && obj.heading.trim()) ||
    deriveTitleFromSubindex(subindex);
  const description =
    (typeof obj.description === "string" && obj.description.trim()) ||
    (typeof obj.summary === "string" && obj.summary.trim()) ||
    `Sub-index for ${title} memories`;

  const rawDefaultPriority = obj.defaultPriority ?? obj.loadout_default_priority;
  const defaultPriority =
    typeof rawDefaultPriority === "string" && VALID_PRIORITIES.has(rawDefaultPriority)
      ? (rawDefaultPriority as Priority)
      : undefined;

  const matcher = parseMatcherObject(obj);

  return {
    subindex,
    title,
    description,
    ...(defaultPriority ? { defaultPriority } : {}),
    ...(isDrop ? { drop: true } : {}),
    ...matcher,
  };
}

/**
 * Parse a `<rules.json>` configuration object into normalized `SplitRulesConfig`.
 */
export function parseSplitRules(raw: unknown): SplitRulesConfig {
  if (Array.isArray(raw)) {
    if (raw.length === 0) {
      throw new SplitError(
        "INVALID_SPLIT_RULES",
        "Split rules array cannot be empty",
        "Add at least one split rule to rules.json",
      );
    }
    return {
      rules: raw.map((item) => parseSingleRule(item)),
    };
  }

  if (!raw || typeof raw !== "object") {
    throw new SplitError(
      "INVALID_SPLIT_RULES",
      "Split rules JSON must be an object or an array of rules",
      "Provide { \"rules\": [ ... ] } or an array of rule objects",
    );
  }

  const obj = raw as Record<string, unknown>;
  const keepRaw = obj.keepInRoot ?? obj.keep;
  const keepInRoot =
    keepRaw && typeof keepRaw === "object" && !Array.isArray(keepRaw)
      ? parseMatcherObject(keepRaw as Record<string, unknown>)
      : undefined;

  const rulesArray = obj.rules ?? obj.subindexes ?? obj.groups;
  if (Array.isArray(rulesArray)) {
    if (rulesArray.length === 0) {
      throw new SplitError(
        "INVALID_SPLIT_RULES",
        "Split rules list cannot be empty",
        "Add at least one rule in `rules`",
      );
    }
    return {
      rules: rulesArray.map((item) => parseSingleRule(item)),
      ...(keepInRoot ? { keepInRoot } : {}),
    };
  }

  // Also support map shorthand: { "index-feedback.md": { ... } } or { "feedback": ["a.md", "b.md"] }
  const rules: SplitRule[] = [];
  for (const [key, val] of Object.entries(obj)) {
    if (key === "keepInRoot" || key === "keep") continue;
    if (Array.isArray(val)) {
      const strs = toStringArray(val) ?? [];
      const hasGlobs = strs.some((s) => s.includes("*"));
      const hasMd = strs.some((s) => s.toLowerCase().endsWith(".md"));
      rules.push(
        parseSingleRule(
          hasGlobs
            ? { globs: strs }
            : hasMd
              ? { files: strs }
              : { prefixes: strs, ids: strs, sections: strs },
          key,
        ),
      );
    } else if (typeof val === "string") {
      const s = val.trim();
      rules.push(
        parseSingleRule(
          s === "*"
            ? { catchAll: true }
            : s.includes("*")
              ? { glob: s }
              : { prefix: s, section: s },
          key,
        ),
      );
    } else if (val && typeof val === "object") {
      rules.push(parseSingleRule(val, key));
    }
  }

  if (rules.length === 0) {
    throw new SplitError(
      "INVALID_SPLIT_RULES",
      "No valid split rules found in rules configuration",
      "Provide a `rules` array in rules.json",
    );
  }

  return {
    rules,
    ...(keepInRoot ? { keepInRoot } : {}),
  };
}

/**
 * Load and parse a `<rules.json>` file from disk.
 */
export function loadSplitRulesFile(rulesFilePath: string): SplitRulesConfig {
  const abs = resolve(rulesFilePath);
  if (!existsSync(abs)) {
    throw new SplitError(
      "RULES_FILE_NOT_FOUND",
      `Split rules file not found: ${rulesFilePath}`,
      "Pass a valid path to --by <rules.json>",
    );
  }
  let rawText: string;
  try {
    rawText = readFileSync(abs, "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new SplitError(
      "RULES_READ_FAILED",
      `Cannot read split rules file ${rulesFilePath}: ${msg}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new SplitError(
      "INVALID_RULES_JSON",
      `Invalid JSON in ${rulesFilePath}: ${msg}`,
      "Ensure the --by <rules.json> file contains valid JSON",
    );
  }
  return parseSplitRules(parsed);
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function matchesCriterion(
  matcher: SplitMatcher,
  ctx: {
    ref: MemoryRef;
    sectionHeading: string;
    entry?: LoadoutEntry;
  },
): boolean {
  const fileBase = basename(ctx.ref.path);
  const fileStem = fileBase.replace(/\.md$/i, "");
  const normPath = ctx.ref.path.replace(/\\/g, "/");
  const entryId = ctx.entry?.id ?? fileStem;

  let hasAnyCriterion = false;

  if (matcher.catchAll) {
    return true;
  }

  if (matcher.sections && matcher.sections.length > 0) {
    hasAnyCriterion = true;
    const h = ctx.sectionHeading.trim().toLowerCase();
    if (
      matcher.sections.some((s) => {
        const target = s.trim().toLowerCase();
        return h === target || h.includes(target);
      })
    ) {
      return true;
    }
  }

  if (matcher.prefixes && matcher.prefixes.length > 0) {
    hasAnyCriterion = true;
    const candidates = [
      fileBase.toLowerCase(),
      fileStem.toLowerCase(),
      normPath.toLowerCase(),
      entryId.toLowerCase(),
    ];
    if (
      matcher.prefixes.some((p) => {
        const pref = p.toLowerCase();
        return candidates.some((c) => c.startsWith(pref));
      })
    ) {
      return true;
    }
  }

  if (matcher.pattern) {
    hasAnyCriterion = true;
    const re = new RegExp(matcher.pattern, "i");
    if (
      re.test(normPath) ||
      re.test(fileBase) ||
      re.test(ctx.ref.name) ||
      re.test(entryId)
    ) {
      return true;
    }
  }

  if (matcher.globs && matcher.globs.length > 0) {
    hasAnyCriterion = true;
    if (
      matcher.globs.some((g) => {
        const re = globToRegExp(g);
        return re.test(normPath) || re.test(fileBase) || re.test(entryId);
      })
    ) {
      return true;
    }
  }

  if (matcher.ids && matcher.ids.length > 0) {
    hasAnyCriterion = true;
    const idSet = new Set(matcher.ids.map((i) => i.toLowerCase()));
    if (idSet.has(entryId.toLowerCase()) || idSet.has(fileStem.toLowerCase())) {
      return true;
    }
  }

  if (matcher.files && matcher.files.length > 0) {
    hasAnyCriterion = true;
    const fSet = new Set(
      matcher.files.map((f) => f.replace(/\\/g, "/").toLowerCase()),
    );
    if (
      fSet.has(normPath.toLowerCase()) ||
      fSet.has(fileBase.toLowerCase()) ||
      fSet.has(fileStem.toLowerCase())
    ) {
      return true;
    }
  }

  if (matcher.keywords && matcher.keywords.length > 0) {
    hasAnyCriterion = true;
    const entryKw = new Set(
      (ctx.entry?.keywords ?? []).map((k: string) => k.toLowerCase()),
    );
    if (matcher.keywords.some((k) => entryKw.has(k.toLowerCase()))) {
      return true;
    }
  }

  if (matcher.priorities && matcher.priorities.length > 0) {
    hasAnyCriterion = true;
    const p = ctx.entry?.priority ?? "domain";
    if (matcher.priorities.includes(p)) {
      return true;
    }
  }

  return hasAnyCriterion ? false : false;
}

function writeAtomic(filePath: string, content: string): void {
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  writeFileSync(tmpPath, content, "utf-8");
  renameSync(tmpPath, filePath);
}

/**
 * Mechanically split root entries in `memoryMdPath` into sub-indexes according
 * to `rulesInput` (either a parsed `SplitRulesConfig` or a raw JSON object).
 */
export function splitMemoryStore(
  memoryMdPath: string,
  rulesInput: SplitRulesConfig | unknown,
  opts: SplitMemoryOptions = {},
): SplitResult {
  const absMemoryMd = resolve(memoryMdPath);
  if (!existsSync(absMemoryMd)) {
    throw new SplitError(
      "MEMORY_MD_NOT_FOUND",
      `MEMORY.md not found at ${memoryMdPath}`,
      "Pass a valid path to MEMORY.md or --store <dir>",
    );
  }

  const rulesConfig =
    rulesInput &&
    typeof rulesInput === "object" &&
    "rules" in (rulesInput as Record<string, unknown>) &&
    Array.isArray((rulesInput as SplitRulesConfig).rules) &&
    (rulesInput as SplitRulesConfig).rules.every(
      (r) => r && typeof r.subindex === "string" && typeof r.title === "string",
    )
      ? (rulesInput as SplitRulesConfig)
      : parseSplitRules(rulesInput);

  const storeDir = dirname(absMemoryMd);
  const parentDir = dirname(storeDir);
  const dryRun = !!opts.dryRun;

  // 1. Baseline analysis + index before splitting
  const beforeMemoryMdRaw = readFileSync(absMemoryMd, "utf-8");
  const beforeMemoryMdBytes = Buffer.byteLength(beforeMemoryMdRaw, "utf-8");
  const beforeAnalysis = analyzeMemoryMd(absMemoryMd);
  const beforeIndex = generateIndex(beforeAnalysis, {
    idSource: opts.idSource,
    projectMode: opts.projectMode,
  });

  const beforeEntryCount = beforeIndex.entries.length;
  const beforeById = new Map<string, LoadoutEntry>();
  const beforeByNormPath = new Map<string, LoadoutEntry>();
  for (const entry of beforeIndex.entries) {
    beforeById.set(entry.id, entry);
    beforeByNormPath.set(entry.path.replace(/\\/g, "/"), entry);
    beforeByNormPath.set(basename(entry.path), entry);
  }

  // 2. Parse root MEMORY.md lines, sections, and top-level refs
  const lines = beforeMemoryMdRaw.split(/\r?\n/);
  const { sections, refs: topRefs } = parseMemoryMd(lines.join("\n"));

  const sectionForLine = (lineIdx: number): string => {
    for (const sec of sections) {
      if (lineIdx >= sec.startLine && lineIdx <= sec.endLine) {
        return sec.heading;
      }
    }
    return "";
  };

  // Track existing sub-index links in MEMORY.md so we never move a sub-index bullet
  // or insert duplicate links to an already-linked sub-index.
  const existingSubindexLinks = new Set<string>();
  for (const ref of topRefs) {
    const resolved = resolveRefPath(ref.path, storeDir, parentDir);
    if (!resolved || !existsSync(resolved)) continue;
    try {
      const refContent = readFileSync(resolved, "utf-8");
      if (detectSubindex(ref.path, refContent).isSubindex) {
        existingSubindexLinks.add(basename(resolved).toLowerCase());
      }
    } catch {
      // ignore
    }
  }

  interface Bucket {
    rule: SplitRule;
    subindexFile: string;
    firstLineIdx: number;
    movedRefs: MemoryRef[];
    movedBulletLines: string[];
    movedEntries: LoadoutEntry[];
    movedHasImplicitDomainPriority: boolean;
  }

  const bucketsBySubindex = new Map<string, Bucket>();
  const linesToRemove = new Set<number>();
  const lineInsertions = new Map<number, string[]>();
  let movedEntryCount = 0;
  let keptInRootCount = 0;

  // Group top-level topic refs by resolved file path so duplicate bullets to the
  // same file in root MEMORY.md move together cleanly.
  const decisionByResolved = new Map<string, SplitRule | null>();

  for (const ref of topRefs) {
    const resolved = resolveRefPath(ref.path, storeDir, parentDir);
    if (!resolved || !existsSync(resolved)) {
      keptInRootCount++;
      continue;
    }

    let topicContent = "";
    try {
      topicContent = readFileSync(resolved, "utf-8");
    } catch {
      keptInRootCount++;
      continue;
    }

    if (detectSubindex(ref.path, topicContent).isSubindex) {
      continue;
    }

    const relPath = relative(storeDir, resolved).replace(/\\/g, "/");
    const entry =
      beforeByNormPath.get(relPath) ??
      beforeByNormPath.get(ref.path.replace(/\\/g, "/")) ??
      beforeByNormPath.get(basename(resolved));
    const secHeading = sectionForLine(ref.line);
    const canonicalTopic = resolve(resolved);

    let matchedRule: SplitRule | null;
    if (decisionByResolved.has(canonicalTopic)) {
      matchedRule = decisionByResolved.get(canonicalTopic)!;
    } else {
      if (
        rulesConfig.keepInRoot &&
        matchesCriterion(rulesConfig.keepInRoot, {
          ref,
          sectionHeading: secHeading,
          entry,
        })
      ) {
        matchedRule = null;
      } else {
        matchedRule =
          rulesConfig.rules.find((r) =>
            matchesCriterion(r, {
              ref,
              sectionHeading: secHeading,
              entry,
            }),
          ) ?? null;
      }
      decisionByResolved.set(canonicalTopic, matchedRule);
    }

    if (!matchedRule) {
      keptInRootCount++;
      continue;
    }

    linesToRemove.add(ref.line);
    movedEntryCount++;

    if (matchedRule.drop) {
      // Drop rule: removes line from MEMORY.md without adding to a sub-index.
      // Post-split verification will catch the entry count difference and refuse.
      continue;
    }

    const subFile = matchedRule.subindex;
    const subKey = subFile.toLowerCase();
    let bucket = bucketsBySubindex.get(subKey);
    if (!bucket) {
      bucket = {
        rule: matchedRule,
        subindexFile: subFile,
        firstLineIdx: ref.line,
        movedRefs: [],
        movedBulletLines: [],
        movedEntries: [],
        movedHasImplicitDomainPriority: false,
      };
      bucketsBySubindex.set(subKey, bucket);
    }

    bucket.movedRefs.push(ref);
    bucket.movedBulletLines.push(lines[ref.line]);
    if (entry) {
      bucket.movedEntries.push(entry);
    }
    if (!hasExplicitPriority(topicContent) && (entry?.priority ?? "domain") === "domain") {
      bucket.movedHasImplicitDomainPriority = true;
    }
  }

  // 3. Build proposed sub-index file contents and schedule link insertions in MEMORY.md
  const proposedSubindexes = new Map<string, string>();
  const subindexSummaries: SplitSubindexSummary[] = [];

  for (const [, bucket] of bucketsBySubindex) {
    const subAbs = join(storeDir, bucket.subindexFile);
    const existed = existsSync(subAbs);
    let subContent: string;

    if (existed) {
      const existingRaw = readFileSync(subAbs, "utf-8");
      const existingRefs = parseMemoryMd(existingRaw).refs;
      const existingPaths = new Set(
        existingRefs.map((r) => basename(r.path).toLowerCase()),
      );
      const newLines = bucket.movedRefs
        .map((r, i) => ({ ref: r, line: bucket.movedBulletLines[i] }))
        .filter(({ ref }) => !existingPaths.has(basename(ref.path).toLowerCase()))
        .map(({ line }) => line);

      const trimmed = existingRaw.trimEnd();
      subContent =
        newLines.length > 0
          ? `${trimmed}\n${newLines.join("\n")}\n`
          : `${trimmed}\n`;
    } else {
      // Ensure priority preservation if target is named `index-archive.md` (which
      // defaults to `manual` unless `loadout_default_priority` is specified) or if
      // the rule sets a defaultPriority.
      const effectiveDefaultPriority =
        bucket.rule.defaultPriority ??
        (bucket.subindexFile.toLowerCase() === "index-archive.md" &&
        bucket.movedHasImplicitDomainPriority
          ? "domain"
          : undefined);

      const fmLines = [
        "---",
        `name: ${bucket.rule.title}`,
        `description: ${bucket.rule.description}`,
        "metadata:",
        "  loadout_role: subindex",
        ...(effectiveDefaultPriority
          ? [`  loadout_default_priority: ${effectiveDefaultPriority}`]
          : []),
        "---",
        "",
        `# ${bucket.rule.title}`,
        "",
        ...bucket.movedBulletLines,
        "",
      ];
      subContent = fmLines.join("\n");
    }

    proposedSubindexes.set(bucket.subindexFile, subContent);

    // Insert sub-index link into MEMORY.md at the first moved entry's line if not already linked
    const subKey = bucket.subindexFile.toLowerCase();
    if (!existingSubindexLinks.has(subKey)) {
      existingSubindexLinks.add(subKey);
      const linkBullet = `- [${bucket.rule.title}](${bucket.subindexFile}) — ${bucket.rule.description}`;
      const list = lineInsertions.get(bucket.firstLineIdx) ?? [];
      list.push(linkBullet);
      lineInsertions.set(bucket.firstLineIdx, list);
    }

    const totalSubEntries = parseMemoryMd(subContent).refs.length;
    subindexSummaries.push({
      subindex: bucket.subindexFile,
      title: bucket.rule.title,
      description: bucket.rule.description,
      movedCount: bucket.movedRefs.length,
      totalEntries: totalSubEntries,
      created: !existed,
      entryIds: bucket.movedEntries.map((e) => e.id),
    });
  }

  // 4. Reconstruct MEMORY.md content
  const updatedMemoryLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const insertions = lineInsertions.get(i);
    if (insertions) {
      updatedMemoryLines.push(...insertions);
    }
    if (!linesToRemove.has(i)) {
      updatedMemoryLines.push(lines[i]);
    }
  }
  const rawJoined = updatedMemoryLines.join("\n");
  const proposedMemoryMd = rawJoined.endsWith("\n") ? rawJoined : `${rawJoined}\n`;

  let proposed: ProposedSplitFiles = {
    memoryMdContent: proposedMemoryMd,
    subindexContents: proposedSubindexes,
  };
  if (opts._transformProposed) {
    proposed = opts._transformProposed(proposed);
  }

  // 5. Prove entry count and per-entry priority are unchanged in an isolated temp dir
  const verifyRoot = mkdtempSync(join(tmpdir(), "loadout-split-verify-"));
  let afterEntryCount = 0;
  try {
    const verifyStoreDir = join(verifyRoot, "store");
    cpSync(storeDir, verifyStoreDir, { recursive: true });
    const verifyMemoryMd = join(verifyStoreDir, basename(absMemoryMd));
    writeFileSync(verifyMemoryMd, proposed.memoryMdContent, "utf-8");
    for (const [subFile, content] of proposed.subindexContents) {
      writeFileSync(join(verifyStoreDir, subFile), content, "utf-8");
    }

    const afterAnalysis = analyzeMemoryMd(verifyMemoryMd);
    const afterIndex = generateIndex(afterAnalysis, {
      idSource: opts.idSource,
      projectMode: opts.projectMode,
    });
    afterEntryCount = afterIndex.entries.length;

    if (afterEntryCount !== beforeEntryCount) {
      throw new SplitError(
        "ENTRY_COUNT_MISMATCH",
        `Refusing split: entry count changed from ${beforeEntryCount} to ${afterEntryCount}`,
        "Every root entry must be preserved in either MEMORY.md or a linked sub-index",
      );
    }

    const afterById = new Map<string, LoadoutEntry>(
      afterIndex.entries.map((e) => [e.id, e]),
    );
    for (const [id, beforeEntry] of beforeById) {
      const afterEntry = afterById.get(id);
      if (!afterEntry) {
        throw new SplitError(
          "ENTRY_MISSING_AFTER_SPLIT",
          `Refusing split: entry "${id}" (${beforeEntry.path}) is missing after split`,
          "Ensure all entries remain reachable from MEMORY.md or a linked sub-index",
        );
      }
      if (afterEntry.priority !== beforeEntry.priority) {
        throw new SplitError(
          "PRIORITY_MISMATCH",
          `Refusing split: entry "${id}" priority changed from "${beforeEntry.priority}" to "${afterEntry.priority}"`,
          "Sub-index defaultPriority must not alter existing entry priorities",
        );
      }
    }
  } finally {
    rmSync(verifyRoot, { recursive: true, force: true });
  }

  const afterMemoryMdBytes = Buffer.byteLength(proposed.memoryMdContent, "utf-8");

  // 6. Commit atomically only when not in --dry-run mode
  if (!dryRun) {
    for (const [subFile, content] of proposed.subindexContents) {
      writeAtomic(join(storeDir, subFile), content);
    }
    writeAtomic(absMemoryMd, proposed.memoryMdContent);
  }

  return {
    memoryMd: absMemoryMd,
    storeDir,
    dryRun,
    beforeEntryCount,
    afterEntryCount,
    entryCountUnchanged: beforeEntryCount === afterEntryCount,
    prioritiesUnchanged: true,
    movedEntryCount,
    keptInRootCount,
    beforeMemoryMdBytes,
    afterMemoryMdBytes,
    subindexes: subindexSummaries,
  };
}
