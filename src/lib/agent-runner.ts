import {
  ProviderError,
  agentComplete,
  modelsFor,
  modelName,
  type Provider,
} from './ai';
import { buildIndex } from './ai-corpus';
import { MAX_TOOL_CALLS, runTool, toolSummary, toolsFor } from './ai-tools';
import { ASSIST_TASKS, assistPrompt } from './assist-tasks';
import {
  applyStep,
  assemblePost,
  clampRun,
  failStep,
  finishRun,
  isFinished,
  lockHeld,
  newRun,
  nextStep,
  sectionFields,
  type PostRun,
  type RunCaller,
  type RunStep,
} from './agent-runs';
import { getCaseStudies, getPosts, getProjects, pinNewJournalPost } from './content';
import { AUTO_RUN_KEY, autoInstruction, slugify, type AutoJournalSettings } from './journal-auto';
import { renderBody } from './markdown';
import { getResume } from './resume';
import { site } from './site';
import { record } from './log';

/**
 * The daily post as a run of steps — the server half.
 *
 * One `documents` row per UTC day, `run:journal-post:<day>`, written whole
 * after every step. `advance()` takes one step under a lock and returns; the
 * cron tick (`/api/ai/daily`) loops it until its budget is spent, and the
 * Journal screen (`/api/ai/runs`) calls it one step at a time.
 *
 * **The lock is a compare-and-set on the row's JSON.** Two callers reading the
 * same unlocked row and both writing a lock would both believe they hold it;
 * an `UPDATE … WHERE json = ?` lets exactly one of them change a row. A lock
 * older than `LOCK_MS` is a killed isolate's and is taken over the same way.
 *
 * Every model step is non-streamed (`agentComplete()`): decision 61 — the
 * Workers Free plan's 10 ms of CPU is per-token work's enemy, and waiting on a
 * vendor is free. A step is over inside about four minutes whatever the vendor
 * does: `STEP_ATTEMPT_MS` bounds one attempt from request to last byte,
 * `STEP_BUDGET_MS` bounds when a lookup or another attempt may start.
 */

export const RUN_PREFIX = 'run:journal-post:';
export const runKey = (day: string): string => `${RUN_PREFIX}${day}`;
export const STEP_ATTEMPT_MS = 120_000;
export const STEP_BUDGET_MS = 240_000;
/** Rows older than this many days are swept on every save. */
const KEEP_DAYS = 3;

/* ---------- the row ---------- */

export async function loadRun(db: D1Database, day: string, now: Date): Promise<{ run: PostRun; raw: string | null }> {
  const row = await db.prepare('SELECT json FROM documents WHERE slug = ?').bind(runKey(day)).first<{ json: string }>();
  let parsed: unknown = null;
  try {
    parsed = row ? JSON.parse(row.json) : null;
  } catch {
    parsed = null;
  }
  return { run: row ? clampRun(parsed, day, now) : newRun(day, now), raw: row?.json ?? null };
}

/** Today's run, or `null` when none has started. Read-only. */
export async function peekRun(db: D1Database, day: string, now: Date): Promise<PostRun | null> {
  const { run, raw } = await loadRun(db, day, now);
  return raw === null ? null : run;
}

async function saveRun(db: D1Database, run: PostRun): Promise<void> {
  await db
    .prepare(
      `INSERT INTO documents (slug, json, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(slug) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
    )
    .bind(runKey(run.key), JSON.stringify(run))
    .run();
  const cutoff = new Date(Date.parse(`${run.key}T00:00:00Z`) - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  await db
    .prepare('DELETE FROM documents WHERE slug LIKE ? AND slug < ?')
    .bind(`${RUN_PREFIX}%`, runKey(cutoff))
    .run()
    .catch(() => {});
}

export async function dropRun(db: D1Database, day: string): Promise<void> {
  await db.prepare('DELETE FROM documents WHERE slug = ?').bind(runKey(day)).run();
}

/**
 * Take the lock, or `null` when someone else holds a live one.
 *
 * Atomic either way: a first run is an `INSERT … ON CONFLICT DO NOTHING`, an
 * existing one an `UPDATE` that matches only the JSON this caller read. A
 * `changes` of zero means another caller got there first.
 */
async function claim(db: D1Database, day: string, caller: RunCaller, now: Date): Promise<PostRun | null> {
  const { run, raw } = await loadRun(db, day, now);
  if (lockHeld(run, now)) return null;
  const locked: PostRun = { ...run, lock: { by: caller, at: now.toISOString() } };
  const json = JSON.stringify(locked);
  const result =
    raw === null
      ? await db
          .prepare(`INSERT INTO documents (slug, json, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(slug) DO NOTHING`)
          .bind(runKey(day), json)
          .run()
      : await db
          .prepare(`UPDATE documents SET json = ?, updated_at = datetime('now') WHERE slug = ? AND json = ?`)
          .bind(json, runKey(day), raw)
          .run();
  return (result.meta?.changes ?? 0) === 1 ? locked : null;
}

/* ---------- the post ---------- */

/** A slug no row has yet: the title's, or the title's with `-2`, `-3`… */
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

/**
 * Insert the finished entry.
 *
 * Straight to D1 rather than through `POST /api/content`, because that endpoint
 * authenticates a person and a cron tick is not one. The rule it enforces is
 * kept: every column name below is a literal, and every value is bound.
 */
async function insertPost(
  db: D1Database,
  post: { slug: string; title: string; summary: string; tags: string[]; readTime: string; body: string; day: string },
  status: 'draft' | 'published',
): Promise<void> {
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
  /* Best effort: the row exists now, and a failure here must not fail the
     step — a retried finish would insert the same entry a second time. */
  await pinNewJournalPost(db, post.slug).catch(() => {});
}

/**
 * The schedule's own record, kept in step with the run.
 *
 * `decide()` reads `attempts`, `slug` and `declined` from it, so a run's
 * failures *are* the day's attempts and a finished run stops the schedule —
 * with no change to `decide()` beyond `declined`.
 */
async function syncRecord(db: D1Database, run: PostRun): Promise<void> {
  const note =
    run.phase === 'done'
      ? `Wrote "${run.plan?.title ?? run.slug}".`
      : run.phase === 'declined'
        ? `Nothing new to write about: ${run.error ?? ''}`
        : run.phase === 'failed'
          ? `Gave up: ${run.error ?? 'too many failed steps'}`
          : `In progress: ${run.sections.length} of ${run.plan?.sections.length ?? '?'} sections written.` +
            (run.error ? ` Last step failed: ${run.error}` : '');
  await db
    .prepare(
      `INSERT INTO documents (slug, json, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(slug) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
    )
    .bind(
      AUTO_RUN_KEY,
      JSON.stringify({
        day: run.key,
        attempts: run.failures,
        slug: run.slug ?? '',
        note: note.slice(0, 500),
        at: run.updatedAt,
        declined: run.phase === 'declined',
      }),
    )
    .run();
}

/* ---------- one step ---------- */

export interface AdvanceOptions {
  providers: Provider[];
  auto: AutoJournalSettings;
  persona: string;
  caller: RunCaller;
  day: string;
  /** For tests. */
  now?: () => Date;
}

export type Advanced =
  | { status: 'busy'; run: PostRun | null }
  | { status: 'idle'; run: PostRun }
  | { status: 'stepped'; run: PostRun; step: RunStep; ok: boolean; note?: string };

/** What one model step wrote, or why it did not. */
async function modelStep(
  db: D1Database,
  run: PostRun,
  step: RunStep,
  options: AdvanceOptions,
): Promise<{ text: string; model: string } | { error: string; model: string }> {
  const { providers, auto } = options;
  const isPlan = step.kind === 'plan';
  const task = isPlan ? ASSIST_TASKS.journalplan : ASSIST_TASKS.journalsection;

  /* Only the plan looks things up, and only the plan carries the index: a
     section's facts are already in the plan. No repository tools — a cron tick
     holds no owner token, and `toolsFor()` without `repoAccess` drops them. */
  const tools = isPlan && providers[0]?.toolsEnabled ? toolsFor('assist') : [];
  let corpus = '';
  if (isPlan) {
    const [projects, caseStudies, posts, resume] = await Promise.all([
      getProjects(db),
      getCaseStudies(db),
      getPosts(db),
      getResume(db),
    ]);
    corpus = buildIndex({ projects, caseStudies, posts, resume });
  }

  const messages = assistPrompt(task, {
    ownerName: site.name,
    context: isPlan ? {} : sectionFields(run, step.index!),
    instruction: isPlan ? autoInstruction(run.key, auto) : '',
    corpus,
    persona: options.persona,
    history: [],
    tools: tools.length ? toolSummary('assist') : '',
  });

  /* The owner's chosen model only when it is one of their own rows. */
  const wanted = auto.model.trim();
  const model = providers.some(p => modelsFor(p, 'assist').includes(wanted)) ? wanted : '';
  let answered = modelName(providers[0]);

  try {
    const done = await agentComplete({
      providers,
      which: 'assist',
      call: {
        maxTokens: task.maxTokens,
        temperature: task.temperature,
        timeoutMs: STEP_ATTEMPT_MS,
        deadline: Date.now() + STEP_BUDGET_MS,
        effort: 'low',
        ...(tools.length ? { tools } : {}),
        ...(model ? { model } : {}),
      },
      messages,
      runTool: (name, args) => runTool(db, name, args),
      maxCalls: MAX_TOOL_CALLS,
    });
    answered = done.model;
    if (!done.text.trim()) {
      return {
        error: done.reasoning
          ? 'The model spent the step thinking and wrote nothing.'
          : 'The model finished without writing anything.',
        model: answered,
      };
    }
    /* Half a plan or half a section is not stored: the step is retried. */
    if (done.stopReason === 'length') return { error: 'The model hit the token ceiling mid-step.', model: answered };
    return { text: done.text, model: answered };
  } catch (error) {
    return {
      error: error instanceof ProviderError || error instanceof Error ? error.message : 'The step failed.',
      model: answered,
    };
  }
}

/**
 * Take one step of today's run, under the lock. Never throws for a bad answer
 * or a provider refusal — those are failed steps, saved and returned.
 */
export async function advance(db: D1Database, options: AdvanceOptions): Promise<Advanced> {
  const clock = options.now ?? (() => new Date());
  const claimed = await claim(db, options.day, options.caller, clock());
  if (!claimed) return { status: 'busy', run: await peekRun(db, options.day, clock()) };

  const { lock: _held, ...unlocked } = claimed;
  let run: PostRun = unlocked;
  const step = nextStep(run);
  if (!step || isFinished(run)) {
    await saveRun(db, run);
    return { status: 'idle', run };
  }

  const started = Date.now();
  const meta = () => ({ ms: Date.now() - started, model: '', now: clock(), maxAttempts: options.auto.maxAttempts });
  let ok = false;
  let note: string | undefined;

  try {
    if (step.kind === 'finish') {
      const post = assemblePost(run);
      const base = slugify(post.title);
      if (!base) throw new Error(`The title produced no usable slug: "${post.title}".`);
      const slug = await freeSlug(db, base);
      const status = options.auto.publish ? 'published' : 'draft';
      await insertPost(db, { ...post, slug, day: run.key }, status);
      run = finishRun(run, slug, meta());
      ok = true;
      note = `${status === 'published' ? 'Published' : 'Drafted'} "${post.title}".`;
    } else {
      const outcome = await modelStep(db, run, step, options);
      const m = { ...meta(), model: outcome.model };
      if ('error' in outcome) {
        run = failStep(run, step, outcome.error, m);
        note = outcome.error;
      } else {
        const before = run.failures;
        run = applyStep(run, step, outcome.text, m);
        ok = run.failures === before;
        note = ok ? undefined : run.error;
      }
    }
  } catch (error) {
    note = error instanceof Error ? error.message : 'The step failed.';
    run = failStep(run, step, note, meta());
  } finally {
    /* Saved without the lock whatever happened, so a crash in the step leaves
       a row the next caller can take — and the trail says what was tried. */
    await saveRun(db, run).catch(() => {});
  }

  await syncRecord(db, run).catch(() => {});
  await record(
    db,
    ok ? 'info' : 'error',
    'daily',
    `${step.label}: ${ok ? (note ?? 'done') : `failed — ${note}`}`,
    {
      day: run.key,
      step: step.id,
      phase: run.phase,
      failures: run.failures,
      caller: options.caller,
      ms: Date.now() - started,
      model: run.trail[run.trail.length - 1]?.model ?? '',
    },
  );
  return { status: 'stepped', run, step, ok, ...(note ? { note } : {}) };
}
