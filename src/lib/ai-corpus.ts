/**
 * Everything the assistant is allowed to know, and nothing else.
 *
 * The request was "secure access to all the contents", and the security half of
 * that sentence is the whole job of this file. The site's content is not
 * uniformly public: a project can be `hidden`, a post can be `draft` or
 * `unpublished`, and both states exist precisely so that something is in the
 * database and *not* on the site. A chatbot that reads the tables is a way to
 * ask the site about the things it declined to publish.
 *
 * So there are two defences and they are deliberately redundant:
 *
 *   1. The route fetches through `content.ts`, whose list functions already
 *      apply the public filters — the same functions the public pages use, so
 *      the assistant cannot see a different site than a reader does.
 *   2. `buildCorpus()` filters *again*, here, on the shape it is handed. It
 *      does not trust its caller. A hidden project or a non-`published` post is
 *      dropped even if something upstream passed one in.
 *
 * The second is the one that matters, because the first is a convention and the
 * second is a function with a test. `scripts/test-ai.mjs` hands this a hidden
 * project and a draft post and asserts neither survives.
 *
 * ## Why there is no vector store
 *
 * The entire corpus is a few dozen kilobytes — a personal portfolio, not a
 * documentation site. Embedding it, storing the vectors, and retrieving the top
 * `k` would add a binding, a build step and an index to keep in sync with
 * writes, in order to select from a body of text that fits in a single prompt
 * with room to spare. `corpusSize()` exists so that stops being an assumption:
 * when it starts reporting numbers that do not fit, this comment is wrong and
 * the answer is Vectorize.
 */

import type { CaseStudy, Post, Project } from './content';
import { CATEGORY_LABELS } from './content';
import type { Resume } from './resume';
import { site } from './site';

/** What the corpus is built from. Every field is optional to fetch, not to filter. */
export interface CorpusInput {
  projects: Project[];
  caseStudies: CaseStudy[];
  posts: Post[];
  resume: Resume | null;
}

/**
 * Markdown, not JSON.
 *
 * A model reads a heading and a bullet list more reliably than it reads a
 * nested object, and the delimiters cost fewer tokens. It is also the form the
 * content was authored in, so nothing is being translated into a shape the
 * author never checked.
 */
const heading = (text: string) => `\n## ${text}\n`;

const bullet = (label: string, value: string | undefined | null) =>
  value && String(value).trim() ? `- ${label}: ${String(value).trim()}\n` : '';

const list = (label: string, values: string[] | undefined) =>
  values && values.length ? `- ${label}: ${values.join(', ')}\n` : '';

/**
 * Bodies are long and the useful part is near the front.
 *
 * A case study's first two thousand characters carry its problem, its approach
 * and usually its result; the remainder is detail that a follow-up question can
 * ask for and that would otherwise be paid for on every unrelated question. The
 * truncation is marked so the model knows the text stopped rather than the
 * subject ending.
 */
const BODY_CHARS = 2000;

const excerpt = (markdown: string, limit = BODY_CHARS): string => {
  const clean = markdown
    /* Strip image and link syntax down to their text: a URL in a corpus is
       something a model will cheerfully invent variations of. */
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return clean.length <= limit ? clean : `${clean.slice(0, limit).trimEnd()}\n[…truncated]`;
};

/* ---------- the visibility filters, restated ---------- */

/**
 * The public-visibility rule, applied to what the caller handed over.
 *
 * These duplicate what `content.ts` already did, and the duplication is the
 * point — see the header. Note `posts` is stricter than `getPosts()` is in
 * development: `getPosts` shows drafts when `!import.meta.env.PROD` so the
 * author can read their own work in progress, and that allowance must not
 * extend to a machine that answers strangers. Published only, in every
 * environment.
 */
export const publicProjects = (projects: Project[]) => projects.filter(p => !p.data.hidden);
export const publicPosts = (posts: Post[]) => posts.filter(p => p.data.status === 'published');

/* ---------- assembly ---------- */

function projectSection(projects: Project[]): string {
  if (!projects.length) return '';
  let out = heading('Projects');
  for (const { slug, data } of projects) {
    out += `\n### ${data.title}\n`;
    out += bullet('Page', `/projects/${slug}`);
    out += bullet('Summary', data.summary);
    out += bullet('Category', CATEGORY_LABELS[data.category] ?? data.category);
    out += bullet('Status', data.status);
    out += bullet('Year', String(data.year));
    out += list('Stack', data.stack);
    out += list('Tags', data.tags);
    out += list('Highlights', data.highlights);
    out += bullet('Repository', data.repoUrl);
    out += bullet('Live demo', data.demoUrl);
  }
  return out;
}

function caseStudySection(caseStudies: CaseStudy[]): string {
  if (!caseStudies.length) return '';
  let out = heading('Case studies (long-form write-ups)');
  for (const { slug, data, body } of caseStudies) {
    out += `\n### ${data.title}\n`;
    out += bullet('Page', `/case-studies/${slug}`);
    out += bullet('Subtitle', data.subtitle);
    out += bullet('Date', data.date);
    out += bullet('Problem', data.problem);
    out += bullet('Solution', data.solution);
    out += list('Achievements', data.achievements);
    out += list('Stack', data.stack);
    if (body?.trim()) out += `\n${excerpt(body)}\n`;
  }
  return out;
}

function journalSection(posts: Post[]): string {
  if (!posts.length) return '';
  let out = heading('Journal posts');
  for (const { slug, data, body } of posts) {
    out += `\n### ${data.title}\n`;
    out += bullet('Page', `/journal/${slug}`);
    out += bullet('Published', data.date);
    out += bullet('Summary', data.summary);
    out += list('Tags', data.tags);
    /* Shorter than a case study's: there are more of them, and a post's summary
       already carries its thesis. */
    if (body?.trim()) out += `\n${excerpt(body, 1200)}\n`;
  }
  return out;
}

function resumeSection(resume: Resume | null): string {
  if (!resume) return '';
  let out = heading('Background and experience');
  out += `\n${resume.summary}\n`;

  if (resume.experience.length) {
    out += '\n### Roles\n';
    for (const role of resume.experience) {
      out += `\n- **${role.title}**, ${role.company} — ${role.dates}`;
      if (role.location) out += ` (${role.location})`;
      out += '\n';
      if (role.description) out += `  ${excerpt(role.description, 600)}\n`;
    }
  }

  if (resume.skills.length) {
    out += '\n### Skills\n';
    for (const group of resume.skills) out += `- ${group.category}: ${group.items.join(', ')}\n`;
  }

  if (resume.education.length) {
    out += '\n### Education\n';
    for (const entry of resume.education) {
      out += `- ${entry.degree}, ${entry.school} (${entry.dates})\n`;
    }
  }

  if (resume.certifications.length) {
    out += `\n### Certifications\n- ${resume.certifications.join('\n- ')}\n`;
  }

  return out;
}

/**
 * Identity, from `site.ts` and nowhere else.
 *
 * **The email, phone and address are deliberately absent.** They are on the
 * resume page for a human who navigated to it; putting them in a corpus makes
 * the assistant a scraping endpoint that reads them out on request, at a URL
 * that takes no effort to find and answers in plain text. The name, role and
 * public profiles are what a question about "who is this" actually needs.
 */
function identitySection(): string {
  let out = `# ${site.name}\n`;
  out += bullet('Role', site.roleLong);
  out += bullet('About', site.bio);
  /* The city, not the street address. "Where is he based" is a fair question
     about a public professional; the line below it on the resume page is not. */
  out += bullet('Based in', site.location);
  out += bullet('GitHub', site.github);
  out += bullet('LinkedIn', site.linkedin);
  out += bullet('Site', site.url);
  return out;
}

/**
 * The grounding corpus, filtered and formatted.
 *
 * Returns markdown ready to be a system-prompt section. It re-applies the
 * public filters rather than trusting the caller — the header explains why that
 * redundancy is the design and not an oversight.
 */
export function buildCorpus(input: CorpusInput): string {
  const projects = publicProjects(input.projects);
  const posts = publicPosts(input.posts);

  return [
    identitySection(),
    resumeSection(input.resume),
    projectSection(projects),
    caseStudySection(input.caseStudies),
    journalSection(posts),
  ]
    .filter(Boolean)
    .join('\n')
    .trim();
}

/**
 * Rough token count, for the admin screen's cost line and for knowing when the
 * "it all fits in one prompt" assumption above stops being true.
 *
 * Four characters per token is the usual English approximation and is close
 * enough for a number displayed next to the word "about". Nothing branches on
 * it — a real tokeniser would be a dependency bought to make an estimate
 * slightly less estimated.
 */
export const corpusSize = (corpus: string) => ({
  chars: corpus.length,
  approxTokens: Math.ceil(corpus.length / 4),
});
