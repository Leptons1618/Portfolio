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

/**
 * The build inputs this script checks come from `.env` locally and from the
 * environment in CI, and it has to see both.
 *
 * Astro reads `.env` through Vite; a plain Node script does not, so without
 * this the `PUBLIC_GITHUB_OAUTH_WORKER` check below would pass locally for the
 * only reason that makes a check worthless — it never saw the value. CI has no
 * `.env` file and passes the variable in the environment, which is why the
 * existing entries win: `loadEnvFile` overwrites, and a repository variable is
 * the more authoritative of the two wherever both exist.
 *
 * `process.loadEnvFile` is stdlib on the Node this repo already requires
 * (>= 22.18, `engines` in package.json), so this needs no parser and no
 * dependency.
 */
function loadDotEnv() {
  if (!existsSync(p('.env'))) return;
  const preset = { ...process.env };
  try {
    process.loadEnvFile(p('.env'));
  } catch {
    /* Unreadable or malformed. The checks below then see whatever the real
       environment holds, which is the same position as having no file. */
    return;
  }
  for (const [key, value] of Object.entries(preset)) {
    if (value !== undefined) process.env[key] = value;
  }
}

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

/**
 * Is markdown rendered with the syntax highlighter switched off?
 *
 * The Worker cannot compile WebAssembly from bytes, and Shiki — Astro's default
 * highlighter — instantiates an Oniguruma module the first time it renders
 * anything. `false` is the only value that keeps the plugin out of the pipeline
 * entirely; naming a highlighter explicitly is the same crash spelled longer.
 */
export function hasHighlightingOff(source) {
  return /syntaxHighlight\s*:\s*false/.test(source);
}

/**
 * How wide a printed page actually is, in CSS pixels.
 *
 * A4 is 210mm; `resume.css`'s `@page` margin is 14mm a side, leaving a 182mm
 * measure. CSS defines 1in as 96px and 1in as 25.4mm, so 182mm is 688px. Any
 * `max-width` breakpoint at or above this number can never match while
 * printing; any below it always can.
 */
const PRINT_WIDTH_PX = Math.round((210 - 28) * (96 / 25.4));

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
  /* The *template* is what the repository owns; `wrangler.jsonc` is generated
     from it and gitignored, because `database_id` names one account's database
     and a fork must point at its own. So the structural check runs against the
     committed file — which means a clone with no database configured still
     typechecks, which is the point. */
  const template = p('wrangler.example.jsonc');
  let migrations = 0;
  if (!existsSync(template)) {
    fail('wrangler.example.jsonc', 'missing — the site has no Worker configuration template');
  } else {
    const text = readFileSync(template, 'utf8');
    if (!/"binding":\s*"DB"/.test(text)) {
      fail('wrangler.example.jsonc', 'no D1 binding named "DB" — every content route reads `env.DB`');
    }
    if (!text.includes('__D1_DATABASE_ID__')) {
      fail(
        'wrangler.example.jsonc',
        'the D1 binding has no __D1_DATABASE_ID__ placeholder — `npm run config` would substitute nothing, and a real id here would be committed',
      );
    }
    migrations = walk('migrations').filter(f => f.endsWith('.sql')).length;
    if (migrations === 0) fail('migrations/', 'no .sql files — the schema is not in the repository');
  }

  /* The generated config, if it has been generated, resolved to a real
     database. An unsubstituted placeholder reaching wrangler is a confusing
     failure several steps later; this names it here. */
  const generated = p('wrangler.jsonc');
  if (existsSync(generated)) {
    const text = readFileSync(generated, 'utf8');
    if (!/"database_id":\s*"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/.test(text)) {
      fail('wrangler.jsonc', 'no real database_id — set D1_DATABASE_ID and re-run `npm run config`');
    }
  } else if (process.env.CI) {
    /* Locally its absence is fine: reading and typechecking need no database.
       In CI it means the generate step did not run or the secret is unset, and
       the build would fail later with something far less obvious. */
    fail('wrangler.jsonc', 'not generated — `npm run config` needs the D1_DATABASE_ID secret');
  }

  /* 6. The generated Cloudflare types are not in the tree.

     `wrangler types` writes `worker-configuration.d.ts`, whose global workerd
     declarations merge illegally with the DOM's and break every browser type in
     the admin — decision 20, and `src/env.d.ts` for the mechanism. This used to
     be "prevented" by a `dev.types.includeRuntime: false` in wrangler.jsonc,
     which is not a field wrangler has; it was ignored on every run. A file
     existing is something that can actually be checked, so this checks it. */
  if (existsSync(p('worker-configuration.d.ts'))) {
    fail(
      'worker-configuration.d.ts',
      'generated by `wrangler types` — its global types break the DOM types in the admin. Delete it; `src/env.d.ts` declares the bindings by hand',
    );
  }

  /* 7. The server bundle is excluded from the static assets.

     `main` and `assets.directory` are both `dist/`, so an unfiltered upload
     would publish `dist/_worker.js` — the whole server bundle — as a fetchable
     static file. `wrangler deploy` refuses outright rather than allow it, so
     the first symptom is a failed deploy; the second, if anyone silences it
     with an *empty* .assetsignore, is server code on the public internet.

     Adapter 12 does not write this file (it emits the Pages-era
     `_routes.json`), so it is checked into `public/` and Astro copies it. That
     also means nothing regenerates it if it is deleted — hence a check. */
  const assetsIgnore = p('public/.assetsignore');
  if (!existsSync(assetsIgnore)) {
    fail('public/.assetsignore', 'missing — `wrangler deploy` will refuse to upload dist/ with the server bundle in it');
  } else if (!/^_worker\.js$/m.test(readFileSync(assetsIgnore, 'utf8'))) {
    fail('public/.assetsignore', 'does not list `_worker.js` — the server bundle would be served as a public static file');
  }

  /* — the OAuth Worker origin must be absolute —

     `src/lib/github.ts` interpolates this into `fetch(`${WORKER_ORIGIN}/token`)`,
     so a value with no scheme is a *relative* URL. Set to `anishgiri.dev`, a
     sign-in from `https://anishgiri.dev/admin/` requested
     `https://anishgiri.dev/admin/anishgiri.dev/token` and reported "Token
     exchange failed (404)" — a message that names neither the setting nor the
     URL it built, on a flow whose other failure modes all have precise
     messages. It shipped to production and stayed broken for a day.

     Checked here rather than only in `github.ts` because this is a *build*
     input: the value is inlined into the bundle, so the moment to refuse it is
     before the bundle exists, not when a visitor clicks sign in. Unset stays a
     supported state — that is the ungated, export-only mode the admin already
     handles — so only a set-but-unusable value fails. */
  loadDotEnv();
  const workerOrigin = (process.env.PUBLIC_GITHUB_OAUTH_WORKER ?? '').trim();
  if (workerOrigin && !/^https?:\/\/./.test(workerOrigin)) {
    fail(
      'PUBLIC_GITHUB_OAUTH_WORKER',
      `is "${workerOrigin}", which has no scheme — it must be the token Worker's full origin ` +
        '(e.g. https://name.subdomain.workers.dev). A bare host is a relative URL and the token ' +
        'exchange would 404 against this site instead of reaching the Worker',
    );
  }

  /* 8. Nothing lays out paper by accident.

     A printed A4 page at 14mm margins is a 182mm measure, which is **688px**
     at CSS's 96dpi. So every `max-width` breakpoint below roughly 690px is
     also a print rule, whether or not anybody meant it to be — and a
     breakpoint that fires alongside the print block is a second, invisible
     author of the printed layout.

     It happened. `resume.css`'s `max-width: 760px` block stacked the sheet and
     placed both children of `.rs-body` into explicit grid cells; the print
     block below it re-declared `grid-template-columns` and not the placements,
     so a resume printed into a 52mm rail with two thirds of the page blank
     beside it. Three pages, and nothing on screen was wrong.

     The same argument covers the dark ramp. Paper has no dark mode, so the
     `[data-mode='dark']` and `prefers-color-scheme` blocks are wrapped in
     `@media screen`; without that, printing from a dark page resolves
     `--color-text-muted` to a *light* neutral and half the sheet prints pale
     grey on white.

     A text match on the stylesheets rather than a rendering test, deliberately:
     the failure is a media query that forgot to say `screen`, which is
     something you can read. Whether the sheet then *looks* right is CSS and a
     printer, and `scripts/test-resume.mjs` says why that is not tested. */
  const SHEET_STYLES = ['src/styles/resume.css', 'src/styles/theme.css', 'src/styles/themes/blueprint.css'];
  for (const file of SHEET_STYLES) {
    const source = readFileSync(p(file), 'utf8');

    for (const [, condition, px] of source.matchAll(/@media([^{]*?)\(max-width:\s*(\d+)px\)/g)) {
      /* `max-width: N` matches when the viewport is *at most* N, so it can
         reach a printed page exactly when N is at least the page's width. A
         breakpoint below that can never fire on paper and needs no qualifier. */
      if (Number(px) < PRINT_WIDTH_PX) continue;
      if (!/\bscreen\b/.test(condition)) {
        fail(
          file,
          `@media (max-width: ${px}px) is not scoped to \`screen\`, so it also matches when ` +
            `printing — a printed page is only ${PRINT_WIDTH_PX}px wide. Write ` +
            '`@media screen and (max-width: ' + px + 'px)`',
        );
      }
    }

    /* The dark ramp, wherever it is declared. Both spellings, because the
       attribute has to win over a light OS and the media query has to carry the
       dark-OS default — see the header of `theme.css`. */
    if (/(?:\[data-mode=['"]dark['"]\]|prefers-color-scheme:\s*dark)/.test(source)) {
      if (!/@media\s+screen\s*\{/.test(source) && !/@media\s+screen\s+and\s*\(prefers-color-scheme/.test(source)) {
        fail(
          file,
          'declares a dark palette but never scopes one to `screen` — paper has no dark mode, ' +
            'and a sheet printed from a dark page is pale grey text on white',
        );
      }
    }
  }

  /* 9. Nothing asks the Worker to compile WebAssembly at runtime.

     `workerd` refuses `WebAssembly.instantiate()` on bytes — "Wasm code
     generation disallowed by embedder" — and Astro's markdown processor walks
     into it by default: its highlighter is Shiki, Shiki's default regex engine
     is Oniguruma, and Oniguruma is a wasm module instantiated on first use.
     `rehypeShiki` builds it for every tree whether or not there is a code block
     in it, so every save of a post or a case study with a body threw with the
     markdown file named as "undefined".

     Invisible everywhere but production: `astro dev` renders this in Node,
     where the instantiation is allowed, and `astro build` never renders
     markdown at all now that content lives in D1.

     A text match on every module that could render markdown at request time —
     `src/lib` as well as `src/pages`, because the processor moved into
     `src/lib/markdown.ts` the moment a second caller wanted it, and a gate that
     only watched routes would have stopped watching it on the way past. */
  for (const file of [...pages, ...walk('src/lib').filter(f => /\.ts$/.test(f))]) {
    const source = readFileSync(p(file), 'utf8');
    if (!source.includes('createMarkdownProcessor')) continue;
    if (!hasHighlightingOff(source)) {
      fail(
        file,
        'calls createMarkdownProcessor() without `syntaxHighlight: false` — Shiki instantiates ' +
          'a WebAssembly module on first render and workerd refuses to compile one, so every ' +
          'save of a body would throw in production and nowhere else',
      );
    }
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

  assert(
    hasHighlightingOff('createMarkdownProcessor({ syntaxHighlight: false })'),
    'accepts the highlighter being off',
  );
  assert(
    hasHighlightingOff(`createMarkdownProcessor({
      syntaxHighlight: false,
    })`),
    'tolerates the option on its own line',
  );
  assert(!hasHighlightingOff('createMarkdownProcessor({})'), 'rejects the default processor');
  assert(
    !hasHighlightingOff("createMarkdownProcessor({ syntaxHighlight: 'shiki' })"),
    'rejects an explicit highlighter',
  );

  assert(isDynamic('export const prerender = false;'), 'detects the opt-out');
  assert(isDynamic('export  const   prerender=false'), 'tolerates spacing');
  assert(!isDynamic('export const prerender = true;'), 'does not accept prerender = true');
  /* Deliberately not asserted: a commented-out `prerender = false` matches.
     This is a text match, and teaching it about comments would be the first
     step towards parsing the file. The failure it guards is a *missing* line,
     not a disguised one. */

  assert(walk('scripts').includes('scripts/check-content.mjs'), 'walk finds a known file');

  /* The OAuth origin matcher. A bare host and a scheme-relative one are the two
     shapes that look like a URL and are not one. */
  const absolute = value => /^https?:\/\/./.test(value);
  assert(absolute('https://portfolio-github-oauth.example.workers.dev'), 'accepts an https origin');
  assert(absolute('http://localhost:8787'), 'accepts a local http origin');
  assert(!absolute('anishgiri.dev'), 'rejects a bare host');
  assert(!absolute('//anishgiri.dev'), 'rejects a scheme-relative host');
  assert(!absolute('https://'), 'rejects a scheme with no host');

  /* The printed-page width, and the comparison that hangs off it. The whole
     check turns on which side of 688px a breakpoint falls, so an arithmetic
     slip here is a guard that silently passes — which is what it did on the
     first attempt, with the comparison the wrong way round. */
  assert(PRINT_WIDTH_PX === 688, 'A4 at 14mm margins is 688px');
  const reaches = px => px >= PRINT_WIDTH_PX;
  assert(reaches(760), 'a 760px breakpoint matches on paper');
  assert(reaches(688), 'a breakpoint exactly the page width matches');
  assert(!reaches(640), 'a 640px breakpoint cannot match on paper');

  /* The matcher, against the shapes that actually appear in these files. */
  const scoped = condition => /\bscreen\b/.test(condition);
  assert(scoped(' screen and '), 'accepts a screen-qualified query');
  assert(!scoped(' '), 'rejects a bare query');
  assert(!scoped(' print, '), 'does not accept `print` as a scope');

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
