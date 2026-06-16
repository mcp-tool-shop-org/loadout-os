import type { SiteConfig } from '@mcptoolshop/site-theme';

export const config: SiteConfig = {
  title: 'loadout-os',
  description:
    'loadout-os is a Knowledge OS: one CLI that routes the right context to your AI agent on demand, instead of dumping every memory and rule into the window each session. Kernel + memories adapter + rules adapter + runtime hook, under one root.',
  logoBadge: 'LO',
  brandName: 'loadout-os',
  repoUrl: 'https://github.com/mcp-tool-shop-org/loadout-os',
  footerText:
    'MIT Licensed — built by <a href="https://github.com/mcp-tool-shop-org" style="color:var(--color-muted);text-decoration:underline">mcp-tool-shop-org</a>',

  hero: {
    badge: 'Knowledge OS',
    headline: 'Stop dumping context.',
    headlineAccent: 'Route it.',
    description:
      'loadout-os is a context-aware knowledge router for AI coding agents. Keep a tiny dispatch index always loaded; load memory and rule payloads only when the task matches. One CLI unifies the router (kernel), the MEMORY.md and CLAUDE.md adapters, and a fail-silent runtime hook that injects ≤5 pointer lines per prompt.',
    primaryCta: { href: '#usage', label: 'Get started' },
    secondaryCta: { href: 'handbook/', label: 'Read the Handbook' },
    previews: [
      { label: 'Install', code: 'npm install -g @mcptoolshop/loadout-os' },
      { label: 'Health check', code: 'loadout-os doctor' },
      { label: 'Index a store', code: 'loadout-os memories index MEMORY.md' },
    ],
  },

  sections: [
    {
      kind: 'features',
      id: 'features',
      title: 'One CLI, four surfaces',
      subtitle:
        'A Knowledge OS for agents — a deterministic router, two document adapters, a runtime hook, and the rituals that keep them in sync.',
      features: [
        {
          title: 'The knowledge router',
          desc: 'A deterministic keyword + pattern matcher and a hierarchical resolver (global → org → project → session). Core entries always load; domain entries load on keyword match; manual entries only on explicit lookup. No regex DoS, no eval, no network.',
        },
        {
          title: 'MEMORY.md & CLAUDE.md adapters',
          desc: 'Point the adapters at your memory store or instruction file and they generate a machine-readable dispatch table, then lint it for missing files, orphans, drift, and over-long entries. Same kernel, two document types.',
        },
        {
          title: 'The runtime hook',
          desc: 'A UserPromptSubmit hook injects ≤5 pointer lines (≤200 tokens) to the memory entries relevant to your prompt — pointers, not payloads. A score floor keeps off-topic matches silent, and every error path exits 0 so a broken hook can never block a prompt.',
        },
        {
          title: 'Rituals: refresh · doctor · report',
          desc: 'refresh regenerates, validates, and publishes the dispatch index in one command (with a backup compensator). doctor is a read-only 8-check health screen. report gives you usage, dead-entry, and budget observability over the append-only usage log.',
        },
      ],
    },
    {
      kind: 'code-cards',
      id: 'usage',
      title: 'Usage',
      cards: [
        {
          title: 'Install',
          code: 'npm install -g @mcptoolshop/loadout-os\nloadout-os --help',
        },
        {
          title: 'Check the whole system',
          code: '# read-only 8-check health screen\nloadout-os doctor',
        },
        {
          title: 'Index a memory store',
          code: '# MEMORY.md → dispatch table\nloadout-os memories index ~/.claude/projects/F--AI/memory/MEMORY.md',
        },
        {
          title: 'See where context goes',
          code: '# usage + dead entries + token budget\nloadout-os report --json',
        },
      ],
    },
  ],
};
