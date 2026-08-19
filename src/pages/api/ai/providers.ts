import type { APIRoute } from 'astro';
import { json, refusal, requireOwner } from '../../../lib/authorize';
import { getAiSettings, getProviders, summarise } from '../../../lib/ai';
import { corpusSize, buildCorpus, buildIndex } from '../../../lib/ai-corpus';
import { usageToday } from '../../../lib/ai-guard';
import { getCaseStudies, getPosts, getProjects } from '../../../lib/content';
import { getResume } from '../../../lib/resume';

/**
 * What the admin's AI screen reads.
 *
 * Writing a provider does **not** go through here: it goes through
 * `POST /api/content` like every other row, against the same tested column
 * allowlist in `src/lib/content-schema.ts`. There is no second write path, and
 * that is deliberate — the endpoint that can put an identifier into a SQL
 * statement should be one endpoint with one test, not one per feature.
 *
 * What could not go through the existing route is the *read*, because the read
 * has an invariant no generic endpoint can carry: **the API key must never be
 * on the wire**. `summarise()` builds the response key by key so a column added
 * to `ai_providers` later cannot ride along, and `scripts/test-ai.mjs` asserts
 * that a provider holding a key produces a payload that does not contain it —
 * checked against the serialised JSON, not against the object, because that is
 * what actually leaves.
 *
 * The corpus statistics are here rather than on a route of their own because
 * they answer a question the same screen asks — "what will each question
 * cost?" — and because building the corpus needs the same four queries.
 */

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }) => {
  try {
    await requireOwner(request);
  } catch (error) {
    return refusal(error) ?? json({ error: 'Unauthorized.' }, 401);
  }

  const { DB } = locals.runtime.env;

  const [providers, settings, projects, caseStudies, posts, resume, usage] = await Promise.all([
    getProviders(DB),
    getAiSettings(DB),
    getProjects(DB),
    getCaseStudies(DB),
    getPosts(DB),
    getResume(DB),
    usageToday(DB),
  ]);

  const content = { projects, caseStudies, posts, resume };
  const corpus = buildCorpus(content);
  /* What a request actually carries now. The corpus is still measured beside
     it, because the difference between the two *is* the saving and a screen
     that reported only the smaller number would be a screen that could not
     show it. */
  const index = buildIndex(content);

  return json({
    providers: providers.map(summarise),
    /* The settings as *stored*, not as `/api/ai/status` reports them. That
       route answers "is the assistant ready", which folds the switch together
       with whether a provider exists — right for deciding whether to show a
       launcher, wrong for a form, where a switch that reads back off because
       no key is set yet would be a control that refuses to stay where it is
       put. This is the raw document, clamped. */
    settings,
    /* Size, never content. The admin can already read every page these are
       built from; shipping the assembled text would only be a large response
       nobody reads, and it is the exact string the model sees — worth keeping
       in one place rather than two. */
    corpus: corpusSize(corpus),
    index: corpusSize(index),
    usage,
  });
};

/**
 * Send one throwaway question to a provider and report what came back.
 *
 * A key is either right or it is not, and finding out by publishing the
 * assistant and asking a stranger to be the first caller is a poor test. This
 * is the smallest real request that proves the whole path: the stored key, the
 * base URL, the model name, and the vendor's willingness to serve this account.
 *
 * Deliberately a real completion rather than a `GET /models`: listing models
 * succeeds on several providers with a key that is not entitled to *inference*,
 * which is a green tick in front of a broken assistant. Eight tokens is a
 * fraction of a cent and answers the question actually being asked.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  try {
    await requireOwner(request);
  } catch (error) {
    return refusal(error) ?? json({ error: 'Unauthorized.' }, 401);
  }

  const { DB } = locals.runtime.env;

  const { slug } = (await request.json().catch(() => ({}))) as { slug?: string };
  const provider = (await getProviders(DB)).find(p => p.slug === slug);

  if (!provider) return json({ error: `No provider named "${slug ?? ''}".` }, 404);
  if (!provider.apiKey?.trim()) return json({ error: 'That provider has no API key stored.' }, 400);

  /* `callChat` is not used here on purpose. It walks the list on failure, which
     is right for answering a visitor and wrong for a test — the point is to
     learn whether *this* provider works, and a fallback that quietly succeeds
     would report a tick for a row that is still broken. */
  const started = Date.now();
  try {
    const response = await fetch(`${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
        max_tokens: 8,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const ms = Date.now() - started;

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 400);
      return json({
        ok: false,
        status: response.status,
        ms,
        /* The vendor's own words. This one *is* shown, unlike on the public
           route: the reader is the owner, and "insufficient credits" or "model
           not found" is precisely what they need in order to fix it. */
        message: detail || `The provider answered ${response.status}.`,
      });
    }

    return json({ ok: true, status: 200, ms, message: `${provider.model} answered in ${ms} ms.` });
  } catch (error) {
    const ms = Date.now() - started;
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return json({
      ok: false,
      ms,
      message: timedOut
        ? 'No answer within 15 seconds. Check the base URL.'
        : `Could not reach ${provider.baseUrl}.`,
    });
  }
};
