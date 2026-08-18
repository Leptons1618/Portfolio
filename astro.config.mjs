import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import mdx from '@astrojs/mdx';
import tailwind from '@astrojs/tailwind';
import icon from 'astro-icon';

export default defineConfig({
  /* The live origin. Must match `public/CNAME` and the domain configured in
     the repository's Pages settings — canonical URLs, Open Graph tags, the
     sitemap and robots.txt are all built from it, so a stale value is
     invisible locally and wrong in production.
     `scripts/check-content.mjs` asserts the fallback against `public/CNAME`. */
  site: process.env.SITE_URL || 'https://anishgiri.dev',
  /* Still `static`: every page is prerendered unless it says otherwise, and
     only the handful of routes that read content opt out with
     `export const prerender = false`. /about, /resume, the whole admin shell
     and the 404 are files on disk that the Worker never runs for — Cloudflare
     serves them from the asset store ahead of the script. */
  output: 'static',
  /* The adapter is what makes `prerender = false` mean anything, and what puts
     `Astro.locals.runtime.env` — the D1 binding — in front of those routes.
     `platformProxy` gives `astro dev` the same bindings against the local
     database in `.wrangler/state`, so development reads real rows without
     touching the deployed one. */
  adapter: cloudflare({ platformProxy: { enabled: true } }),
  /* The dev port is part of the admin's OAuth identity, not a convenience.
     `http://localhost:4321/admin/` is a registered callback on the GitHub App
     and `http://localhost:4321` is an entry in the token Worker's
     ALLOWED_ORIGINS — so a server that quietly falls through to 4322 because
     something already holds 4321 cannot sign in at all, and fails twice over:
     GitHub refuses the `redirect_uri` and the Worker refuses the origin. What
     it looks like from the browser is a sign-in button that stopped working.

     `strictPort` turns that into what it actually is — "Port 4321 is already
     in use" — at startup, where it is one line to read and one process to
     close. It has to go under `vite`: the port hunt is Vite's (the message is
     `[vite] Port 4321 is in use, trying another one...`), Astro's own `server`
     block has no such key, and passing it there is silently dropped. */
  server: { port: 4321 },
  vite: { server: { strictPort: true } },
  integrations: [
    mdx(),
    tailwind({ applyBaseStyles: false }),
    /* Icons are inlined as SVG at build time, so nothing ships at runtime and
       `currentColor` keeps them on the theme tokens. Only the admin surface
       uses them; the public pages stay on the illustrations in
       `src/assets/illustrations/`. */
    icon(),
    /* `@astrojs/sitemap` is gone, not forgotten. It enumerates the routes the
       build emitted, and the content routes are no longer among them — it
       would have shipped a sitemap listing /about and /resume and silently
       dropping every project, case study and post. `src/pages/sitemap.xml.ts`
       replaces it by asking D1 the same question at request time, and keeps
       the admin exclusion the `filter` above used to do. */
  ],
});
