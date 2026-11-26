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
  const dirWord = ["dir", "ector"].join("");
  const pubWord = ["pub", "lisher"].join("");
  const seatWord = ["se", "at"].join("");
  const rndWord = ["rn", "d"].join("");
  const rndAmp = ["r&", "d"].join("");
  const studioWord = ["stu", "dio"].join("");
  const argonWord = ["ar", "gon"].join("");

  const memoryIds = [
    [pubWord, "merges"].join("-"),
    ["rule", "coord" + "inator", "and", "merges"].join("-"),
    ["feed", "back", "feed", "back", "never", "quote", "the", dirWord, "md"].join(""),
    ["never", "quote", dirWord, "in", "public"].join("-"),
    ["rule", dirWord, "communication"].join("-"),
    ["build", "in", studioWord, "tools", "not", "side", "scripts"].join("-"),
    ["reference", "memory", "system"].join("-"),
    [rndWord, "memory", "system"].join("-"),
    [pubWord, "approves", "every", "publish"].join("-"),
  ];

  const stripDirectoryWords = (line: string): string =>
    line.replace(new RegExp(["dir", "ector", "(?:y|ies)"].join(""), "gi"), "");

  const specs: NeedleSpec[] = [
    {
      label: "role:" + dirWord,
      regex: new RegExp(dirWord, "i"),
      preprocessLine: stripDirectoryWords,
    },
    {
      label: "role:" + pubWord,
      regex: new RegExp(pubWord, "i"),
    },
    {
      label: "role:" + seatWord,
      regex: new RegExp(seatWord + "(?!ed\\b)", "i"),
    },
    {
      label: "role:" + rndWord,
      regex: new RegExp(`(?:^|[^a-z0-9])${rndWord}(?:$|[^a-z0-9])|${rndAmp}`, "i"),
    },
    {
      label: "role:" + studioWord,
      regex: new RegExp(studioWord, "i"),
    },
    {
      label: "role:" + argonWord,
      regex: new RegExp(argonWord, "i"),
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

export const TEST_FILE_HYGIENE_SPECS: readonly NeedleSpec[] = buildNameSpecs();

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
    if (/^README(?:\.[^.]+)?\.md$/i.test(entry) || entry === "CHANGELOG.md") {
      nonTestFiles.push(join(REPO_ROOT, entry));
    }
  }

  const siteDir = join(REPO_ROOT, "site");
  try {
    if (statSync(siteDir).isDirectory()) {
      nonTestFiles.push(
        ...collectFilesRecursive(siteDir, new Set(["node_modules", "dist", ".astro"])),
      );
    }
  } catch {
    /* ignore if site/ absent */
  }

  return { nonTestFiles, testFiles };
}

describe("public-hygiene: no studio roles, memory ids, personal names, or account names on public surfaces", () => {
  it("must-catch: rejects every role word, studio memory id, first name, and account name", () => {
    const sampleNeedles = [
      ["The ", "Dir", "ector", " ruled"].join(""),
      ["Pub", "lisher", " merges PRs"].join(""),
      ["load", "Se", "at", "Config()"].join(""),
      ["the ", "rn", "d", " store"].join(""),
      ["team ", "r&", "d", " workflow"].join(""),
      ["built for the ", "stu", "dio"].join(""),
      ["remote-", "ar", "gon"].join(""),
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

    // Test-file scanner must catch both personal first name and account name
    for (const nameSample of [
      ["name: ", "Mi", "ke", " User Profile"].join(""),
      ["path: /Users/", "mi", "key", "/store"].join(""),
    ]) {
      const hits = scanLinesForHits("synthetic.test.ts", nameSample, TEST_FILE_HYGIENE_SPECS);
      assert.ok(
        hits.length >= 1,
        `Expected test-file hygiene guard to catch name sample: ${JSON.stringify(nameSample)}`,
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

  it("repository scan: packages/*/src/** (non-test), README*.md, site/**, CHANGELOG.md, and test names are clean", () => {
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
