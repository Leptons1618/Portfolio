/**
 * Resume content, shared by the public /resume page and the admin editor.
 *
 * This module used to *be* the resume: five exported constants that the editor
 * regenerated wholesale and written back over its own source. That made
 * saving a resume a write to the repository, and it was the last one left after
 * the collections moved to D1 — so the body moved too, into a single row of the
 * `documents` table, and what stays here is the shape and the reader.
 *
 * Identity fields still come from `site.ts` and are composed back on read. That
 * is decision 3, unchanged and now load-bearing in a second way: the document in
 * the database deliberately does not contain the owner's name, email, phone or
 * address, so there is still exactly one place those are written down.
 *
 * The resume is one document read by two pages and written whole by one editor,
 * which is why it is a JSON column rather than four normalised tables — the note
 * in `migrations/0003_documents.sql` has the reasoning.
 */

import { site } from './site';

export interface ExperienceEntry {
  title: string;
  company: string;
  dates: string;
  location: string;
  description: string;
}

export interface SkillGroup {
  category: string;
  items: string[];
}

export interface EducationEntry {
  school: string;
  degree: string;
  dates: string;
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
  experience: ExperienceEntry[];
  skills: SkillGroup[];
  certifications: string[];
  education: EducationEntry[];
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
  summary: string;
}

export interface Resume extends ResumeDocument {
  person: ResumePerson;
}

/**
 * An empty resume, for the one case that would otherwise be a crash.
 *
 * If the `resume` row is missing — a fresh local database that has not had
 * `migrations/0003_documents.sql` applied — the page should render the person's
 * identity and no history, not throw. It is deliberately empty rather than a
 * copy of the real resume: a fallback holding real data is a second source of
 * truth that nobody remembers to update.
 */
const EMPTY: ResumeDocument = {
  summary: '',
  experience: [],
  skills: [],
  certifications: [],
  education: [],
};

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

  if (!row) return compose(EMPTY);

  try {
    return compose({ ...EMPTY, ...(JSON.parse(row.json) as Partial<ResumeDocument>) });
  } catch {
    /* Unparseable JSON is a corrupted row, not a reason to 500 the page. The
       identity half still renders, and the editor can overwrite it. */
    return compose(EMPTY);
  }
}
