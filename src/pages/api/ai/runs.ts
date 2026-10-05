import type { APIRoute } from 'astro';
import { json, refusal, requireOwner } from '../../../lib/authorize';
import { getAiSettings, usableProviders } from '../../../lib/ai';
import { advance, dropRun, peekRun } from '../../../lib/agent-runner';
import { clampCaseStudyProgress, lockHeld, summariseRun } from '../../../lib/agent-runs';
import { AUTO_KEY, clampAutoSettings, dayOf } from '../../../lib/journal-auto';

/**
 * Two kinds of run, both owner-only.
 *
 * `journal-post` — today's daily-journal run: read it, take one step, or
 * discard it.
 *
 * `case-study` — a long case study's *progress*, keyed by project slug:
 * `save` stores the plan and finished sections after each one, `discard`
 * drops it, `GET` returns it. The writing stays in the browser; this is what
 * lets a reload resume it.
 *
 * A journal step is one `POST`, not streamed: the Journal screen loops it and
 * shows progress between steps, and a non-streamed step costs one parse of CPU
 * however long the vendor deliberates (decision 61). Every body field is
 * matched against a literal — nothing here takes a prompt, a model or a table.
 * The journal day is always today's, UTC; the one key a caller names is a
 * case study's project slug, which must match the slug shape and an existing
 * project before it becomes part of a row name.
 */

export const prerender = false;

async function readAuto(db: D1Database) {
  const row = await db.prepare('SELECT json FROM documents WHERE slug = ?').bind(AUTO_KEY).first<{ json: string }>();
  try {
    return clampAutoSettings(row ? JSON.parse(row.json) : {});
  } catch {
    return clampAutoSettings({});
  }
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const caseStudyKey = (slug: string) => `run:case-study:${slug}`;

export const GET: APIRoute = async ({ request, locals, url }) => {
  try {
    await requireOwner(request);
  } catch (error) {
    return refusal(error) ?? json({ error: 'Unauthorized.' }, 401);
  }
  const now = new Date();
  if (url.searchParams.get('kind') === 'case-study') {
    const slug = url.searchParams.get('key') ?? '';
    if (!SLUG.test(slug) || slug.length > 100) return json({ error: 'A project slug is required.' }, 400);
    const row = await locals.runtime.env.DB.prepare('SELECT json FROM documents WHERE slug = ?')
      .bind(caseStudyKey(slug))
      .first<{ json: string }>();
    let parsed: unknown = null;
    try {
      parsed = row ? JSON.parse(row.json) : null;
    } catch {
      parsed = null;
    }
    return json({ progress: clampCaseStudyProgress(parsed, now) });
  }
  const run = await peekRun(locals.runtime.env.DB, dayOf(now), now);
  return json({ run: run ? summariseRun(run, now) : null });
};

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    await requireOwner(request);
  } catch (error) {
    return refusal(error) ?? json({ error: 'Unauthorized.' }, 401);
  }
  const { DB } = locals.runtime.env;
  const body = (await request.json().catch(() => ({}))) as {
    kind?: unknown;
    action?: unknown;
    key?: unknown;
    progress?: unknown;
  };

  if (body.kind === 'case-study') {
    const slug = typeof body.key === 'string' ? body.key : '';
    if (!SLUG.test(slug) || slug.length > 100) return json({ error: 'A project slug is required.' }, 400);
    /* Only for a project that exists: the key is a row name, and an open one
       would let any string become a documents row. */
    const project = await DB.prepare('SELECT slug FROM projects WHERE slug = ?').bind(slug).first();
    if (!project) return json({ error: `No project named "${slug}".` }, 404);
    if (body.action === 'discard') {
      await DB.prepare('DELETE FROM documents WHERE slug = ?').bind(caseStudyKey(slug)).run();
      return json({ ok: true });
    }
    if (body.action !== 'save') return json({ error: 'Unknown action. Expected save or discard.' }, 400);
    const progress = clampCaseStudyProgress(body.progress, new Date());
    if (!progress) return json({ error: 'Nothing to save: the progress has no plan.' }, 400);
    await DB.prepare(
      `INSERT INTO documents (slug, json, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(slug) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
    )
      .bind(caseStudyKey(slug), JSON.stringify({ ...progress, updatedAt: new Date().toISOString() }))
      .run();
    return json({ ok: true });
  }

  if (body.kind !== 'journal-post') return json({ error: 'Unknown run kind. Expected journal-post or case-study.' }, 400);
  const now = new Date();
  const day = dayOf(now);

  if (body.action === 'discard') {
    const run = await peekRun(DB, day, now);
    if (run && lockHeld(run, now)) {
      return json({ error: 'A step is running right now. Discard it once that step finishes.' }, 409);
    }
    await dropRun(DB, day);
    return json({ ok: true, run: null });
  }

  if (body.action !== 'step') return json({ error: 'Unknown action. Expected step or discard.' }, 400);

  const providers = await usableProviders(DB);
  if (!providers.length) return json({ error: 'No AI provider is active and holding a key.' }, 503);

  const result = await advance(DB, {
    providers,
    auto: await readAuto(DB),
    persona: (await getAiSettings(DB)).persona,
    caller: 'owner',
    day,
  });

  if (result.status === 'busy') {
    return json(
      {
        error: 'The schedule is writing this post right now.',
        run: result.run ? summariseRun(result.run, now) : null,
      },
      409,
    );
  }
  return json({
    ok: result.status === 'idle' || result.ok,
    run: summariseRun(result.run),
    ...(result.status === 'stepped'
      ? { step: { id: result.step.id, label: result.step.label, ok: result.ok, note: result.note ?? null } }
      : {}),
  });
};
