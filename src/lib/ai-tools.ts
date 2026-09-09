/**
 * What a model may look up, and the closed table it may look it up through.
 *
 * `ai-corpus.ts` decides what the assistant is *allowed* to know. This decides
 * how it *gets* it, and the two are separate files because they answer separate
 * questions: the corpus module is a filter over content, this is a set of
 * callable functions with a schema each.
 *
 * ## Why retrieval replaced a corpus in the prompt
 *
 * Every question used to carry the entire site — identity, resume, every
 * project, every case study excerpt, every post excerpt — as one block of
 * markdown inside the system prompt. On a portfolio that is a few dozen
 * kilobytes, which is affordable once and absurd on every message of a
 * conversation: a ten-turn chat paid for the whole corpus ten times to answer
 * ten questions, most of which touched one post.
 *
 * Worse, it crowded out the thing being paid for. A reasoning model given
 * twelve thousand tokens of reference and a two-thousand-token ceiling spends
 * the ceiling deliberating over the reference and never writes an answer, which
 * is the failure that prompted all of this.
 *
 * So the prompt now carries an **index** — one line per thing, from
 * `buildIndex()` — and the bodies arrive through these tools when the model
 * decides it needs them. The index is small, stable between requests and
 * therefore cacheable; the bodies are fetched at most a few per conversation.
 *
 * ## This does not reopen decision 24
 *
 * Decision 31 refused a tool-calling loop, on the argument that a model
 * choosing what to call next turns `/api/ai/assist` into a general-purpose
 * endpoint running on the owner's key. That argument is about **actions**, and
 * it still holds: nothing here writes, nothing here takes a URL, a table name,
 * a column or a query fragment, and nothing here can reach a row that a logged
 * -out stranger could not already read by loading a page.
 *
 * Concretely, every tool in this table:
 *
 *   - reads through `content.ts`, and then **re-applies the public filters** on
 *     what it got back, exactly as `buildCorpus()` does and for the same
 *     reason — the second filter is the one with a test;
 *   - takes a slug or a search string and nothing that becomes SQL. The `?`
 *     placeholders are in `content.ts`; the arguments here are matched against
 *     rows already in memory;
 *   - returns text, capped, with no field that `ai-corpus.ts` would have left
 *     out — the email, phone and address are absent here for the same reason
 *     they are absent there.
 *
 * A stolen admin session therefore buys a model that can read the public site.
 * That was already true of `curl`.
 *
 * ## The shape of a tool
 *
 * OpenAI's `tools` array, which is what every provider in `ai_providers`
 * accepts. The JSON Schema is written out per tool rather than generated,
 * because it is an interface a third party's model reads and a generated one
 * would drift with whatever it was generated from.
 */

import { getCaseStudies, getPosts, getProjects, CATEGORY_LABELS } from './content';
import { CodeReadError, repoDocs, repoFile, repoTree } from './ai-code';
import { publicPosts, publicProjects } from './ai-corpus';
import { entryRange, getResume } from './resume';
import { site } from './site';

/* ---------- the table ---------- */

/** Which assistant may be offered a tool. `both` is the common case. */
export type ToolSurface = 'chat' | 'assist' | 'both';

export interface ToolSpec {
  /** The name the model calls. Lowercase with underscores, like every vendor's. */
  name: string;
  /** What it does, in the words a model reads to decide whether to call it. */
  description: string;
  /** JSON Schema for the arguments. Objects only — that is what the API takes. */
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
    additionalProperties: false;
  };
  surface: ToolSurface;
  /**
   * Needs the owner's GitHub token to run, so it is only offered where one
   * exists.
   *
   * `surface: 'assist'` says *who* may be given a tool; this says *when*. The
   * daily journal job is on the assist surface too and has no owner token —
   * it is a cron tick, not a person — so without this it would be handed three
   * repository tools it can only fail at, spending a lookup and a round to
   * discover that. `toolsFor()` and `toolSummary()` both read it.
   */
  needsRepo?: true;
}

/**
 * Every result is capped, and the cap is per call rather than per conversation.
 *
 * A post body runs to ten thousand characters and the useful part is the front
 * of it, which is the same judgement `ai-corpus.ts` makes about excerpts. The
 * difference is that a tool result is fetched *because the model asked for this
 * one*, so it can afford to be several times longer than a corpus entry.
 */
const RESULT_CHARS = 8000;

/**
 * How many tool calls one answer may make, across all rounds.
 *
 * The bound that makes a loop safe to run on someone's credit card. Four is
 * enough for "search, then read the two things that matched"; a model that
 * wants a fifth is looping, and the round limit in `agentStream()` catches that
 * from the other direction.
 */
export const MAX_TOOL_CALLS = 8;

export const TOOL_SPECS: readonly ToolSpec[] = [
  {
    name: 'search_content',
    description:
      'Search this site’s published writing and projects by keyword. Returns matching titles, slugs and one-line summaries, best match first. Use this first when you are not sure what exists; then read the specific item.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Words to look for. Two or three specific terms work better than a sentence.',
        },
        kind: {
          type: 'string',
          description: 'Restrict the search to one kind of content. Omit to search everything.',
          enum: ['project', 'post', 'case_study'],
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    surface: 'both',
  },
  {
    name: 'read_post',
    description:
      'Read one published journal post in full: its title, date, tags and body. Use it when a question is about a specific post, or when you need an example of how the author writes.',
    parameters: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'The post’s slug, as listed in the index.' },
      },
      required: ['slug'],
      additionalProperties: false,
    },
    surface: 'both',
  },
  {
    name: 'read_project',
    description:
      'Read one project’s full record: summary, stack, highlights, status, year and links.',
    parameters: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'The project’s slug, as listed in the index.' },
      },
      required: ['slug'],
      additionalProperties: false,
    },
    surface: 'both',
  },
  {
    name: 'read_case_study',
    description:
      'Read one case study in full: the problem, the approach, what it achieved, the stack, and the write-up itself.',
    parameters: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'The case study’s slug, as listed in the index.' },
      },
      required: ['slug'],
      additionalProperties: false,
    },
    surface: 'both',
  },
  {
    name: 'read_resume',
    description:
      'Read the author’s professional background: roles and dates, skills, education and certifications. Contact details are not available through this tool.',
    parameters: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          description: 'One section only. Omit for all of it.',
          enum: ['experience', 'skills', 'education', 'certifications'],
        },
      },
      additionalProperties: false,
    },
    surface: 'both',
  },

  /* — the owner's own code ————————————————————————————————————————————————

     Every tool above reads this site's published content. These three read the
     repository a project actually lives in, and they exist because a case study
     written from a one-line summary is a confident description of code nobody
     wrote — the model had no way to check itself.

     All three are `surface: 'assist'`, and that is the guardrail rather than a
     convenience: the public assistant is never handed them, so no visitor can
     reach a repository through the chat box. The rest of the boundary — the
     owner's repositories only, reads only, every path validated — is in
     `ai-code.ts`, which states it in full. */
  {
    name: 'list_repo_files',
    description:
      'List the files in one of the author’s own GitHub repositories, documentation first. Use it to see how a project is actually built before writing about it, then read the files that matter. Only the author’s repositories can be read.',
    parameters: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description:
            'The repository, as "name" or "owner/name" or its GitHub URL. Take it from the project’s repository field.',
        },
      },
      required: ['repo'],
      additionalProperties: false,
    },
    surface: 'assist',
    needsRepo: true,
  },
  {
    name: 'read_repo_docs',
    description:
      'Read a repository’s README and any documentation beside it, in one call. Start here when writing a case study or a post about a project — it is the author’s own account of what the project does and why, and it costs one lookup instead of five.',
    parameters: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'The repository, as "name" or "owner/name" or its GitHub URL.',
        },
      },
      required: ['repo'],
      additionalProperties: false,
    },
    surface: 'assist',
    needsRepo: true,
  },
  {
    name: 'read_repo_file',
    description:
      'Read one text file from one of the author’s repositories — source, configuration or documentation. Use it after list_repo_files to check a specific claim before writing it down.',
    parameters: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'The repository, as "name" or "owner/name" or its GitHub URL.',
        },
        path: {
          type: 'string',
          description: 'The file’s path inside the repository, exactly as list_repo_files gave it.',
        },
      },
      required: ['repo', 'path'],
      additionalProperties: false,
    },
    surface: 'assist',
    needsRepo: true,
  },
];

/** The names, as a set, so an unknown call is refused rather than dispatched. */
const BY_NAME = new Map(TOOL_SPECS.map(spec => [spec.name, spec]));

/**
 * The `tools` array for one surface, in the shape every provider accepts.
 *
 * Built here rather than at the route so that "which tools does the writing
 * assistant get" is a property of the table, the same way `task.surface` is.
 */
const offered = (
  surface: 'chat' | 'assist',
  options: { repoAccess?: boolean },
): readonly ToolSpec[] =>
  TOOL_SPECS.filter(
    spec =>
      (spec.surface === 'both' || spec.surface === surface) &&
      (!spec.needsRepo || options.repoAccess === true),
  );

export const toolsFor = (surface: 'chat' | 'assist', options: { repoAccess?: boolean } = {}) =>
  offered(surface, options).map(spec => ({
    type: 'function' as const,
    function: {
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters,
    },
  }));

/** One line naming what is available, for the system prompt. */
export const toolSummary = (
  surface: 'chat' | 'assist',
  options: { repoAccess?: boolean } = {},
): string =>
  offered(surface, options)
    .map(spec => `- ${spec.name}: ${spec.description.split('.')[0]}.`)
    .join('\n');

/* ---------- running one ---------- */

export interface ToolResult {
  /** What goes back to the model as the tool message. Always a string. */
  text: string;
  /** One short line for the UI's tool row. Never the whole result. */
  detail: string;
  ok: boolean;
}

/** A string argument, or `''`. Arguments arrive as a model's JSON and may be anything. */
const arg = (args: Record<string, unknown>, key: string): string => {
  const value = args[key];
  return typeof value === 'string' ? value.trim().slice(0, 200) : '';
};

const cap = (text: string) =>
  text.length <= RESULT_CHARS ? text : `${text.slice(0, RESULT_CHARS).trimEnd()}\n[…truncated]`;

const bullets = (label: string, values: string[] | undefined) =>
  values?.length ? `${label}: ${values.join(', ')}\n` : '';

/**
 * A slug, matched against rows that are already filtered.
 *
 * Deliberately exact rather than fuzzy. A model that invents a plausible slug
 * should be told the thing does not exist, not handed the nearest row — the
 * whole reason the index is in the prompt is so it does not have to guess.
 */
const bySlug = <T extends { slug: string }>(rows: T[], slug: string): T | undefined =>
  rows.find(row => row.slug === slug.toLowerCase());

const notFound = (kind: string, slug: string): ToolResult => ({
  ok: false,
  text: `There is no published ${kind} with the slug "${slug}". Check the index in your instructions for the exact slug, or use search_content.`,
  detail: `no ${kind} "${slug}"`,
});

/**
 * Run one tool call and return what the model should be told.
 *
 * Never throws for an ordinary failure — an unknown tool, a slug that does not
 * exist and a malformed argument are all *answers* rather than errors, because
 * a model that gets an error frame stops and a model that gets "there is no
 * such post" tries the right one. The route's own failure handling is for the
 * things this cannot answer, like the database being unreachable.
 */
export async function runTool(
  db: D1Database,
  name: string,
  rawArgs: unknown,
  /**
   * What the repository tools need, and nothing else has.
   *
   * The owner's GitHub token, forwarded from the request `requireOwner()`
   * already checked. Optional because the public route has none and must never
   * have one: without it the three `list_repo_files` / `read_repo_*` tools
   * refuse, which is a second latch behind `surface: 'assist'` — the public
   * assistant is not offered them *and* could not run them if it were.
   */
  ctx: { githubToken?: string } = {},
): Promise<ToolResult> {
  const spec = BY_NAME.get(name);
  if (!spec) {
    return {
      ok: false,
      text: `There is no tool called "${name}". The tools you have are: ${TOOL_SPECS.map(s => s.name).join(', ')}.`,
      detail: 'unknown tool',
    };
  }

  const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Record<string, unknown>;

  switch (spec.name) {
    case 'search_content':
      return search(db, arg(args, 'query'), arg(args, 'kind'));
    case 'read_post':
      return readPost(db, arg(args, 'slug'));
    case 'read_project':
      return readProject(db, arg(args, 'slug'));
    case 'read_case_study':
      return readCaseStudy(db, arg(args, 'slug'));
    case 'read_resume':
      return readResume(db, arg(args, 'section'));
    case 'list_repo_files':
    case 'read_repo_docs':
    case 'read_repo_file':
      return readCode(spec.name, args, ctx.githubToken);
    default:
      /* Unreachable while the switch covers the table, and a compile-time
         reminder to extend it when the table grows. */
      return { ok: false, text: `"${spec.name}" is not wired up.`, detail: 'not implemented' };
  }
}

/**
 * The three repository tools, sharing one failure shape.
 *
 * Every way this can fail is an *answer* rather than an error, the same rule
 * the rest of this file follows: a model told "you may only read the author's
 * own repositories" names the right one next time, where a model handed an
 * error frame stops with a half-written draft. `CodeReadError` carries the
 * sentence worth showing; anything else is reported without its stack, because
 * a vendor's transport error is not something the writer can act on.
 */
async function readCode(
  name: string,
  args: Record<string, unknown>,
  token: string | undefined,
): Promise<ToolResult> {
  if (!token) {
    return {
      ok: false,
      text: 'Repository reading is not available in this conversation. Answer from the site’s own content instead.',
      detail: 'no repository access',
    };
  }
  /* Longer than `arg()`'s 200 characters would allow for a path, and no
     shorter for a repository name — both are identifiers, not prose. */
  const repo = typeof args.repo === 'string' ? args.repo.trim().slice(0, 300) : '';
  const path = typeof args.path === 'string' ? args.path.trim().slice(0, 400) : '';

  try {
    const result =
      name === 'list_repo_files'
        ? await repoTree(repo, token)
        : name === 'read_repo_docs'
          ? await repoDocs(repo, token)
          : await repoFile(repo, path, token);
    return { ok: true, text: cap(result.text), detail: result.detail };
  } catch (error) {
    if (error instanceof CodeReadError) {
      return { ok: false, text: error.message, detail: error.message.slice(0, 80) };
    }
    return { ok: false, text: 'That repository could not be read.', detail: 'repository read failed' };
  }
}

/* ---------- the tools themselves ---------- */

/**
 * Keyword search over the index fields, scored by where a term matched.
 *
 * No index, no embeddings, no ranking library: this searches a few dozen rows
 * that are already in memory, and a title match mattering more than a body
 * match is the whole of the relevance model. `ai-corpus.ts` says when that
 * assumption stops being true — the answer then is Vectorize, and it is not
 * this function growing a scoring system.
 */
async function search(db: D1Database, query: string, kind: string): Promise<ToolResult> {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  if (!terms.length) {
    return { ok: false, text: 'Give search_content something to search for.', detail: 'empty query' };
  }

  const [projects, caseStudies, posts] = await Promise.all([
    getProjects(db),
    getCaseStudies(db),
    getPosts(db),
  ]);

  type Hit = { score: number; line: string };
  const hits: Hit[] = [];

  const score = (strong: string, weak: string): number => {
    const head = strong.toLowerCase();
    const rest = weak.toLowerCase();
    let total = 0;
    for (const term of terms) {
      if (head.includes(term)) total += 3;
      else if (rest.includes(term)) total += 1;
    }
    return total;
  };

  if (!kind || kind === 'project') {
    for (const { slug, data } of publicProjects(projects)) {
      const s = score(
        `${data.title} ${data.tags.join(' ')} ${data.stack.join(' ')}`,
        `${data.summary} ${data.highlights.join(' ')}`,
      );
      if (s > 0) hits.push({ score: s, line: `project ${slug} — ${data.title}: ${data.summary}` });
    }
  }

  if (!kind || kind === 'post') {
    for (const { slug, data, body } of publicPosts(posts)) {
      const s = score(`${data.title} ${data.tags.join(' ')}`, `${data.summary} ${body ?? ''}`);
      if (s > 0) hits.push({ score: s, line: `post ${slug} — ${data.title}: ${data.summary}` });
    }
  }

  if (!kind || kind === 'case_study') {
    for (const { slug, data, body } of caseStudies) {
      const s = score(
        `${data.title} ${data.subtitle} ${data.stack.join(' ')}`,
        `${data.problem} ${data.solution} ${body ?? ''}`,
      );
      if (s > 0) hits.push({ score: s, line: `case_study ${slug} — ${data.title}: ${data.subtitle}` });
    }
  }

  if (!hits.length) {
    return {
      ok: true,
      text: `Nothing on this site matches "${query}". Say so rather than guessing — the index in your instructions is the complete list of what exists.`,
      detail: 'no matches',
    };
  }

  hits.sort((a, b) => b.score - a.score);
  const shown = hits.slice(0, 8);
  return {
    ok: true,
    text: cap(
      `${hits.length} match${hits.length === 1 ? '' : 'es'} for "${query}". Read one with read_post, read_project or read_case_study.\n\n${shown
        .map(hit => `- ${hit.line}`)
        .join('\n')}`,
    ),
    detail: `${hits.length} match${hits.length === 1 ? '' : 'es'}`,
  };
}

async function readPost(db: D1Database, slug: string): Promise<ToolResult> {
  /* Through `getPosts` and then `publicPosts` — the double filter this file's
     header describes. `getPosts` shows drafts in `dev`; `publicPosts` does not,
     in any environment, and a machine answering strangers gets the strict one. */
  const post = bySlug(publicPosts(await getPosts(db)), slug);
  if (!post) return notFound('post', slug);

  const { data, body } = post;
  let out = `# ${data.title}\n`;
  out += `Page: /journal/${post.slug}\n`;
  out += `Published: ${data.date}\n`;
  out += bullets('Tags', data.tags);
  out += `\n${data.summary}\n\n${body ?? ''}`;
  return { ok: true, text: cap(out), detail: `${(body ?? '').length.toLocaleString()} characters` };
}

async function readProject(db: D1Database, slug: string): Promise<ToolResult> {
  const project = bySlug(publicProjects(await getProjects(db)), slug);
  if (!project) return notFound('project', slug);

  const { data } = project;
  let out = `# ${data.title}\n`;
  out += `Page: /projects/${project.slug}\n`;
  out += `Summary: ${data.summary}\n`;
  out += `Category: ${CATEGORY_LABELS[data.category] ?? data.category}\n`;
  out += `Status: ${data.status}\nYear: ${data.year}\n`;
  out += bullets('Stack', data.stack);
  out += bullets('Tags', data.tags);
  out += bullets('Highlights', data.highlights);
  if (data.repoUrl) out += `Repository: ${data.repoUrl}\n`;
  if (data.demoUrl) out += `Live demo: ${data.demoUrl}\n`;
  if (data.caseStudySlug) out += `Case study: ${data.caseStudySlug} (read_case_study)\n`;
  return { ok: true, text: cap(out), detail: data.title };
}

async function readCaseStudy(db: D1Database, slug: string): Promise<ToolResult> {
  const study = bySlug(await getCaseStudies(db), slug);
  if (!study) return notFound('case study', slug);

  const { data, body } = study;
  let out = `# ${data.title}\n`;
  out += `Page: /case-studies/${study.slug}\n`;
  out += `Subtitle: ${data.subtitle}\nDate: ${data.date}\n`;
  out += `Problem: ${data.problem}\nSolution: ${data.solution}\n`;
  out += bullets('Achievements', data.achievements);
  out += bullets('Stack', data.stack);
  out += `\n${body ?? ''}`;
  return { ok: true, text: cap(out), detail: `${(body ?? '').length.toLocaleString()} characters` };
}

/**
 * The résumé, minus the three fields that are the reason this is a tool at all.
 *
 * `getResume()` composes the identity block back in from `site.ts`, which is
 * where the email, phone and street address live. None of them is written here,
 * for exactly the reason `ai-corpus.ts` gives: an assistant that reads them out
 * on request is a scraping endpoint at a URL that takes no effort to find.
 */
async function readResume(db: D1Database, section: string): Promise<ToolResult> {
  const resume = await getResume(db);
  if (!resume) {
    return { ok: false, text: 'There is no resume stored on this site.', detail: 'no resume' };
  }

  const want = (name: string) => !section || section === name;
  let out = `# ${site.name} — ${site.roleLong}\nBased in ${site.location}\n\n${resume.summary}\n`;

  if (want('experience') && resume.experience.length) {
    out += '\n## Roles\n';
    for (const role of resume.experience) {
      out += `\n- ${role.title}, ${role.company} — ${entryRange(role)}`;
      if (role.location) out += ` (${role.location})`;
      out += '\n';
      if (role.description) out += `  ${role.description}\n`;
      for (const point of role.highlights) out += `  - ${point}\n`;
    }
  }
  if (want('skills') && resume.skills.length) {
    out += '\n## Skills\n';
    for (const group of resume.skills) out += `- ${group.category}: ${group.items.join(', ')}\n`;
  }
  if (want('education') && resume.education.length) {
    out += '\n## Education\n';
    for (const entry of resume.education) out += `- ${entry.degree}, ${entry.school} (${entryRange(entry)})\n`;
  }
  if (want('certifications') && resume.certifications.length) {
    out += `\n## Certifications\n- ${resume.certifications.join('\n- ')}\n`;
  }

  return { ok: true, text: cap(out), detail: section || 'full resume' };
}
