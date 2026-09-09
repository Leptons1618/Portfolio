import type { APIRoute } from 'astro';
import { getAiSettings, usableProviders } from '../../../lib/ai';
import { callerKey, dayStamp, remainingFor } from '../../../lib/ai-guard';

/**
 * Whether the public pages should show a chat launcher at all.
 *
 * ## Why this exists rather than being decided at build time
 *
 * Most of this site is prerendered and served as static assets without waking
 * the Worker — that is the point of decision 18's arrangement, and it is the
 * reason a page costs nothing. But whether the assistant is switched on is a
 * *row*, changed from the admin with no build in between, and a prerendered
 * page cannot read a row. So the launcher's visibility is the one thing on a
 * public page that has to be asked for at runtime.
 *
 * The cost of that is bounded to **one request per browser session**: the
 * widget caches the answer in `sessionStorage` and never asks again until the
 * tab is closed. A visitor reading eight pages wakes the Worker once. Without
 * the cache it would be eight, on a site whose whole architecture is arranged
 * so that eight static pages wake it zero times, and that would be a real
 * regression traded for a launcher animating in a few milliseconds sooner.
 *
 * The response carries no secret and nothing per-visitor, so it is also
 * cacheable at the edge for five minutes — which is the second reason a
 * toggle in the admin takes a moment to reach every reader, and is short enough
 * that nobody notices.
 */

export const prerender = false;

export const GET: APIRoute = async ({ locals, request }) => {
  const { DB } = locals.runtime.env;
  const settings = await getAiSettings(DB);

  /* Both halves, because they fail differently and the widget must not appear
     for either. `enabled` is the author's switch; a usable provider is whether
     the switch is connected to anything. A launcher that opens onto "the
     assistant could not answer" is worse than no launcher. */
  const ready = settings.enabled && (await usableProviders(DB)).length > 0;

  /* How many questions this visitor has left, so the panel can say so before
     they spend one finding out. Read-only — `remainingFor()` increments
     nothing — and computed from the same hashed, daily-rotated caller key the
     limiter uses, so this endpoint learns no more about who is asking than the
     limiter already does. Skipped entirely when the assistant is off: there is
     no budget to report and no reason to touch the table. */
  const remaining = ready
    ? await remainingFor(DB, await callerKey(request, dayStamp()), settings)
    : 0;

  return new Response(
    JSON.stringify({
      enabled: ready,
      /* The visitor's own allowance, and the ceiling it is measured against —
         "4 of 15 left" needs both. A number that moves per caller is why this
         response stops being edge-cacheable below. */
      remaining,
      perIpPerHour: settings.perIpPerHour,
      /* Sent with the status so the panel has its copy before the first
         question — one round trip instead of two, and the greeting is not worth
         a request of its own. */
      greeting: ready ? settings.greeting : '',
      suggestions: ready ? settings.suggestions : [],
      maxQuestionChars: settings.maxQuestionChars,
    }),
    {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        /* `private`, and no longer shared-cacheable. This used to be five
           minutes at the edge because the body was identical for everyone;
           `remaining` is per-visitor, so a cached copy would hand one reader
           another reader's count. The browser may still hold it briefly — the
           widget caches it for the session anyway — but no shared cache may.
           The cost is that toggling the assistant off now reaches readers as
           soon as their next session rather than within five minutes. */
        'Cache-Control': 'private, max-age=30',
      },
    },
  );
};
