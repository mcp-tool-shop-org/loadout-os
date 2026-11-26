import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..");

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".md",
  ".mdx",
  ".astro",
  ".json",
  ".css",
  ".html",
  ".yaml",
  ".yml",
  ".txt",
]);

interface NeedleSpec {
  label: string;
  regex: RegExp;
  preprocessLine?: (line: string) => string;
}

function buildRoleAndMemorySpecs(): NeedleSpec[] {
  const w1 = ["dir", "ector"].join("");
  const w2 = ["pub", "lisher"].join("");
  const w3 = ["se", "at"].join("");
  const w4 = ["rn", "d"].join("");
  const w4Amp = ["r&", "d"].join("");
  const w5 = ["stu", "dio"].join("");
  const w6 = ["ar", "gon"].join("");
  const wSlug = ["f--", "ai"].join("");

  const memoryIds = [
    [w2, "merges"].join("-"),
    ["rule", "coord" + "inator", "and", "merges"].join("-"),
    ["feed", "back", "feed", "back", "never", "quote", "the", w1, "md"].join(""),
    ["never", "quote", w1, "in", "public"].join("-"),
    ["rule", w1, "communication"].join("-"),
    ["build", "in", w5, "tools", "not", "side", "scripts"].join("-"),
    ["reference", "memory", "system"].join("-"),
    [w4, "memory", "system"].join("-"),
    [w2, "approves", "every", "publish"].join("-"),
  ];

  const stripDirectoryWords = (line: string): string =>
    line.replace(new RegExp(["dir", "ector", "(?:y|ies|io|ios)"].join(""), "gi"), "");

  const specs: NeedleSpec[] = [
    {
      label: "role:" + w1,
      regex: new RegExp(w1, "i"),
      preprocessLine: stripDirectoryWords,
    },
    {
      label: "role:" + w2,
      regex: new RegExp(w2, "i"),
    },
    {
      label: "role:" + w3,
      regex: new RegExp(w3 + "(?!ed\\b)", "i"),
    },
    {
      label: "role:" + w4,
      regex: new RegExp(`(?:^|[^a-z0-9])${w4}(?:$|[^a-z0-9])|${w4Amp}`, "i"),
    },
    {
      label: "role:" + w5,
      regex: new RegExp(w5, "i"),
    },
    {
      label: "role:" + w6,
      regex: new RegExp(w6, "i"),
    },
    {
      label: "slug:" + wSlug,
      regex: new RegExp(wSlug, "i"),
    },
  ];

  for (const id of memoryIds) {
    specs.push({
      label: "memory-id:" + id,
      regex: new RegExp(id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
    });
  }

  return specs;
}

function buildNameSpecs(): NeedleSpec[] {
  const firstName = ["mi", "ke"].join("");
  const accountName = ["mi", "key"].join("");
  return [
    {
      label: "name:first",
      regex: new RegExp(firstName, "i"),
    },
    {
      label: "name:account",
      regex: new RegExp(accountName, "i"),
    },
  ];
}

export const NON_TEST_HYGIENE_SPECS: readonly NeedleSpec[] = [
  ...buildRoleAndMemorySpecs(),
  ...buildNameSpecs(),
];

export const TEST_FILE_HYGIENE_SPECS: readonly NeedleSpec[] = NON_TEST_HYGIENE_SPECS;

export function scanLinesForHits(
  relPath: string,
  content: string,
  specs: readonly NeedleSpec[],
): string[] {
  const hits: string[] = [];
  const lines = content.split(/\r?\n/);
  for (let idx = 0; idx < lines.length; idx++) {
    const rawLine = lines[idx]!;
    for (const spec of specs) {
      const candidate = spec.preprocessLine ? spec.preprocessLine(rawLine) : rawLine;
      if (spec.regex.test(candidate)) {
        hits.push(`${relPath}:${idx + 1} [${spec.label}]: ${rawLine.trim()}`);
      }
    }
  }
  return hits;
}

function collectFilesRecursive(dir: string, skipDirNames: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (skipDirNames.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...collectFilesRecursive(full, skipDirNames));
    } else if (st.isFile() && TEXT_EXTENSIONS.has(extname(entry).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

function collectGuardedFiles(): { nonTestFiles: string[]; testFiles: string[] } {
  const nonTestFiles: string[] = [];
  const testFiles: string[] = [];

  const packagesDir = join(REPO_ROOT, "packages");
  for (const pkg of readdirSync(packagesDir)) {
    const srcDir = join(packagesDir, pkg, "src");
    try {
      if (!statSync(srcDir).isDirectory()) continue;
    } catch {
      continue;
    }
    const allSrc = collectFilesRecursive(srcDir, new Set(["node_modules", "dist"]));
    for (const f of allSrc) {
      const rel = relative(REPO_ROOT, f).replace(/\\/g, "/");
      if (/\/tests\/|\.test\.[cm]?[jt]s$/i.test(rel)) {
        testFiles.push(f);
      } else {
        nonTestFiles.push(f);
      }
    }
  }

  for (const entry of readdirSync(REPO_ROOT)) {
    if (
      /^README(?:\.[^.]+)?\.md$/i.test(entry) ||
      entry === "CHANGELOG.md" ||
      entry === "ROADMAP.md"
    ) {
      nonTestFiles.push(join(REPO_ROOT, entry));
    }
  }

  const cliDir = join(REPO_ROOT, "packages", "cli");
  for (const entry of readdirSync(cliDir)) {
    if (extname(entry).toLowerCase() === ".md") {
      nonTestFiles.push(join(cliDir, entry));
    }
  }

  for (const dirName of ["site", ".claude"]) {
    const subDir = join(REPO_ROOT, dirName);
    try {
      if (statSync(subDir).isDirectory()) {
        nonTestFiles.push(
          ...collectFilesRecursive(subDir, new Set(["node_modules", "dist", ".astro"])),
        );
      }
    } catch {
      /* ignore if absent */
    }
  }

  return { nonTestFiles, testFiles };
}

describe("public-hygiene: no internal roles, memory ids, project slug, personal names, or account names on public surfaces", () => {
  it("must-catch: rejects every role word, memory id, project slug, first name, and account name", () => {
    const sampleNeedles = [
      ["The ", "Dir", "ector", " ruled"].join(""),
      ["Pub", "lisher", " merges PRs"].join(""),
      ["load", "Se", "at", "Config()"].join(""),
      ["the ", "rn", "d", " store"].join(""),
      ["team ", "r&", "d", " workflow"].join(""),
      ["built for the ", "stu", "dio"].join(""),
      ["remote-", "ar", "gon"].join(""),
      ["~/.claude/projects/", "F--", "AI", "/memory"].join(""),
      [["pub", "lisher"].join(""), "merges"].join("-"),
      ["rule", "coord" + "inator", "and", "merges"].join("-"),
      ["feed", "back", "feed", "back", "never", "quote", "the", "dir", "ector", "md"].join(""),
      ["never", "quote", ["dir", "ector"].join(""), "in", "public"].join("-"),
      ["rule", ["dir", "ector"].join(""), "communication"].join("-"),
      ["build", "in", ["stu", "dio"].join(""), "tools", "not", "side", "scripts"].join("-"),
      ["reference", "memory", "system"].join("-"),
      [["rn", "d"].join(""), "memory", "system"].join("-"),
      [["pub", "lisher"].join(""), "approves", "every", "publish"].join("-"),
      ["Mi", "ke", " said"].join(""),
      ["C:/Users/", "mi", "key", "/.ai-loadout"].join(""),
    ];

    for (const sample of sampleNeedles) {
      const hits = scanLinesForHits("synthetic.ts", sample, NON_TEST_HYGIENE_SPECS);
      assert.ok(
        hits.length >= 1,
        `Expected hygiene guard to catch needle in sample: ${JSON.stringify(sample)}`,
      );
    }

    // Test-file scanner must catch role words, memory ids, project slug, personal name, and account name
    for (const testSample of [
      ["name: ", "Mi", "ke", " User Profile"].join(""),
      ["path: /Users/", "mi", "key", "/store"].join(""),
      ["~/.claude/projects/", "f--", "ai", "/memory"].join(""),
      ["The ", "Dir", "ector", " ruled"].join(""),
      ["never", "quote", ["dir", "ector"].join(""), "in", "public"].join("-"),
    ]) {
      const hits = scanLinesForHits("synthetic.test.ts", testSample, TEST_FILE_HYGIENE_SPECS);
      assert.ok(
        hits.length >= 1,
        `Expected test-file hygiene guard to catch needle sample: ${JSON.stringify(testSample)}`,
      );
    }
  });

  it("must-pass: allows directory, Directory, seated, and npm publish", () => {
    const cleanLines = [
      "Read files from the target directory.",
      "Directory traversal is scoped to the store.",
      "List all subdirectories under packages/cli/src.",
      "The seated row stays fixed while scrolling.",
      "Run `npm publish --dry-run` before tagging a release.",
      "Published packages live on npm.",
    ].join("\n");

    const hits = scanLinesForHits("clean.md", cleanLines, NON_TEST_HYGIENE_SPECS);
    assert.deepEqual(hits, []);
  });

  it("repository scan: packages/*/src/** (including tests), packages/cli/*.md, README*.md, site/**, .claude/**, ROADMAP.md, and CHANGELOG.md are clean", () => {
    const { nonTestFiles, testFiles } = collectGuardedFiles();
    assert.ok(nonTestFiles.length > 0, "Expected non-test guarded files");
    assert.ok(testFiles.length > 0, "Expected test files");

    const allHits: string[] = [];
    for (const f of nonTestFiles) {
      const rel = relative(REPO_ROOT, f).replace(/\\/g, "/");
      const content = readFileSync(f, "utf-8");
      allHits.push(...scanLinesForHits(rel, content, NON_TEST_HYGIENE_SPECS));
    }
    for (const f of testFiles) {
      const rel = relative(REPO_ROOT, f).replace(/\\/g, "/");
      const content = readFileSync(f, "utf-8");
      allHits.push(...scanLinesForHits(rel, content, TEST_FILE_HYGIENE_SPECS));
    }

    assert.equal(
      allHits.length,
      0,
      `Public hygiene violation(s) found:\n${allHits.join("\n")}`,
    );
  });
});
