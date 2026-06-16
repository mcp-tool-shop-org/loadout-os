---
id: this-is-an-intentionally-very-long-frontmatter-id-well-past-sixty-chars
keywords: [long, frontmatter, id, validate]
patterns: []
priority: domain
triggers:
  task: true
  plan: false
  edit: false
---

# Long Frontmatter Id

A frontmatter-bearing topic file whose `id` field exceeds 60 chars. Its
reference name is SHORT (so the derived kebab id is fine) — only the
frontmatter id is over-long. Exercises the MEM-B08 ID_TOO_LONG check on
the frontmatter-supplied id path.
