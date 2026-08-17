/**
 * The write half of the content collections.
 *
 * `content.ts` reads them at build time; this is what the admin screens commit
 * back. It exists so that "what a valid project file looks like" is written
 * down exactly once — the import form, the edit form and the case-study
 * scaffold all go through the same field list and the same serialiser. A new
 * value in the schema's enums fails the typecheck here rather than at build
 * time, in a file that has already been pushed.
 *
 * Two write strategies, deliberately not one:
 *
 *   - **Create** builds a whole file. There is nothing to preserve yet, and a
 *     generator is the only way to guarantee every required field is present.
 *   - **Edit** patches fields in place through `frontmatter.ts`. The admin does
 *     not render a project's body and does not know every field a hand-authored
 *     file might carry, so regenerating one would quietly drop whatever this
 *     screen has never heard of.
 *
 * Browser-only: every exported function here ends in a GitHub commit. The type
 * import from `./content` is erased at compile time, so nothing drags
 * `astro:content` into the client bundle.
 */

import type { Post, Project } from './content';
import {
  removeFrontmatterField,
  setFrontmatterField,
  setFrontmatterList,
  type Scalar,
} from './frontmatter';
import { GitHubError, commitFile, deleteFile, readFile, type CommitResult } from './github';

type Category = Project['data']['category'];
type Status = Project['data']['status'];

/**
 * Every value the schema's enums allow, in the order the forms offer them.
 *
 * Declared as full `Record`s so that adding a value in `src/content/config.ts`
 * fails the typecheck here until it is listed — the same trick that keeps
 * `CATEGORY_LABELS` honest in `content.ts`.
 */
const CATEGORY_SET = {
  'ml-cv': 'Computer Vision',
  'ai-llm': 'AI / ML',
  'full-stack': 'Full-Stack',
  devtools: 'DevTools',
  systems: 'Systems',
  simulation: 'Simulation',
  other: 'Other',
} satisfies Record<Category, string>;

const STATUS_SET = {
  active: 'Active',
  stable: 'Stable',
  wip: 'Work in progress',
  archived: 'Archived',
} satisfies Record<Status, string>;

export const PROJECT_CATEGORIES = Object.entries(CATEGORY_SET) as [Category, string][];
export const PROJECT_STATUSES = Object.entries(STATUS_SET) as [Status, string][];

/** One project file's frontmatter — the schema, as the admin writes it. */
export interface ProjectFields {
  title: string;
  summary: string;
  category: Category;
  tags: string[];
  stack: string[];
  repoUrl: string;
  demoUrl?: string;
  caseStudySlug?: string;
  featuredRank?: number;
  status: Status;
  year: number;
  heroImage?: string;
  highlights: string[];
  hidden?: boolean;
}

/** Filename → slug, so this has to agree with what Astro derives from it. */
export function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export const projectPath = (slug: string) => `src/content/projects/${slug}.md`;
export const caseStudyPath = (slug: string) => `src/content/case-studies/${slug}.mdx`;
export const postPath = (slug: string) => `src/content/journal/${slug}.md`;

export type PostStatus = Post['data']['status'];

const POST_STATUS_SET = {
  draft: 'Draft',
  published: 'Published',
  unpublished: 'Unpublished',
} satisfies Record<PostStatus, string>;

export const POST_STATUSES = Object.entries(POST_STATUS_SET) as [PostStatus, string][];

/**
 * Move one journal post between draft, published and unpublished.
 *
 * A patch rather than a rewrite, because this is the one journal action the
 * editor performs on a file it did not just author: the body, and any field
 * the editor has never heard of, have to survive. `null` when the file already
 * said this.
 */
export async function setPostStatus(slug: string, status: PostStatus): Promise<CommitResult | null> {
  const path = postPath(slug);
  const file = await readFile(path);
  const next = setFrontmatterField(file.text, 'status', status);
  if (next === file.text) return null;
  return commitFile({ path, content: next, message: `content(journal): ${status} ${slug}`, sha: file.sha });
}

const quote = (value: string) => JSON.stringify(value);

/**
 * A complete project file.
 *
 * Field order and list style match the hand-authored files: short lists inline,
 * `highlights` as an indented block. An imported project should be
 * indistinguishable from one written by hand, or the next `git diff` is noise.
 */
export function buildProjectMarkdown(fields: ProjectFields): string {
  const lines = [
    '---',
    `title: ${quote(fields.title)}`,
    `summary: ${quote(fields.summary)}`,
    `category: ${quote(fields.category)}`,
    `tags: [${fields.tags.map(quote).join(', ')}]`,
    `stack: [${fields.stack.map(quote).join(', ')}]`,
    `repoUrl: ${quote(fields.repoUrl)}`,
  ];
  if (fields.demoUrl) lines.push(`demoUrl: ${quote(fields.demoUrl)}`);
  if (fields.caseStudySlug) lines.push(`caseStudySlug: ${quote(fields.caseStudySlug)}`);
  if (fields.featuredRank !== undefined) lines.push(`featuredRank: ${fields.featuredRank}`);
  lines.push(`status: ${quote(fields.status)}`, `year: ${fields.year}`);
  if (fields.heroImage) lines.push(`heroImage: ${quote(fields.heroImage)}`);
  lines.push('highlights:');
  for (const highlight of fields.highlights) lines.push(`  - ${quote(highlight)}`);
  if (fields.hidden) lines.push('hidden: true');
  lines.push('---', '');
  return lines.join('\n');
}

/** True when the path is already on the default branch. */
async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) return false;
    throw error;
  }
}

/**
 * Write a new project file.
 *
 * Refuses to overwrite: the Contents API happily turns a create into an update,
 * and "import" landing on top of an existing project would replace a file the
 * author wrote with one assembled from repository metadata.
 */
export async function createProject(slug: string, fields: ProjectFields): Promise<CommitResult> {
  const path = projectPath(slug);
  if (await exists(path)) {
    throw new GitHubError(`${path} already exists. Edit that project instead.`);
  }
  return commitFile({
    path,
    content: buildProjectMarkdown(fields),
    message: `content(projects): add ${slug}`,
  });
}

/**
 * Change some fields of an existing project.
 *
 * One read, every patch applied in memory, one commit under the SHA that was
 * read — so a concurrent edit makes GitHub reject the write instead of losing
 * it, and a five-field edit is one commit rather than five.
 *
 * A key set to `undefined` or `''` is removed, which is how an optional field
 * gets cleared. Required fields are the caller's problem: this does not know
 * which is which, and an empty `title` would be caught by the build.
 *
 * Returns `null` when the file already said exactly this.
 */
export async function patchProject(
  slug: string,
  changes: Partial<ProjectFields>,
  message: string
): Promise<CommitResult | null> {
  const path = projectPath(slug);
  const file = await readFile(path);

  let next = file.text;
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined || value === '') next = removeFrontmatterField(next, key);
    else if (Array.isArray(value)) next = setFrontmatterList(next, key, value);
    else next = setFrontmatterField(next, key, value as Scalar);
  }

  if (next === file.text) return null;
  return commitFile({ path, content: next, message, sha: file.sha });
}

/** Delete a project file. Recoverable — it stays in the history. */
export function removeProject(slug: string): Promise<CommitResult> {
  return deleteFile({ path: projectPath(slug), message: `content(projects): remove ${slug}` });
}

/** The case-study frontmatter this scaffold fills in. */
export interface CaseStudySeed {
  title: string;
  subtitle: string;
  problem: string;
  solution: string;
  achievements: string[];
  stack: string[];
  repoUrl?: string;
  demoUrl?: string;
  date: string;
}

/**
 * Scaffold a case study with an empty body and link-ready frontmatter.
 *
 * Bodies are written in git, not here. An MDX editor in the browser means a
 * second editor as capable as the journal one, a preview that cannot be a
 * 40-line subset, and a real chance of committing MDX that fails the build —
 * see `docs/ADMIN-REARCHITECTURE.md`. What the admin can usefully do is create
 * the file, fill in the structured half from the project it belongs to, and
 * link it.
 */
export async function createCaseStudy(slug: string, seed: CaseStudySeed): Promise<CommitResult> {
  const path = caseStudyPath(slug);
  if (await exists(path)) {
    throw new GitHubError(`${path} already exists. Link to it instead of creating it.`);
  }

  const lines = [
    '---',
    `title: ${quote(seed.title)}`,
    `subtitle: ${quote(seed.subtitle)}`,
    `problem: ${quote(seed.problem)}`,
    `solution: ${quote(seed.solution)}`,
    'achievements:',
    ...seed.achievements.map(item => `  - ${quote(item)}`),
    `stack: [${seed.stack.map(quote).join(', ')}]`,
  ];
  if (seed.repoUrl) lines.push(`repoUrl: ${quote(seed.repoUrl)}`);
  if (seed.demoUrl) lines.push(`demoUrl: ${quote(seed.demoUrl)}`);
  lines.push(
    `date: ${quote(seed.date)}`,
    '---',
    '',
    '## Background',
    '',
    'Written in the repository — this file was scaffolded from the admin so the',
    'project could link to it. Replace this section.',
    ''
  );

  return commitFile({
    path,
    content: lines.join('\n'),
    message: `content(case-studies): scaffold ${slug}`,
  });
}

/**
 * Repository metadata as project fields, as far as it goes.
 *
 * Seven of the nine required fields have an honest answer on GitHub. The two
 * that do not — `category`, a seven-value enum, and `highlights`, prose — are
 * why importing opens a form instead of committing straight away.
 */
export function fieldsFromRepo(
  repo: {
    name: string;
    description: string | null;
    htmlUrl: string;
    homepage: string | null;
    topics: string[];
    createdAt: string;
    pushedAt: string;
    archived: boolean;
  },
  languages: string[]
): ProjectFields {
  return {
    title: repo.name,
    summary: repo.description ?? '',
    category: 'other',
    tags: repo.topics.slice(0, 8),
    stack: languages.slice(0, 8),
    repoUrl: repo.htmlUrl,
    demoUrl: repo.homepage ?? undefined,
    status: repo.archived ? 'archived' : 'active',
    year: new Date(repo.pushedAt || repo.createdAt).getFullYear(),
    highlights: [],
  };
}
