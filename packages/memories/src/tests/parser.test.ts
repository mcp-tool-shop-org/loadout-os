import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseMemoryMd } from "../parser.js";

describe("parseMemoryMd", () => {
  it("parses sections from headings", () => {
    const content = `# Main Title

## Active

- Item A → \`memory/a.md\`

## Products

- Item B → \`memory/b.md\`
`;
    const { sections } = parseMemoryMd(content);
    assert.equal(sections.length, 3);
    assert.equal(sections[0].heading, "Main Title");
    assert.equal(sections[0].level, 1);
    assert.equal(sections[1].heading, "Active");
    assert.equal(sections[1].level, 2);
    assert.equal(sections[2].heading, "Products");
  });

  it("parses arrow references with em-dash", () => {
    const content = `## Active

- AI Loadout — routing core (v1.0.3) → \`memory/ai-loadout.md\`
- Claude Rules — CLAUDE.md optimizer → \`memory/claude-rules.md\`
`;
    const { refs } = parseMemoryMd(content);
    assert.equal(refs.length, 2);
    assert.equal(refs[0].name, "AI Loadout");
    assert.equal(refs[0].description, "routing core (v1.0.3)");
    assert.equal(refs[0].path, "memory/ai-loadout.md");
    assert.equal(refs[1].name, "Claude Rules");
  });

  it("handles references without descriptions", () => {
    const content = `## Section

- MyTool → \`memory/mytool.md\`
`;
    const { refs } = parseMemoryMd(content);
    assert.equal(refs.length, 1);
    assert.equal(refs[0].name, "MyTool");
    assert.equal(refs[0].description, "");
    assert.equal(refs[0].path, "memory/mytool.md");
  });

  it("returns empty for non-list content", () => {
    const content = `# Title

Just some text, no list items.

More text.
`;
    const { refs } = parseMemoryMd(content);
    assert.equal(refs.length, 0);
  });

  it("associates refs with their parent section", () => {
    const content = `## Active

- Tool A → \`memory/a.md\`
- Tool B → \`memory/b.md\`

## Archived

- Tool C → \`memory/c.md\`
`;
    const { sections } = parseMemoryMd(content);
    assert.equal(sections[0].entries.length, 2);
    assert.equal(sections[1].entries.length, 1);
    assert.equal(sections[1].entries[0].name, "Tool C");
  });

  it("handles asterisk bullets", () => {
    const content = `## Section

* Tool A — desc → \`memory/a.md\`
`;
    const { refs } = parseMemoryMd(content);
    assert.equal(refs.length, 1);
    assert.equal(refs[0].name, "Tool A");
  });

  it("ignores non-reference list items", () => {
    const content = `## Section

- Just a normal list item
- Another item without path
- Tool A → \`memory/a.md\`
`;
    const { refs } = parseMemoryMd(content);
    assert.equal(refs.length, 1);
    assert.equal(refs[0].name, "Tool A");
  });

  it("parses non-bulleted arrow references", () => {
    const content = `## Active

AI Loadout — routing core (v1.0.3) → \`memory/ai-loadout.md\`
Claude Rules — optimizer → \`memory/claude-rules.md\`
`;
    const { refs } = parseMemoryMd(content);
    assert.equal(refs.length, 2);
    assert.equal(refs[0].name, "AI Loadout");
    assert.equal(refs[0].path, "memory/ai-loadout.md");
    assert.equal(refs[1].name, "Claude Rules");
  });

  // MEM-001 / MEM-003: prose path-citations must NOT become refs.
  it("rejects prose path-citation junk shapes (MEM-001)", () => {
    const content = `## Prose

- Memory files: see \`memory/index.json\` for the generated dispatch table
Full frame in \`C:/Users/Public/.claude/projects/memory/user_profile.md\` — read it if unsure
See also: the post-proof balance tuning notes live at \`memory/post-proof-balance-tuning.md\` and cover wave-based tuning

## Real

- Genuine Tool — a real entry → \`memory/genuine.md\`
`;
    const { refs } = parseMemoryMd(content);
    // Only the genuine bullet+arrow entry survives.
    assert.equal(refs.length, 1, "exactly one ref should parse");
    assert.equal(refs[0].name, "Genuine Tool");
    assert.equal(refs[0].path, "memory/genuine.md");

    // None of the junk shapes leak through under any derived name.
    const junkNames = ["Memory files", "Full frame in", "See also"];
    for (const junk of junkNames) {
      assert.ok(
        !refs.some((r) => r.name.startsWith(junk)),
        `junk shape "${junk}" must not be parsed as a ref`,
      );
    }
    // The kebab ids that used to leak (memory-files / full-frame / see-also)
    // are absent because the lines are not parsed as refs at all.
    const paths = refs.map((r) => r.path);
    assert.ok(!paths.includes("memory/index.json"));
    assert.ok(!paths.includes("memory/post-proof-balance-tuning.md"));
  });

  it("rejects absolute/glob paths reached via the inline-path branch (MEM-001)", () => {
    // These lines have a bullet + arrow but the backtick path is NOT the
    // arrow target (text follows it), so the well-behaved arrow branch does
    // NOT match and they fall through to the inline-path branch — which is
    // the branch MEM-001 tightens. Absolute and glob paths must be rejected
    // there; only the relative topic ref survives.
    const content = `## Edge

- Drive Path — see \`C:/Users/Public/memory/x.md\` → for more details here
- Glob Path — see \`memory/*.md\` → for all the files
- Real One — see \`memory/real.md\` → for the real one
`;
    const { refs } = parseMemoryMd(content);
    assert.equal(refs.length, 1);
    assert.equal(refs[0].path, "memory/real.md");
  });

  it("still parses a genuine bullet + arrow inline-path ref (MEM-001 regression guard)", () => {
    // No em-dash separator, path in backticks, bullet + arrow present.
    const content = `## Active

- MyTopic → \`memory/my-topic.md\`
`;
    const { refs } = parseMemoryMd(content);
    assert.equal(refs.length, 1);
    assert.equal(refs[0].name, "MyTopic");
    assert.equal(refs[0].path, "memory/my-topic.md");
  });

  it("parses Markdown-link entries in Claude Code's index format (MEM-B12)", () => {
    const content = `## Feedback corrections (index)

- [Docs as you go](Feedback/feedback_docs_as_you_go.md) — Director 2026-09-25: update docs after each merge
- [python-gpu — GPU Python on the rig](python-gpu.md) — run CUDA scripts with \`python-gpu\`
- **[Bold entry](bold.md)** — emphasised in the index
- [No hook](no-hook.md)
* [Anchored](anchored.md#section): colon separator
`;
    const { refs, sections } = parseMemoryMd(content);
    assert.equal(refs.length, 5);
    assert.deepEqual(refs.map((r) => r.path), [
      "Feedback/feedback_docs_as_you_go.md", "python-gpu.md", "bold.md", "no-hook.md", "anchored.md",
    ]);
    assert.equal(refs[0].name, "Docs as you go");
    assert.equal(refs[0].description, "Director 2026-09-25: update docs after each merge");
    // An em-dash inside the link text splits name from subtitle; the text after
    // the link still wins as the description.
    assert.equal(refs[1].name, "python-gpu");
    assert.equal(refs[1].description, "run CUDA scripts with `python-gpu`");
    assert.equal(refs[3].description, "");
    assert.equal(refs[4].description, "colon separator");
    assert.equal(sections[0].entries.length, 5);
  });

  it("accepts a short status marker before the link (MEM-B12)", () => {
    const content = `- **⭐ [ai-rpg-engine v3.9.0 SHIPPED](memory/ai-rpg-engine-v39.md)** — 2026-08-31: authoring loop
- ✅ [Done thing](done.md) — shipped
- some words [Not first](not-first.md) — prose, not an entry
`;
    const { refs } = parseMemoryMd(content);
    assert.deepEqual(refs.map((r) => r.path), ["memory/ai-rpg-engine-v39.md", "done.md"]);
    assert.equal(refs[0].name, "ai-rpg-engine v3.9.0 SHIPPED");
    assert.equal(refs[0].description, "2026-08-31: authoring loop");
  });

  it("falls back to the link text's subtitle when nothing follows the link (MEM-B12)", () => {
    const { refs } = parseMemoryMd("- [Topic — what it covers](topic.md)\n");
    assert.equal(refs.length, 1);
    assert.equal(refs[0].name, "Topic");
    assert.equal(refs[0].description, "what it covers");
  });

  it("rejects Markdown links that are citations, URLs or absolute paths (MEM-B12)", () => {
    const content = `- See [the protocol](protocol.md) for details
Full frame in [user profile](user_profile.md).
- [Site](https://example.com/readme.md) — external
- [Abs](C:/Users/x/memory/abs.md) — absolute
- [Root](/memory/root.md) — posix absolute
- [Glob](memory/*.md) — glob
- [Not markdown](notes.txt) — wrong extension
`;
    const { refs } = parseMemoryMd(content);
    assert.equal(refs.length, 0, `expected no refs, got ${JSON.stringify(refs.map((r) => r.path))}`);
  });

  it("keeps arrow lines on the arrow branch even when they contain a link (MEM-B12 regression guard)", () => {
    const { refs } = parseMemoryMd("- [Old](old.md) Topic — desc → `memory/topic.md`\n");
    assert.equal(refs.length, 1);
    assert.equal(refs[0].path, "memory/topic.md");
  });
});
