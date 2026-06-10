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
});
