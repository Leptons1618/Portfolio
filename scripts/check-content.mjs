#!/usr/bin/env node
/**
 * Cross-file content checks that neither `astro check` nor `astro build` do.
 *
 * `astro check` validates types; `astro build` validates each content file
 * against its Zod schema. Neither validates the relationships *between* files,
 * so a `caseStudySlug` pointing at a missing case study, a `heroImage` pointing
 * at a missing asset, or an origin that disagrees with the CNAME all build
 * green and fail in production.
 *
 * Run by `npm run check`, ahead of `astro check`.
 * Self-check: `node scripts/check-content.mjs --self-test`.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...parts) => join(root, ...parts);

/**
 * Read one scalar frontmatter field.
 *
 * ponytail: regex over the frontmatter block, not a YAML parse — every field
 * this checks is a plain quoted or bare scalar. Swap in a real parser if a
 * checked field ever becomes a block scalar, an anchor, or multi-line.
 */
export function frontmatterField(source, key) {
  const fm = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return undefined;
  const line = fm[1].match(new RegExp(`^${key}:[ \\t]*(.+?)[ \\t]*$`, 'm'));
  if (!line) return undefined;
  const raw = line[1].trim();
  const quoted = raw.match(/^(['"])([\s\S]*)\1$/);
  return quoted ? quoted[2] : raw;
}

const listFiles = dir => (existsSync(dir) ? readdirSync(dir) : []);
const slugOf = file => file.replace(/\.mdx?$/, '');

function collect(dir) {
  return listFiles(p('src/content', dir))
    .filter(f => /\.mdx?$/.test(f))
    .map(file => ({
      file: `src/content/${dir}/${file}`,
      slug: slugOf(file),
      source: readFileSync(p('src/content', dir, file), 'utf8'),
    }));
}

function check() {
  const errors = [];
  const fail = (file, message) => errors.push(`${file}: ${message}`);

  const projects = collect('projects');
  const caseStudies = collect('case-studies');
  const journal = collect('journal');
  const caseStudySlugs = new Set(caseStudies.map(cs => cs.slug));

  // 1. Every project's caseStudySlug resolves to a real case study.
  for (const project of projects) {
    const slug = frontmatterField(project.source, 'caseStudySlug');
    if (slug && !caseStudySlugs.has(slug)) {
      fail(project.file, `caseStudySlug "${slug}" has no matching file in src/content/case-studies/`);
    }
  }

  // 2. Every site-relative image reference resolves to a file in public/.
  for (const entry of [...projects, ...caseStudies, ...journal]) {
    for (const key of ['heroImage', 'architectureImage']) {
      const ref = frontmatterField(entry.source, key);
      if (ref?.startsWith('/') && !existsSync(p('public', ref.slice(1)))) {
        fail(entry.file, `${key} "${ref}" is not in public/`);
      }
    }
  }

  /* 3. Every journal post declares a status, and one this build understands.
     The schema defaults a missing `status` to `draft`, which is right for a
     file the editor just created and wrong for one written by hand — a typo,
     or a post from before the field existed, would silently vanish from
     production instead of failing here. */
  const JOURNAL_STATUSES = ['draft', 'published', 'unpublished'];
  for (const post of journal) {
    const status = frontmatterField(post.source, 'status');
    if (!status) fail(post.file, `no "status" — expected one of ${JOURNAL_STATUSES.join(', ')}`);
    else if (!JOURNAL_STATUSES.includes(status)) {
      fail(post.file, `status "${status}" is not one of ${JOURNAL_STATUSES.join(', ')}`);
    }
  }

  // 4. The default Open Graph image exists — every page's og:image points at it.
  const siteModule = readFileSync(p('src/lib/site.ts'), 'utf8');
  const ogImage = siteModule.match(/ogImage:\s*'([^']+)'/)?.[1];
  if (!ogImage) {
    fail('src/lib/site.ts', 'no ogImage found');
  } else if (!existsSync(p('public', ogImage.slice(1)))) {
    fail('src/lib/site.ts', `ogImage "${ogImage}" is not in public/`);
  }

  // 5. The build origin agrees with the domain Pages actually serves.
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

  /* 6. ...and the deploy workflow does not quietly overrule it. `SITE_URL` in
     the environment beats both files above, so a literal origin hard-coded
     into the workflow bypasses check 4 entirely: the build stays green and
     every canonical URL, OG tag and sitemap entry in production points at the
     wrong host. That is exactly what shipped once. */
  const workflow = p('.github/workflows/deploy.yml');
  if (existsSync(workflow)) {
    const text = readFileSync(workflow, 'utf8');
    for (const [, origin] of text.matchAll(/SITE_URL:.*?'(https?:\/\/[^']+)'/g)) {
      if (new URL(origin).hostname !== cname) {
        fail('.github/workflows/deploy.yml', `SITE_URL hard-codes "${origin}", which is not public/CNAME ("${cname}")`);
      }
    }
  }

  return { errors, counts: { projects: projects.length, caseStudies: caseStudies.length, journal: journal.length } };
}

function selfTest() {
  const eq = (actual, expected, label) => {
    if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  };
  const doc = '---\ntitle: "A"\ncaseStudySlug: "axcad"\nyear: 2024\nbare: value here\n---\n\nbody: not frontmatter\n';
  eq(frontmatterField(doc, 'caseStudySlug'), 'axcad', 'quoted');
  eq(frontmatterField(doc, 'year'), '2024', 'numeric');
  eq(frontmatterField(doc, 'bare'), 'value here', 'unquoted');
  eq(frontmatterField(doc, 'body'), undefined, 'stops at closing delimiter');
  eq(frontmatterField(doc, 'missing'), undefined, 'absent key');
  eq(frontmatterField('no frontmatter here', 'title'), undefined, 'no frontmatter block');
  eq(frontmatterField('---\r\ntitle: "A"\r\n---\r\n', 'title'), 'A', 'crlf');
  console.log('check-content self-test: ok');
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const { errors, counts } = check();
  if (errors.length) {
    console.error('Content check failed:\n' + errors.map(e => `  - ${e}`).join('\n'));
    process.exit(1);
  }
  console.log(
    `Content check passed: ${counts.projects} projects, ${counts.caseStudies} case studies, ${counts.journal} journal entries.`
  );
}
