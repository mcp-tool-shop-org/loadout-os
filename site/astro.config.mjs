// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://mcp-tool-shop-org.github.io',
  base: '/loadout-os',
  integrations: [
    starlight({
      title: 'loadout-os',
      logo: {
        src: './src/assets/logo.png',
        alt: 'loadout-os',
        href: '/loadout-os/',
        replacesTitle: false,
      },
      description: 'loadout-os — consolidated Knowledge OS for the studio — kernel (ai-loadout) + memories (claude-memories) + rules (claude-rules) + the runtime loadout hook, under one npm-workspaces root.',
      disable404Route: true,
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/mcp-tool-shop-org/loadout-os' },
      ],
      sidebar: [
        {
          label: 'Handbook',
          autogenerate: { directory: 'handbook' },
        },
      ],
      customCss: ['./src/styles/starlight-custom.css'],
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
