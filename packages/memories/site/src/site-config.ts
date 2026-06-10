import type { SiteConfig } from '@mcptoolshop/site-theme';

export const config: SiteConfig = {
  title: '@mcptoolshop/claude-memories',
  description: 'MEMORY.md optimizer and dispatch table generator for Claude Code',
  logoBadge: 'CM',
  brandName: 'claude-memories',
  repoUrl: 'https://github.com/mcp-tool-shop-org/claude-memories',
  npmUrl: 'https://www.npmjs.com/package/@mcptoolshop/claude-memories',
  footerText: 'MIT Licensed — built by <a href="https://mcp-tool-shop.github.io/" style="color:var(--color-muted);text-decoration:underline">MCP Tool Shop</a>',

  hero: {
    badge: 'CLI Tool',
    headline: 'Put your MEMORY.md',
    headlineAccent: 'on a diet.',
    description: 'Analyzes your memory files, generates a machine-readable dispatch table, and shows where your context budget goes. 98% token savings on a real 31-topic workspace.',
    primaryCta: { href: '#usage', label: 'Get started' },
    secondaryCta: { href: 'handbook/', label: 'Read the Handbook' },
    previews: [
      { label: 'Install', code: 'npm install -g @mcptoolshop/claude-memories' },
      { label: 'Analyze', code: 'claude-memories analyze MEMORY.md' },
      { label: 'Index', code: 'claude-memories index MEMORY.md --lazy' },
    ],
  },

  sections: [
    {
      kind: 'features',
      id: 'features',
      title: 'Features',
      subtitle: 'Why your agent needs a memory index.',
      features: [
        { title: 'Context savings', desc: 'Turns 40K+ tokens of always-loaded memories into an on-demand dispatch table. Only the relevant topic loads per task.' },
        { title: 'Auto-extraction', desc: 'Keywords are extracted from topic names and headings automatically. Optional frontmatter gives fine-grained control.' },
        { title: 'Full diagnostics', desc: 'Token budget dashboard, orphan detection, duplicate references, structural validation — all from one CLI.' },
      ],
    },
    {
      kind: 'code-cards',
      id: 'usage',
      title: 'Usage',
      cards: [
        { title: 'Install globally', code: 'npm install -g @mcptoolshop/claude-memories' },
        { title: 'Analyze structure', code: 'claude-memories analyze MEMORY.md\n# Shows topics, references, token costs' },
        { title: 'Generate dispatch table', code: 'claude-memories index MEMORY.md --lazy\n# Writes index.json for ai-loadout' },
        { title: 'Token budget dashboard', code: 'claude-memories stats MEMORY.md\n# Total tokens, savings %, per-topic breakdown' },
      ],
    },
    {
      kind: 'features',
      id: 'architecture',
      title: 'Architecture',
      subtitle: 'Layer 2 adapter in the Knowledge OS stack.',
      features: [
        { title: 'Kernel', desc: '@mcptoolshop/ai-loadout provides routing types, matching, and validation — the shared foundation.' },
        { title: 'Adapter', desc: 'claude-memories converts MEMORY.md into a LoadoutIndex. Same kernel, different document type.' },
        { title: 'Zero dependencies', desc: 'Local-only, no network calls, no telemetry. Deterministic: same inputs always produce the same outputs.' },
      ],
    },
  ],
};
