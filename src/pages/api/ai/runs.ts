import type { APIRoute } from 'astro';
import { json, refusal, requireOwner } from '../../../lib/authorize';
import { getAiSettings, usableProviders } from '../../../lib/ai';
import { advance, dropRun, peekRun } from '../../../lib/agent-runner';
import { lockHeld, summariseRun } from '../../../lib/agent-runs';
import { AUTO_KEY, clampAutoSettings, dayOf } from '../../../lib/journal-auto';

/**
 * Today's daily-journal run, for the owner: read it, take one step, or discard it.
 *
 * One step per `POST`, not streamed: the Journal screen loops it and shows
 * progress between steps, and a non-streamed step costs one parse of CPU
 * however long the vendor deliberates (decision 61). Every body field is
 * matched against a literal — nothing here takes a prompt, a model, a slug or
 * a table — and the day is always today's, UTC.
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

export const GET: APIRoute = async ({ request, locals }) => {
  try {
    await requireOwner(request);
  } catch (error) {
    return refusal(error) ?? json({ error: 'Unauthorized.' }, 401);
  }
  const now = new Date();
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
  const body = (await request.json().catch(() => ({}))) as { kind?: unknown; action?: unknown };
  if (body.kind !== 'journal-post') return json({ error: 'Unknown run kind. Expected journal-post.' }, 400);
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
