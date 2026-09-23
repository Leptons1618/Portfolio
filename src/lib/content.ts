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
  /**
   * Absent means there is no public repository to link: a private repo is
   * invisible to a visitor, and a button to a 404 is worse than no button.
   * Every render site treats this the way `demoUrl` is treated.
   */
  repoUrl?: string;
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
  /** When the row was last written, ISO with a `Z`. Admin-only; see `stamp`. */
  updatedAt: string;
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

/**
 * `updated_at` as something `Date` can read.
 *
 * SQLite writes `datetime('now')` as `2026-08-20 09:14:33` — UTC, but with a
 * space and no zone marker, which V8 parses as *local* time. Normalised once
 * here rather than at each reader, because every reader would get it wrong the
 * same way and only one of them would notice.
 */
const stamp = (v: unknown): string =>
  typeof v === 'string' && v ? `${v.replace(' ', 'T')}Z` : '';

type Row = Record<string, any>;

const toProject = (r: Row): Project => ({
  slug: r.slug,
  data: {
    title: r.title,
    summary: r.summary,
    category: r.category,
    tags: list(r.tags),
    stack: list(r.stack),
    repoUrl: opt(r.repo_url),
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
    updatedAt: stamp(r.updated_at),
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

/**
 * Every case study, newest first — including the ones a visitor cannot reach.
 *
 * This is the admin's set, and the AI's when it is answering the owner. The
 * public pages want `getPublicCaseStudies()`.
 */
export async function getCaseStudies(db: D1Database, limit?: number): Promise<CaseStudy[]> {
  const sorted = (await all(db, 'case_studies')).map(toCaseStudy).sort(byDateDesc);
  return limit === undefined ? sorted : sorted.slice(0, limit);
}

/**
 * The case studies a visitor may read.
 *
 * `hidden` is a flag on a *project*, and `case_studies` has no equivalent — a
 * study is written up work, and the work is the project. So retiring a project
 * has to retire its write-up with it, or hiding one takes the card off every
 * listing and 404s the detail page while leaving the long version live for
 * anyone holding the link. That is the whole of the bug
 * `getDeepDiveProjects()` fixes on the home page's line-up, one section
 * further in.
 *
 * A study **nothing** links to is not retired: it is unlinked, which the
 * dashboard already flags, and it is reachable on purpose. Only a study whose
 * every linking project is hidden goes — the `every` matters because two
 * projects may point at one study, and one of them still being live is still a
 * reason to read it.
 */
export async function getPublicCaseStudies(db: D1Database): Promise<CaseStudy[]> {
  const [studies, everyProject] = [await getCaseStudies(db), await getProjects(db, true)];
  const linked = (hidden: boolean) =>
    new Set(
      everyProject
        .filter(p => p.data.caseStudySlug && p.data.hidden === hidden)
        .map(p => p.data.caseStudySlug!),
    );
  const [retired, live] = [linked(true), linked(false)];
  return studies.filter(cs => !retired.has(cs.slug) || live.has(cs.slug));
}

/* ---------- the home page's deep dives ---------- */

/**
 * The home page leads with the work that has been written up at length. Which
 * projects lead — and in what order — is an authoring decision, not something
 * `featuredRank` should keep deciding on the front door as well as everywhere
 * else. The decision is stored as a singleton row in `documents`, the same
 * shape of fact as the resume and the AI settings: one record, no table of its
 * own, holding `{ "slugs": ["querypilot", …] }` top-to-bottom.
 *
 * The list holds **project** slugs, and that is the fix for the bug this
 * arrangement had. The section used to be a list of *case studies*, read
 * straight out of `case_studies` — which knows nothing about
 * `projects.hidden`. Retiring a project therefore took it off `/projects`,
 * 404'd its detail page, and left its case study leading the front door.
 * Sourcing the line-up from `getProjects()` makes that impossible by
 * construction: hidden rows are gone before the selection is applied, so there
 * is no second place for the flag to be honoured or forgotten.
 *
 * The admin writes through `saveDeepDives()` in `content-store.ts`.
 */
export const DEEP_DIVES_KEY = 'projects-deep-dives';

/** Whatever the row held, as an ordered list of real slugs, duplicates gone. */
function clampSlugs(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const slugs = raw.filter((slug): slug is string => typeof slug === 'string' && slug !== '');
  return [...new Set(slugs)];
}

/**
 * The saved selection, top-to-bottom. Empty means automatic: no row yet, an
 * emptied list, or a row of JSON that does not parse all read as "the site
 * chooses" rather than as an error — the same tolerance `clampSettings`
 * extends the AI settings, because a hand-edited row must never take the home
 * page down with it.
 */
export async function getDeepDiveSelection(db: D1Database): Promise<string[]> {
  const row = await db
    .prepare('SELECT json FROM documents WHERE slug = ?')
    .bind(DEEP_DIVES_KEY)
    .first<{ json: string } | null>();
  if (!row?.json) return [];
  try {
    return clampSlugs((JSON.parse(row.json) as { slugs?: unknown }).slugs);
  } catch {
    return [];
  }
}

/**
 * The projects the home page leads with, in order.
 *
 * The saved list is intersected with what actually exists *and is visible* at
 * read time, so a deleted or retired project drops out of the line-up instead
 * of leaving a hole in the grid — and a selection whose every slug has since
 * gone falls back to automatic rather than rendering an empty section.
 *
 * Automatic is "the ones with a write-up": a project pointing at a case study
 * is a project there is more to read about, which is what the section means.
 * With no case studies anywhere the line-up is empty and the home page draws
 * no Deep dives section at all.
 */
export async function getDeepDiveProjects(db: D1Database): Promise<Project[]> {
  const [visible, selected] = [await getProjects(db), await getDeepDiveSelection(db)];
  const bySlug = new Map(visible.map(project => [project.slug, project]));

  const picked = selected.flatMap(slug => {
    const found = bySlug.get(slug);
    return found ? [found] : [];
  });
  return picked.length > 0 ? picked : visible.filter(project => project.data.caseStudySlug);
}

/**
 * The journal listing's saved order — the same singleton-in-`documents`
 * arrangement as the deep dives above, under its own key. An ordered list of
 * post slugs to float to the top of the journal in this order; everything not
 * named keeps the date order beneath them. Empty means automatic.
 *
 * The admin writes through `saveJournalOrder()` in `content-store.ts`.
 */
export const JOURNAL_ORDER_KEY = 'journal-order';

/** Whatever the row held, as an ordered list of real slugs, duplicates gone. */
export async function getJournalOrder(db: D1Database): Promise<string[]> {
  const row = await db
    .prepare('SELECT json FROM documents WHERE slug = ?')
    .bind(JOURNAL_ORDER_KEY)
    .first<{ json: string } | null>();
  if (!row?.json) return [];
  try {
    return clampSlugs((JSON.parse(row.json) as { slugs?: unknown }).slugs);
  } catch {
    return [];
  }
}

/**
 * Float a newly created post to the top of the saved listing order.
 *
 * The saved order is a position map: posts it names come first, posts it does
 * not name follow by date — which puts a new post *beneath every named one*,
 * in the archive section, no matter how fresh its date is. This is the missing
 * half of creation, for both writers that make a post (the admin editor, the
 * daily generator): read the saved order, if there is one, and put the new
 * slug at its head.
 *
 * Deliberately a no-op when the row does not exist: absent and empty both mean
 * the automatic date order, which already puts a new post first. Creating the
 * row here would silently switch the listing from automatic to pinned for a
 * single slug — the same list, but a different regime, and the admin screen
 * would start offering to reorder.
 */
export async function pinNewJournalPost(db: D1Database, slug: string): Promise<void> {
  const row = await db
    .prepare('SELECT json FROM documents WHERE slug = ?')
    .bind(JOURNAL_ORDER_KEY)
    .first<{ json: string } | null>();
  if (!row?.json) return;

  let saved: string[];
  try {
    saved = clampSlugs((JSON.parse(row.json) as { slugs?: unknown }).slugs);
  } catch {
    /* An unreadable row is left alone rather than replaced with a guess. */
    return;
  }

  await db
    .prepare(`UPDATE documents SET json = ?, updated_at = datetime('now') WHERE slug = ?`)
    .bind(JSON.stringify({ slugs: [slug, ...saved.filter(s => s !== slug)] }), JOURNAL_ORDER_KEY)
    .run();
}

/**
 * Journal posts, newest first.
 *
 * The admin can pin an explicit order on top of the date (`saveJournalOrder()`
 * in `content-store.ts`, the same singleton-in-`documents` arrangement as the
 * home page's deep dives). Rows named in the saved list come first in that
 * order; everything else — including rows added after the order was saved —
 * keeps the date below. `sort` is stable, so unlisted posts stay newest-first
 * among themselves rather than being shuffled.
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
  const [rows, order] = [await all(db, 'journal'), await getJournalOrder(db)];
  /* The saved order is a position map, not a filter: a slug named there that no
     longer exists (or is filtered out here) simply costs nothing, and posts it
     never mentions sort after every one it does. */
  const position = new Map(order.map((slug, i) => [slug, i]));
  return rows
    .map(toPost)
    .filter(keep)
    .sort(
      (a, b) =>
        (position.get(a.slug) ?? order.length) - (position.get(b.slug) ?? order.length) ||
        byDateDesc(a, b),
    );
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
  return (await getPublicCaseStudies(db)).find(cs => cs.slug === slug);
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

/**
 * Previous/next links for the case-study footer, in publication order.
 *
 * The public set, so a footer arrow never points at a page that 404s — the
 * neighbour of a retired study is the next one a reader can actually open.
 */
export async function caseStudyNeighbours(db: D1Database, slug: string) {
  const sorted = await getPublicCaseStudies(db);
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
