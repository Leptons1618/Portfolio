#!/usr/bin/env node
/**
 * Cross-file checks that neither `astro check` nor `astro build` does.
 *
 * ## What this used to be, and why it is smaller
 *
 * Most of this script existed because content lived in files and nothing
 * validated the relationships *between* them: a `caseStudySlug` pointing at a
 * missing case study, a journal post with no `status`, a category outside the
 * enum. Those all built green and failed in production, and this ran ahead of
 * the build to stop them.
 *
 * They are now constraints in `migrations/0001_init.sql` — a FOREIGN KEY, a
 * NOT NULL and three CHECKs — so the database refuses the write instead. That
 * is strictly earlier than this was: it fires when the author presses save,
 * not when CI next runs. The checks were not dropped; they moved, and the ones
 * left here are the ones a database cannot see.
 *
 * What is left is about the *deployment*, which is exactly what a schema has no
 * opinion on: whether a route that reads the database remembered to opt out of
 * prerendering, whether the origin agrees with itself in every place it is
 * written down, and whether the bindings the site needs are actually declared.
 *
 * Run by `npm run check`, ahead of `astro check`.
 * Self-check: `node scripts/check-content.mjs --self-test`.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...parts) => join(root, ...parts);

/** Every file under a directory, recursively, as repo-relative paths. */
export function walk(dir, base = dir) {
  if (!existsSync(p(dir))) return [];
  return readdirSync(p(dir)).flatMap(entry => {
    const rel = `${dir}/${entry}`;
    return statSync(p(rel)).isDirectory() ? walk(rel, base) : [rel];
  });
}

/**
 * Does this page read content at request time?
 *
 * Deliberately a source match rather than a module graph: the failure being
 * caught is someone adding a route that queries D1 and forgetting one line, and
 * the line and the query are both right there in the file.
 */
export function readsDatabase(source) {
  return /Astro\.locals\.runtime|locals\.runtime/.test(source);
}

/** Does it opt out of prerendering? */
export function isDynamic(source) {
  return /export\s+const\s+prerender\s*=\s*false/.test(source);
}

function check() {
  const errors = [];
  const fail = (file, message) => errors.push(`${file}: ${message}`);

  /* 1. Every route that reaches for the runtime bindings declares itself
     dynamic.

     This is the one that replaces the old relational checks, and it guards the
     failure this architecture actually has: `output` is still `'static'`, so a
     page is prerendered *unless it says otherwise*. A new content route without
     `export const prerender = false` is built once, at deploy time, against a
     database binding that does not exist during the build — which is either a
     crash in CI or, worse, a page frozen at whatever the content said on the
     day it shipped. Nothing else notices: the types are fine and the build is
     green. */
  const pages = walk('src/pages').filter(f => /\.(astro|ts)$/.test(f));
  let dynamic = 0;
  for (const file of pages) {
    const source = readFileSync(p(file), 'utf8');
    if (!readsDatabase(source)) continue;
    dynamic += 1;
    if (!isDynamic(source)) {
      fail(file, 'reads the D1 binding but does not `export const prerender = false`');
    }
  }
  if (dynamic === 0) {
    fail('src/pages', 'no route reads the database — every page would be frozen at deploy time');
  }

  // 2. The default Open Graph image exists — every page's og:image points at it.
  const siteModule = readFileSync(p('src/lib/site.ts'), 'utf8');
  const ogImage = siteModule.match(/ogImage:\s*'([^']+)'/)?.[1];
  if (!ogImage) {
    fail('src/lib/site.ts', 'no ogImage found');
  } else if (!existsSync(p('public', ogImage.slice(1)))) {
    fail('src/lib/site.ts', `ogImage "${ogImage}" is not in public/`);
  }

  /* 3. The build origin agrees with itself.

     `public/CNAME` no longer configures anything — the site is served by a
     Worker, not by GitHub Pages, and the custom domain is attached in
     Cloudflare. It is kept as the one-line record of what the domain *is*, and
     this check is what stops the three places that state it from drifting
     apart. Decision 4, with one of its three consumers retired. */
  const cname = readFileSync(p('public/CNAME'), 'utf8').trim();
  const configured = readFileSync(p('astro.config.mjs'), 'utf8').match(/site:.*?'([^']+)'/s)?.[1];
  for (const [file, url] of [
    ['astro.config.mjs', configured],
    ['src/lib/site.ts', siteModule.match(/url:\s*'([^']+)'/)?.[1]],
  ]) {
    if (!url) fail(file, 'no site URL found');
    else if (new URL(url).hostname !== cname) {
      fail(file, `site URL "${url}" disagrees with public/CNAME ("${cname}")`);
    }
  }

  /* 4. ...and the deploy workflow does not quietly overrule it. `SITE_URL` in
     the environment beats both files above, so a literal origin hard-coded
     into the workflow bypasses check 3 entirely: the build stays green and
     every canonical URL, OG tag and sitemap entry in production points at the
     wrong host. That is exactly what shipped once. */
  const workflow = p('.github/workflows/deploy.yml');
  if (existsSync(workflow)) {
    const text = readFileSync(workflow, 'utf8');
    for (const [, origin] of text.matchAll(/SITE_URL:.*?'(https?:\/\/[^']+)'/g)) {
      if (new URL(origin).hostname !== cname) {
        fail(
          '.github/workflows/deploy.yml',
          `SITE_URL hard-codes "${origin}", which is not public/CNAME ("${cname}")`,
        );
      }
    }
  }

  /* 5. The database the whole site now reads from is actually bound, and its
     schema is actually in the repository. A missing binding is a site that
     500s on every content route; a missing `migrations/` is a database nobody
     can rebuild. */
  const wrangler = p('wrangler.jsonc');
  let migrations = 0;
  if (!existsSync(wrangler)) {
    fail('wrangler.jsonc', 'missing — the site has no Worker configuration');
  } else {
    const text = readFileSync(wrangler, 'utf8');
    if (!/"binding":\s*"DB"/.test(text)) {
      fail('wrangler.jsonc', 'no D1 binding named "DB" — every content route reads `env.DB`');
    }
    if (!/"database_id":\s*"[0-9a-f-]{36}"/.test(text)) {
      fail('wrangler.jsonc', 'the D1 binding has no database_id');
    }
    migrations = walk('migrations').filter(f => f.endsWith('.sql')).length;
    if (migrations === 0) fail('migrations/', 'no .sql files — the schema is not in the repository');
  }

  return { errors, counts: { dynamicRoutes: dynamic, pages: pages.length, migrations } };
}

/**
 * Prove the two source matchers actually discriminate.
 *
 * They are regexes over source text, which is the kind of check that silently
 * starts matching nothing after an unrelated edit and then passes everything.
 */
function selfTest() {
  const assert = (ok, what) => {
    if (!ok) {
      console.error(`check-content self-test FAILED: ${what}`);
      process.exit(1);
    }
  };

  assert(readsDatabase('const { DB } = Astro.locals.runtime.env;'), 'detects a page binding');
  assert(readsDatabase('export const GET = async ({ locals }) => locals.runtime.env.DB;'), 'detects an endpoint binding');
  assert(!readsDatabase('const x = 1;'), 'does not match an unrelated file');

  assert(isDynamic('export const prerender = false;'), 'detects the opt-out');
  assert(isDynamic('export  const   prerender=false'), 'tolerates spacing');
  assert(!isDynamic('export const prerender = true;'), 'does not accept prerender = true');
  /* Deliberately not asserted: a commented-out `prerender = false` matches.
     This is a text match, and teaching it about comments would be the first
     step towards parsing the file. The failure it guards is a *missing* line,
     not a disguised one. */

  assert(walk('scripts').includes('scripts/check-content.mjs'), 'walk finds a known file');

  console.log('check-content self-test: ok');
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const { errors, counts } = check();
  if (errors.length) {
    for (const error of errors) console.error(`  ${error}`);
    console.error(`\ncheck-content: ${errors.length} problem(s)`);
    process.exit(1);
  }
  console.log(
    `check-content: ok (${counts.dynamicRoutes} dynamic of ${counts.pages} routes, ${counts.migrations} migrations)`,
  );
}
