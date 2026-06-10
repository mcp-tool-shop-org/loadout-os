import type { SiteConfig } from '@mcptoolshop/site-theme';

export const config: SiteConfig = {
  title: 'AI Loadout',
  description: 'Context-aware knowledge router for AI agents. Dispatch table, frontmatter spec, keyword matcher, token estimator.',
  logoBadge: 'AL',
  brandName: 'AI Loadout',
  repoUrl: 'https://github.com/mcp-tool-shop-org/ai-loadout',
  npmUrl: 'https://www.npmjs.com/package/@mcptoolshop/ai-loadout',
  footerText: 'MIT Licensed — built by <a href="https://mcp-tool-shop.github.io/" style="color:var(--color-muted);text-decoration:underline">MCP Tool Shop</a>',

  hero: {
    badge: 'Knowledge routing library',
    headline: 'Equip the Right Knowledge.',
    headlineAccent: 'On Demand.',
    description: 'Stop dumping everything into context. AI Loadout is a dispatch table format and matching engine that loads the right knowledge for each task — like a game loadout for your agent.',
    primaryCta: { href: '#quickstart', label: 'Get started' },
    secondaryCta: { href: 'handbook/', label: 'Read the Handbook' },
    previews: [
      { label: 'Install', code: 'npm install @mcptoolshop/ai-loadout' },
      { label: 'Match', code: "import { matchLoadout } from '@mcptoolshop/ai-loadout';\n\nconst results = matchLoadout('fix the CI workflow', index);\n// [{ entry: { id: 'github-actions' }, score: 0.67 }]" },
      { label: 'Validate', code: "import { validateIndex } from '@mcptoolshop/ai-loadout';\n\nconst issues = validateIndex(index);\n// [] — clean!" },
    ],
  },

  sections: [
    {
      kind: 'features',
      id: 'features',
      title: 'Features',
      subtitle: 'Everything that makes context routing work.',
      features: [
        {
          title: 'Dispatch Table Format',
          desc: 'A structured index of knowledge payloads. Entries carry keywords, patterns, priority tiers, and trigger phases. The index is the brain; payloads are the muscles.',
        },
        {
          title: 'Keyword + Pattern Matching',
          desc: 'Deterministic routing based on keyword overlap proportion plus a pattern bonus. Core entries always load. Manual entries never auto-load. Domain entries score and rank.',
        },
        {
          title: 'Frontmatter Spec',
          desc: 'Each payload file carries its own routing metadata as YAML-like frontmatter. Hand-rolled parser — no YAML library, no eval, no prototype pollution. Frontmatter is the source of truth.',
        },
        {
          title: 'Three Priority Tiers',
          desc: 'Core (always loaded), Domain (keyword-triggered), Manual (explicit lookup only). Clear semantics, no ambiguity about what loads and when.',
        },
        {
          title: 'Structural Validator',
          desc: 'Catches broken indexes before they break your agent: missing IDs, duplicate entries, empty keywords on domain entries, invalid priorities, budget sanity checks.',
        },
        {
          title: 'Zero Dependencies',
          desc: 'Pure TypeScript, ESM-only, zero production dependencies. Works anywhere Node 20+ runs. Token estimator included (chars/4 heuristic).',
        },
      ],
    },
    {
      kind: 'code-cards',
      id: 'quickstart',
      title: 'Quick Start',
      cards: [
        {
          title: 'Install',
          code: 'npm install @mcptoolshop/ai-loadout',
        },
        {
          title: 'Match a task',
          code: "import { matchLoadout } from '@mcptoolshop/ai-loadout';\n\nconst results = matchLoadout(\n  'fix the CI workflow',\n  index\n);\n\nfor (const { entry, score } of results) {\n  console.log(entry.id, score);\n}",
        },
        {
          title: 'Parse frontmatter',
          code: "import { parseFrontmatter } from '@mcptoolshop/ai-loadout';\n\nconst { frontmatter, body } = parseFrontmatter(fileContent);\nif (frontmatter) {\n  console.log(frontmatter.id, frontmatter.keywords);\n}",
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
        ['core', 'Always loaded (score 1.0)', '"never skip tests to make CI green"'],
        ['domain', 'Loaded when task keywords match', 'CI rules when editing workflows'],
        ['manual', 'Never auto-loaded, explicit lookup only', 'Obscure platform gotchas'],
      ],
    },
    {
      kind: 'api',
      id: 'api',
      title: 'API Reference',
      subtitle: 'Clean exports for matching, resolving, and observability.',
      apis: [
        {
          name: 'matchLoadout(task, index)',
          desc: 'Match a task description against a loadout index. Returns entries ranked by match strength.',
        },
        {
          name: 'lookupEntry(id, index)',
          desc: 'Look up a specific entry by ID. For manual entries or explicit access.',
        },
        {
          name: 'parseFrontmatter(content)',
          desc: 'Parse YAML-like frontmatter from a payload file. Returns { frontmatter, body } or { frontmatter: null, body }.',
        },
        {
          name: 'serializeFrontmatter(fm)',
          desc: 'Serialize a Frontmatter object back to a --- delimited string.',
        },
        {
          name: 'validateIndex(index)',
          desc: 'Validate structural integrity of a LoadoutIndex. Returns an array of issues with severity, code, message, and hint.',
        },
        {
          name: 'estimateTokens(text)',
          desc: 'Estimate token count from text using chars/4 heuristic.',
        },
      ],
    },
  ],
};
