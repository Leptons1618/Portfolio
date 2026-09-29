#!/usr/bin/env node
/**
 * The admin surface, from a terminal.
 *
 * ## What this is, and what it deliberately is not
 *
 * It is a client of `POST /api/content` and nothing else — the same endpoint,
 * the same `src/lib/content-schema.ts` column allowlist and the same
 * `requireOwner()` identity check the browser screens go through. It holds no
 * database credential, it has no privileged path, and there is no second write
 * endpoint anywhere in this system for it to use. Deleting the config file below
 * leaves it with exactly the powers of a stranger.
 *
 * That is the whole design. A CLI that talked to D1 directly would be a second
 * writer with no constraint checking, no `explainConstraint()`, no log row and
 * no owner check — four properties that took a migration to establish. This one
 * inherits all of them by being just another caller.
 *
 * ## The credential
 *
 * A GitHub token belonging to the account in `site.githubUser`. Not a token this
 * tool mints: `requireOwner()` presents whatever it is given to GitHub and
 * admits one login, so a token from `gh auth token`, a fine-grained PAT, or the
 * one the admin screens obtained through OAuth are all equally acceptable and
 * equally revocable — at GitHub, not here. See `src/lib/authorize.ts`.
 *
 * It is stored in `~/.config/portfolio/cli.json` at mode 0600. That is a
 * credential in a file, which is worse than the browser's `sessionStorage` and
 * is the honest cost of a tool that runs in a shell; `logout` removes it, and
 * `--token` / `$PORTFOLIO_TOKEN` skip the file entirely for CI.
 *
 * ## Where the shared half lives
 *
 * `cli/portfolio-api.mjs` — the session, the four endpoints, the kind names and
 * the read/write projection. `mcp/portfolio-mcp.mjs` imports the same module, so
 * a model in an editor and a person at a terminal reach this site through one
 * client with one set of semantics. What stays here is the part that is only
 * true of a terminal: argv, `$EDITOR`, tables of text and a confirm prompt.
 *
 * ## Why the field names are not written down here
 *
 * `src/lib/content-schema.ts` already says which fields each table takes and how
 * each one encodes, and it imports nothing, so Node can load it directly and
 * strip the types (the same trick `scripts/test-content-schema.mjs` uses, and the
 * same Node >= 22.18 requirement). Every `field=value` below is parsed against
 * that map. A column added to a table is therefore settable from here the moment
 * it is added to the allowlist, with no edit to this file — and a typo is
 * refused locally, with the real field list printed, rather than round-tripping
 * for a 400.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { BadRequest, TABLES, assertSlug } from '../src/lib/content-schema.ts';
import {
  CONFIG,
  Fail,
  IMAGE_TYPES,
  ORDERS,
  api,
  contentWrite,
  defaultSite,
  die,
  fieldsOf,
  githubLogin,
  kindOf,
  readConfig,
  rowsOf,
  saveDoc,
  session as apiSession,
  writable,
  writeConfig,
} from './portfolio-api.mjs';

/* Re-exported so `scripts/test-cli.mjs` keeps asking this file for them: what it
   pins is that *the CLI* has no field table of its own, which is a fact about
   this file wherever the helper now lives. */
export { defaultSite, kindOf, writable };

/* ------------------------------------------------------------------ plumbing */

/** The stored session, with this invocation's `--site` / `--token` over the top. */
const session = flags => apiSession({ site: flags.site, token: flags.token });


/* -------------------------------------------------------------------- tables */

/**
 * `tags=a,b,c` → `['a','b','c']`, against the encoder the column declares.
 *
 * The encoder is the whole point: it is the same table the server binds with, so
 * a `list` column splits, a `bool` takes the words a person would type, and a
 * `number` is a number rather than the string `"2026"` (which `encode` would
 * accept, but which reads back differently). `-` clears a field — an empty
 * string is what the server treats as unset, and `field=` is easy to type by
 * accident, so the clear is deliberate and visible.
 */
export function parsePair(table, pair) {
  const at = pair.indexOf('=');
  if (at < 1) die(`Expected field=value, got "${pair}".`);
  const key = pair.slice(0, at);
  const text = pair.slice(at + 1);
  const spec = fieldsOf(table)[key];
  if (!spec) {
    die(`Unknown field "${key}" for ${table}. It takes: ${Object.keys(fieldsOf(table)).join(', ')}.`);
  }
  const [, as] = spec;
  if (text === '-') return [key, as === 'list' ? [] : ''];
  switch (as) {
    case 'list':
      return [key, text.split(',').map(part => part.trim()).filter(Boolean)];
    case 'number': {
      const n = Number(text);
      if (!Number.isFinite(n)) die(`${key} wants a number, got "${text}".`);
      return [key, n];
    }
    case 'bool': {
      if (!/^(true|false|yes|no|on|off|1|0)$/i.test(text)) die(`${key} wants true or false, got "${text}".`);
      return [key, /^(true|yes|on|1)$/i.test(text)];
    }
    default:
      return [key, text];
  }
}

const parsePairs = (table, pairs) => Object.fromEntries(pairs.map(pair => parsePair(table, pair)));

/** What `ls` prints per kind — the two or three facts worth a column each. */
const SUMMARY = {
  projects: f => [f.hidden ? 'hidden' : 'visible', f.category, f.year, f.caseStudySlug ? `cs:${f.caseStudySlug}` : ''],
  case_studies: f => [f.date, f.readTime],
  journal: f => [f.status, f.date],
  ai_providers: f => [f.active ? 'active' : 'off', `p${f.priority}`, f.model, f.hasKey ? `key ${f.keyHint}` : 'NO KEY'],
  documents: () => [],
};

/* ------------------------------------------------------------------- editing */

/** Round-trip a temp file through `$VISUAL` / `$EDITOR`, returning what came back. */
function throughEditor(name, contents) {
  const editor = process.env.VISUAL || process.env.EDITOR;
  if (!editor) die('No $EDITOR set. Set one, or use `set` / `--in` to write without one.');
  const path = join(tmpdir(), `portfolio-${process.pid}-${name}`);
  writeFileSync(path, contents);
  try {
    /* Split rather than run through a shell. `$EDITOR` is routinely a program
       plus a flag — `code --wait`, `vim -u NONE` — which is why the shell was
       tempting; but a shell here concatenates instead of escaping, so anything
       in the argument list becomes shell source, and Node warns about exactly
       that (DEP0190). Splitting on whitespace handles every real value and
       passes the path as one argument whatever is in it. */
    const [program, ...args] = editor.split(/\s+/).filter(Boolean);
    const { status, error } = spawnSync(program, [...args, path], { stdio: 'inherit' });
    if (error) die(`Could not run ${editor} — ${error.message}`);
    if (status !== 0) die(`${editor} exited ${status}; nothing was saved.`);
    return readFileSync(path, 'utf8');
  } finally {
    rmSync(path, { force: true });
  }
}

/** Everything on stdin, or `null` when it is a terminal. */
async function stdin() {
  if (process.stdin.isTTY) return null;
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function confirm(question) {
  if (!process.stdin.isTTY) die(`${question} — pass --yes to confirm without a terminal.`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
  } finally {
    rl.close();
  }
}

/* ------------------------------------------------------------------ printing */

const out = text => process.stdout.write(`${text}\n`);

function table(rows) {
  if (!rows.length) return;
  const widths = rows[0].map((_, column) => Math.max(...rows.map(row => String(row[column] ?? '').length)));
  for (const row of rows) {
    out(row.map((cell, column) => String(cell ?? '').padEnd(column === row.length - 1 ? 0 : widths[column])).join('  ').trimEnd());
  }
}

/* ------------------------------------------------------------------ commands */

const COMMANDS = {
  async login(_, flags) {
    /* Four sources, in the order of "least likely to end up in shell history".
       Nothing is prompted for: a token echoed into a terminal is a token in the
       scrollback, and every one of these avoids that. */
    /* `--token` is checked before stdin is touched, and that ordering is the
       whole point: reading stdin first meant `portfolio login --token X` sat
       waiting for an EOF that a script, a CI job or an agent shell never sends.
       It looked like a hang with no output. Only reach for the pipe when nothing
       else answered — someone with no flag and no variable did mean to pipe. */
    let token = flags.token?.trim() || '';
    if (!token) {
      const piped = await stdin();
      token = piped ? piped.toString('utf8').trim() : '';
    }
    token ||=
      process.env.PORTFOLIO_TOKEN ||
      process.env.GITHUB_TOKEN ||
      spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' }).stdout?.trim() ||
      '';
    if (!token) {
      die(
        'No token. Any of:\n' +
          '  portfolio login --token ghp_…\n' +
          '  pbpaste | portfolio login\n' +
          '  PORTFOLIO_TOKEN=ghp_… portfolio login\n' +
          '  gh auth login   (then: portfolio login)\n\n' +
          'It must belong to the account this site admits — see site.githubUser.',
      );
    }

    const site = (flags.site || process.env.PORTFOLIO_SITE || readConfig().site || defaultSite()).replace(/\/+$/, '');
    if (!site) die('No site origin. Pass --site https://example.com.');

    /* Ask GitHub who this is, then ask the site whether it will take them. Two
       questions, because they have two different answers and only the second one
       decides anything: a perfectly valid token for the wrong account is a 403,
       and reporting "signed in" for it would be the bug `canWriteContent()`
       exists to avoid on the browser side. */
    const login = await githubLogin(token);

    /* Then ask the site. Three outcomes, and only one of them is a refusal:
       it accepts the token, it rejects it, or — the case that cost an afternoon
       the first time — it answers 404 because the origin is running a build from
       before `GET /api/content` existed. That last one is not an authentication
       problem and must not be reported as one: the credential is good, the
       deploy is behind, and "answered 404." names neither. */
    let stale = false;
    try {
      await api({ site, token }, '/api/content?table=projects&limit=1');
    } catch (error) {
      if (!/answered 404/.test(error.message)) throw error;
      stale = true;
    }

    writeConfig({ site, token, login });
    if (stale) {
      out(`Signed in as @${login}, and the token is stored — but ${site} has no`);
      out('`GET /api/content`, so it is serving a build from before this tool existed.');
      out('Deploy the site (`npm run deploy`) and reads will start working; writes');
      out('already do. Until then, point this at a dev server with');
      out('`--site http://localhost:4321`.');
    } else {
      out(`Signed in as @${login} — ${site} accepts writes from this token.`);
    }
    out(`Token stored in ${CONFIG} (mode 600). \`portfolio logout\` removes it.`);
  },

  logout() {
    rmSync(CONFIG, { force: true });
    out(`Removed ${CONFIG}. The token itself is revoked at GitHub, not here.`);
  },

  async whoami(_, flags) {
    const where = session(flags);
    await api(where, '/api/content?table=projects&limit=1');
    /* Asked rather than remembered when the token did not come from `login` —
       `--token` and `$PORTFOLIO_TOKEN` write nothing to disk, and a `whoami`
       answering "@?" is a command that did not do its one job. */
    const login = where.login ?? (await githubLogin(where.token).catch(() => null));
    out(`@${login ?? 'unknown'} → ${where.site} (writes accepted)`);
  },

  async ls([kind], flags) {
    const where = session(flags);
    const table_ = kindOf(kind);
    const rows = await rowsOf(where, table_);
    if (flags.json) return out(JSON.stringify(rows, null, 2));
    if (!rows.length) return out(`No ${table_} rows.`);
    table(rows.map(row => [row.slug, ...(SUMMARY[table_](row.fields) ?? [])]));
    out(`\n${rows.length} ${table_} row${rows.length === 1 ? '' : 's'}`);
  },

  async get([kind, slug], flags) {
    const where = session(flags);
    const table_ = kindOf(kind);
    if (!slug) die(`Which ${table_} row? \`portfolio ls ${kind}\` lists them.`);
    const [row] = await rowsOf(where, table_, slug);
    /* A `documents` row is the document, not a column holding one — the same
       shape `edit` opens, so what is printed is what would be edited. */
    const shown = flags.json ? row : table_ === 'documents' ? row.fields.json : row.fields;
    out(JSON.stringify(shown, null, 2));
    if (row.body && !flags.json) out(`\n--- body (${row.body.length} chars) — \`portfolio body ${kind} ${slug}\` to edit ---`);
  },

  async create([kind, slug, ...pairs], flags) {
    const where = session(flags);
    const table_ = kindOf(kind);
    if (!slug) die('A slug is required — it is the primary key and the public URL.');
    assertSlug(table_, slug);
    const fromFile = flags.file ? writable(table_, JSON.parse(readFileSync(flags.file, 'utf8'))) : {};
    const fields = { ...fromFile, ...parsePairs(table_, pairs) };
    if (!Object.keys(fields).length) die('Nothing to write. Pass field=value pairs or --file row.json.');
    const body = flags.body ? readFileSync(flags.body, 'utf8') : undefined;
    await contentWrite(where, table_, slug, 'create', { fields, ...(body === undefined ? {} : { body }) });
    out(`Created ${table_}/${slug}.`);
  },

  async set([kind, slug, ...pairs], flags) {
    const where = session(flags);
    const table_ = kindOf(kind);
    if (!slug || !pairs.length) die('Usage: portfolio set <kind> <slug> field=value [field=value …]');
    await contentWrite(where, table_, slug, 'patch', { fields: parsePairs(table_, pairs) });
    out(`Saved ${table_}/${slug} — ${pairs.map(pair => pair.split('=')[0]).join(', ')}.`);
  },

  /**
   * The row as JSON, in `$EDITOR`, patched back.
   *
   * This is the command that makes the other twenty unnecessary: every field of
   * every table is editable through it, including one added tomorrow, and there
   * is no flag here to keep in step with the schema. Only what changed is sent,
   * so a field this tool has never heard of survives the round trip the same way
   * it survives an edit from a screen that does not show it.
   */
  async edit([kind, slug], flags) {
    const where = session(flags);
    const table_ = kindOf(kind);
    if (!slug) die(`Which ${table_} row? \`portfolio ls ${kind}\` lists them.`);
    const [row] = await rowsOf(where, table_, slug);

    const before = table_ === 'documents' ? row.fields.json : writable(table_, row.fields);
    const edited = throughEditor(`${table_}-${slug}.json`, `${JSON.stringify(before, null, 2)}\n`);
    let next;
    try {
      next = JSON.parse(edited);
    } catch (error) {
      die(`That is not valid JSON, so nothing was saved: ${error.message}`);
    }

    if (table_ === 'documents') {
      if (JSON.stringify(next) === JSON.stringify(before)) return out('No change.');
      await saveDoc(where, slug, next);
      return out(`Saved documents/${slug}.`);
    }

    /* Only the keys that actually differ. A patch of everything would work, but
       it would also rewrite columns the editor never looked at — and the whole
       reason `patch` exists rather than `INSERT OR REPLACE` is that it does not
       do that. */
    const fields = writable(table_, next);
    const changed = Object.fromEntries(
      Object.entries(fields).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(before[key])),
    );
    if (!Object.keys(changed).length) return out('No change.');
    await contentWrite(where, table_, slug, 'patch', { fields: changed });
    out(`Saved ${table_}/${slug} — ${Object.keys(changed).join(', ')}.`);
  },

  /**
   * The markdown body, as markdown.
   *
   * A separate command rather than a `body` key in the JSON above, because a
   * post inside a JSON string is a wall of `\n` escapes — and because the two
   * halves are edited at different times by different means. `--out` and `--in`
   * are the non-interactive forms; the HTML half is derived on the server from
   * whatever this sends and is not something a caller may set.
   */
  async body([kind, slug], flags) {
    const where = session(flags);
    const table_ = kindOf(kind);
    if (!TABLES[table_].rendersBody) die(`${table_} has no body.`);
    if (!slug) die(`Which ${table_} row?`);

    if (flags.in) {
      const markdown = flags.in === '-' ? (await stdin())?.toString('utf8') : readFileSync(flags.in, 'utf8');
      if (markdown === undefined) die('Nothing on stdin.');
      await contentWrite(where, table_, slug, 'patch', { body: markdown });
      return out(`Saved the body of ${table_}/${slug} (${markdown.length} chars).`);
    }

    const [row] = await rowsOf(where, table_, slug);
    if (flags.out) {
      writeFileSync(flags.out, row.body ?? '');
      return out(`Wrote ${flags.out} (${(row.body ?? '').length} chars).`);
    }
    if (!process.stdout.isTTY) return process.stdout.write(row.body ?? '');

    const edited = throughEditor(`${table_}-${slug}.md`, row.body ?? '');
    if (edited === row.body) return out('No change.');
    await contentWrite(where, table_, slug, 'patch', { body: edited });
    out(`Saved the body of ${table_}/${slug} (${edited.length} chars).`);
  },

  async rm([kind, slug], flags) {
    const where = session(flags);
    const table_ = kindOf(kind);
    if (!slug) die(`Which ${table_} row?`);
    /* A deleted row is gone. There is no git history holding a copy — that
       stopped being true when content moved to D1 — so this asks, and says why
       rather than just asking. */
    if (!flags.yes && !(await confirm(`Delete ${table_}/${slug}? There is no copy of it anywhere.`))) {
      return out('Left alone.');
    }
    await contentWrite(where, table_, slug, 'delete');
    out(`Deleted ${table_}/${slug}.`);
  },

  /**
   * Rearranging, which is a document rather than a column.
   *
   * Both orders are an array of slugs in one `documents` row, and an empty array
   * means automatic — the projects with a case study behind them, and the posts
   * in date order. With no slugs this prints the saved order as the command that
   * would reproduce it, which is the shortest path to editing one.
   */
  async order([kind, ...slugs], flags) {
    const where = session(flags);
    const which = String(kind ?? '').toLowerCase().replace(/^(project|post)$/, '$1s');
    const spec = ORDERS[which];
    if (!spec) die('Usage: portfolio order projects|journal [slug …] [--auto]');

    if (flags.auto) {
      await saveDoc(where, spec.key, { slugs: [] });
      return out(`Automatic — ${spec.what} is no longer pinned by hand.`);
    }

    const rows = await rowsOf(where, spec.table);
    const known = new Set(rows.map(row => row.slug));

    if (!slugs.length) {
      const [doc] = await rowsOf(where, 'documents', spec.key).catch(() => []);
      const saved = (doc?.fields.json?.slugs ?? []).filter(slug => known.has(slug));
      out(saved.length ? `portfolio order ${which} ${saved.join(' ')}` : `Automatic — nothing is pinned by hand.`);
      out(`\nAvailable: ${rows.map(row => row.slug).join(' ')}`);
      return;
    }

    /* Refused here rather than saved and dropped on read. A slug that is not a
       row is a typo, and the read side silently ignoring it would make the typo
       look like a save that worked. */
    const unknown = slugs.filter(slug => !known.has(slug));
    if (unknown.length) die(`Not ${spec.table} rows: ${unknown.join(', ')}.`);
    if (new Set(slugs).size !== slugs.length) die('The same slug twice.');
    if (spec.table === 'projects') {
      /* A hidden project cannot lead a section it is not on — the same rule the
         manifest enforces by bouncing a card back down. */
      const hidden = slugs.filter(slug => rows.find(row => row.slug === slug)?.fields.hidden);
      if (hidden.length) die(`Hidden, so cannot lead: ${hidden.join(', ')}. Unhide first: portfolio set project ${hidden[0]} hidden=false`);
    }

    await saveDoc(where, spec.key, { slugs });
    out(`Saved — ${spec.what} is now: ${slugs.join(' → ')}`);
  },

  /** The two provider operations `/api/content` cannot express. */
  async provider([action, slug], flags) {
    const where = session(flags);
    if (action === 'test') {
      if (!slug) die('Usage: portfolio provider test <slug>');
      const result = await api(where, '/api/ai/providers', { method: 'POST', body: { slug } });
      out(`${result.ok ? 'ok' : 'FAILED'}  ${result.ms} ms  ${result.message}`);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (action === 'key') {
      if (!slug) die('Usage: pbpaste | portfolio provider key <slug>   (or --token-file)');
      /* Read, never taken as an argument: a credential in `argv` is a credential
         in shell history and in every `ps` on the machine. */
      const piped = flags.file ? readFileSync(flags.file, 'utf8') : (await stdin())?.toString('utf8');
      const key = piped?.trim();
      if (!key) die('Nothing on stdin. Pipe the key in, or pass --file key.txt.');
      await contentWrite(where, 'ai_providers', slug, 'patch', { fields: { apiKey: key } });
      return out(`Stored a key for ${slug}. It cannot be read back — only replaced or cleared.`);
    }
    if (action === 'clear-key') {
      if (!slug) die('Usage: portfolio provider clear-key <slug>');
      if (!flags.yes && !(await confirm(`Clear the API key on ${slug}? The assistant will stop answering.`))) {
        return out('Left alone.');
      }
      await contentWrite(where, 'ai_providers', slug, 'patch', { fields: { apiKey: '' } });
      return out(`Cleared the key on ${slug}.`);
    }
    die('Usage: portfolio provider test|key|clear-key <slug>. Everything else is `ls`/`edit`/`set`/`rm` provider.');
  },

  async logs(_, flags) {
    const where = session(flags);
    const query = new URLSearchParams();
    if (flags.level) query.set('level', flags.level);
    if (flags.source) query.set('source', flags.source);
    if (flags.limit) query.set('limit', flags.limit);

    if (flags.clear) {
      if (!flags.yes && !(await confirm(`Delete the log rows ${query.size ? 'matching that filter' : '— all of them'}?`))) {
        return out('Left alone.');
      }
      const { removed } = await api(where, `/api/logs?${query}`, { method: 'DELETE' });
      return out(`Removed ${removed} row${removed === 1 ? '' : 's'}.`);
    }

    const { rows, total, kept, cap } = await api(where, `/api/logs?${query}`);
    if (flags.json) return out(JSON.stringify(rows, null, 2));
    table(rows.map(row => [row.at, row.level, row.source, row.message]));
    out(`\n${rows.length} of ${total} matching · ${kept}/${cap} rows kept`);
  },

  async media([action, file], flags) {
    const where = session(flags);
    if (!action || action === 'ls') {
      const { items } = await api(where, '/api/media');
      table(items.map(item => [item.url, `${Math.ceil(item.size / 1024)} KB`, item.mime, item.updatedAt]));
      return out(`\n${items.length} file${items.length === 1 ? '' : 's'}`);
    }
    if (action === 'rm') {
      if (!file) die('Usage: portfolio media rm /media/dir/name.ext');
      if (!flags.yes && !(await confirm(`Delete ${file}? A page still pointing at it will show a broken image.`))) {
        return out('Left alone.');
      }
      await api(where, `/api/media?path=${encodeURIComponent(file)}`, { method: 'DELETE' });
      return out(`Deleted ${file}.`);
    }
    if (action !== 'put') die('Usage: portfolio media ls|put|rm …');
    if (!file) die('Which file?');

    const extension = file.split('.').pop()?.toLowerCase() ?? '';
    const mime = IMAGE_TYPES[extension];
    if (!mime) die(`Not an image this site accepts: .${extension}. One of: ${Object.keys(IMAGE_TYPES).join(', ')}.`);

    const query = new URLSearchParams({
      dir: flags.dir ?? 'uploads',
      name: flags.name ?? (file.split('/').pop() ?? '').replace(/\.[^.]+$/, ''),
    });
    const { url } = await api(where, `/api/media?${query}`, {
      method: 'POST',
      raw: readFileSync(file),
      type: mime,
    });
    out(url);
  },

  help() {
    out(HELP);
  },
};

const HELP = `portfolio — the admin surface, from a terminal

  Every write goes through POST /api/content with your GitHub token, the same
  endpoint and the same column allowlist the /admin screens use. Nothing here
  talks to the database.

SESSION
  login [--token T]              store a token (also: stdin, $PORTFOLIO_TOKEN, gh auth token)
  whoami                         who this is, and whether the site accepts it
  logout                         forget the token

CONTENT                          <kind> = project | case-study | journal | provider | doc
  ls <kind>                      every row, one line each
  get <kind> <slug>              one row as JSON
  create <kind> <slug> f=v …     insert a row  [--file row.json] [--body post.md]
  set <kind> <slug> f=v …        patch just those fields  (f=- clears one)
  edit <kind> <slug>             the row as JSON in \$EDITOR; only changes are sent
  body journal|case-study <slug> the markdown, in \$EDITOR  [--out f] [--in f|-]
  rm <kind> <slug>               delete it  [--yes]         (there is no copy)
  order projects|journal [slug …] rearrange; no args prints the saved order  [--auto]

AI
  provider test <slug>           one eight-token completion through it
  provider key <slug>            read a key from stdin  [--file key.txt]
  provider clear-key <slug>      remove it  [--yes]

OPERATIONS
  logs [--level l] [--source s] [--limit n] [--clear] [--yes]
  media ls | media put <file> [--dir d] [--name n] | media rm <path> [--yes]

EVERYWHERE
  --site https://…               override the origin (default: public/CNAME)
  --json                         machine-readable output

  Field names are the ones POST /api/content takes, read from
  src/lib/content-schema.ts — a wrong one is refused with the list.
  A list field is comma-separated: tags=cv,pytorch

EXAMPLES
  portfolio ls project
  portfolio set project my-thing hidden=true featuredRank=1
  portfolio edit journal a-post
  portfolio body journal a-post --in draft.md
  portfolio order projects thing other-thing
  portfolio create journal new-post title="New post" summary="…" date=2026-09-29 status=draft
`;

/* ---------------------------------------------------------------------- main */

const OPTIONS = {
  site: { type: 'string' },
  token: { type: 'string' },
  json: { type: 'boolean' },
  file: { type: 'string' },
  body: { type: 'string' },
  out: { type: 'string' },
  in: { type: 'string' },
  dir: { type: 'string' },
  name: { type: 'string' },
  auto: { type: 'boolean' },
  level: { type: 'string' },
  source: { type: 'string' },
  limit: { type: 'string' },
  clear: { type: 'boolean' },
  yes: { type: 'boolean', short: 'y' },
  help: { type: 'boolean', short: 'h' },
};

/* Aliases for the verbs, because half of these have two obvious names and
   guessing wrong should not be an error message. */
const ALIAS = { list: 'ls', show: 'get', delete: 'rm', remove: 'rm', patch: 'set', new: 'create', reorder: 'order', providers: 'provider' };

async function main() {
  let values, positionals;
  try {
    ({ values, positionals } = parseArgs({ options: OPTIONS, allowPositionals: true }));
  } catch (error) {
    die(`${error.message}\n\nRun \`portfolio help\` for the options.`);
  }

  const [verb = 'help', ...rest] = positionals;
  if (values.help) return COMMANDS.help();
  const command = COMMANDS[ALIAS[verb] ?? verb];
  if (!command) die(`Unknown command "${verb}". Run \`portfolio help\`.`);
  await command(rest, values);
}

/* Only when run, never when imported: `scripts/test-cli.mjs` drives the pure
   helpers above, and a module that starts parsing `process.argv` on import
   cannot be tested. `realpath` on both sides so an `npm link` symlink — which is
   how this is normally on a PATH — still compares equal. */
const invokedDirectly = (() => {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main().catch(error => {
  /* `BadRequest` is the shared vocabulary of the write endpoint's boundary, and
     it means the same thing here as it does there: the caller got something
     wrong and the message says what. A stack trace over it would bury the one
     useful line. Anything else is a bug in this file and keeps its trace. */
    const expected = error instanceof Fail || error instanceof BadRequest;
    process.stderr.write(`${expected ? error.message : (error?.stack ?? error)}\n`);
    process.exitCode = 1;
  });
}
