/**
 * The write half of the content tables.
 *
 * `content.ts` reads them; this is what the admin screens save through. It
 * exists so that "what a valid project looks like" is written down exactly
 * once — the import form, the edit form and the case-study scaffold all go
 * through the same field list.
 *
 * ## What changed when the content moved to D1
 *
 * Every function here used to end in a GitHub commit, and the author's change
 * appeared on the site one deploy later. They now end in a `POST /api/content`,
 * and the change is on the site when the request returns. Three things fell
 * out of that, and they are the reason this file is shorter than it was:
 *
 *   - **No serialiser.** A row is columns, so `buildProjectMarkdown` no longer
 *     has to produce a file that is byte-indistinguishable from a hand-written
 *     one. `buildPostMarkdown` survives, because exporting a post as markdown
 *     is still a thing the editor offers.
 *   - **No read-modify-write.** `patchProject` was one read, patches applied in
 *     memory, and one commit under the SHA it read, all so a concurrent edit
 *     would be rejected rather than lost. `UPDATE ... SET` on the columns that
 *     changed is that same guarantee, minus the ceremony.
 *   - **No overwrite check.** `createProject` had to ask whether the file
 *     existed, because the Contents API turns a create into an update given
 *     half a chance. `slug` is a PRIMARY KEY, so the database refuses instead.
 *
 * Browser-only: every exported write here ends in a fetch carrying the admin's
 * GitHub token. The type import from `./content` is erased at compile time.
 */

import type { CaseStudyData, Category, PostStatus, ProjectStatus } from './content';
import { getToken } from './github';
import { RESUME_KEY, type ResumeDocument } from './resume';

export type { PostStatus };

/**
 * Every value the CHECK constraints allow, in the order the forms offer them.
 *
 * Declared as full `Record`s so that widening a constraint in `migrations/`
 * fails the typecheck here until the new value is listed — the same trick that
 * keeps `CATEGORY_LABELS` honest in `content.ts`.
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
} satisfies Record<ProjectStatus, string>;

const POST_STATUS_SET = {
  draft: 'Draft',
  published: 'Published',
  unpublished: 'Unpublished',
} satisfies Record<PostStatus, string>;

export const PROJECT_CATEGORIES = Object.entries(CATEGORY_SET) as [Category, string][];
export const PROJECT_STATUSES = Object.entries(STATUS_SET) as [ProjectStatus, string][];
export const POST_STATUSES = Object.entries(POST_STATUS_SET) as [PostStatus, string][];

/** One project row, as the admin writes it. */
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
  status: ProjectStatus;
  year: number;
  heroImage?: string;
  highlights: string[];
  hidden?: boolean;
}

/** One journal row, as the editor writes it. */
export interface PostFields {
  title: string;
  summary: string;
  date: string;
  tags: string[];
  readTime?: string;
  videoDuration?: string;
  heroImage?: string;
  status: PostStatus;
}

/** A case study's structured fields. */
export type CaseStudyFields = CaseStudyData;

/** Title → slug. The primary key, and the last segment of the public URL. */
export function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Where a row lives, for the admin to display.
 *
 * These used to be repository paths — `src/content/projects/thing.md` — and the
 * screens print them so the author knows what a save is about to touch. The
 * answer is now a table and a key, so that is what they return. Keeping the
 * function rather than inlining the string means the admin has one place to
 * learn from if content ever moves again.
 */
export const projectPath = (slug: string) => `projects/${slug}`;
export const caseStudyPath = (slug: string) => `case_studies/${slug}`;
export const postPath = (slug: string) => `journal/${slug}`;

/** Raised for anything the write endpoint refused. Carries its message verbatim. */
export class ContentError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ContentError';
    this.status = status;
  }
}

/**
 * What a save reports back.
 *
 * `url` is the page the change is visible on — which is the whole difference
 * this migration made, and is why it replaced the commit URL the screens used
 * to link to. There is no commit to view, and there is no build to wait for.
 */
export interface WriteResult {
  slug: string;
  /** The live page, ready to open. */
  url: string;
}

type Table = 'projects' | 'case_studies' | 'journal' | 'documents';

/** Where a row is readable once written. */
const LIVE_PATH: Record<Table, (slug: string) => string> = {
  journal: slug => `/journal/${encodeURIComponent(slug)}`,
  case_studies: slug => `/case-studies/${encodeURIComponent(slug)}`,
  projects: slug => `/projects/${encodeURIComponent(slug)}`,
  // The resume is a singleton; its key is not part of its URL.
  documents: () => '/resume',
};

const liveUrl = (table: Table, slug: string): string => LIVE_PATH[table](slug);

/**
 * The one call every write goes through.
 *
 * The token is the admin's GitHub token, and the endpoint asks GitHub whose it
 * is — there is no second credential anywhere in this system. See
 * `src/lib/authorize.ts`.
 */
async function write(
  table: Table,
  slug: string,
  op: 'create' | 'patch' | 'delete',
  payload: { fields?: Record<string, unknown>; body?: string } = {},
): Promise<WriteResult> {
  const token = getToken();
  if (!token) throw new ContentError('Sign in with GitHub to save changes.', 401);

  const response = await fetch('/api/content', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ table, slug, op, ...payload }),
  });

  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new ContentError(data.error ?? `Save failed (${response.status}).`, response.status);
  }
  return { slug, url: liveUrl(table, slug) };
}

/* ---------- journal ---------- */

/**
 * Move one journal post between draft, published and unpublished.
 *
 * Unpublishing takes the page away rather than leaving an orphan URL: the
 * public lookup filters on status, so `/journal/<slug>` starts returning 404
 * the moment this returns.
 */
export function setPostStatus(slug: string, status: PostStatus): Promise<WriteResult> {
  return write('journal', slug, 'patch', { fields: { status } });
}

/**
 * A complete journal file, for the editor's export button.
 *
 * The site no longer reads markdown files, but "give me this post as a `.md`"
 * is still worth having — it is how a post leaves this system. Optional fields
 * are omitted rather than written empty, the way the hand-authored posts did.
 */
export function buildPostMarkdown(fields: PostFields, body: string): string {
  const quote = (value: string) => JSON.stringify(value);
  const lines = [
    '---',
    `title: ${quote(fields.title || 'Untitled')}`,
    `summary: ${quote(fields.summary)}`,
    `date: ${quote(fields.date)}`,
    `tags: [${fields.tags.map(quote).join(', ')}]`,
  ];
  if (fields.readTime) lines.push(`readTime: ${quote(fields.readTime)}`);
  if (fields.videoDuration) lines.push(`videoDuration: ${quote(fields.videoDuration)}`);
  if (fields.heroImage) lines.push(`heroImage: ${quote(fields.heroImage)}`);
  lines.push(`status: ${quote(fields.status)}`, '---', '', body.trim(), '');
  return lines.join('\n');
}

/**
 * Write a journal post that does not exist yet.
 *
 * `slug` is the primary key, so landing on an existing one is refused by the
 * database rather than silently replacing a published post with an empty draft.
 */
export function createPost(slug: string, fields: PostFields, body: string): Promise<WriteResult> {
  return write('journal', slug, 'create', { fields: { ...fields }, body });
}

/**
 * Save an open journal post.
 *
 * Which post is open is the route, not a variable, and the slug never follows
 * the title: renaming would orphan a live URL. Only the columns the editor
 * knows about are written, so anything added to the table since survives.
 */
export function updatePost(slug: string, fields: PostFields, body: string): Promise<WriteResult> {
  return write('journal', slug, 'patch', { fields: { ...fields }, body });
}

/**
 * Delete a journal post.
 *
 * Unlike the file this replaced, a deleted row is *gone* — there is no commit
 * history holding a copy. The screens that call this say so.
 */
export function removePost(slug: string): Promise<WriteResult> {
  return write('journal', slug, 'delete');
}

/* ---------- projects ---------- */

/** Write a project that does not exist yet. A duplicate slug is refused. */
export function createProject(slug: string, fields: ProjectFields): Promise<WriteResult> {
  return write('projects', slug, 'create', { fields: { ...fields } });
}

/**
 * Change some fields of an existing project.
 *
 * A key set to `undefined` or `''` clears the column, which is how an optional
 * field is emptied. Required fields are the database's problem: NOT NULL and
 * the CHECK constraints refuse a write that would leave a row unrenderable.
 */
export function patchProject(slug: string, changes: Partial<ProjectFields>): Promise<WriteResult> {
  return write('projects', slug, 'patch', { fields: { ...changes } });
}

/** Delete a project. Refused while a case study still points at it. */
export function removeProject(slug: string): Promise<WriteResult> {
  return write('projects', slug, 'delete');
}

/* ---------- case studies ---------- */

/** The case-study fields this scaffold fills in. */
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
 * Scaffold a case study with a placeholder body and link-ready fields.
 *
 * The body is markdown now rather than MDX, and the endpoint renders it on the
 * way in — so unlike the file version, this one is immediately readable rather
 * than a stub waiting for someone to open an editor in git.
 */
export function createCaseStudy(slug: string, seed: CaseStudySeed): Promise<WriteResult> {
  const body = [
    '## Background',
    '',
    'Scaffolded from the admin so the project could link to it. Replace this',
    'section.',
    '',
  ].join('\n');
  return write('case_studies', slug, 'create', { fields: { ...seed }, body });
}

/** Change some of a case study's structured fields. */
export function patchCaseStudy(
  slug: string,
  changes: Partial<CaseStudyFields>,
): Promise<WriteResult> {
  return write('case_studies', slug, 'patch', { fields: { ...changes } });
}

/** Replace a case study's prose. */
export function setCaseStudyBody(slug: string, body: string): Promise<WriteResult> {
  return write('case_studies', slug, 'patch', { body });
}

/* ---------- singleton documents ---------- */

/**
 * Save the resume body.
 *
 * A patch on one row of `documents`, holding the whole document as JSON. The
 * editor has always written the resume whole — it used to regenerate all of
 * `src/lib/resume.ts` and commit that — so a partial update was never a thing
 * this needed to express.
 *
 * Identity fields are not sent and must not be: name, email, phone and address
 * come from `src/lib/site.ts` and are composed back on read.
 */
export function saveResume(document: ResumeDocument): Promise<WriteResult> {
  return write('documents', RESUME_KEY, 'patch', { fields: { json: JSON.stringify(document) } });
}

/* ---------- import ---------- */

/**
 * Repository metadata as project fields, as far as it goes.
 *
 * Seven of the nine required fields have an honest answer on GitHub. The two
 * that do not — `category`, a seven-value enum, and `highlights`, prose — are
 * why importing opens a form instead of saving straight away.
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
  languages: string[],
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
