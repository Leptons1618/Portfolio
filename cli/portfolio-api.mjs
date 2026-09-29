/**
 * The one client of this site's own API, shared by both front ends.
 *
 * `cli/portfolio.mjs` is a person at a terminal; `mcp/portfolio-mcp.mjs` is a
 * model in an editor. They want different surfaces — one wants `$EDITOR` and
 * `field=value`, the other wants JSON Schema — and they must not want different
 * *semantics*, so everything either of them knows about this site is here:
 *
 *   - where the site is, and which token to present,
 *   - which endpoints exist (four, and none of them a second writer),
 *   - which kind name means which table,
 *   - how a row read back is projected onto what a write accepts.
 *
 * The rule the whole arrangement rests on: **neither front end has a privileged
 * path.** Every write below is `POST /api/content` with a GitHub token belonging
 * to `site.githubUser`, checked by `requireOwner()` against GitHub on every
 * request. There is no credential this site issued, no database handle, and
 * nothing here that a signed-in browser could not do. See decision 73 and
 * `src/lib/authorize.ts`.
 *
 * Zero dependencies, deliberately. This module is loaded by a process holding a
 * token that can rewrite the live site, and the smallest supply chain for that
 * is none. It imports `src/lib/content-schema.ts` — the write endpoint's own
 * column allowlist — directly, and lets Node strip the types; that module
 * imports nothing, which is what makes it loadable outside a bundler.
 */

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TABLES } from '../src/lib/content-schema.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Where the token lives. Mode 0600, and nothing here ever prints it. */
export const CONFIG = join(
  process.env.XDG_CONFIG_HOME || join(homedir(), '.config'),
  'portfolio',
  'cli.json',
);

/** Raised for anything the caller got wrong. Both front ends render it as a message. */
export class Fail extends Error {}

export const die = message => {
  throw new Fail(message);
};

/**
 * The live origin.
 *
 * Read out of `public/CNAME` rather than written down, because that file is the
 * one-line record of what the domain is and `scripts/check-content.mjs` fails
 * the build if the other two places that state it disagree. A fourth copy here
 * would be a fourth thing to keep in step — and this is a read of the canonical
 * file, not a copy of it.
 */
export function defaultSite() {
  try {
    return `https://${readFileSync(resolve(HERE, '..', 'public', 'CNAME'), 'utf8').trim()}`;
  } catch {
    return '';
  }
}

export const readConfig = () => {
  try {
    return JSON.parse(readFileSync(CONFIG, 'utf8'));
  } catch {
    return {};
  }
};

export function writeConfig(next) {
  mkdirSync(dirname(CONFIG), { recursive: true });
  writeFileSync(CONFIG, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  /* Explicitly, because `mode` on `writeFileSync` is a *creation* mode: it is
     ignored for a file that already exists, so a config written once with a
     loose umask would stay loose through every later save. */
  chmodSync(CONFIG, 0o600);
}

/**
 * Config, then environment, then whatever this invocation was given.
 *
 * The MCP server passes `{}` and gets the stored session, which is the whole of
 * its authentication story: it is a subprocess on the owner's machine reading a
 * file the owner's account owns. It has no way to obtain a token of its own.
 */
export function session(overrides = {}) {
  const stored = readConfig();
  const site = (
    overrides.site ||
    process.env.PORTFOLIO_SITE ||
    stored.site ||
    defaultSite()
  ).replace(/\/+$/, '');
  const token = overrides.token || process.env.PORTFOLIO_TOKEN || stored.token || '';
  if (!site) die('No site origin. Set PORTFOLIO_SITE, or run this from inside the repository.');
  return { site, token, login: stored.login ?? null };
}

/**
 * One request to the site, with the owner's token on it.
 *
 * Every endpoint answers `{ error }` with a status, so a failure is reported in
 * the endpoint's own words — which are written to be acted on
 * (`explainConstraint()` turns a SQLite constraint into a sentence naming the
 * empty field). Inventing a message on top of that would be losing the only
 * useful one.
 */
export async function api(where, path, { method = 'GET', body, raw, type } = {}) {
  if (!where.token) die('Not signed in. Run `portfolio login` first.');
  let response;
  try {
    response = await fetch(`${where.site}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${where.token}`,
        ...(raw ? { 'Content-Type': type } : body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
  } catch (error) {
    die(`Could not reach ${where.site} — ${error.message}`);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    /* 401 and 403 are the same two sentences the browser gets, and both are
       worth quoting: one means the token is not valid, the other means it is
       valid and belongs to somebody else. */
    die(data.error ?? `${method} ${path} answered ${response.status}.`);
  }
  return data;
}

/** Whose token this is, according to GitHub. The site decides whether it matters. */
export async function githubLogin(token) {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'portfolio-cli',
    },
  }).catch(() => null);
  if (!response?.ok) die('GitHub would not identify that token. It may have expired.');
  return (await response.json()).login;
}

/* -------------------------------------------------------------------- tables */

/**
 * What a caller types or sends, and the table it means.
 *
 * Singular and plural both, because nobody remembers which a given tool wanted
 * and a model guesses from the noun in the sentence it is reading.
 */
export const KINDS = {
  project: 'projects',
  projects: 'projects',
  'case-study': 'case_studies',
  'case-studies': 'case_studies',
  case_studies: 'case_studies',
  cs: 'case_studies',
  post: 'journal',
  posts: 'journal',
  journal: 'journal',
  entry: 'journal',
  provider: 'ai_providers',
  providers: 'ai_providers',
  ai_providers: 'ai_providers',
  doc: 'documents',
  docs: 'documents',
  document: 'documents',
  documents: 'documents',
};

/** The distinct kinds, for a help string or an enum in a schema. */
export const KIND_NAMES = ['project', 'case-study', 'journal', 'provider', 'doc'];

export const kindOf = name => {
  const table = KINDS[String(name ?? '').toLowerCase()];
  if (!table) die(`Unknown kind "${name}". One of: ${[...new Set(Object.values(KINDS))].join(', ')}.`);
  return table;
};

export const fieldsOf = table => TABLES[table].columns;

/**
 * The fields of an object that this table will actually take.
 *
 * Two jobs. It drops what a *read* adds and a write refuses — `slug`,
 * `updatedAt`, and on a provider `hasKey` and `keyHint`, which are derived — so
 * a row fetched, edited and sent straight back does not come home as "Unknown
 * field for ai_providers: keyHint". And it stringifies an object landing on a
 * `text` column: `params` comes back from `summarise()` parsed and clamped, and
 * `String({})` is `"[object Object]"`.
 */
export function writable(table, object) {
  const map = fieldsOf(table);
  const out = {};
  for (const [key, value] of Object.entries(object)) {
    const spec = map[key];
    if (!spec) continue;
    out[key] = spec[1] === 'text' && value !== null && typeof value === 'object' ? JSON.stringify(value) : value;
  }
  return out;
}

/**
 * Fields as a *caller* supplied them: unknown keys refused, objects encoded.
 *
 * The lenient projection above is for the read path, where dropping a derived
 * key is the whole point. This is the input path, and there dropping is the bug:
 * `POST /api/content` refuses an unknown field rather than discarding it, because
 * "a save that silently discards a field reports success and loses work" — and a
 * caller that is a model, guessing `repo_url` from a column name it saw
 * somewhere, is exactly who that rule protects. The endpoint would refuse it too;
 * refusing here means the message can list the fields that *do* exist.
 *
 * The stringify is the other half of the same care. `params` is a `text` column
 * holding JSON, so an object arriving for it would reach `encode(value, 'text')`
 * and be stored as the string `[object Object]` — a success, and a corrupted row.
 */
export function strictFields(table, object) {
  const map = fieldsOf(table);
  const out = {};
  for (const [key, value] of Object.entries(object ?? {})) {
    const spec = map[key];
    if (!spec) {
      die(`Unknown field "${key}" for ${table}. It takes: ${Object.keys(map).join(', ')}.`);
    }
    out[key] = spec[1] === 'text' && value !== null && typeof value === 'object' ? JSON.stringify(value) : value;
  }
  return out;
}

/* --------------------------------------------------------------------- reads */

const safeParse = text => {
  try {
    return JSON.parse(text ?? '{}');
  } catch {
    return text;
  }
};

/**
 * One kind's rows, in one shape whichever endpoint answered.
 *
 * `ai_providers` is read through `GET /api/ai/providers` and never through the
 * generic reader, because its `api_key` column must not be on the wire and the
 * guarantee for that is structural: `TABLES.ai_providers.readable` is `false`,
 * `readableColumns()` throws, and `summarise()` builds the payload key by key.
 * See decision 22. So this is where the two readers meet, and the shape they
 * meet in is the one the write takes.
 *
 * A `documents` row is presented as the document it holds rather than as a
 * column containing a JSON string. Editing an escaped string inside a JSON file
 * is not editing, and the whole row *is* that document.
 */
export async function rowsOf(where, table, slug) {
  if (table === 'ai_providers') {
    const { providers } = await api(where, '/api/ai/providers');
    const rows = providers.map(provider => ({
      slug: provider.slug,
      updatedAt: provider.updatedAt ?? null,
      fields: provider,
    }));
    const found = slug ? rows.filter(row => row.slug === slug) : rows;
    if (slug && !found.length) die(`No provider named "${slug}".`);
    return found;
  }

  const query = new URLSearchParams({ table });
  if (slug) query.set('slug', slug);
  const { rows } = await api(where, `/api/content?${query}`);
  if (table !== 'documents') return rows;
  return rows.map(row => ({ ...row, fields: { json: safeParse(row.fields.json) } }));
}

/* ------------------------------------------------------------------- writing */

export const contentWrite = (where, table, slug, op, payload = {}) =>
  api(where, '/api/content', { method: 'POST', body: { table, slug, op, ...payload } });

/**
 * Write a singleton document, creating the row if it is not there yet.
 *
 * `documents` is seeded for three of its five keys and not for the two order
 * lists, and a `patch` on a row that does not exist is a 404 rather than an
 * insert — deliberately, because that is what stops a typo becoming a row. So
 * the first save of an order takes the create branch and every one after it the
 * patch, exactly as `saveDeepDives()` does in `src/lib/content-store.ts`.
 */
export async function saveDoc(where, key, document) {
  const fields = { json: JSON.stringify(document) };
  try {
    return await contentWrite(where, 'documents', key, 'patch', { fields });
  } catch (error) {
    if (!/^No documents row/.test(error.message)) throw error;
    return contentWrite(where, 'documents', key, 'create', { fields });
  }
}

/** The two saved orders, which are documents rather than columns. */
export const ORDERS = {
  projects: {
    key: 'projects-deep-dives',
    table: 'projects',
    what: 'the home page’s Deep dives line-up',
  },
  journal: {
    key: 'journal-order',
    table: 'journal',
    what: 'the posts pinned to the top of /journal',
  },
};

/** Image types this site accepts, by extension. Mirrors `MEDIA_TYPES` in `media.ts`. */
export const IMAGE_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  avif: 'image/avif',
};
