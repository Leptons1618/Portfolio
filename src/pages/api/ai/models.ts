import type { APIRoute } from 'astro';
import { json, refusal, requireOwner } from '../../../lib/authorize';
import { getProviders } from '../../../lib/ai';
import { normaliseModels } from '../../../lib/ai-catalog';

/**
 * What a provider will actually serve, asked of the provider.
 *
 * The AI screen used to have three free-text fields for model ids — the model,
 * the writing model, and the fallback list — which meant every one of them was
 * a spelling test whose only feedback was a 404 in front of a visitor. This is
 * the listing behind the picker that replaced them.
 *
 * **A proxy, not a passthrough.** The vendor's rows are rebuilt by
 * `normaliseModels()` into the seven fields this site has a use for. That is
 * partly hygiene — OpenRouter's listing is roughly a megabyte of JSON and most
 * of it is per-endpoint routing detail — and partly the same rule the rest of
 * this directory follows: what leaves the Worker is built here, key by key,
 * rather than forwarded because it happened to arrive.
 *
 * **The key never crosses.** It authenticates the outbound request and nothing
 * else; the response carries model ids and prices. Several vendors serve
 * `/models` unauthenticated, and this still sends the key where there is one,
 * because the listing a *paid* account sees is not always the public one.
 *
 * **Failure is a message, not a status.** A base URL that is wrong, a vendor
 * that has no `/models`, a local server that is not running — all of them are
 * ordinary states of a screen where the owner is still typing, and all of them
 * come back as `{ models: [], error: '…' }` with a 200 so the picker can say
 * what happened instead of the fetch throwing. The one exception is a caller
 * who is not the owner, which is a 401 like everywhere else.
 */

export const prerender = false;

/** Long enough for OpenRouter's list, short enough not to hold a Worker open. */
const TIMEOUT_MS = 15_000;

export const GET: APIRoute = async ({ request, locals }) => {
  try {
    await requireOwner(request);
  } catch (error) {
    return refusal(error) ?? json({ error: 'Unauthorized.' }, 401);
  }

  const { DB } = locals.runtime.env;
  const url = new URL(request.url);
  const slug = url.searchParams.get('slug') ?? '';

  /* Either an existing row, or a base URL typed into the dialog for a provider
     that has not been saved yet — which is the common case, because picking a
     model is something the owner wants to do *before* pressing Save. A typed
     URL brings no key with it; the vendors that need one for `/models` will say
     so, and that message is the useful answer. */
  const typed = url.searchParams.get('baseUrl')?.trim() ?? '';
  const provider = slug ? (await getProviders(DB)).find(p => p.slug === slug) : undefined;
  const baseUrl = (provider?.baseUrl ?? typed).trim().replace(/\/+$/, '');

  if (!baseUrl) {
    return json({ models: [], error: 'No base URL to ask. Pick a provider first.' });
  }
  if (!/^https?:\/\//i.test(baseUrl)) {
    return json({ models: [], error: 'The base URL must start with http:// or https://.' });
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (provider?.apiKey?.trim()) headers.Authorization = `Bearer ${provider.apiKey.trim()}`;

  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      return json({
        models: [],
        /* The vendor's own words, like the Test button. The reader is the owner
           and "invalid api key" is the whole diagnosis. */
        error: detail || `${baseUrl}/models answered ${response.status}.`,
      });
    }

    const payload = await response.json().catch(() => null);
    const models = normaliseModels(payload);
    return json({
      models,
      error: models.length ? undefined : 'That endpoint answered, but listed no models.',
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return json({
      models: [],
      error: timedOut
        ? `No answer from ${baseUrl}/models within 15 seconds.`
        : `Could not reach ${baseUrl}/models.`,
    });
  }
};
