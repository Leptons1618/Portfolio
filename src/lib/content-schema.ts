/**
 * What the write endpoint will accept into a content row, and how.
 *
 * This is the trust boundary of the whole D1 migration, so it is a module of
 * its own rather than a few consts inside the route: it is the thing that has
 * to be tested (`npm run check:schema`), and a route handler is not something a
 * plain Node script can call.
 *
 * ## The rule this file exists to enforce
 *
 * A table name or a column name **cannot be a bound parameter in SQL** — only
 * values can. So every identifier that ends up in a statement has to originate
 * here, in source, and never in a request. `bind()` therefore *looks up* the
 * keys a caller sent; it never derives an identifier from them. An unknown key
 * is refused outright rather than dropped, because a save that silently
 * discards a field reports success and loses work.
 *
 * The values go back to the caller separately from the columns, and that
 * separation is the safety property: `columns` came from this file, `values`
 * came from the request, and they only ever meet as `?` placeholders.
 */

/** Astro derived a slug from a filename; this is the same shape `slugify` emits. */
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Raised for anything the caller got wrong. The endpoint turns it into a 400. */
export class BadRequest extends Error {}

export type Encoder = 'text' | 'list' | 'number' | 'bool';

/** `camelCase field the admin sends` → `[column, how to encode it]`. */
export type ColumnMap = Record<string, [string, Encoder]>;

const PROJECT_COLUMNS: ColumnMap = {
  title: ['title', 'text'],
  summary: ['summary', 'text'],
  category: ['category', 'text'],
  tags: ['tags', 'list'],
  stack: ['stack', 'list'],
  repoUrl: ['repo_url', 'text'],
  demoUrl: ['demo_url', 'text'],
  caseStudySlug: ['case_study_slug', 'text'],
  featuredRank: ['featured_rank', 'number'],
  status: ['status', 'text'],
  year: ['year', 'number'],
  heroImage: ['hero_image', 'text'],
  highlights: ['highlights', 'list'],
  hidden: ['hidden', 'bool'],
};

const CASE_STUDY_COLUMNS: ColumnMap = {
  title: ['title', 'text'],
  subtitle: ['subtitle', 'text'],
  heroImage: ['hero_image', 'text'],
  heroVideo: ['hero_video', 'text'],
  problem: ['problem', 'text'],
  solution: ['solution', 'text'],
  architectureImage: ['architecture_image', 'text'],
  achievements: ['achievements', 'list'],
  stack: ['stack', 'list'],
  repoUrl: ['repo_url', 'text'],
  demoUrl: ['demo_url', 'text'],
  date: ['date', 'text'],
  readTime: ['read_time', 'text'],
};

const JOURNAL_COLUMNS: ColumnMap = {
  title: ['title', 'text'],
  summary: ['summary', 'text'],
  date: ['date', 'text'],
  tags: ['tags', 'list'],
  readTime: ['read_time', 'text'],
  videoDuration: ['video_duration', 'text'],
  heroImage: ['hero_image', 'text'],
  status: ['status', 'text'],
};

/**
 * Singleton documents — currently just the resume.
 *
 * One writable column holding the whole document as JSON. It goes through this
 * allowlist rather than a second endpoint so the resume save is covered by the
 * same identity check and the same tested boundary as everything else.
 */
const DOCUMENT_COLUMNS: ColumnMap = {
  json: ['json', 'text'],
};

/** `rendersBody` is what decides whether a `body` is accepted for this table. */
export const TABLES = {
  projects: { columns: PROJECT_COLUMNS, rendersBody: false },
  case_studies: { columns: CASE_STUDY_COLUMNS, rendersBody: true },
  journal: { columns: JOURNAL_COLUMNS, rendersBody: true },
  documents: { columns: DOCUMENT_COLUMNS, rendersBody: false },
} as const;

export type TableName = keyof typeof TABLES;

export const isTable = (value: unknown): value is TableName =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(TABLES, value);

/**
 * SQLite has no array type and no boolean; the column comments in `migrations/`
 * say why the storage looks the way it does.
 *
 * An empty string means "unset" rather than "empty string": it is what a
 * cleared form field sends, every column it can reach is nullable, and writing
 * `readTime: ''` would render a blank meta line on the post rather than none.
 */
export function encode(value: unknown, as: Encoder): string | number | null {
  if (value === undefined || value === null || value === '') {
    return as === 'list' ? '[]' : null;
  }
  switch (as) {
    case 'list':
      return JSON.stringify(Array.isArray(value) ? value.map(String) : [String(value)]);
    case 'number': {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new BadRequest(`Expected a number, got ${JSON.stringify(value)}.`);
      return n;
    }
    case 'bool':
      return value === true || value === 'true' || value === 1 ? 1 : 0;
    default:
      return String(value);
  }
}

/**
 * Translate a request's fields into column identifiers and bound values.
 *
 * Throws `BadRequest` for any key not in the map — including, deliberately,
 * keys that name a real column in snake_case. The admin speaks camelCase; a
 * caller sending `repo_url` is not the admin, and guessing at their intent is
 * how an allowlist stops being one.
 */
export function bind(
  table: TableName,
  fields: Record<string, unknown>,
): { columns: string[]; values: (string | number | null)[] } {
  const map = TABLES[table].columns;
  const columns: string[] = [];
  const values: (string | number | null)[] = [];

  for (const [key, value] of Object.entries(fields)) {
    // `hasOwnProperty`, not `map[key]`: `constructor` and `toString` are truthy
    // on any object literal, and neither is a column.
    if (!Object.prototype.hasOwnProperty.call(map, key)) {
      throw new BadRequest(`Unknown field for ${table}: ${key}`);
    }
    const [column, as] = map[key];
    columns.push(column);
    values.push(encode(value, as));
  }
  return { columns, values };
}
