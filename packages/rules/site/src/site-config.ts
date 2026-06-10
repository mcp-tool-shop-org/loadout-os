import type { SiteConfig } from '@mcptoolshop/site-theme';

export const config: SiteConfig = {
  title: 'Claude Rules',
  description: 'Dispatch table generator and instruction-file optimizer for Claude Code. Put your CLAUDE.md on a diet.',
  logoBadge: 'CR',
  brandName: 'Claude Rules',
  repoUrl: 'https://github.com/mcp-tool-shop-org/claude-rules',
  npmUrl: 'https://www.npmjs.com/package/@mcptoolshop/claude-rules',
  footerText: 'MIT Licensed — built by <a href="https://mcp-tool-shop.github.io/" style="color:var(--color-muted);text-decoration:underline">MCP Tool Shop</a>',

  hero: {
    badge: 'Claude Code optimizer',
    headline: 'Put Your CLAUDE.md',
    headlineAccent: 'On a Diet.',
    description: 'Split bloated instruction files into a tiny routing index (always loaded) and topic-specific rule files (loaded on demand). Save context tokens every session.',
    primaryCta: { href: '#quickstart', label: 'Get started' },
    secondaryCta: { href: 'handbook/', label: 'Read the Handbook' },
    previews: [
      { label: 'Analyze', code: 'npx @mcptoolshop/claude-rules analyze\n\n# File: CLAUDE.md (258 lines, ~2388 tokens)\n# Proposed extractions: 8 sections\n# Savings: 91% per session' },
      { label: 'Split', code: 'npx @mcptoolshop/claude-rules split\n\n# Interactive — approve each extraction\n# Generates index.json + rule files' },
      { label: 'Stats', code: 'npx @mcptoolshop/claude-rules stats\n\n# Always loaded:    320 tokens\n# On-demand total: 2180 tokens\n# Savings:          91%' },
    ],
  },

  sections: [
    {
      kind: 'features',
      id: 'features',
      title: 'Features',
      subtitle: 'Everything that makes your CLAUDE.md leaner.',
      features: [
        {
          title: 'Section Scoring',
          desc: 'Analyze your CLAUDE.md and see exactly which sections are core (must stay inline) and which can be extracted. Priority classification uses heading signals, content length, and domain markers.',
        },
        {
          title: 'Interactive Extraction',
          desc: 'The split command walks you through each proposed extraction. Preview the rule file, approve or skip. Like eslint --fix for your instruction files.',
        },
        {
          title: 'Dispatch Table',
          desc: 'Generates index.json with keywords, patterns, priority tiers, and trigger phases. The agent reads the index and loads rule files on demand.',
        },
        {
          title: 'Frontmatter Routing',
          desc: 'Each extracted rule file carries its own routing metadata as frontmatter. Keywords, patterns, priority, triggers — the source of truth for the dispatch table.',
        },
        {
          title: 'Drift Detection',
          desc: 'The validate command catches stale indexes, missing files, orphaned rules, empty keywords, and frontmatter drift. Keeps your rules healthy over time.',
        },
        {
          title: 'Token Budget Dashboard',
          desc: 'See the physics of your system: always-loaded cost, on-demand total, average task load, and savings percentage. Know exactly what you are paying.',
        },
      ],
    },
    {
      kind: 'code-cards',
      id: 'quickstart',
      title: 'Quick Start',
      cards: [
        {
          title: 'Analyze',
          code: '# Score your CLAUDE.md sections\nnpx @mcptoolshop/claude-rules analyze\n\n# Or point to a specific file\nnpx @mcptoolshop/claude-rules analyze .claude/CLAUDE.md',
        },
        {
          title: 'Split',
          code: '# Interactive extraction\nnpx @mcptoolshop/claude-rules split\n\n# Preview without writing\nnpx @mcptoolshop/claude-rules split --dry-run',
        },
        {
          title: 'Validate & Stats',
          code: '# Lint your rules directory\nnpx @mcptoolshop/claude-rules validate\n\n# Token budget dashboard\nnpx @mcptoolshop/claude-rules stats',
        },
      ],
    },
    {
      kind: 'data-table',
      id: 'priority-tiers',
      title: 'Priority Tiers',
      subtitle: 'Three tiers with clear semantics. No ambiguity about what loads and when.',
      columns: ['Tier', 'Behavior', 'Example'],
      rows: [
        ['core', 'Always inline in CLAUDE.md', '"test is right until proven otherwise"'],
        ['domain', 'Loaded when task keywords match', 'GitHub Actions rules when editing CI'],
        ['manual', 'Never auto-loaded, deliberate lookup', 'Obscure platform gotchas'],
      ],
    },
    {
      kind: 'data-table',
      id: 'invariants',
      title: 'Invariants',
      subtitle: 'These always hold. If they break, validate catches it.',
      columns: ['Invariant', 'Enforced By'],
      rows: [
        ['Every extracted section leaves a summary in CLAUDE.md', 'split'],
        ['Every domain/manual rule exists in index.json', 'validate'],
        ['Core rules stay inline (never extracted to file-only)', 'split'],
        ['Frontmatter is source of truth; index.json is derived', 'validate'],
        ['Parser only splits on ATX headings (##, ###)', 'parser'],
      ],
    },
  ],
};
