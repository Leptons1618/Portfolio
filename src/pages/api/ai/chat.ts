import type { APIRoute } from 'astro';
import { json } from '../../../lib/authorize';
import {
  ProviderError,
  agentStream,
  callChat,
  getAiSettings,
  usableProviders,
} from '../../../lib/ai';
import { buildIndex } from '../../../lib/ai-corpus';
import { MAX_TOOL_CALLS, runTool, toolSummary, toolsFor } from '../../../lib/ai-tools';
import {
  GuardError,
  boundTurns,
  callerKey,
  charge,
  dayStamp,
  scopePrompt,
  screenQuestion,
} from '../../../lib/ai-guard';
import { getCaseStudies, getPosts, getProjects } from '../../../lib/content';
import { getResume } from '../../../lib/resume';
import { site } from '../../../lib/site';

/**
 * The public assistant.
 *
 * The one endpoint on this site that a stranger can reach and that costs the
 * owner money, which shapes every decision in it. The order of the checks below
 * is the design, not an accident of writing: each one is cheaper than the next,
 * so the expensive work — reading the whole corpus out of D1, then calling a
 * vendor — happens only after everything that could refuse for free has
 * declined to.
 *
 *   1. Is the assistant switched on at all? One row.
 *   2. Is the request well-formed and within its caps? No I/O.
 *   3. Is it one of the misuse shapes that need no model to recognise? No I/O.
 *   4. Has this caller, or this day, run out of budget? Two writes.
 *   5. Is there a provider with a key? One query.
 *   6. Only now: build the index and call the model.
 *
 * `src/lib/ai-guard.ts` explains what this is and is not defending against, and
 * is honest that the scope prompt is the weakest of the three mechanisms. The
 * ones that hold are the budget in step 3 and the fact that step 6's index and
 * every tool behind it physically cannot contain unpublished content — see
 * `ai-corpus.ts` and `ai-tools.ts`.
 *
 * ## The prompt carries an index; the bodies are looked up
 *
 * This used to put the whole site in the system prompt of every message. That
 * is affordable once and absurd ten turns in, and on a model that deliberates
 * it is worse than absurd — the reference crowded out the token ceiling and the
 * answer never got written. The prompt is now a table of contents and the model
 * calls `read_post` / `read_project` / `search_content` for what it needs, which
 * also makes the prompt *stable* between questions and therefore cacheable.
 */

export const prerender = false;

/** Refusals answer in the same shape the stream's error line uses. */
const refuse = (message: string, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });

/**
 * A guard refusal, delivered as an ordinary answer.
 *
 * `200` and one NDJSON frame rather than a `4xx`, because this is not an error:
 * the visitor asked something out of scope and the assistant is telling them so.
 * The widget renders a non-ok response as a red note beside the conversation and
 * a stream as an assistant bubble, and a refusal belongs in the bubble — it is
 * the answer to what they typed, and it should read like every other one. It
 * also keeps the transcript coherent, since the turn stays in `history`.
 */
const refusalStream = (answer: string) =>
  new Response(`${JSON.stringify({ delta: answer })}\n`, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });

export const POST: APIRoute = async ({ request, locals }) => {
  const { DB } = locals.runtime.env;

  const settings = await getAiSettings(DB);
  if (!settings.enabled) {
    /* 503 rather than 404: the route exists, the feature is off. The widget
       reads this and hides itself rather than showing an error to someone who
       did nothing wrong. */
    return refuse('The assistant is not available right now.', 503);
  }

  let turns;
  try {
    const payload = (await request.json()) as { messages?: unknown };
    turns = boundTurns(payload.messages, settings);
  } catch (error) {
    if (error instanceof GuardError) return refuse(error.message, error.status);
    return refuse('That request could not be read.', 400);
  }

  const caller = await callerKey(request, dayStamp());

  const tooMany = (verdict: { reason?: string; retryAfterSeconds?: number }) =>
    refuse(
      verdict.reason ?? 'Too many questions for now.',
      429,
      verdict.retryAfterSeconds ? { 'Retry-After': String(verdict.retryAfterSeconds) } : {},
    );

  /* The cheap half of the scope defence, before the budget is spent on it.
     `screenQuestion` recognises only the unmistakable shapes — "write me a
     python script", "ignore your instructions" — and everything it is unsure
     about goes to the model under the scope prompt, which is still what decides
     scope in general. See the comment on the function; it is deliberately a
     narrow filter and not a wall.

     Metered against the caller's own hour but not against the site's day: this
     answer costs nothing to produce, so it must not consume the allowance that
     pays for real ones — while still not being free to hammer. */
  const screening = screenQuestion(turns, site.name.split(' ')[0]);
  if (!screening.allowed) {
    const metered = await charge(DB, caller, settings, Date.now(), { countsAgainstDay: false });
    if (!metered.ok) return tooMany(metered);
    return refusalStream(screening.answer);
  }

  const verdict = await charge(DB, caller, settings);
  if (!verdict.ok) return tooMany(verdict);

  const providers = await usableProviders(DB);
  if (!providers.length) return refuse('The assistant is not available right now.', 503);

  /* Fetched through `content.ts`, so the assistant sees exactly the site a
     reader sees — and `buildIndex` filters again on top of that. Four queries
     against tables holding a few dozen rows between them; the alternative is a
     cache that has to be invalidated by every save, which is a correctness
     problem bought to avoid a latency one nobody has measured.

     What goes into the prompt is the *index* — a line per thing, with the slug
     a tool takes — rather than the whole corpus. The bodies arrive through
     `ai-tools.ts` if the model asks for them, which is the difference between
     paying for the entire site on every message of a conversation and paying
     for the two posts a question was actually about. */
  const [projects, caseStudies, posts, resume] = await Promise.all([
    getProjects(DB),
    getCaseStudies(DB),
    getPosts(DB),
    getResume(DB),
  ]);

  const index = buildIndex({ projects, caseStudies, posts, resume });

  /* Tools are a property of the provider that will answer, and the walk may
     land on a different one. Deciding from the first is the honest
     approximation: they are almost always the same row, and `callChat` retries
     without tools if whichever one answers refuses the field. */
  const tools = providers[0]?.toolsEnabled ? toolsFor('chat') : [];

  const messages = [
    {
      role: 'system' as const,
      content: scopePrompt(site.name, index, settings.persona, tools.length ? toolSummary('chat') : ''),
      /* The whole of it is stable between questions — the rules do not change,
         and the index changes only when the author publishes something. Marking
         it is what lets a provider that reads cache breakpoints charge for this
         block once an hour rather than once a message. */
      cache: true,
    },
    ...turns,
  ];

  const call = {
    maxTokens: settings.maxOutputTokens,
    /* Low, and not configurable. This endpoint answers from a reference
       section; the useful failure mode is "I do not have that detail", and
       temperature is the dial that trades that for invention. */
    temperature: 0.2,
    stream: true,
    ...(tools.length ? { tools } : {}),
  };

  try {
    const first = await callChat(providers, { ...call, messages });

    if (!first.response.body) return refuse('The model returned nothing.', 502);

    return new Response(
      agentStream({
        first,
        which: 'chat',
        call,
        messages,
        runTool: (name, args) => runTool(DB, name, args),
        /* Tighter than the authoring assistant's. A visitor's question is
           answered from an index and one or two pages; a model taking four
           rounds over that is looping, and every round is billed. */
        maxRounds: 2,
        maxCalls: MAX_TOOL_CALLS,
      }),
      {
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          /* An answer is unique to its question and to whatever the content says
             right now. Nothing between here and the browser should keep it. */
          'Cache-Control': 'no-store',
          /* Cloudflare and some proxies buffer a response they think is complete;
             this is the conventional opt-out and is what keeps the reply
             appearing word by word rather than all at once at the end. */
          'X-Accel-Buffering': 'no',
        },
      },
    );
  } catch (error) {
    if (error instanceof ProviderError) {
      /* The vendor's own message is kept in the log, not in the response: it
         can name the model, the account and occasionally the key's prefix, and
         a visitor is owed none of that. */
      console.error('[ai/chat] provider failed:', error.message);
      return refuse('The assistant could not answer just now. Please try again.', 502);
    }
    console.error('[ai/chat] unexpected:', error);
    return refuse('Something went wrong.', 500);
  }
};

/** A `GET` here is someone exploring; say what the route is rather than 405ing blankly. */
export const GET: APIRoute = async () =>
  json({ error: 'Ask a question by POSTing { messages: [{ role, content }] }.' }, 405);
