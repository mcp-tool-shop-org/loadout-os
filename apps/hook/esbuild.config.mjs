/**
 * Bundle the loadout runtime hook into ONE self-contained ESM file.
 *
 * Why this exists: the LIVE hook (~/.claude/loadout-hook/loadout-hook.mjs) runs
 * from a directory with NO node_modules. The SOURCE hook (apps/hook/loadout-hook.mjs)
 * does `await import('@mcptoolshop/ai-loadout')` to get the matcher — fine in the
 * workspace (it resolves to packages/kernel via the node_modules symlink), but a
 * MODULE_NOT_FOUND in the deployed location. Published ai-loadout is being retired,
 * so the hook can no longer depend on it being installed.
 *
 * The fix mirrors packages/cli/esbuild.config.mjs: esbuild INLINES the kernel
 * (= @mcptoolshop/ai-loadout, the workspace packages/kernel, carrying the NEW
 * recall-aware scoring) into a single dependency-free deployable. Node builtins
 * (fs, path, os) stay external — always present at runtime.
 *
 *   SOURCE (apps/hook/loadout-hook.mjs)      → keeps the import; resolves to the
 *                                              workspace kernel for dev/readability.
 *   BUNDLE (apps/hook/dist/loadout-hook.mjs) → import inlined; this is what the
 *                                              coordinator copies to the live hook.
 *
 * Format choice: ESM. The kernel is `"type": "module"` ESM and the hook source is
 * already ESM (top-level await on the dynamic import). Bundling to ESM preserves
 * those semantics with zero shims. The `#!/usr/bin/env node` shebang on line 1 of
 * the source is preserved verbatim by esbuild; a post-bundle assertion verifies
 * exactly one shebang on line 1 (a malformed shebang silently breaks the hook).
 *
 * Standards compliance (workflow-standards.md):
 *   PIN_PER_STEP 2 — the bundle is a deterministic, replayable artifact of the
 *     pinned source + pinned esbuild version (devDependencies) at a fixed target
 *     (node20); no network, no nondeterministic input.
 *   ANDON_AUTHORITY 2 — esbuild fails the build (non-zero) on any unresolved
 *     import, and the shebang assertion below halts on a malformed artifact; a
 *     broken bundle never reaches the coordinator's cutover.
 *   EXTERNAL_VERIFIER 1 — the standalone proof (run the emitted bundle from a
 *     clean temp dir with no node_modules) is run by the operator/coordinator, not
 *     baked in here. skip: a build script is not a multi-model pipeline.
 *   Remaining standards (NAMED_COMPENSATORS / DECOMPOSE_BY_SECRETS /
 *     UNCERTAINTY_GATED_HUMANS) skip: this step performs no irreversible tool call
 *     (it only writes dist/loadout-hook.mjs, overwritten on every run) and has no
 *     human checkpoint. The cutover to the LIVE hook is the coordinator's step.
 */

import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, "loadout-hook.mjs");
const outfile = join(here, "dist", "loadout-hook.mjs");

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // The executable shebang is preserved from the entry (loadout-hook.mjs opens
  // with `#!/usr/bin/env node`); esbuild keeps a leading hashbang verbatim. We do
  // NOT add a `banner` shebang — that would duplicate it. The assertion below
  // verifies exactly one shebang on line 1.
  // Inline EVERYTHING (the @mcptoolshop/ai-loadout workspace kernel included).
  // Only Node's own builtins stay external — always present at runtime.
  packages: undefined,
  external: [],
  logLevel: "info",
  sourcemap: false,
  legalComments: "none",
});

// ANDON: a malformed shebang silently breaks the deployed hook (Claude Code runs
// it as an executable). Assert exactly one `#!/usr/bin/env node` and that it is line 1.
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
