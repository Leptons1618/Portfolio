import type { APIRoute } from 'astro';
import { Unauthorized, json, refusal, requireOwner } from '../../../lib/authorize';
import {
  ProviderError,
  agentStream,
  callChat,
  getAiSettings,
  modelsFor,
  usableProviders,
  type Provider,
} from '../../../lib/ai';
import { buildIndex } from '../../../lib/ai-corpus';
import { MAX_TOOL_CALLS, runTool, toolSummary, toolsFor } from '../../../lib/ai-tools';
import { getCaseStudies, getPosts, getProjects, pinNewJournalPost } from '../../../lib/content';
import { getResume } from '../../../lib/resume';
import { ASSIST_TASKS, POST_KEYS, assistPrompt, parseFields } from '../../../lib/assist-tasks';
import {
  AUTO_KEY,
  AUTO_RUN_KEY,
  autoInstruction,
  clampAutoRun,
  clampAutoSettings,
  decide,
  slugify,
  type AutoJournalRun,
  type AutoJournalSettings,
} from '../../../lib/journal-auto';
import { renderBody } from '../../../lib/markdown';
import { site } from '../../../lib/site';

/**
 * The daily journal job.
 *
 * Everything else on this site that spends money is started by a person. This
 * is started by a clock — `.github/workflows/daily-journal.yml` calls it once
 * an hour — and `src/lib/journal-auto.ts` decides, from the date and two rows,
 * whether this particular tick is the one that writes. Most of them are not:
 * the normal answer is `skipped` with a reason, which costs one D1 read and no
 * tokens at all.
 *
 * ## Why a second write path, when there is supposed to be one
 *
 * `POST /api/content` is the write endpoint and this is not it, for the same
 * reason `/api/ai/chats` is not it: that endpoint authenticates a **person**.
 * It takes the GitHub token a browser is holding and asks GitHub whose it is,
 * and there is no browser and no person here. So the rule that endpoint exists
 * to enforce is kept rather than borrowed — every column name in `insertDraft`
 * is a literal in source, nothing from a request becomes a SQL identifier, and
 * the only inputs to the statement are the model's own text and the owner's
 * settings row. There is nothing in a request to this route that reaches the
 * database at all: it takes no slug, no table, no fields, and no prompt.
 *
 * ## Two ways in, and they are two different callers
 *
 *   - **The schedule** presents `CRON_SECRET`, a Worker secret. Absent from the
 *     environment, that door is shut — a missing secret is not an open one.
 *   - **The owner** presents their GitHub token, exactly like every admin write,
 *     and may pass `force` to run one now regardless of the clock. That is the
 *     "Run now" button on the AI screen, and it is how the feature is tested
 *     without waiting for an hour to come round.
 *
 * ## It writes a draft
 *
 * Never `published`. The post appears in the admin's journal list with a Draft
 * chip and 404s for everyone else until the owner reads it and presses publish.
 * An unattended model with the owner's byline is exactly the thing decision 13
 * refuses to build, and a status column is what makes refusing it cheap.
 */

export const prerender = false;

/**
 * Constant-time-ish comparison for the shared secret.
 *
 * `===` on strings short-circuits at the first differing byte, which leaks the
 * length of a correct prefix to anyone willing to make enough requests. This is
 * a Worker behind Cloudflare and the practical risk is remote, but the cost of
 * not getting it wrong is four lines.
 */
function secretMatches(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i += 1) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/** Who is calling: the schedule, the owner, or nobody who may. */
async function authorise(request: Request, secret: string | undefined): Promise<'cron' | 'owner'> {
  const header = request.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new Unauthorized('Missing bearer token.');

  /* The secret first, and only when there is one. An unset `CRON_SECRET` must
     not make every token a valid one — which is what comparing against
     `undefined` coerced to a string would do on an empty header. */
  if (secret && secret.trim() && secretMatches(token, secret.trim())) return 'cron';

  await requireOwner(request);
  return 'owner';
}

/**
 * That slug, or the first free variant of it.
 *
 * A model asked for a post about the same subject twice will occasionally
 * produce the same title, and the slug is a primary key. Suffixing rather than
 * refusing, because the run has already been paid for by the time this is
 * known — and a second post named `caching-2` is a thing the owner can rename,
 * where a failed insert is a wasted generation.
 */
async function freeSlug(db: D1Database, base: string): Promise<string> {
  const taken = async (slug: string) =>
    Boolean(await db.prepare('SELECT slug FROM journal WHERE slug = ?').bind(slug).first());
  if (!(await taken(base))) return base;
  for (let n = 2; n < 30; n += 1) {
    const candidate = `${base.slice(0, 76)}-${n}`;
    if (!(await taken(candidate))) return candidate;
  }
  throw new Error(`Thirty posts already share the slug "${base}".`);
}

/** The fields a generated post is inserted with. */
interface AutoPost {
  slug: string;
  title: string;
  summary: string;
  tags: string[];
  readTime: string;
  body: string;
  day: string;
}

/**
 * Insert the post, as a draft or — when the owner's settings say so —
 * published.
 *
 * Written straight to D1 rather than through `POST /api/content`, because that
 * endpoint authenticates a *person* — it presents a GitHub token and asks whose
 * it is — and there is no person here. The rule that endpoint exists to enforce
 * still holds and is what this statement is written to keep: every column name
 * below is a literal in this file, none of them came from a caller, and every
 * value is a bound parameter. Nothing in the request reaches the statement at
 * all; the only inputs are the model's own text and the owner's settings row.
 */
async function insertPost(db: D1Database, post: AutoPost, status: 'draft' | 'published'): Promise<void> {
  await db
    .prepare(
      `INSERT INTO journal
         (slug, title, summary, date, tags, read_time, status, body_md, body_html, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
    .bind(
      post.slug,
      post.title,
      post.summary,
      post.day,
      JSON.stringify(post.tags),
      post.readTime || null,
      status,
      post.body,
      await renderBody(post.body),
    )
    .run();
  /* Same half of creation the editor's save gets: a generated post floats to
     the top of the entries list, where the author reads first, rather than
     under every post a saved order names. */
  await pinNewJournalPost(db, post.slug);
}

/** A `documents` singleton, or `{}`. */
async function readDoc(db: D1Database, slug: string): Promise<unknown> {
  const row = await db.prepare('SELECT json FROM documents WHERE slug = ?').bind(slug).first<{ json: string }>();
  if (!row) return {};
  try {
    return JSON.parse(row.json);
  } catch {
    return {};
  }
}

/** Record what this tick did. Best effort: a failed write must not mask why. */
async function writeRun(db: D1Database, run: AutoJournalRun): Promise<void> {
  await db
    .prepare(
      `INSERT INTO documents (slug, json, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(slug) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
    )
    .bind(AUTO_RUN_KEY, JSON.stringify(run))
    .run();
}

/**
 * Drain a streamed answer into its two channels.
 *
 * The job wants the whole text at once, which a non-streaming call would give
 * it more directly — and would also hand it a reasoning model's deliberation
 * mixed into `content`, with nothing between that and a published post but a
 * parser. Streaming and draining runs the answer through exactly the separation
 * every other surface gets: `delta` is the answer, `thinking` is not, and
 * `error` is a run that reported on itself. Decision 29 is not a property of
 * the browser, it is a property of the frame protocol.
 */
async function drain(stream: ReadableStream<Uint8Array>): Promise<{ text: string; error: string }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let error = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let frame: { delta?: string; error?: string };
      try {
        frame = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof frame.delta === 'string') text += frame.delta;
      /* Kept rather than thrown: a run that produced an answer *and* reported
         something is worth writing, and one that produced nothing needs the
         report as its reason. */
      if (typeof frame.error === 'string' && frame.error) error = frame.error;
    }
  }
  return { text, error };
}

/** Generate one post, or throw with a reason worth writing into the run record. */
async function compose(
  db: D1Database,
  providers: Provider[],
  settings: AutoJournalSettings,
  day: string,
): Promise<{ title: string; summary: string; tags: string[]; readTime: string; body: string }> {
  const task = ASSIST_TASKS.compose;
  const aiSettings = await getAiSettings(db);

  const tools = providers[0]?.toolsEnabled ? toolsFor('assist') : [];

  const [projects, caseStudies, posts, resume] = await Promise.all([
    getProjects(db),
    getCaseStudies(db),
    getPosts(db),
    getResume(db),
  ]);

  const messages = assistPrompt(task, {
    ownerName: site.name,
    /* Nothing on screen, because there is no screen. The task's context
       allowlist is satisfied with an empty draft, which is the same thing
       `/write-whole-post` sees when the author runs it on a blank editor. */
    context: {},
    instruction: autoInstruction(day, settings),
    corpus: buildIndex({ projects, caseStudies, posts, resume }),
    persona: aiSettings.persona,
    history: [],
    tools: tools.length ? toolSummary('assist') : '',
  });

  /* The model the owner configured for this job, when it is one of their own
     rows — the same lookup `/api/ai/assist` does, and for the same reason:
     a model id that was not already in `ai_providers` would be a value from a
     settings row deciding what the key pays for. */
  const wanted = settings.model.trim();
  const model = providers.some(p => modelsFor(p, 'assist').includes(wanted)) ? wanted : '';

  const call = {
    maxTokens: task.maxTokens,
    temperature: task.temperature,
    stream: true,
    /* Longer than the panel's sixty seconds. Nobody is watching this one, and a
       whole post on a slow model is the longest generation this site makes. */
    timeoutMs: 120_000,
    /* Low, and not negotiable here. The panel has a picker because an author
       sometimes wants a harder think; a job that runs while nobody is looking
       has no such moment, and every token of deliberation is billed against the
       same ceiling the post has to fit in. */
    effort: 'low' as const,
    ...(tools.length ? { tools } : {}),
    ...(model ? { model } : {}),
  };

  const first = await callChat(providers, { ...call, messages }, 'assist');
  if (!first.response.body) throw new Error('The model returned nothing.');

  const { text, error } = await drain(
    agentStream({
      first,
      which: 'assist',
      call,
      messages,
      runTool: (name, args) => runTool(db, name, args),
      maxCalls: MAX_TOOL_CALLS,
    }),
  );

  const parsed = parseFields(text, POST_KEYS);
  if (!parsed.recognised) {
    /* The same rule the editors follow: a response carrying no label at all is
       not salvaged as body text. That fallback is how a reasoning model's
       deliberation ended up inside a post — decision 29 — and an unattended job
       is the last place to reintroduce it. */
    throw new Error(error || 'The model answered in no recognisable shape.');
  }

  const title = parsed.values.title?.trim() ?? '';
  const body = parsed.values.body?.trim() ?? '';
  if (!title || !body) throw new Error(error || 'The post came back without a title or a body.');

  const summary = parsed.values.summary?.trim() ?? '';
  return {
    title,
    body,
    /* NOT NULL on the column, and a generated post is not worth failing an
       insert over one missing sentence. */
    summary: summary || `${title}.`.slice(0, 200),
    tags: (parsed.values.tags ?? '')
      .split(',')
      .map(tag => tag.trim())
      .filter(Boolean)
      .slice(0, 6),
    readTime: parsed.values.readTime?.trim() ?? '',
  };
}

export const POST: APIRoute = async ({ request, locals }) => {
  const { DB, CRON_SECRET } = locals.runtime.env;

  let caller: 'cron' | 'owner';
  try {
    caller = await authorise(request, CRON_SECRET);
  } catch (error) {
    return refusal(error) ?? json({ error: 'Unauthorized.' }, 401);
  }

  const body = (await request.json().catch(() => ({}))) as { force?: unknown };
  /* Only the owner may jump the schedule. A leaked cron secret that could also
     force a run would be a leaked secret that can spend the whole day's budget
     in a loop; one that can only ask "is it time yet" is worth much less. */
  const force = caller === 'owner' && body.force === true;

  const settings = clampAutoSettings(await readDoc(DB, AUTO_KEY));
  const run = clampAutoRun(await readDoc(DB, AUTO_RUN_KEY));

  const now = new Date();
  const verdict = decide(now, settings, run);

  if (!verdict.act && !force) {
    return json({ ok: true, status: 'skipped', reason: verdict.reason, day: verdict.day });
  }

  const providers = await usableProviders(DB);
  if (!providers.length) {
    return json(
      { ok: false, status: 'failed', reason: 'No AI provider is active and holding a key.' },
      503,
    );
  }

  /* Charged before the attempt, not after.
   *
   * The thing `maxAttempts` bounds is cost, and an attempt that is recorded
   * only on the way out is not recorded at all when the isolate is killed
   * mid-generation — which is precisely the expensive failure. Same reasoning
   * as the public rate limiter charging before the call and not refunding.
   *
   * A forced run is deliberately outside this: it is the owner pressing a
   * button, it is bounded by their patience, and spending the day's automatic
   * attempts on a test would leave the schedule with none. */
  const today = run.day === verdict.day ? run : { ...run, day: verdict.day, attempts: 0, slug: '' };
  if (!force) {
    await writeRun(DB, {
      ...today,
      attempts: today.attempts + 1,
      note: 'Generating…',
      at: now.toISOString(),
    });
  }

  try {
    const post = await compose(DB, providers, settings, verdict.day);
    const base = slugify(post.title);
    if (!base) throw new Error(`The title produced no usable slug: "${post.title}".`);
    const slug = await freeSlug(DB, base);
    const status = settings.publish ? 'published' : 'draft';

    await insertPost(DB, { ...post, slug, day: verdict.day }, status);

    /* The slug is what stops tomorrow's first tick writing a second post today,
        so it is written even for a forced run — a manual post still counts as
        the day's post. */
    await writeRun(DB, {
      day: verdict.day,
      attempts: force ? today.attempts : today.attempts + 1,
      slug,
      note: status === 'published' ? `Published "${post.title}".` : `Drafted "${post.title}".`,
      at: new Date().toISOString(),
    });

    return json({
      ok: true,
      status: 'written',
      postStatus: status,
      slug,
      title: post.title,
      day: verdict.day,
      edit: `${site.url}/admin/journal/${slug}`,
      ...(status === 'published' ? { live: `${site.url}/journal/${slug}` } : {}),
    });
  } catch (error) {
    const reason =
      error instanceof ProviderError || error instanceof Error
        ? error.message
        : 'The daily post failed.';

    await writeRun(DB, {
      ...today,
      attempts: force ? today.attempts : today.attempts + 1,
      note: reason.slice(0, 300),
      at: new Date().toISOString(),
    }).catch(() => {});

    /* A 502 rather than a 200, so the workflow's step goes red and the failure
       is visible in a place the owner already looks — the alternative is a job
       that reports success every hour while writing nothing for a week. */
    return json({ ok: false, status: 'failed', reason, day: verdict.day }, 502);
  }
};

/**
 * What the schedule would do right now, without doing it.
 *
 * Owner-only, and the AI screen's status line. It is a `GET` because it changes
 * nothing: a person opening the settings screen must not consume one of the
 * day's attempts by looking at it.
 */
export const GET: APIRoute = async ({ request, locals }) => {
  try {
    await requireOwner(request);
  } catch (error) {
    return refusal(error) ?? json({ error: 'Unauthorized.' }, 401);
  }

  const { DB, CRON_SECRET } = locals.runtime.env;
  const settings = clampAutoSettings(await readDoc(DB, AUTO_KEY));
  const run = clampAutoRun(await readDoc(DB, AUTO_RUN_KEY));
  const verdict = decide(new Date(), settings, run);

  return json({
    settings,
    run,
    /* Whether the schedule can reach this route at all. The setting can be on,
       the window sane and the model configured, and the whole thing still never
       fire because the secret was never set — which is invisible from every
       other field on the screen. */
    scheduled: Boolean(CRON_SECRET && CRON_SECRET.trim()),
    next: verdict.act ? 'Due now.' : verdict.reason,
  });
};
