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
Full frame in \`C:/Users/mikey/.claude/projects/memory/user_profile.md\` — read it if unsure
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

- Drive Path — see \`C:/Users/mikey/memory/x.md\` → for more details here
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
});
