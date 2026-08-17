import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';
import icon from 'astro-icon';

export default defineConfig({
  /* The live origin. Must match `public/CNAME` and the domain configured in
     the repository's Pages settings — canonical URLs, Open Graph tags, the
     sitemap and robots.txt are all built from it, so a stale value is
     invisible locally and wrong in production.
     `scripts/check-content.mjs` asserts the fallback against `public/CNAME`. */
  site: process.env.SITE_URL || 'https://anishgiri.dev',
  output: 'static',
  integrations: [
    mdx(),
    tailwind({ applyBaseStyles: false }),
    /* Icons are inlined as SVG at build time, so nothing ships at runtime and
       `currentColor` keeps them on the theme tokens. Only the admin surface
       uses them; the public pages stay on the illustrations in
       `src/assets/illustrations/`. */
    icon(),
    // The admin surface is an authoring tool, not public content.
    sitemap({ filter: page => !/\/admin(\/|$)/.test(new URL(page).pathname) }),
  ],
});
