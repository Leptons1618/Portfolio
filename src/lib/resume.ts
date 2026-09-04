/**
 * The resume: what is stored, how it is read, and how one variant of it is
 * resolved into a sheet somebody can print.
 *
 * This module used to *be* the resume: five exported constants that the editor
 * regenerated wholesale and wrote back over its own source. That made saving a
 * resume a write to the repository, and it was the last one left after the
 * collections moved to D1 — so the body moved too, into a single row of the
 * `documents` table, and what stays here is the shape and the reader.
 *
 * Identity fields still come from `site.ts` and are composed back on read. That
 * is decision 3, unchanged and now load-bearing in a second way: the document in
 * the database deliberately does not contain the owner's name, email, phone or
 * address, so there is still exactly one place those are written down.
 *
 * ## One master, many variants — decision 39
 *
 * Applying for an ML role and a full-stack role wants two different resumes,
 * and the naive way to have two is to keep two documents. That is a job title
 * corrected in one of them, a date fixed in the other, and no way to tell which
 * is right six months later.
 *
 * So the history is written **once**, and a variant is a *view* of it: which
 * roles, which skill groups, which projects, in what order, with an optional
 * per-item rewrite for the ones that need role-specific framing. Fixing a typo
 * fixes every resume. `resolveVariant()` below is the function that turns the
 * master and one variant into the flat structure everything downstream renders,
 * and it is the only place that composition happens — the public page, the
 * admin preview and the print sheet are all the same call.
 *
 * The variants live *inside* the same `documents` row rather than in a table of
 * their own, for the reason `migrations/0003_documents.sql` gives for the row
 * existing at all: this is one document, read by two pages, written whole by
 * one editor. A table would buy per-row integrity nothing queries and cost a
 * second write path through the endpoint.
 */

import { formatDuration, formatRange, parseLegacyDates } from './format';
import { site } from './site';

/* ---------- what is stored ---------- */

export interface ExperienceEntry {
  /** Stable across reorders, because variants reference entries by it. */
  id: string;
  title: string;
  company: string;
  /** `YYYY-MM`. Empty when only the legacy `dates` string is known. */
  start: string;
  /** `YYYY-MM`, or null for "Present". */
  end: string | null;
  location: string;
  /** One framing sentence. The bullets are `highlights`. */
  description: string;
  /** What a recruiter actually scans. One outcome per line. */
  highlights: string[];
  /**
   * The hand-typed range this row had before the months existed.
   *
   * Kept only as the fallback for a string `parseLegacyDates` could not read,
   * and overwritten by the first save. Nothing writes it deliberately.
   */
  dates?: string;
}

export interface SkillGroup {
  category: string;
  items: string[];
}

export interface EducationEntry {
  id: string;
  school: string;
  degree: string;
  start: string;
  end: string | null;
  dates?: string;
}

/** Which sheet a resume prints as. See `resume.css`. */
export type ResumeLayout = 'ats' | 'sidebar' | 'timeline';

export const RESUME_LAYOUTS = [
  {
    id: 'ats',
    label: 'One column (ATS-safe)',
    hint: 'Single column, plain headings, no sidebar. What a portal parses reliably.',
  },
  {
    id: 'sidebar',
    label: 'Two column',
    hint: 'Contact, skills and education in a rail. Better on screen, riskier in a parser.',
  },
  {
    id: 'timeline',
    /* The sheet this site had before the renderer existed: a narrow left rail
       against a wide main column, accented section headings, and the roles
       hanging off one chronological rail. It was lost in the move to a single
       renderer — not deliberately, it was simply the layout nobody re-drew —
       and it is the one that looks like the rest of the site rather than like
       a document. It is a third `data-layout` and no new markup, which is the
       property the whole renderer exists to keep. */
    label: 'Timeline (portfolio)',
    hint: 'Rail on the left, roles on a dated spine. The site’s own sheet — for reading, not for a parser.',
  },
] as const satisfies readonly { id: ResumeLayout; label: string; hint: string }[];

export const isResumeLayout = (value: unknown): value is ResumeLayout =>
  RESUME_LAYOUTS.some(layout => layout.id === value);

/**
 * One included item, with the override that makes it role-specific.
 *
 * Selection, order and override in one array rather than an include-list plus a
 * rewrites map: they are the same decision made about the same item, and two
 * structures is two places for an id to go missing.
 *
 * An absent `description` or `highlights` means "use the master's". An empty
 * array means "this role has no bullets on this resume", which is a real thing
 * to want and is why the field is optional rather than defaulted.
 */
export interface VariantEntry {
  id: string;
  description?: string;
  highlights?: string[];
}

export interface VariantSkill {
  category: string;
  /** A subset of the master group's items. Absent means all of them. */
  items?: string[];
}

/**
 * A project on the resume: a live row, plus the one line it gets here.
 *
 * The line defaults to the project's own summary and is overridden per
 * variant, because "what this project is" and "why this project matters for
 * this job" are different sentences. The project itself is never copied — it is
 * read from the `projects` table at render time, so a renamed project is
 * renamed on every resume.
 */
export interface VariantProject {
  slug: string;
  line?: string;
}

export interface ResumeVariant {
  /** Slug. Unique within the document, and what the editor routes on. */
  id: string;
  /** What this resume is for: "ML / CV Engineer", "Backend, fintech". */
  label: string;
  /** Overrides the master summary. Empty falls back to it. */
  summary?: string;
  layout: ResumeLayout;
  /**
   * Overrides the masthead's job title for this variant. Empty falls back to
   * the master's own `headline`, which itself falls back to `site.role`.
   *
   * The variant's `label` ("ML / CV Engineer") already reads like a job title,
   * and the renderer used to tack it onto `site.role` in the masthead —
   * "Software Engineer · ML / CV Engineer" — rather than let it replace
   * anything, because there was nowhere else for a tailored title to go. This
   * is that somewhere: an explicit override, editable, that *replaces* the
   * headline instead of appending a second one after it.
   */
  headline?: string;
  /**
   * The advert this variant was tailored to, as pasted.
   *
   * Stored rather than held in the editor for two reasons: re-running "tailor
   * the summary" three weeks later should not mean finding the job posting
   * again, and six months on it is the only record of *why* this variant
   * selects what it selects. It is never rendered — it is not part of the
   * resume, it is the brief for one.
   */
  jobDescription?: string;
  experience: VariantEntry[];
  skills: VariantSkill[];
  education: string[];
  /** Certifications are plain strings, so a string is its own id. */
  certifications: string[];
  projects: VariantProject[];
}

/**
 * The resume body, exactly as it is stored.
 *
 * `summary` is the one thing about the person that belongs to the resume rather
 * than to the site — a professional statement, rewritten per role. Everything
 * else about the person comes from `site.ts`.
 */
export interface ResumeDocument {
  summary: string;
  /**
   * Overrides `site.role` in every sheet's masthead. Empty falls back to it.
   *
   * The one identity field that is editable here despite decision 3, because
   * unlike a name or an email a job title is routinely reworded per
   * application — "Software Engineer" for one resume, "ML / CV Engineer" for
   * another — and `site.role` can only ever hold one of them. Not a second
   * place the owner's name or contact details live; it is a resume-specific
   * override of a single word choice, the same shape `summary` already is.
   */
  headline: string;
  /**
   * Which sheet the master prints as.
   *
   * A variant carries its own; the master had none, and `resolveVariant` filled
   * the gap with a hard-coded `'sidebar'`. That is why the editor's Sheet picker
   * did nothing on the master — there was nowhere for the choice to go, so the
   * control was hidden along with the rest of the variant row and the one resume
   * everybody starts with was the one resume whose layout could not be chosen.
   */
  layout: ResumeLayout;
  experience: ExperienceEntry[];
  skills: SkillGroup[];
  certifications: string[];
  education: EducationEntry[];
  variants: ResumeVariant[];
  /**
   * Which variant `/resume` renders. Empty means the whole master, unfiltered.
   *
   * A field on the document rather than a flag on each variant, because
   * "exactly one is public" is an invariant a flag cannot express — two rows
   * with `public: true` is representable and meaningless, and the code that
   * picks a winner from it is code nobody wants to read.
   */
  publicVariant: string;
}

/** The row's primary key. The admin writes through the same key. */
export const RESUME_KEY = 'resume';

/** Identity from `site.ts` + the resume's own summary, as the pages render it. */
export interface ResumePerson {
  name: string;
  role: string;
  location: string;
  address: string;
  email: string;
  phone: string;
  linkedin: string;
  github: string;
  summary: string;
}

export interface Resume extends ResumeDocument {
  person: ResumePerson;
}

/* ---------- normalising what was read ---------- */

/** `Axcend Automation` → `axcend-automation`. Also what the editor slugifies with. */
export function slugifyResume(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
}

/**
 * Give a row an id that survives a reorder, without colliding.
 *
 * Derived from its own content rather than random, so the same document
 * normalised twice produces the same ids and a variant written against one read
 * still resolves against the next. The counter suffix is not decoration: this
 * person has two entries at the same company, and `axcend-automation` twice
 * would silently merge them in every variant.
 */
function idFor(seed: string, taken: Set<string>, fallback: string): string {
  const base = slugifyResume(seed) || fallback;
  let id = base;
  let n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  taken.add(id);
  return id;
}

/** Months from whatever the row has: the fields, or the legacy string. */
function months(row: { start?: unknown; end?: unknown; dates?: unknown }): {
  start: string;
  end: string | null;
  dates?: string;
} {
  const start = typeof row.start === 'string' ? row.start.trim() : '';
  if (start) {
    return { start, end: typeof row.end === 'string' && row.end.trim() ? row.end.trim() : null };
  }

  const legacy = typeof row.dates === 'string' ? row.dates.trim() : '';
  if (!legacy) return { start: '', end: null };

  const parsed = parseLegacyDates(legacy);
  /* Unparseable: keep the author's own words rather than inventing a date. The
     renderer prefers the computed range and falls back to this. */
  return parsed ? { ...parsed } : { start: '', end: null, dates: legacy };
}

const asStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(item => String(item)).filter(Boolean) : [];

/**
 * Fill in everything a stored document may be missing, and upgrade the shapes
 * that predate the current one.
 *
 * Every read goes through this, so the rest of the module can assume complete
 * rows. It is a pure function of its input — no clock, no randomness — which is
 * what makes ids stable and the whole thing testable.
 */
export function normaliseResume(raw: Partial<ResumeDocument> | null | undefined): ResumeDocument {
  const input = raw ?? {};

  const expIds = new Set<string>();
  const experience: ExperienceEntry[] = (Array.isArray(input.experience) ? input.experience : []).map(
    (row, index) => {
      const entry = row as Partial<ExperienceEntry> & { dates?: string };
      const company = String(entry.company ?? '');
      const title = String(entry.title ?? '');
      return {
        id: entry.id ? idFor(entry.id, expIds, `role-${index + 1}`) : idFor(`${company} ${title}`, expIds, `role-${index + 1}`),
        title,
        company,
        location: String(entry.location ?? ''),
        description: String(entry.description ?? ''),
        highlights: asStrings(entry.highlights),
        ...months(entry),
      };
    },
  );

  const eduIds = new Set<string>();
  const education: EducationEntry[] = (Array.isArray(input.education) ? input.education : []).map(
    (row, index) => {
      const entry = row as Partial<EducationEntry> & { dates?: string };
      const school = String(entry.school ?? '');
      const degree = String(entry.degree ?? '');
      return {
        id: entry.id ? idFor(entry.id, eduIds, `edu-${index + 1}`) : idFor(`${school} ${degree}`, eduIds, `edu-${index + 1}`),
        school,
        degree,
        ...months(entry),
      };
    },
  );

  const skills: SkillGroup[] = (Array.isArray(input.skills) ? input.skills : []).map(row => {
    const group = row as Partial<SkillGroup>;
    return { category: String(group.category ?? ''), items: asStrings(group.items) };
  });

  const variantIds = new Set<string>();
  const variants: ResumeVariant[] = (Array.isArray(input.variants) ? input.variants : []).map(
    (row, index) => {
      const variant = row as Partial<ResumeVariant>;
      const label = String(variant.label ?? `Variant ${index + 1}`);
      return {
        id: idFor(String(variant.id ?? label), variantIds, `variant-${index + 1}`),
        label,
        summary: typeof variant.summary === 'string' ? variant.summary : '',
        layout: isResumeLayout(variant.layout) ? variant.layout : 'ats',
        headline: typeof variant.headline === 'string' ? variant.headline : '',
        jobDescription: typeof variant.jobDescription === 'string' ? variant.jobDescription : '',
        experience: (Array.isArray(variant.experience) ? variant.experience : []).map(item => {
          const pick = item as Partial<VariantEntry>;
          return {
            id: String(pick.id ?? ''),
            ...(typeof pick.description === 'string' ? { description: pick.description } : {}),
            ...(Array.isArray(pick.highlights) ? { highlights: asStrings(pick.highlights) } : {}),
          };
        }).filter(item => item.id),
        skills: (Array.isArray(variant.skills) ? variant.skills : []).map(item => {
          const pick = item as Partial<VariantSkill>;
          return {
            category: String(pick.category ?? ''),
            ...(Array.isArray(pick.items) ? { items: asStrings(pick.items) } : {}),
          };
        }).filter(item => item.category),
        education: asStrings(variant.education),
        certifications: asStrings(variant.certifications),
        projects: (Array.isArray(variant.projects) ? variant.projects : []).map(item => {
          const pick = item as Partial<VariantProject>;
          return {
            slug: String(pick.slug ?? ''),
            ...(typeof pick.line === 'string' ? { line: pick.line } : {}),
          };
        }).filter(item => item.slug),
      };
    },
  );

  const wanted = String(input.publicVariant ?? '');

  return {
    summary: String(input.summary ?? ''),
    headline: String(input.headline ?? ''),
    /* `sidebar` rather than `ats`, because that is what `resolveVariant`
       hard-coded before this field existed: a stored document written under the
       old shape has to keep rendering as the sheet it was rendering as. */
    layout: isResumeLayout(input.layout) ? input.layout : 'sidebar',
    experience,
    skills,
    certifications: asStrings(input.certifications),
    education,
    variants,
    /* A public variant that no longer exists is the same as none: the page
       renders the master rather than 404ing on a resume. */
    publicVariant: variants.some(variant => variant.id === wanted) ? wanted : '',
  };
}

/** Compose the stored body with the identity fields `site.ts` owns. */
function compose(document: ResumeDocument): Resume {
  return {
    ...document,
    person: {
      name: site.name,
      role: site.role,
      location: site.location,
      address: site.address,
      email: site.email,
      phone: site.phone,
      linkedin: site.linkedin,
      github: site.github,
      summary: document.summary,
    },
  };
}

/**
 * Read the resume.
 *
 * Takes the database rather than reaching for a global, for the same reason
 * every function in `content.ts` does — see the note at the top of that module.
 */
export async function getResume(db: D1Database): Promise<Resume> {
  const row = await db
    .prepare('SELECT json FROM documents WHERE slug = ?')
    .bind(RESUME_KEY)
    .first<{ json: string }>();

  if (!row) return compose(normaliseResume(null));

  try {
    return compose(normaliseResume(JSON.parse(row.json) as Partial<ResumeDocument>));
  } catch {
    /* Unparseable JSON is a corrupted row, not a reason to 500 the page. The
       identity half still renders, and the editor can overwrite it. */
    return compose(normaliseResume(null));
  }
}

/** The stored half of a `Resume`, for saving it back without the identity. */
export function documentOf(resume: Resume): ResumeDocument {
  return {
    summary: resume.summary,
    headline: resume.headline,
    layout: resume.layout,
    experience: resume.experience,
    skills: resume.skills,
    certifications: resume.certifications,
    education: resume.education,
    variants: resume.variants,
    publicVariant: resume.publicVariant,
  };
}

/* ---------- resolving one variant into a sheet ---------- */

/** A role as it appears on a finished sheet: no ids, no options, no fallbacks. */
export interface SheetRole {
  title: string;
  company: string;
  location: string;
  /** `Jul 2024 — Present`, or the author's own string if that is all there is. */
  range: string;
  /** `2 yr 2 mo`. Empty when the months are unknown. */
  duration: string;
  description: string;
  highlights: string[];
}

export interface SheetEducation {
  school: string;
  degree: string;
  range: string;
}

export interface SheetProject {
  slug: string;
  title: string;
  line: string;
  /** Where to read more. Empty when the project has no public URL worth citing. */
  url: string;
}

/** Everything a rendered resume is, and nothing else. */
export interface ResumeSheet {
  person: ResumePerson;
  /** Which variant this is, for the editor's chrome. Empty for the master. */
  variantId: string;
  variantLabel: string;
  layout: ResumeLayout;
  summary: string;
  experience: SheetRole[];
  skills: SkillGroup[];
  projects: SheetProject[];
  education: SheetEducation[];
  certifications: string[];
}

/** What `resolveVariant` needs to know about a project, and no more. */
export interface ProjectLike {
  slug: string;
  data: { title: string; summary: string; repoUrl?: string; demoUrl?: string; hidden: boolean };
}

/**
 * The date range of a stored row, as one string.
 *
 * The computed range where the months are known, and the author's own typed
 * string where they are not. Exported because three readers need it — the
 * sheet, the assistant's index and the `read_resume` tool — and three copies of
 * `formatRange(...) || row.dates` is three places for the fallback to be
 * forgotten.
 */
export const entryRange = (row: { start: string; end: string | null; dates?: string }): string =>
  formatRange(row.start, row.end) || row.dates || '';

const range = entryRange;

/**
 * Master + variant + the live project rows → the sheet everything renders.
 *
 * The single composition point. The public page, the admin preview and the
 * print sheet all call this and then hand the result to `renderSheet()`, which
 * is what makes "the preview does not look like the real thing" a class of bug
 * that cannot occur rather than one to keep fixing.
 *
 * `variantId` of `''` — or one that does not exist — resolves to the master
 * unfiltered, which is what an author who has never made a variant should see.
 *
 * Order comes from the *variant* where it has an opinion and from the master
 * where it does not, because reordering roles for one application must not
 * reorder them for every other.
 *
 * A hidden project is dropped here as well as being filtered upstream, on the
 * same argument `ai-corpus.ts` makes about its own filters: the caller having
 * filtered is a convention, filtering here is a function with a test.
 */
export function resolveVariant(
  resume: Resume,
  variantId: string,
  projects: ProjectLike[] = [],
): ResumeSheet {
  const variant = resume.variants.find(entry => entry.id === variantId) ?? null;

  const byId = new Map(resume.experience.map(entry => [entry.id, entry]));
  const eduById = new Map(resume.education.map(entry => [entry.id, entry]));
  const skillByCategory = new Map(resume.skills.map(group => [group.category, group]));
  const projectBySlug = new Map(
    projects.filter(project => !project.data.hidden).map(project => [project.slug, project]),
  );

  const experience: SheetRole[] = (
    variant
      ? variant.experience
          .map(pick => {
            const master = byId.get(pick.id);
            return master ? { master, pick } : null;
          })
          .filter((entry): entry is { master: ExperienceEntry; pick: VariantEntry } => entry !== null)
      : resume.experience.map(master => ({ master, pick: {} as VariantEntry }))
  ).map(({ master, pick }) => ({
    title: master.title,
    company: master.company,
    location: master.location,
    range: range(master),
    duration: formatDuration(master.start, master.end),
    description: pick.description ?? master.description,
    highlights: pick.highlights ?? master.highlights,
  }));

  const skills: SkillGroup[] = (
    variant
      ? variant.skills
          .map(pick => {
            const master = skillByCategory.get(pick.category);
            return master ? { category: master.category, items: pick.items ?? master.items } : null;
          })
          .filter((group): group is SkillGroup => group !== null)
      : resume.skills
  ).filter(group => group.items.length > 0);

  const education: SheetEducation[] = (
    variant
      ? variant.education
          .map(id => eduById.get(id))
          .filter((entry): entry is EducationEntry => entry !== undefined)
      : resume.education
  ).map(entry => ({ school: entry.school, degree: entry.degree, range: range(entry) }));

  const projectRows: SheetProject[] = (variant?.projects ?? [])
    .map(pick => {
      const project = projectBySlug.get(pick.slug);
      if (!project) return null;
      return {
        slug: project.slug,
        title: project.data.title,
        line: pick.line?.trim() || project.data.summary,
        url: project.data.demoUrl || project.data.repoUrl || '',
      };
    })
    .filter((project): project is SheetProject => project !== null);

  const summary = variant?.summary?.trim() || resume.summary;
  /* Variant, then master, then `site.role` — the same fallback chain
     `summary` uses. Replaces the masthead's job title rather than appending
     to it; see the comment on `ResumeVariant.headline`. */
  const role = variant?.headline?.trim() || resume.headline.trim() || resume.person.role;

  return {
    person: { ...resume.person, summary, role },
    variantId: variant?.id ?? '',
    variantLabel: variant?.label ?? '',
    layout: variant?.layout ?? resume.layout,
    summary,
    experience,
    skills,
    projects: projectRows,
    education,
    certifications: variant ? variant.certifications : resume.certifications,
  };
}

/**
 * A new variant, pre-filled with everything the master has.
 *
 * Starting from "all of it" rather than from nothing is the right default for
 * the same reason a new document starts blank rather than refusing to open:
 * removing three roles is one gesture each, and finding the six you wanted out
 * of twenty is a form nobody finishes.
 */
export function newVariant(resume: ResumeDocument, label: string): ResumeVariant {
  const taken = new Set(resume.variants.map(variant => variant.id));
  return {
    id: idFor(label, taken, `variant-${resume.variants.length + 1}`),
    label,
    summary: '',
    layout: 'ats',
    headline: '',
    jobDescription: '',
    experience: resume.experience.map(entry => ({ id: entry.id })),
    skills: resume.skills.map(group => ({ category: group.category })),
    education: resume.education.map(entry => entry.id),
    certifications: [...resume.certifications],
    projects: [],
  };
}
