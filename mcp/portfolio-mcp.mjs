#!/usr/bin/env node
/**
 * An MCP server for this site's own admin surface.
 *
 * It lets an assistant do the things the `/admin` screens do — read the
 * projects, write a journal entry, patch a case study, rearrange the home page —
 * and it is built so that "secure, and only I can reach it" is a property of the
 * machine rather than of an auth scheme somebody wrote.
 *
 * ## Why stdio, and why that is the security design
 *
 * This server has **no network listener**. It speaks JSON-RPC over stdin and
 * stdout as a child process of whatever editor launched it, on the owner's own
 * computer. There is no port, no origin, no session, no token to steal in
 * transit, and nothing new exposed to the internet — so the question "who can
 * reach this?" is answered by the operating system's process and file
 * permissions, which are already answering it for every other program on the
 * machine.
 *
 * The alternative — a remote MCP endpoint on the Worker — would have needed an
 * authorization scheme of its own, an internet-facing surface, and a second
 * credential, in order to arrive at a weaker version of the same thing. If the
 * owner ever wants to edit the site from a phone, that is a different design and
 * should be argued for on its own terms.
 *
 * ## It invents no authority
 *
 * The credential is the GitHub token `portfolio login` already stored in
 * `~/.config/portfolio/cli.json` at mode 0600. This server reads it, presents it
 * on each request, and never returns it, logs it or echoes it into a tool result.
 * Every write is `POST /api/content`, which asks GitHub whose token it is and
 * admits only `site.githubUser` — so this process has exactly the powers of a
 * signed-in browser tab and not one more. Revoking the token at GitHub, or
 * deleting that file, removes its access without this site being told anything.
 * Decision 73; `src/lib/authorize.ts` for the boundary itself.
 *
 * ## Three gates that are not about authentication
 *
 * Authentication says *who*. These say *what*, and they exist because the caller
 * on the other end is a model:
 *
 *   1. **Delete is not even listed** unless `PORTFOLIO_MCP_ALLOW_DELETE=1`. A
 *      deleted row has no copy anywhere — there is no git history behind this
 *      content any more — so an always-available delete tool is the wrong
 *      default for a live portfolio. `hidden` and `status` are the reversible
 *      ways to take something down, and they are always available.
 *   2. **Configuration is read-only.** Content is writable: projects, case
 *      studies, journal, the resume, the two saved orders. Not writable: the
 *      `ai_providers` rows, the public assistant's settings, the daily
 *      journal's schedule. Those decide what the assistant may spend and how
 *      often it runs, and a model editing its own budget is a conflict of
 *      interest rather than a feature. `PORTFOLIO_MCP_ALLOW_CONFIG=1` widens it.
 *   3. **`apiKey` is refused unconditionally**, gates or no gates. A credential
 *      should not travel through a conversation; `portfolio provider key` reads
 *      one from stdin, which is the path that exists for it.
 *
 * None of the three replaces the client's own approval prompt, which is the
 * human in the loop and the thing actually standing between a suggestion and a
 * write. They are there so that the worst available mistake is a small one.
 *
 * ## Protocol
 *
 * Hand-written, ~120 lines, against the 2025-06-18 spec (and answering the two
 * older versions a client may ask for). No SDK, deliberately: this process holds
 * a token that can rewrite the live site, and the smallest dependency tree for
 * that is none — the same reasoning as every other check in this repository
 * being plain `node:assert`. `scripts/test-mcp.mjs` drives a real handshake over
 * a real pipe, so the protocol is pinned by something other than confidence.
 *
 * **Nothing but protocol may be written to stdout.** A stray `console.log` is a
 * parse error in the client and a server that "won't connect" for no visible
 * reason. Diagnostics go to stderr, which the client shows in its logs.
 */

import { readFileSync } from 'node:fs';

import { BadRequest, assertSlug } from '../src/lib/content-schema.ts';
import {
  CONFIG,
  Fail,
  IMAGE_TYPES,
  KIND_NAMES,
  ORDERS,
  api,
  contentWrite,
  die,
  githubLogin,
  kindOf,
  rowsOf,
  saveDoc,
  session,
  strictFields,
} from '../cli/portfolio-api.mjs';

const VERSION = '1.0.0';
const LATEST = '2025-06-18';
const SUPPORTED = new Set([LATEST, '2025-03-26', '2024-11-05']);

const on = name => /^(1|true|yes|on)$/i.test(process.env[name] ?? '');
const ALLOW_DELETE = on('PORTFOLIO_MCP_ALLOW_DELETE');
const ALLOW_CONFIG = on('PORTFOLIO_MCP_ALLOW_CONFIG');

/* --------------------------------------------------------------------- policy */

/** Content, as opposed to configuration. Always writable. */
const CONTENT_TABLES = new Set(['projects', 'case_studies', 'journal']);

/** The `documents` singletons that hold content rather than settings. */
const CONTENT_DOCS = new Set(['resume', 'projects-deep-dives', 'journal-order']);

/**
 * Refuse a write this server does not do, before it reaches the network.
 *
 * Deliberately *not* framed as "is this caller allowed" — it is, it holds the
 * owner's token. It is "is this the kind of change a conversation should be
 * making", and the answer for a spending ceiling or a stored credential is no
 * even when the answer for a blog post is yes.
 */
function assertWritable(table, slug, fields) {
  if (fields && Object.prototype.hasOwnProperty.call(fields, 'apiKey')) {
    die(
      'This server will not write an API key, with or without PORTFOLIO_MCP_ALLOW_CONFIG. ' +
        'A credential should not travel through a conversation — run `portfolio provider key ' +
        `${slug}` +
        '` and pipe it in from stdin.',
    );
  }
  if (CONTENT_TABLES.has(table)) return;
  if (table === 'documents' && CONTENT_DOCS.has(slug)) return;
  if (ALLOW_CONFIG) return;
  die(
    `${table}${table === 'documents' ? `/${slug}` : ''} is configuration, and this server is ` +
      'read-only for configuration: those rows decide what the assistant may spend and how often ' +
      'the daily journal runs. Read them freely. To change one, use the /admin/ai screen, or the ' +
      'CLI (`portfolio edit …`), or set PORTFOLIO_MCP_ALLOW_CONFIG=1 on this server.',
  );
}

/** The policy, in words, for `portfolio_whoami` and the initialize instructions. */
const policyLines = () => [
  `Writable: projects, case studies, journal, ${[...CONTENT_DOCS].join(', ')}.`,
  ALLOW_CONFIG
    ? 'Configuration is writable (PORTFOLIO_MCP_ALLOW_CONFIG is set) — except apiKey, which is never writable here.'
    : 'Configuration (ai_providers, ai-assistant, journal-auto) is read-only. apiKey is never writable here.',
  ALLOW_DELETE
    ? 'portfolio_delete is available (PORTFOLIO_MCP_ALLOW_DELETE is set) and needs confirm: true. A deleted row has no copy anywhere.'
    : 'Deleting is not available. Take something down reversibly instead: hidden=true on a project, status="unpublished" on a post.',
];

/* ---------------------------------------------------------------------- tools */

const KIND = { type: 'string', enum: KIND_NAMES, description: 'Which kind of row.' };
const SLUG = {
  type: 'string',
  description:
    'The row’s primary key, and for content its public URL. Lowercase words joined by hyphens.',
};

const TOOLS = [
  {
    name: 'portfolio_whoami',
    title: 'Check the connection',
    description:
      'Which site this is pointed at, which GitHub account it writes as, whether that account is accepted, and what this server will and will not change. Call this first if anything is unclear — it is the cheapest way to find out why a write would be refused.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'portfolio_list',
    title: 'List rows',
    description:
      'Every row of one kind, with the two or three facts that identify it (a project’s visibility and category, a post’s status and date). Fields and bodies are not included — use portfolio_get for one row.',
    inputSchema: {
      type: 'object',
      properties: { kind: KIND },
      required: ['kind'],
      additionalProperties: false,
    },
  },
  {
    name: 'portfolio_get',
    title: 'Read one row',
    description:
      'One row in full: every field, and the markdown body for a journal entry or case study. The fields come back with exactly the names a write accepts, so this output can be edited and handed to portfolio_update.',
    inputSchema: {
      type: 'object',
      properties: { kind: KIND, slug: SLUG },
      required: ['kind', 'slug'],
      additionalProperties: false,
    },
  },
  {
    name: 'portfolio_create',
    title: 'Create a row',
    description:
      'Insert a new row. The slug is permanent — it is the public URL, and renaming it later would orphan a live page — so choose it from the title and confirm it with the author if there is any doubt. A duplicate slug is refused rather than overwriting. A journal entry with no status is created as a draft, which is the right default: publish it as a separate, deliberate step.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: KIND,
        slug: SLUG,
        fields: {
          type: 'object',
          description:
            'The row’s fields, camelCase, as portfolio_get returns them. Required fields differ per kind; a missing one is refused with its name. An unknown field name is refused with the list of real ones.',
        },
        body: {
          type: 'string',
          description:
            'Markdown body, for a journal entry or a case study. Rendered to HTML on the server, with raw HTML escaped and unsafe links unwrapped — so write markdown, not HTML.',
        },
      },
      required: ['kind', 'slug', 'fields'],
      additionalProperties: false,
    },
  },
  {
    name: 'portfolio_update',
    title: 'Update a row',
    description:
      'Patch an existing row. Only the fields passed are written, so anything not mentioned keeps its value — read first with portfolio_get if you need to preserve something you are also rewriting. The slug is never changed by this: it is the route, and editing a title does not move the page.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: KIND,
        slug: SLUG,
        fields: { type: 'object', description: 'Only the fields to change, camelCase.' },
        body: { type: 'string', description: 'Replaces the whole markdown body when given.' },
      },
      required: ['kind', 'slug'],
      additionalProperties: false,
    },
  },
  {
    name: 'portfolio_order',
    title: 'Rearrange',
    description:
      'The two hand-picked orders: which projects lead the home page’s Deep dives section, and which posts are pinned to the top of /journal. Call with no slugs to read the current order. A hidden project cannot lead. Passing automatic: true hands the order back to the site’s own rule.',
    inputSchema: {
      type: 'object',
      properties: {
        which: { type: 'string', enum: ['projects', 'journal'] },
        slugs: {
          type: 'array',
          items: { type: 'string' },
          description: 'The full order, first to last. Every slug must be an existing row.',
        },
        automatic: { type: 'boolean', description: 'Clear the hand-picked order instead.' },
      },
      required: ['which'],
      additionalProperties: false,
    },
  },
  {
    name: 'portfolio_media',
    title: 'Images',
    description:
      'List the uploaded images, or upload one from a local file so a heroImage field can point at it. The returned /media/... URL is public and permanent until replaced, so upload only files meant to be published — this reads whatever path it is given.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'upload'] },
        file: { type: 'string', description: 'Local path to the image, for upload.' },
        dir: { type: 'string', description: 'Directory segment under /media. Default "uploads".' },
        name: { type: 'string', description: 'Filename without extension. Default the file’s own.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'portfolio_logs',
    title: 'Read the site log',
    description:
      'The site’s own operational record, newest first: content writes, uploads, AI runs, daily-journal ticks and how each ended. This is where to look when something did not happen — a daily entry that never appeared, a save that was refused.',
    inputSchema: {
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['info', 'warn', 'error'] },
        source: {
          type: 'string',
          enum: ['daily', 'content', 'media', 'chat', 'assist', 'admin'],
        },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
  },
];

/* The gated one, appended only when it is switched on — not listed and refused,
   but absent, so a model never proposes a delete the owner has not enabled. */
if (ALLOW_DELETE) {
  TOOLS.push({
    name: 'portfolio_delete',
    title: 'Delete a row',
    description:
      'Permanently remove a row. THERE IS NO COPY: this content is not in git, and nothing here can undo it. Prefer the reversible alternatives — hidden=true on a project, status="unpublished" on a post — and ask the author in plain words before calling this. Deleting a case study that a project still links to is refused by the database.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: KIND,
        slug: SLUG,
        confirm: {
          type: 'boolean',
          description: 'Must be true. A second, explicit barrier in front of an irreversible write.',
        },
      },
      required: ['kind', 'slug', 'confirm'],
      additionalProperties: false,
    },
  });
}

/* ------------------------------------------------------------------- handlers */

const where = () => session();

const CALLS = {
  async portfolio_whoami() {
    const site = where();

    /* Three outcomes, not two. The read endpoint answering is `ok`; a 401 or 403
       is a real refusal; and a **404 means the origin is serving a build from
       before `GET /api/content` existed** — the token is fine and writes work, the
       deploy is behind. Collapsing that third case into "refused" sends a model
       off debugging a credential that was never the problem. */
    let status = 'ok';
    let detail = null;
    try {
      await api(site, '/api/content?table=projects&limit=1');
    } catch (error) {
      if (/answered 404/.test(error.message)) {
        status = 'needs-deploy';
        detail =
          'This origin has no GET /api/content, so it is running a build from before these ' +
          'tools existed. Writing works; reading does not. Deploy the site (`npm run deploy`), ' +
          'or point PORTFOLIO_SITE at a dev server.';
      } else {
        status = 'refused';
        detail = error.message;
      }
    }
    return {
      site: site.site,
      githubAccount: site.login ?? (await githubLogin(site.token).catch(() => null)),
      siteStatus: status,
      canRead: status === 'ok',
      canWrite: status !== 'refused',
      detail,
      tokenFrom: process.env.PORTFOLIO_TOKEN ? 'PORTFOLIO_TOKEN (environment)' : CONFIG,
      policy: policyLines(),
    };
  },

  async portfolio_list({ kind }) {
    const table = kindOf(kind);
    const rows = await rowsOf(where(), table);
    return {
      kind,
      table,
      count: rows.length,
      rows: rows.map(row => ({ slug: row.slug, updatedAt: row.updatedAt, ...summary(table, row.fields) })),
    };
  },

  async portfolio_get({ kind, slug }) {
    const table = kindOf(kind);
    const [row] = await rowsOf(where(), table, String(slug));
    return row;
  },

  async portfolio_create({ kind, slug, fields, body }) {
    const table = kindOf(kind);
    slug = String(slug);
    assertSlug(table, slug);
    assertWritable(table, slug, fields);
    const payload = { fields: strictFields(table, fields) };
    if (!Object.keys(payload.fields).length) die('Nothing to write: `fields` was empty.');
    if (body !== undefined) payload.body = String(body);
    await contentWrite(where(), table, slug, 'create', payload);
    return { created: `${table}/${slug}`, fields: Object.keys(payload.fields), live: liveUrl(table, slug) };
  },

  async portfolio_update({ kind, slug, fields, body }) {
    const table = kindOf(kind);
    slug = String(slug);
    assertSlug(table, slug);
    assertWritable(table, slug, fields);

    /* A `documents` row is one JSON column, so a "field" patch is a whole-document
       replacement — the same thing the resume editor does. Read-modify-write here
       would be inventing a merge the screens do not do. */
    if (table === 'documents') {
      if (body !== undefined) die('A document has no markdown body.');
      if (!fields || typeof fields !== 'object') die('Pass the whole document as `fields`.');
      await saveDoc(where(), slug, fields);
      return { saved: `documents/${slug}` };
    }

    const payload = {};
    if (fields && Object.keys(fields).length) payload.fields = strictFields(table, fields);
    if (body !== undefined) payload.body = String(body);
    if (!payload.fields && payload.body === undefined) die('Nothing to change: pass `fields`, `body`, or both.');
    await contentWrite(where(), table, slug, 'patch', payload);
    return {
      saved: `${table}/${slug}`,
      fields: Object.keys(payload.fields ?? {}),
      body: payload.body === undefined ? 'unchanged' : `${payload.body.length} chars`,
      live: liveUrl(table, slug),
    };
  },

  async portfolio_delete({ kind, slug, confirm }) {
    if (!ALLOW_DELETE) die('Deleting is not enabled on this server.');
    if (confirm !== true) die('Refused: `confirm` must be true. A deleted row has no copy anywhere.');
    const table = kindOf(kind);
    slug = String(slug);
    assertSlug(table, slug);
    assertWritable(table, slug);
    await contentWrite(where(), table, slug, 'delete');
    return { deleted: `${table}/${slug}`, recoverable: false };
  },

  async portfolio_order({ which, slugs, automatic }) {
    const spec = ORDERS[String(which)];
    if (!spec) die('`which` must be "projects" or "journal".');
    const site = where();

    if (automatic === true) {
      await saveDoc(site, spec.key, { slugs: [] });
      return { which, order: 'automatic', what: spec.what };
    }

    const rows = await rowsOf(site, spec.table);
    const known = new Map(rows.map(row => [row.slug, row.fields]));

    if (!Array.isArray(slugs)) {
      const [doc] = await rowsOf(site, 'documents', spec.key).catch(() => []);
      const saved = (doc?.fields.json?.slugs ?? []).filter(slug => known.has(slug));
      return {
        which,
        what: spec.what,
        current: saved.length ? saved : 'automatic',
        available: [...known.keys()],
      };
    }

    /* Refused here rather than saved and dropped on read: the read side ignores a
       slug that is not a row, which would make a typo look like a save that
       worked. */
    const unknown = slugs.filter(slug => !known.has(slug));
    if (unknown.length) die(`Not ${spec.table} rows: ${unknown.join(', ')}.`);
    if (new Set(slugs).size !== slugs.length) die('The same slug appears twice.');
    if (spec.table === 'projects') {
      const hidden = slugs.filter(slug => known.get(slug)?.hidden);
      if (hidden.length) {
        die(`Hidden, so cannot lead the home page: ${hidden.join(', ')}. Unhide it first.`);
      }
    }

    await saveDoc(site, spec.key, { slugs });
    return { which, what: spec.what, order: slugs };
  },

  async portfolio_media({ action, file, dir, name }) {
    const site = where();
    if (action === 'list') {
      const { items } = await api(site, '/api/media');
      return { count: items.length, items };
    }
    if (action !== 'upload') die('`action` must be "list" or "upload".');
    if (!file) die('`file` is the local path to upload.');

    const extension = String(file).split('.').pop()?.toLowerCase() ?? '';
    const mime = IMAGE_TYPES[extension];
    if (!mime) {
      die(`Not an image this site accepts: .${extension}. One of: ${Object.keys(IMAGE_TYPES).join(', ')}.`);
    }
    let bytes;
    try {
      bytes = readFileSync(String(file));
    } catch (error) {
      die(`Could not read ${file} — ${error.message}`);
    }
    const query = new URLSearchParams({
      dir: dir ?? 'uploads',
      name: name ?? (String(file).split('/').pop() ?? '').replace(/\.[^.]+$/, ''),
    });
    const { url, size } = await api(site, `/api/media?${query}`, {
      method: 'POST',
      raw: bytes,
      type: mime,
    });
    return { url, size, note: 'Put this in a heroImage field. It is a public URL.' };
  },

  async portfolio_logs({ level, source, limit }) {
    const query = new URLSearchParams();
    if (level) query.set('level', String(level));
    if (source) query.set('source', String(source));
    query.set('limit', String(Math.min(100, Math.max(1, Number(limit) || 25))));
    const { rows, total, kept, cap } = await api(where(), `/api/logs?${query}`);
    return { rows, matching: total, kept, cap };
  },
};

/** The identifying facts per kind, matching what the CLI's `ls` prints. */
function summary(table, f) {
  if (table === 'projects') {
    return { title: f.title, hidden: f.hidden, category: f.category, year: f.year, caseStudySlug: f.caseStudySlug };
  }
  if (table === 'journal') return { title: f.title, status: f.status, date: f.date };
  if (table === 'case_studies') return { title: f.title, date: f.date };
  if (table === 'ai_providers') {
    return { label: f.label, active: f.active, model: f.model, hasKey: f.hasKey, priority: f.priority };
  }
  return {};
}

/** Where a row is readable once written, so a result can offer the page. */
const liveUrl = (table, slug) =>
  ({
    projects: `/projects/${slug}`,
    case_studies: `/case-studies/${slug}`,
    journal: `/journal/${slug}`,
  })[table] ?? null;

/* -------------------------------------------------------------------- protocol */

const send = message => process.stdout.write(`${JSON.stringify(message)}\n`);
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const failRpc = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

const INSTRUCTIONS = [
  'Reads and writes the content of this portfolio through its own admin API, as the owner.',
  'A slug is a row’s primary key and its public URL: never change one to follow an edited title.',
  'Journal entries have three states — draft, published, unpublished — and a project has a hidden flag.',
  'Those are the reversible ways to take something down; deleting is not reversible and is off by default.',
  'Bodies are markdown; the server renders and sanitises them.',
  ...policyLines(),
].join(' ');

async function handle(message) {
  const { id, method, params } = message;
  const isRequest = id !== undefined && id !== null;

  switch (method) {
    case 'initialize': {
      /* Echo the client's version when it is one we speak, otherwise answer with
         our latest and let the client decide whether to continue — which is what
         the spec asks for, and is friendlier than refusing outright. */
      const asked = params?.protocolVersion;
      return reply(id, {
        protocolVersion: SUPPORTED.has(asked) ? asked : LATEST,
        capabilities: { tools: {} },
        serverInfo: { name: 'portfolio', title: 'Portfolio admin', version: VERSION },
        instructions: INSTRUCTIONS,
      });
    }

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return; // notifications take no response

    case 'ping':
      return reply(id, {});

    case 'tools/list':
      return reply(id, { tools: TOOLS });

    case 'tools/call': {
      const call = CALLS[params?.name];
      if (!call) return failRpc(id, -32602, `Unknown tool: ${params?.name}`);
      try {
        const result = await call(params.arguments ?? {});
        return reply(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
      } catch (error) {
        /* A refusal is a *result*, not a protocol error: `isError` is how the
           model gets to read what went wrong and try something else, where a
           JSON-RPC error is the client's problem and the model may never see the
           sentence. `Fail` and `BadRequest` carry messages written to be acted
           on — a missing required field names the field. Anything else is a bug
           here and says so rather than pretending to be advice. */
        const expected = error instanceof Fail || error instanceof BadRequest;
        if (!expected) process.stderr.write(`portfolio-mcp: ${error?.stack ?? error}\n`);
        return reply(id, {
          content: [{ type: 'text', text: expected ? error.message : `Server error: ${error?.message ?? error}` }],
          isError: true,
        });
      }
    }

    default:
      if (isRequest) return failRpc(id, -32601, `Method not found: ${method}`);
      return;
  }
}

/* Newline-delimited JSON, with the partial tail held: a chunk boundary lands
   mid-message often enough that dropping the remainder would look like a client
   that intermittently ignores requests. */
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      /* No id to answer against, so there is nobody to tell. Parse errors here
         mean the pipe is not carrying MCP, and stderr is where that shows up. */
      process.stderr.write('portfolio-mcp: could not parse a line as JSON\n');
      continue;
    }
    /* Never let one bad request end the session: an unhandled rejection would
       take the process down and the client would report a crash rather than a
       failed call. */
    handle(message).catch(error => {
      process.stderr.write(`portfolio-mcp: ${error?.stack ?? error}\n`);
      if (message.id !== undefined && message.id !== null) {
        failRpc(message.id, -32603, `Internal error: ${error?.message ?? error}`);
      }
    });
  }
});

/* The client closes stdin to shut us down. */
process.stdin.on('end', () => process.exit(0));
/* No exports, deliberately. `scripts/test-mcp.mjs` drives this as a real
   subprocess over a real pipe rather than importing its functions, which is the
   only way to pin the half that is protocol rather than logic — and a module
   that attaches stdin handlers on import cannot be imported anyway. */
