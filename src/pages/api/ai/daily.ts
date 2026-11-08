import type { APIRoute } from 'astro';
import { Unauthorized, json, refusal, requireOwner } from '../../../lib/authorize';
import { getAiSettings, usableProviders } from '../../../lib/ai';
import { advance, peekRun } from '../../../lib/agent-runner';
import { isFinished, summariseRun, type PostRun } from '../../../lib/agent-runs';
import {
  AUTO_KEY,
  AUTO_RUN_KEY,
  clampAutoRun,
  clampAutoSettings,
  decide,
} from '../../../lib/journal-auto';
import { site } from '../../../lib/site';

/**
 * The daily journal job.
 *
 * ## A run of steps, not one generation
 *
 * The post is written by `src/lib/agent-runner.ts` as a persisted run: plan,
 * one request per section, then assembly. A tick loops `advance()` until the
 * run is finished or `TICK_BUDGET_MS` is spent, and answers `in-progress` when
 * it stops early — the next tick continues from the step after the last one
 * that finished. A failed step is retried; the run's failures are the day's
 * attempts, so `decide()`'s `maxAttempts` still bounds what a bad day costs.
 * One generation used to have to survive the whole post in one request on the
 * free pool, and mostly did not.
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
 * to enforce is kept rather than borrowed — every column name in `insertPost`
 * (`agent-runner.ts`) is a literal in source, nothing from a request becomes a SQL identifier, and
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
 *     "Run now" button on the Journal screen's Daily journal tab, and it is how
 *     the feature is tested without waiting for an hour to come round.
 *
 * ## It writes a draft
 *
 * By default. The post appears in the admin's journal list with a Draft chip
 * and 404s for everyone else until the owner reads it and presses publish. An
 * unattended model with the owner's byline is exactly the thing decision 13
 * refuses to build, and a status column is what makes refusing it cheap. The
 * `publish` setting on the Journal screen's Daily journal tab is the owner
 * choosing otherwise.
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

/** A documents singleton, or `{}`. */
async function readDoc(db: D1Database, slug: string): Promise<unknown> {
  const row = await db.prepare('SELECT json FROM documents WHERE slug = ?').bind(slug).first<{ json: string }>();
  if (!row) return {};
  try {
    return JSON.parse(row.json);
  } catch {
    return {};
  }
}

/**
 * How long a tick keeps starting steps. A step already running may take four
 * minutes more (`STEP_BUDGET_MS`), and the workflow's `curl` waits ten.
 */
const TICK_BUDGET_MS = 300_000;

/** The response a run's state maps to. A failed day is a 502 so the workflow goes red. */
function answer(run: PostRun | null, day: string, extra: Record<string, unknown> = {}): Response {
  const work = run ? summariseRun(run) : null;
  if (!run) return json({ ok: true, status: 'busy', day, work, ...extra });
  if (run.phase === 'done') {
    return json({
      ok: true,
      status: 'written',
      slug: run.slug,
      title: run.plan?.title,
      day,
      edit: `${site.url}/admin/journal/${run.slug}`,
      work,
      ...extra,
    });
  }
  if (run.phase === 'declined') return json({ ok: true, status: 'declined', reason: run.error, day, work, ...extra });
  if (run.phase === 'failed') return json({ ok: false, status: 'failed', reason: run.error, day, work, ...extra }, 502);
  return json({ ok: true, status: 'in-progress', day, work, ...extra });
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
     in a loop; one that can only ask "is it time yet" is worth much less. A
     forced run ignores the clock, not the attempt ceiling: its failed steps
     are the day's failures like any other. */
  const force = caller === 'owner' && body.force === true;

  const auto = clampAutoSettings(await readDoc(DB, AUTO_KEY));
  const record = clampAutoRun(await readDoc(DB, AUTO_RUN_KEY));
  const started = Date.now();
  const verdict = decide(new Date(), auto, record);

  if (!verdict.act && !force) {
    return json({ ok: true, status: 'skipped', reason: verdict.reason, day: verdict.day });
  }

  const providers = await usableProviders(DB);
  if (!providers.length) {
    return json({ ok: false, status: 'failed', reason: 'No AI provider is active and holding a key.' }, 503);
  }
  const persona = (await getAiSettings(DB)).persona;

  let run: PostRun | null = null;
  let steps = 0;
  /* Settings and providers are read once per tick, not per step. */
  while (Date.now() - started < TICK_BUDGET_MS) {
    const step = await advance(DB, { providers, auto, persona, caller, day: verdict.day });
    if (step.status === 'busy') return answer(null, verdict.day, { work: step.run ? summariseRun(step.run) : null });
    run = step.run;
    if (step.status === 'idle' || isFinished(run)) break;
    steps += 1;
    /* A failed step waits for the next tick. Retrying it at once against a
       provider that is refusing would spend the day's attempts in a minute. */
    if (!step.ok) break;
  }
  return answer(run, verdict.day, { steps });
};

/**
 * What the schedule would do right now, without doing it — plus today's run.
 *
 * Owner-only, and the Daily journal tab's status line. A `GET` because it
 * changes nothing: looking at the screen must not consume one of the day's
 * attempts.
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
  const now = new Date();
  const verdict = decide(now, settings, run);
  const work = await peekRun(DB, verdict.day, now);

  return json({
    settings,
    run,
    /* Whether the schedule can reach this route at all. The setting can be on,
       the window sane and the model configured, and the whole thing still never
       fire because the secret was never set — which is invisible from every
       other field on the screen. */
    scheduled: Boolean(CRON_SECRET && CRON_SECRET.trim()),
    next: verdict.act ? 'Due now.' : verdict.reason,
    work: work ? summariseRun(work, now) : null,
  });
};
