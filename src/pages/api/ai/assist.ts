import type { APIRoute } from 'astro';
import { json, refusal, requireOwner } from '../../../lib/authorize';
import {
  ProviderError,
  agentStream,
  callChat,
  getAiSettings,
  modelsFor,
  usableProviders,
  type Provider,
} from '../../../lib/ai';
import { clampEffort } from '../../../lib/ai-catalog';
import { buildIndex } from '../../../lib/ai-corpus';
import { MAX_TOOL_CALLS, runTool, toolSummary, toolsFor } from '../../../lib/ai-tools';
import { getCaseStudies, getPosts, getProjects } from '../../../lib/content';
import { getResume } from '../../../lib/resume';
import { ASSIST_TASKS, assistPrompt, isAssistTask } from '../../../lib/assist-tasks';
import { site } from '../../../lib/site';

/**
 * The journal writing assistant.
 *
 * The same providers as the public chat, and almost nothing else in common with
 * it. This one is behind `requireOwner()`, so there is no rate limiter, no
 * scope prompt, and no refusal to be creative — the whole point is to draft
 * something that does not exist yet, which is the opposite of what
 * `/api/ai/chat` is allowed to do.
 *
 * What it *is* careful about:
 *
 *   - **It never saves.** Every task returns text to the editor, and the author
 *     presses the same save button they always did. An agent that could write a
 *     row would be an agent that could publish, and nothing on this surface
 *     publishes without a person pressing a button — decision 13's reasoning
 *     applied to a machine.
 *   - **It is enabled independently of the public chat.** `settings.enabled`
 *     governs whether strangers may ask questions. Turning that off must not
 *     take away the author's own tools, so the only thing checked here is that
 *     a provider exists.
 *   - **The task list is closed.** `assistPrompt()` looks the task up; a task
 *     name that is not in the table is refused rather than treated as a prompt.
 *     Otherwise this route is an authenticated general-purpose model with the
 *     owner's key, reachable by anything that gets hold of a session — and
 *     "only the owner can call it" is a weaker claim than "there are eight
 *     things it can be asked to do".
 *
 * The `assistModel` on a provider row is used where set, so drafting can run on
 * a larger model than the one answering visitors, or a cheaper one.
 */

export const prerender = false;

interface AssistBody {
  task?: string;
  /** The post's current title, body, tags — whatever the task needs. */
  context?: Record<string, unknown>;
  /** Free-text steer from the author: "make it shorter", "focus on the API". */
  instruction?: string;
  /**
   * The conversation so far, oldest first.
   *
   * Sent only for the conversational tasks and trimmed by `assistPrompt` to the
   * last few turns. Every entry is text the owner's own browser wrote or
   * received, and it is re-shaped here rather than forwarded: a role that is
   * not `user` or `assistant` is dropped, so nothing in a stored transcript can
   * become a second `system` message.
   */
  history?: unknown;
  /**
   * Which of the configured models to run this on.
   *
   * Validated against the provider rows rather than trusted: `pickModel()`
   * below only ever returns a string that was already in `ai_providers`, so the
   * panel's picker is a *selection from the owner's own configuration* and not
   * a model id in a request body. The difference matters even behind
   * `requireOwner()` — a stolen session that could name any model could name an
   * expensive one.
   */
  model?: unknown;
  /** `low` / `medium` / `high`, or anything else for "use the row's setting". */
  effort?: unknown;
  /** `false` turns the lookup tools off for this run. */
  tools?: unknown;
}

/**
 * The caller's chosen model, if it is one this site is configured with.
 *
 * The panel offers a picker built from the same rows, so the normal case is a
 * value that matches. Anything else — a stale option from a provider that has
 * since been edited, or a model id somebody typed into a fetch — comes back
 * `null` and the walk runs as usual. That is the whole check, and it is the
 * reason this is a lookup rather than a validation: there is no pattern that
 * distinguishes a model this account may use from one it may not, and there is
 * a list that does.
 */
function pickModel(providers: Provider[], raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const wanted = raw.trim();
  const configured = providers.some(
    provider =>
      modelsFor(provider, 'assist').includes(wanted) || modelsFor(provider, 'chat').includes(wanted),
  );
  return configured ? wanted : null;
}

/** Whatever was in `history`, as turns a model may be given. */
function turns(raw: unknown): { role: 'user' | 'assistant'; content: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const entry of raw) {
    const turn = entry as { role?: unknown; content?: unknown };
    if (turn?.role !== 'user' && turn?.role !== 'assistant') continue;
    if (typeof turn.content !== 'string' || !turn.content.trim()) continue;
    out.push({ role: turn.role, content: turn.content });
  }
  return out;
}

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    await requireOwner(request);
  } catch (error) {
    return refusal(error) ?? json({ error: 'Unauthorized.' }, 401);
  }

  const { DB } = locals.runtime.env;

  const payload = (await request.json().catch(() => ({}))) as AssistBody;
  if (!isAssistTask(payload.task)) {
    return json({ error: `Unknown task. Expected one of: ${Object.keys(ASSIST_TASKS).join(', ')}.` }, 400);
  }
  const task = ASSIST_TASKS[payload.task];

  const providers = await usableProviders(DB);
  if (!providers.length) {
    return json(
      { error: 'No AI provider is active and holding a key. Configure one on the AI screen.' },
      503,
    );
  }

  const settings = await getAiSettings(DB);

  /* Tools go to the tasks that were given the index, and to conversation.
     A task that rewrites a selection has nothing to look up, and offering it
     tools is a round trip it will occasionally take anyway. */
  const wantsTools =
    payload.tools !== false &&
    (task.needsCorpus || payload.task === 'chat') &&
    Boolean(providers[0]?.toolsEnabled);
  const tools = wantsTools ? toolsFor('assist') : [];

  /* The author's own voice is the point of a writing assistant, and the only
     record of it this system has is what they have already published. Tasks
     that draft prose ask for it; the ones that reformat what is on screen do
     not, and skipping four queries and several thousand tokens for those is
     worth the flag.

     What they get is the *index* rather than the corpus. The corpus was every
     post's opening twelve hundred characters on every run — several thousand
     tokens of reference on a task whose ceiling then had to cover the thinking
     *and* the post. A model that wants to match the voice reads one post; a
     model that wants a fact reads the thing it is a fact about.

     Also built for a task that has tools but did not ask for the corpus, which
     is `chat`: the tools take a slug, and the index is the only list of slugs
     there is. Tools without it would be a model told never to invent a slug and
     given nowhere to find one. */
  let voice = '';
  if (task.needsCorpus || wantsTools) {
    const [projects, caseStudies, posts, resume] = await Promise.all([
      getProjects(DB),
      getCaseStudies(DB),
      getPosts(DB),
      getResume(DB),
    ]);
    voice = buildIndex({ projects, caseStudies, posts, resume });
  }

  const messages = assistPrompt(task, {
    ownerName: site.name,
    context: payload.context ?? {},
    instruction: typeof payload.instruction === 'string' ? payload.instruction.slice(0, 2000) : '',
    corpus: voice,
    persona: settings.persona,
    history: turns(payload.history),
    tools: tools.length ? toolSummary('assist') : '',
  });

  const model = pickModel(providers, payload.model);
  const effort = clampEffort(payload.effort);

  const call = {
    maxTokens: task.maxTokens,
    temperature: task.temperature,
    stream: true,
    /* Drafting a whole post is a longer generation than answering a
       question, and timing out at thirty seconds mid-outline would be the
       most annoying possible failure. */
    timeoutMs: 60_000,
    ...(tools.length ? { tools } : {}),
    ...(model ? { model } : {}),
    /* `undefined` leaves the provider row's setting alone; a value the panel
       sent replaces it for this run only. */
    ...(effort ? { effort } : {}),
  };

  try {
    const first = await callChat(providers, { ...call, messages }, 'assist');

    if (!first.response.body) return json({ error: 'The model returned nothing.' }, 502);

    return new Response(
      agentStream({
        first,
        which: 'assist',
        call,
        messages,
        runTool: (name, args) => runTool(DB, name, args),
        maxCalls: MAX_TOOL_CALLS,
      }),
      {
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Accel-Buffering': 'no',
        },
      },
    );
  } catch (error) {
    if (error instanceof ProviderError) {
      /* Shown in full, unlike on the public route. The reader is the owner and
         the vendor's message is the only thing that says which model name was
         wrong or which account is out of credit. */
      return json({ error: error.message }, error.status);
    }
    return json({ error: error instanceof Error ? error.message : 'Assist failed.' }, 500);
  }
};
