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

/**
 * AI providers — an endpoint, a model, and the one secret this site stores.
 *
 * It goes through this allowlist rather than an endpoint of its own for the
 * reason the whole file exists: a table name and a column name cannot be bound
 * parameters, so every identifier that reaches a statement should originate in
 * one tested map. A second write path for one feature would be a second place
 * to get that wrong.
 *
 * `apiKey` is writable here and is deliberately **not** readable anywhere:
 * `GET /api/ai/providers` selects columns by name and returns a fingerprint.
 * The asymmetry is the design — the admin can replace a key and can never
 * retrieve one, which is also what makes a compromised admin session worth
 * less than the credential behind it. An empty `apiKey` clears the column, so
 * the form sends the field only when a new key has actually been typed;
 * `src/lib/ai-store.ts` is where that rule lives.
 */
const AI_PROVIDER_COLUMNS: ColumnMap = {
  label: ['label', 'text'],
  baseUrl: ['base_url', 'text'],
  apiKey: ['api_key', 'text'],
  model: ['model', 'text'],
  assistModel: ['assist_model', 'text'],
  /* A JSON array of model ids, tried in order when the primary will not answer.
     `list` is the same encoder `tags` and `stack` use. */
  fallbackModels: ['fallback_models', 'list'],
  /* A JSON *object* of sampling parameters, stringified by the caller — the
     same arrangement as `documents.json`, and for the same reason: there is no
     object encoder because a column holding one is a column nothing queries.
     The server rebuilds it against an allowlist on read (`clampParams()` in
     `ai-catalog.ts`), so what is stored here is never what is sent. */
  params: ['params', 'text'],
  active: ['active', 'bool'],
  priority: ['priority', 'number'],
};

/** `rendersBody` is what decides whether a `body` is accepted for this table. */
export const TABLES = {
  projects: { columns: PROJECT_COLUMNS, rendersBody: false },
  case_studies: { columns: CASE_STUDY_COLUMNS, rendersBody: true },
  journal: { columns: JOURNAL_COLUMNS, rendersBody: true },
  documents: { columns: DOCUMENT_COLUMNS, rendersBody: false },
  ai_providers: { columns: AI_PROVIDER_COLUMNS, rendersBody: false },
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
 * `repoUrl` → `Repo URL`. The admin speaks camelCase; a person does not.
 */
const humanise = (field: string) =>
  field
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\burl\b/i, 'URL')
    .replace(/^./, character => character.toUpperCase());

/** The camelCase field a column came from, for turning a refusal back into copy. */
function fieldFor(table: string, column: string): string | null {
  if (!isTable(table)) return null;
  const entry = Object.entries(TABLES[table].columns).find(([, [name]]) => name === column);
  return entry ? humanise(entry[0]) : null;
}

/**
 * Turn a database refusal into a sentence naming what to do about it.
 *
 * The constraints in `migrations/` are the validation now — that is the whole
 * point of decision 18 — but a constraint speaks SQLite. Leaving a post's
 * summary blank and pressing save produced, verbatim on screen:
 *
 *     D1_ERROR: NOT NULL constraint failed: journal.summary: SQLITE_CONSTRAINT
 *
 * which is correct, useless, and reads as a fault in the site rather than as an
 * empty field twenty pixels away from the button. The editors validate their
 * own required fields before saving, so this is the backstop for the ones they
 * miss and for anything reaching the endpoint another way — but a backstop that
 * a person can act on.
 *
 * It lives here because the answer is this file's data: the map that turns
 * `journal.summary` back into "Summary" is the same map `bind()` uses to go the
 * other way, and a second copy of it somewhere else would drift the first time
 * a column was renamed.
 *
 * Returns `null` for anything it does not recognise, so the caller falls back
 * to the raw message rather than swallowing a failure it cannot explain.
 */
export function explainConstraint(message: string, slug?: string): string | null {
  const notNull = /NOT NULL constraint failed: (\w+)\.(\w+)/.exec(message);
  if (notNull) {
    const [, table, column] = notNull;
    const label = fieldFor(table, column) ?? humanise(column);
    return `${label} is required, and was left empty. Fill it in and save again.`;
  }

  const unique = /UNIQUE constraint failed: (\w+)\.slug/.exec(message);
  if (unique) {
    const where = slug ? `"${slug}"` : 'that slug';
    return `${where} already exists in ${unique[1]}. Open it and edit it rather than creating a second one.`;
  }

  if (/FOREIGN KEY constraint failed/i.test(message)) {
    return (
      'A link is in the way: either the case study being pointed at does not exist, or a project ' +
      'still points at the case study being deleted. Unlink the two first, then try again.'
    );
  }

  const check = /CHECK constraint failed: (\w+)/.exec(message);
  if (check) {
    return `${humanise(check[1])} is not one of the values this table accepts.`;
  }

  return null;
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
