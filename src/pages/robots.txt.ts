import type { APIRoute } from 'astro';
import { site as siteConfig } from '../lib/site';

/* Generated rather than served from `public/` so the sitemap URL always
   matches the origin the rest of the build uses. */
export const GET: APIRoute = ({ site }) => {
  const origin = site ?? new URL(siteConfig.url);
  return new Response(
    `User-agent: *
Allow: /
Disallow: /admin

Sitemap: ${new URL('sitemap.xml', origin).href}
`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
  );
};
