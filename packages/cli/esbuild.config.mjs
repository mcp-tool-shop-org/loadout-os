/**
 * Bundle the loadout-os CLI into ONE self-contained ESM bin.
 *
 * Why this exists: the published @mcptoolshop/loadout-os must `npm install -g`
 * as a single package with NO `@mcptoolshop/*` runtime dependencies. The three
 * workspace libraries (kernel = ai-loadout, claude-memories, claude-rules) are
 * INLINED here so the global bin runs standalone — no node_modules resolution of
 * the (unpublished) workspace packages at runtime.
 *
 * Output: dist/loadout-os.js — the file named in package.json `bin` + `files`.
 * The modular tsc dist/ (dist/cli.js, dist/commands.js, …) is kept for the test
 * suite + dev, but is NOT shipped (see `files`). esbuild reads the TS source
 * directly (so a bundle can be built even before/independent of tsc).
 *
 * Format choice: ESM. The workspace deps are `"type": "module"` ESM, and the
 * source uses `import.meta.url` (getVersion / isEntrypoint). Bundling to ESM
 * preserves those semantics with zero shims. We keep the `#!/usr/bin/env node`
 * shebang via `banner` so the artifact is directly executable.
 *
 * Standards compliance (workflow-standards.md):
 *   PIN_PER_STEP 2 — the bundle is a deterministic, replayable artifact of the
 *     pinned source + pinned esbuild version (devDependencies) at a fixed target
 *     (node20); no network, no nondeterministic input.
 *   ANDON_AUTHORITY 2 — esbuild fails the build (non-zero) on any unresolved
 *     import; a broken bundle never reaches `prepublishOnly`'s publish step.
 *   EXTERNAL_VERIFIER 1 — the post-bundle smoke check (`--version` on the
 *     emitted bin from a clean temp dir) is run by the operator/coordinator, not
 *     baked in here. skip: a build script is not a multi-model pipeline.
 *   Remaining standards (NAMED_COMPENSATORS / DECOMPOSE_BY_SECRETS /
 *     UNCERTAINTY_GATED_HUMANS) skip: this step performs no irreversible tool
 *     call (it only writes dist/loadout-os.js, overwritten on every run) and has
 *     no human checkpoint.
 */

import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, "src", "cli.ts");
const outfile = join(here, "dist", "loadout-os.js");

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // The executable shebang is preserved from the entry: src/cli.ts opens with
  // `#!/usr/bin/env node`, and esbuild keeps a leading hashbang verbatim in the
  // output. We deliberately do NOT add a `banner` shebang — that would duplicate
  // it (esbuild's preserved one + the banner). A post-bundle assertion below
  // verifies exactly one shebang on line 1.
  // Inline EVERYTHING (the three @mcptoolshop/* workspace deps included). Only
  // Node's own builtins stay external — they're always present at runtime.
  packages: undefined,
  external: [],
  logLevel: "info",
  sourcemap: false,
  legalComments: "none",
});

// ANDON: a malformed shebang silently breaks `loadout-os` as a global bin.
// Assert exactly one `#!/usr/bin/env node` and that it is line 1.
const out = readFileSync(outfile, "utf8");
const lines = out.split("\n");
const shebangCount = lines.filter((l) => l.startsWith("#!")).length;
if (lines[0] !== "#!/usr/bin/env node" || shebangCount !== 1) {
  console.error(
    `bundle shebang check failed: expected exactly one '#!/usr/bin/env node' on line 1, ` +
      `got ${shebangCount} hashbang line(s); line 1 = ${JSON.stringify(lines[0])}`,
  );
  process.exit(1);
}

console.log(`bundled → ${outfile} (${(out.length / 1024).toFixed(1)} kb, shebang OK)`);
