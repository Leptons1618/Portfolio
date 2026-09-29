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
  /* What the model can actually be asked to write, filled in from the vendor's
     own listing when a model is picked. `number` rather than `text` because it
     becomes `max_tokens` in a request body; `clampOutputCeiling()` bounds it
     again on read, for the same reason `clampParams()` exists. */
  maxOutputTokens: ['max_output_tokens', 'number'],
  /* USD per million tokens, from the vendor's listing when a model is picked —
     the same moment `maxOutputTokens` is filled in, and shown on the picker's
     own rows. `number`; `clampPrice()` in `ai.ts` refuses a negative one on
     read, because OpenRouter's `-1` means "depends which model this routes
     to" and would otherwise render as a negative cost. */
  pricePrompt: ['price_prompt', 'number'],
  priceCompletion: ['price_completion', 'number'],
  reasoningEffort: ['reasoning_effort', 'text'],
  promptCache: ['prompt_cache', 'bool'],
  toolsEnabled: ['tools_enabled', 'bool'],
  active: ['active', 'bool'],
  priority: ['priority', 'number'],
};

/**
 * What each table accepts.
 *
 * `rendersBody` decides whether a `body` is accepted. `slugs` is the closed key
 * set for a table of singletons, and `null` for a table whose rows are named by
 * their author.
 *
 * `readable` decides whether `GET /api/content` will hand the row back.
 * `ai_providers` is deliberately `false`: its `api_key` column must never be on
 * the wire, and the way to guarantee that is for the generic reader never to
 * touch the table at all — `GET /api/ai/providers` is the one reader, and it
 * builds its payload key by key. See decision 22.
 */
interface TableSpec {
  columns: ColumnMap;
  rendersBody: boolean;
  slugs: readonly string[] | null;
  readable: boolean;
}

/**
 * The five `documents` rows this endpoint writes.
 *
 * `documents` is not a collection — it is a handful of singletons, each with
 * exactly one writer and one reader, and its primary key is therefore a closed
 * set rather than something an author names. Leaving it open had two costs. A
 * typo (`resumee`) *succeeds*: `create` inserts a row nothing will ever read,
 * and the save reports success. And `journal-auto-run` — the daily job's own
 * account of what it attempted and when — became writable by anything holding
 * the owner's token, which would let a caller hand the job another day's
 * attempts. That row is written by `POST /api/ai/daily` against the database
 * directly and must not be reachable from here; the same is true of any ledger
 * added beside it later.
 *
 * Spelled out rather than imported: each constant lives in the module that owns
 * the document (`RESUME_KEY` in `resume.ts`, `AI_SETTINGS_KEY` in `ai.ts`,
 * `AUTO_KEY` in `journal-auto.ts`, the two order keys in `content.ts`), and
 * three of those four modules cannot be loaded by a plain Node script — which
 * `npm run check:schema` is. The test asserts the list, so a rename that
 * forgets this file fails there rather than in production.
 */
const DOCUMENT_SLUGS = [
  'resume',
  'ai-assistant',
  'journal-auto',
  'projects-deep-dives',
  'journal-order',
] as const;

export const TABLES = {
  projects: { columns: PROJECT_COLUMNS, rendersBody: false, slugs: null, readable: true },
  case_studies: { columns: CASE_STUDY_COLUMNS, rendersBody: true, slugs: null, readable: true },
  journal: { columns: JOURNAL_COLUMNS, rendersBody: true, slugs: null, readable: true },
  documents: { columns: DOCUMENT_COLUMNS, rendersBody: false, slugs: DOCUMENT_SLUGS, readable: true },
  ai_providers: { columns: AI_PROVIDER_COLUMNS, rendersBody: false, slugs: null, readable: false },
} as const satisfies Record<string, TableSpec>;

export type TableName = keyof typeof TABLES;

/**
 * Refuse a slug the table will not take, before anything is bound.
 *
 * Two questions, in the order that makes the message useful: is this the shape
 * a slug has at all, and — for a table of singletons — is it one of the keys
 * that exists. Both are `BadRequest`, so both come back as a 400 naming what to
 * do about it rather than as a row nobody reads or a 409 from the database.
 */
export function assertSlug(table: TableName, slug: string): void {
  if (!SLUG.test(slug)) throw new BadRequest('Slug must be lowercase words joined by hyphens.');
  const allowed = TABLES[table].slugs as readonly string[] | null;
  if (allowed && !allowed.includes(slug)) {
    throw new BadRequest(
      `"${slug}" is not a ${table} row this endpoint writes. It takes: ${allowed.join(', ')}.`,
    );
  }
}

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
 * The inverse of `encode()`: a stored column value as the field a caller sends.
 *
 * It exists so that what `GET /api/content` hands back is the same shape
 * `POST /api/content` accepts — a row read, edited and written straight back has
 * to round-trip, or every scripted edit is a 400 about `repo_url` not being a
 * field. SQLite has no array and no boolean, so this is where `'[]'` becomes an
 * array again and `0` becomes `false`.
 *
 * A malformed `list` degrades to `[]` rather than throwing. The column is
 * written only by `encode()` above, so a value that is not JSON means the row
 * was edited by hand in `wrangler d1 execute` — and a listing that 500s on one
 * bad row is worse than one that shows it empty.
 */
export function decode(value: unknown, as: Encoder): unknown {
  if (as === 'bool') return value === 1 || value === true;
  if (value === null || value === undefined) return as === 'list' ? [] : null;
  switch (as) {
    case 'list': {
      if (Array.isArray(value)) return value;
      try {
        const parsed = JSON.parse(String(value));
        return Array.isArray(parsed) ? parsed.map(String) : [];
      } catch {
        return [];
      }
    }
    case 'number': {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    default:
      return String(value);
  }
}

/**
 * The columns to SELECT for a table, and the fields they come back as.
 *
 * Built from the same map `bind()` reads, which is the point: a reader that did
 * `SELECT *` would hand back whatever columns the table has acquired since,
 * `ai_providers.api_key` included. Naming them from this file means a column has
 * to be listed here to be readable, the same rule `summarise()` follows in
 * `ai.ts` — and it is why `GET /api/content` refuses `ai_providers` outright
 * rather than relying on a filter.
 */
export function readableColumns(table: TableName): string[] {
  /* Throws rather than filters. `ai_providers.api_key` is in that table's column
     map because it is *writable*, and the only safe relationship between this
     function and that column is for the table never to reach here — a filter
     would be a line someone could delete and a test that still passed. */
  if (!TABLES[table].readable) {
    throw new BadRequest(`${table} is not readable here. Use its own endpoint.`);
  }
  return Object.values(TABLES[table].columns).map(([column]) => column);
}

/** One row, as the fields a caller may send back. */
export function unbind(table: TableName, row: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [field, [column, as]] of Object.entries(TABLES[table].columns)) {
    if (!(column in row)) continue;
    fields[field] = decode(row[column], as);
  }
  return fields;
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
