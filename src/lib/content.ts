/**
 * The one query layer over the content tables.
 *
 * Ordering, draft filtering, category labels and the project <-> case-study
 * link all live here rather than being re-derived per page. Pages and layouts
 * consume these functions; only this module talks to D1.
 *
 * It used to be the only caller of `getCollection`, and the change from that to
 * this is deliberately confined to the lines that fetch. Every rule below —
 * `featuredRank ?? 99` before year descending, the three-state journal filter,
 * the tag counter — is the code that was here before, unedited. The rows are
 * few enough that sorting them in SQL would buy nothing measurable and would
 * risk exactly the thing this module exists to prevent: SQL's NULL ordering
 * quietly disagreeing with `?? UNRANKED` about where an unranked project goes.
 *
 * Every function takes the database as its first argument rather than reaching
 * for a global. Pages get it from `Astro.locals.runtime.env.DB`; that is one
 * line per page, and it is what makes these functions callable from a test or
 * a script without an ambient Worker.
 */

/** Closed sets, kept in step with the CHECK constraints in `migrations/`. */
export type Category =
  | 'ml-cv'
  | 'ai-llm'
  | 'full-stack'
  | 'devtools'
  | 'systems'
  | 'simulation'
  | 'other';
export type ProjectStatus = 'active' | 'stable' | 'archived' | 'wip';
export type PostStatus = 'draft' | 'published' | 'unpublished';

export interface ProjectData {
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
  hidden: boolean;
}

export interface CaseStudyData {
  title: string;
  subtitle: string;
  heroImage?: string;
  heroVideo?: string;
  problem: string;
  solution: string;
  architectureImage?: string;
  achievements: string[];
  stack: string[];
  repoUrl?: string;
  demoUrl?: string;
  date: string;
  readTime?: string;
}

export interface PostData {
  title: string;
  summary: string;
  date: string;
  tags: string[];
  readTime?: string;
  videoDuration?: string;
  heroImage?: string;
  status: PostStatus;
}

/**
 * An entry keeps the shape the collection entries had — `slug` beside `data` —
 * so no page had to be rewritten around a flatter row. The two collections
 * whose bodies are rendered carry `html` as well, and that is what replaced
 * `await entry.render()`: the markdown became HTML when it was written, so
 * there is nothing left to render per request.
 */
export interface Project {
  slug: string;
  data: ProjectData;
}
export interface CaseStudy {
  slug: string;
  data: CaseStudyData;
  body: string;
  html: string;
}
export interface Post {
  slug: string;
  data: PostData;
  body: string;
  html: string;
}

/**
 * Display names for a project's category — one entry per value in the CHECK
 * constraint, so a new category fails the typecheck until it is labelled here.
 */
export const CATEGORY_LABELS: Record<Category, string> = {
  'ai-llm': 'AI / ML',
  'ml-cv': 'Computer Vision',
  'full-stack': 'Full-Stack',
  devtools: 'DevTools',
  systems: 'Systems',
  simulation: 'Simulation',
  other: 'Other',
};

export function categoryLabel(key: string): string {
  return CATEGORY_LABELS[key as Category] ?? key;
}

/** Unranked projects sort last; ties break on the most recent year. */
const UNRANKED = 99;

function byRankThenYear(a: Project, b: Project): number {
  const rank = (a.data.featuredRank ?? UNRANKED) - (b.data.featuredRank ?? UNRANKED);
  return rank !== 0 ? rank : b.data.year - a.data.year;
}

const byDateDesc = (a: { data: { date: string } }, b: { data: { date: string } }) =>
  new Date(b.data.date).getTime() - new Date(a.data.date).getTime();

/* ---------- row mapping ---------- */

/**
 * Columns are snake_case and nullable; the fields pages read are camelCase and
 * optional. SQLite has no array type and no boolean, so list columns arrive as
 * JSON text and flags as 0/1. These two helpers are the whole translation.
 */
const list = (v: unknown): string[] => {
  if (typeof v !== 'string' || v === '') return [];
  const parsed: unknown = JSON.parse(v);
  return Array.isArray(parsed) ? (parsed as string[]) : [];
};

/** NULL becomes absent rather than `null`, which is what an optional field expects. */
const opt = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);

type Row = Record<string, any>;

const toProject = (r: Row): Project => ({
  slug: r.slug,
  data: {
    title: r.title,
    summary: r.summary,
    category: r.category,
    tags: list(r.tags),
    stack: list(r.stack),
    repoUrl: r.repo_url,
    demoUrl: opt(r.demo_url),
    caseStudySlug: opt(r.case_study_slug),
    featuredRank: opt(r.featured_rank),
    status: r.status,
    year: r.year,
    heroImage: opt(r.hero_image),
    highlights: list(r.highlights),
    hidden: r.hidden === 1,
  },
});

const toCaseStudy = (r: Row): CaseStudy => ({
  slug: r.slug,
  body: r.body_md,
  html: r.body_html,
  data: {
    title: r.title,
    subtitle: r.subtitle,
    heroImage: opt(r.hero_image),
    heroVideo: opt(r.hero_video),
    problem: r.problem,
    solution: r.solution,
    architectureImage: opt(r.architecture_image),
    achievements: list(r.achievements),
    stack: list(r.stack),
    repoUrl: opt(r.repo_url),
    demoUrl: opt(r.demo_url),
    date: r.date,
    readTime: opt(r.read_time),
  },
});

const toPost = (r: Row): Post => ({
  slug: r.slug,
  body: r.body_md,
  html: r.body_html,
  data: {
    title: r.title,
    summary: r.summary,
    date: r.date,
    tags: list(r.tags),
    readTime: opt(r.read_time),
    videoDuration: opt(r.video_duration),
    heroImage: opt(r.hero_image),
    status: r.status,
  },
});

const all = async (db: D1Database, table: string): Promise<Row[]> =>
  (await db.prepare(`SELECT * FROM ${table}`).all<Row>()).results ?? [];

/* ---------- queries ---------- */

/**
 * Every project, in the site's canonical order.
 *
 * Hidden projects are excluded everywhere the public site looks — listings and
 * detail pages alike — so `hidden: true` retires a project without deleting
 * it. The admin screens pass `includeHidden` because hiding is the thing they
 * exist to manage.
 */
export async function getProjects(db: D1Database, includeHidden = false): Promise<Project[]> {
  const rows = (await all(db, 'projects')).map(toProject);
  return rows.filter(({ data }) => includeHidden || !data.hidden).sort(byRankThenYear);
}

/** Only projects the author marked with a `featuredRank`. */
export async function getFeaturedProjects(db: D1Database, limit?: number): Promise<Project[]> {
  const ranked = (await getProjects(db)).filter(p => p.data.featuredRank !== undefined);
  return limit === undefined ? ranked : ranked.slice(0, limit);
}

/** Every case study, newest first. */
export async function getCaseStudies(db: D1Database, limit?: number): Promise<CaseStudy[]> {
  const sorted = (await all(db, 'case_studies')).map(toCaseStudy).sort(byDateDesc);
  return limit === undefined ? sorted : sorted.slice(0, limit);
}

/**
 * Journal posts, newest first.
 *
 * `published` is public. `draft` is visible while writing — in `dev` and to
 * the admin screens — and never in production. `unpublished` is visible only
 * to the admin: it is how a live post is withdrawn, and the page stops being
 * served rather than staying reachable by anyone holding the link.
 *
 * The admin screens pass `includeAll`, because managing those states is what
 * they exist for.
 */
export async function getPosts(db: D1Database, includeAll = false): Promise<Post[]> {
  const keep = ({ data }: Post) =>
    includeAll || data.status === 'published' || (data.status === 'draft' && !import.meta.env.PROD);
  return (await all(db, 'journal')).map(toPost).filter(keep).sort(byDateDesc);
}

/**
 * One row by slug, or `undefined`.
 *
 * These exist because a detail page used to get its entry from
 * `getStaticPaths`, which had already filtered the collection. Without a build
 * there is no such pass, so the page looks the row up itself — and it has to
 * look it up through the *same* filter, or `hidden` and `unpublished` would
 * still be reachable by anyone typing the URL. That is why each of these goes
 * through the list function rather than issuing its own `WHERE slug = ?`.
 */
export async function getProject(
  db: D1Database,
  slug: string,
  includeHidden = false,
): Promise<Project | undefined> {
  return (await getProjects(db, includeHidden)).find(p => p.slug === slug);
}

export async function getCaseStudy(db: D1Database, slug: string): Promise<CaseStudy | undefined> {
  return (await getCaseStudies(db)).find(cs => cs.slug === slug);
}

export async function getPost(
  db: D1Database,
  slug: string,
  includeAll = false,
): Promise<Post | undefined> {
  return (await getPosts(db, includeAll)).find(p => p.slug === slug);
}

/** The project that links to this case study, if any. */
export async function projectForCaseStudy(
  db: D1Database,
  slug: string,
): Promise<Project | undefined> {
  return (await getProjects(db)).find(p => p.data.caseStudySlug === slug);
}

/** Previous/next links for the case-study footer, in publication order. */
export async function caseStudyNeighbours(db: D1Database, slug: string) {
  const sorted = await getCaseStudies(db);
  const i = sorted.findIndex(cs => cs.slug === slug);
  return { prev: sorted[i + 1] ?? null, next: sorted[i - 1] ?? null };
}

/** Where a project card should point: its case study when it has one. */
export function projectHref(project: Project): string {
  return project.data.caseStudySlug
    ? `/case-studies/${encodeURIComponent(project.data.caseStudySlug)}`
    : `/projects/${encodeURIComponent(project.slug)}`;
}

/** Tags across all projects, most-used first — the filter bar's chip row. */
export function topTags(projects: Project[], limit = 16): string[] {
  const counts = new Map<string, number>();
  for (const p of projects) {
    for (const tag of p.data.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag]) => tag);
}
