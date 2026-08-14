/**
 * The one query layer over the content collections.
 *
 * Ordering, draft filtering, category labels and the project <-> case-study
 * link all live here rather than being re-derived per page. Pages and layouts
 * consume these functions; only this module calls `getCollection`.
 */

import { getCollection, type CollectionEntry } from 'astro:content';

export type Project = CollectionEntry<'projects'>;
export type CaseStudy = CollectionEntry<'case-studies'>;
export type Post = CollectionEntry<'journal'>;

/**
 * Display names for `projects.category` — one entry per value in the schema
 * enum, so a new category fails the typecheck until it is labelled here.
 */
export const CATEGORY_LABELS: Record<Project['data']['category'], string> = {
  'ai-llm': 'AI / ML',
  'ml-cv': 'Computer Vision',
  'full-stack': 'Full-Stack',
  devtools: 'DevTools',
  systems: 'Systems',
  simulation: 'Simulation',
  other: 'Other',
};

export function categoryLabel(key: string): string {
  return CATEGORY_LABELS[key as Project['data']['category']] ?? key;
}

/** Unranked projects sort last; ties break on the most recent year. */
const UNRANKED = 99;

function byRankThenYear(a: Project, b: Project): number {
  const rank = (a.data.featuredRank ?? UNRANKED) - (b.data.featuredRank ?? UNRANKED);
  return rank !== 0 ? rank : b.data.year - a.data.year;
}

const byDateDesc = (a: { data: { date: string } }, b: { data: { date: string } }) =>
  new Date(b.data.date).getTime() - new Date(a.data.date).getTime();

/** Every project, in the site's canonical order. */
export async function getProjects(): Promise<Project[]> {
  return (await getCollection('projects')).sort(byRankThenYear);
}

/** Only projects the author marked with a `featuredRank`. */
export async function getFeaturedProjects(limit?: number): Promise<Project[]> {
  const ranked = (await getProjects()).filter(p => p.data.featuredRank !== undefined);
  return limit === undefined ? ranked : ranked.slice(0, limit);
}

/** Every case study, newest first. */
export async function getCaseStudies(limit?: number): Promise<CaseStudy[]> {
  const sorted = (await getCollection('case-studies')).sort(byDateDesc);
  return limit === undefined ? sorted : sorted.slice(0, limit);
}

/**
 * Journal posts, newest first. Drafts are authored in the admin editor and
 * kept out of production builds, but stay visible in `dev` and to the admin
 * screens, which pass `includeDrafts`.
 */
export async function getPosts(includeDrafts = false): Promise<Post[]> {
  const keep = ({ data }: Post) => includeDrafts || !import.meta.env.PROD || !data.draft;
  return (await getCollection('journal', keep)).sort(byDateDesc);
}

/** The project that links to this case study, if any. */
export async function projectForCaseStudy(slug: string): Promise<Project | undefined> {
  return (await getProjects()).find(p => p.data.caseStudySlug === slug);
}

/** Previous/next links for the case-study footer, in publication order. */
export async function caseStudyNeighbours(slug: string) {
  const sorted = await getCaseStudies();
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
