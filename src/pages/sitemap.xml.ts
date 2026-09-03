import type { APIRoute } from 'astro';
import { getPosts, getProjects, getPublicCaseStudies } from '../lib/content';
import { site as siteConfig } from '../lib/site';

/**
 * The sitemap, built from D1 instead of from the build.
 *
 * `@astrojs/sitemap` enumerated the routes the build emitted. Content routes
 * are no longer among them — they resolve per request — so it would have
 * shipped a sitemap that listed /about and /resume and quietly omitted every
 * project, case study and post on the site. This asks the database the same
 * question the pages ask, which means a post published a minute ago is in the
 * sitemap a minute ago rather than at the next deploy.
 *
 * Two rules carried over from the integration's config: /admin is excluded,
 * because it is an authoring tool and not public content, and the origin comes
 * from `Astro.site` so it tracks whatever `SITE_URL` the build used.
 */
export const prerender = false;

/** Only `published` posts and unhidden projects — the same set a reader can reach. */
export const GET: APIRoute = async ({ site, locals }) => {
  const { DB } = locals.runtime.env;
  const origin = site ?? new URL(siteConfig.url);

  const [projects, caseStudies, posts] = await Promise.all([
    getProjects(DB),
    getPublicCaseStudies(DB),
    getPosts(DB),
  ]);

  const paths = [
    '/',
    '/about',
    '/projects',
    '/journal',
    '/resume',
    ...projects.map(p => `/projects/${encodeURIComponent(p.slug)}`),
    ...caseStudies.map(cs => `/case-studies/${encodeURIComponent(cs.slug)}`),
    // A draft is visible in `dev` but must never be advertised to a crawler.
    ...posts.filter(p => p.data.status === 'published').map(p => `/journal/${encodeURIComponent(p.slug)}`),
  ];

  const urls = paths.map(path => `  <url><loc>${new URL(path, origin).href}</loc></url>`).join('\n');

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`,
    {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        // Crawlers re-fetch this often and it is three queries against a table
        // of tens of rows; a short shared cache keeps that off the database
        // without making a new post wait meaningfully longer to be listed.
        'Cache-Control': 'public, max-age=0, s-maxage=300',
      },
    },
  );
};
