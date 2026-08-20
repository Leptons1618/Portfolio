/**
 * Which model answers, on whose credential, and under what ceilings.
 *
 * This is the server half. `ai-corpus.ts` decides *what the model is allowed to
 * know*, `ai-guard.ts` decides *what it is allowed to be asked*, and this
 * decides *who it asks* — three files because they are three different failure
 * modes and only the first two are testable without a network.
 *
 * ## Why a provider is three strings
 *
 * OpenRouter, OpenAI, Groq, Together, DeepSeek, Mistral and a local llama.cpp
 * all accept the same `POST {base_url}/chat/completions` with the same body and
 * answer with the same SSE frames. So "support many providers" is not an
 * abstraction problem — it is a row with a URL in it. There is deliberately no
 * adapter interface here: the moment one is needed, the provider in question is
 * not OpenAI-compatible and wants its own module, not a slot in this one.
 *
 * ## The key never leaves the Worker
 *
 * `api_key` is the one secret this site has. Every read of it in this file goes
 * through `usableProviders()`, which is server-only, and the only thing that
 * ever happens to the value is that it becomes an `Authorization` header on an
 * outbound request. Nothing here returns it, and `maskKey()` exists so the
 * admin screen has something honest to show instead. `scripts/test-ai.mjs`
 * asserts that the shape the listing endpoint builds cannot carry it.
 *
 * ## Reasoning is not an answer, and it travels in its own channel
 *
 * A reasoning model's chain-of-thought is not output — it is the model talking
 * to itself, and it arrived on this site's public chat as "Here's a thinking
 * process:" followed by a numbered analysis of the visitor's own question, and
 * in the journal editor as eight hundred words of deliberation written straight
 * into the post body. `thinkStripper` below separates it — from `<think>`-family
 * tags, from `delta.reasoning`, and from bare narrated prose that marks itself
 * with nothing at all — and it leaves here as `{"thinking":…}` frames, never as
 * `{"delta":…}`.
 *
 * The separation is the guarantee, not the discarding. A UI shows thinking
 * behind a disclosure and the answer in the body; the authoring assistant
 * writes `delta` into the post and `thinking` into the panel. Nothing has to
 * decide which half it is looking at, which is what the old arrangement — one
 * `content` field carrying both — asked every reader to do. Decision 29.
 *
 * ## A ceiling has to clear the thinking, so the model's own maximum is it
 *
 * `max_tokens` bounds *thinking plus answer*, which is why a number sized to
 * the answer is a reasoning model that narrates for fifteen thousand characters
 * and stops before writing a word. `maxOutputTokens` on a provider row is what
 * the model can really be asked for — read off the vendor's own listing when a
 * model is picked — and `effectiveMaxTokens()` raises every task ceiling to it.
 * Nothing is billed for a ceiling that is not reached. Decision 37.
 *
 * ## The prompt is a stable prefix and then a question
 *
 * A prompt that varies at its opening caches nothing, so the builders emit the
 * unchanging half — rules, persona, content index — as one leading message
 * marked `cache`, and `wireMessages()` turns that into an Anthropic-style
 * breakpoint for the two APIs that read one. Everywhere else it is dropped and
 * the same bytes go out as a plain string, which is enough for the providers
 * that cache a repeated prefix implicitly.
 *
 * ## `agentStream()` runs the lookups, and its bounds are the design
 *
 * The bodies of posts and projects are no longer in the prompt: a model asks
 * for them through the closed, read-only table in `ai-tools.ts`, and the loop
 * at the bottom of this file is what runs them. It is bounded by rounds, by
 * total calls, and by *withdrawing the tools* once either runs out — a limit a
 * model is merely told about is a limit it asks past. Decision 37.
 */

import {
  MAX_OUTPUT_CEILING,
  clampEffort,
  clampOutputCeiling,
  clampParams,
  supportsCacheControl,
  type ReasoningEffort,
} from './ai-catalog';
import { site } from './site';

/* ---------- settings ---------- */

/** The singleton row in `documents` these live in. */
export const AI_SETTINGS_KEY = 'ai-assistant';

/**
 * Everything about the assistant that is not a credential.
 *
 * Stored as one JSON column for the same reason the resume is: it is read by
 * two endpoints, written whole by one screen, and normalising it would buy
 * per-field integrity that nothing queries.
 */
export interface AiSettings {
  /** The public chat answers only while this is true. Ships false. */
  enabled: boolean;
  /** Extra sentences appended to the scope prompt. Never replaces it. */
  persona: string;
  /** The first line in the panel, before anyone has typed. */
  greeting: string;
  /** Starter questions offered as chips. */
  suggestions: string[];
  maxQuestionChars: number;
  maxTurns: number;
  maxOutputTokens: number;
  perIpPerHour: number;
  perDayTotal: number;
  /**
   * How hard the public assistant is asked to think, or `null` for "send no
   * field and let the provider row decide".
   *
   * The one lever on this screen that acts on *thinking* rather than on the
   * total. `maxOutputTokens` bounds reasoning plus answer together, so it can
   * only ever say how much of the two there may be — never how the model
   * divides them, and a model set to deliberate hard will spend the whole
   * allowance on deliberation and truncate mid-sentence. Effort is the field
   * that moves the split. It ships `low` because this endpoint answers a
   * stranger's question out of an index and one or two pages: there is nothing
   * here to think hard about, and every token of thinking is billed and then
   * shown in a disclosure nobody opens.
   */
  reasoningEffort: ReasoningEffort | null;
}

/**
 * The ceilings the author's own settings are clamped to.
 *
 * These are not defaults — `DEFAULTS` below is that. These are the values a
 * saved setting cannot exceed, and they exist because the settings screen is
 * reachable by exactly one person whose mistake would be paid for by the
 * account, not by them. A form that can set `perIpPerHour` to 10000 is a form
 * that can hand a stranger the owner's balance.
 *
 * Clamping rather than refusing, deliberately: a number outside the range is
 * far more likely to be a typo than an attack, and silently doing the safe
 * thing beats a validation error on a field the author will just retype.
 */
const CEILINGS = {
  maxQuestionChars: 2000,
  maxTurns: 20,
  /* High enough to be raisable past a reasoning model's own appetite. A model
     that deliberates spends this budget *before* it writes anything — at 1500
     the whole ceiling went on thinking and the visitor got a truncated
     analysis of their own question, and at 4000 the same thing happened to a
     20B model that narrates for fifteen thousand characters before writing.
     The owner pays per token used, not per token allowed, so headroom here
     costs nothing and its absence is a dead answer. Decision 29.

     `MAX_OUTPUT_CEILING` is the same number, and they are the same number
     deliberately: this is the site's answer to "how large may one completion
     be", and having it in two places with two values is how a provider row
     ends up able to ask for more than the settings screen can. */
  maxOutputTokens: MAX_OUTPUT_CEILING,
  perIpPerHour: 60,
  perDayTotal: 2000,
} as const;

/** What an unconfigured site behaves like. Off, with sane copy. */
export const DEFAULTS: AiSettings = {
  enabled: false,
  persona: '',
  greeting: `Ask me anything about ${site.name.split(' ')[0]} — projects, writing, or background.`,
  suggestions: [],
  maxQuestionChars: 600,
  maxTurns: 8,
  /* Enough for a short answer *and* for a model that thinks before it writes.
     600 was sized to the answer alone, which is the assumption every reasoning
     model breaks; a provider row that names a model's real ceiling raises this
     further still — see `effectiveMaxTokens()`. */
  maxOutputTokens: 2000,
  perIpPerHour: 15,
  perDayTotal: 300,
  /* See the field's own comment. `low` rather than absent: absent means "send
     nothing", which hands the decision to whatever the vendor defaults to, and
     the vendors that default to anything default to more. */
  reasoningEffort: 'low',
};

const clampNumber = (value: unknown, fallback: number, max: number): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(Math.floor(n), max));
};

const strings = (value: unknown, limit: number): string[] =>
  Array.isArray(value) ? value.filter(v => typeof v === 'string' && v.trim()).slice(0, limit) : [];

/**
 * Whatever was in the JSON column, as settings that cannot hurt anyone.
 *
 * Every field is re-derived rather than spread, so a column holding a key that
 * was renamed, an extra key from a future version, or outright garbage produces
 * a working assistant on the defaults instead of a 500. The row is written by
 * one screen, but it is also the kind of row a person edits by hand in
 * `wrangler d1 execute` at midnight.
 */
export function clampSettings(raw: unknown): AiSettings {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const text = (key: keyof AiSettings, fallback: string, limit: number) => {
    const value = source[key];
    return typeof value === 'string' ? value.slice(0, limit) : fallback;
  };

  return {
    enabled: source.enabled === true,
    /* Capped because it is concatenated into every system prompt, and an
       unbounded one is an unbounded bill on every single question. */
    persona: text('persona', DEFAULTS.persona, 2000),
    greeting: text('greeting', DEFAULTS.greeting, 200),
    suggestions: strings(source.suggestions, 4).map(s => s.slice(0, 120)),
    maxQuestionChars: clampNumber(source.maxQuestionChars, DEFAULTS.maxQuestionChars, CEILINGS.maxQuestionChars),
    maxTurns: clampNumber(source.maxTurns, DEFAULTS.maxTurns, CEILINGS.maxTurns),
    maxOutputTokens: clampNumber(source.maxOutputTokens, DEFAULTS.maxOutputTokens, CEILINGS.maxOutputTokens),
    perIpPerHour: clampNumber(source.perIpPerHour, DEFAULTS.perIpPerHour, CEILINGS.perIpPerHour),
    perDayTotal: clampNumber(source.perDayTotal, DEFAULTS.perDayTotal, CEILINGS.perDayTotal),
    /* `clampEffort` answers `null` for anything that is not one of the three
       levels — which is also how the form says "leave it to the provider row",
       so an empty select and a garbage column land in the same, safe place. */
    reasoningEffort: clampEffort(source.reasoningEffort),
  };
}

/** The clamp ceilings, so the admin screen can print what it is capped at. */
export const SETTINGS_CEILINGS = CEILINGS;

/** Read the settings row, falling back to a disabled assistant. */
export async function getAiSettings(db: D1Database): Promise<AiSettings> {
  const row = await db
    .prepare('SELECT json FROM documents WHERE slug = ?')
    .bind(AI_SETTINGS_KEY)
    .first<{ json: string }>();
  if (!row) return { ...DEFAULTS };
  try {
    return clampSettings(JSON.parse(row.json));
  } catch {
    /* A corrupt settings row must not take the site's chat down *and* leave no
       trace of why — it takes it down safely, which is what `enabled: false`
       in the defaults means. */
    return { ...DEFAULTS };
  }
}

/* ---------- providers ---------- */

/** A row of `ai_providers`, key included. Never leaves this module. */
export interface Provider {
  slug: string;
  label: string;
  baseUrl: string;
  apiKey: string | null;
  model: string;
  assistModel: string | null;
  /**
   * Models to try, in order, when the one above will not answer.
   *
   * A vendor outage is rarely the whole vendor: it is one model returning 429
   * or 503 while the rest of the catalogue is fine. A second *provider* row
   * covers the first case and needs a second account and a second key; this
   * covers the second case with a list of strings on the row that already
   * exists. `callChat` walks models within a provider and then providers,
   * which is the order that costs least to recover from.
   */
  fallbackModels: string[];
  /**
   * Sampling parameters merged into every request to this provider.
   *
   * Already clamped against `PARAM_SPECS` by the time it is here — see
   * `clampParams()` in `ai-catalog.ts` and the comment on the column in
   * `migrations/0006_ai_params.sql`. Empty is the normal case and means "send
   * no sampling fields", which is not the same as sending each vendor's
   * documented defaults.
   */
  params: Record<string, number>;
  /**
   * The largest completion this provider's model will be asked for.
   *
   * Filled in from the vendor's own model listing when a model is picked on the
   * AI screen, and it **raises** every task's ceiling rather than capping it —
   * see `effectiveMaxTokens()`. `null` means "use whatever the task or the
   * settings asked for", which is what an unconfigured row does.
   */
  maxOutputTokens: number | null;
  /** `low` / `medium` / `high`, or `null` to send no effort field at all. */
  reasoningEffort: ReasoningEffort | null;
  /** Whether to mark a cache breakpoint on the stable half of the prompt. */
  promptCache: boolean;
  /** Whether this provider's model may be given the retrieval tools. */
  toolsEnabled: boolean;
  active: boolean;
  priority: number;
  updatedAt: string;
}

/** What the admin is allowed to see: everything except the key itself. */
export interface ProviderSummary {
  slug: string;
  label: string;
  baseUrl: string;
  model: string;
  assistModel: string | null;
  fallbackModels: string[];
  params: Record<string, number>;
  maxOutputTokens: number | null;
  reasoningEffort: ReasoningEffort | null;
  promptCache: boolean;
  toolsEnabled: boolean;
  active: boolean;
  priority: number;
  updatedAt: string;
  /** Whether a key is stored at all — the difference between "off" and "broken". */
  hasKey: boolean;
  /** `sk-or…9f2a`, or `null`. Enough to tell two keys apart, useless as one. */
  keyHint: string | null;
}

type ProviderRow = {
  slug: string;
  label: string;
  base_url: string;
  api_key: string | null;
  model: string;
  assist_model: string | null;
  fallback_models: string | null;
  params: string | null;
  max_output_tokens: number | null;
  reasoning_effort: string | null;
  prompt_cache: number | null;
  tools_enabled: number | null;
  active: number;
  priority: number;
  updated_at: string;
};

/**
 * The fallback list, from a column that may hold anything.
 *
 * Written as a JSON array by the `list` encoder in `content-schema.ts`, but
 * this is also a column a person edits in `wrangler d1 execute` at midnight, so
 * a comma-separated string parses too and garbage becomes an empty list rather
 * than an exception on every request.
 */
const parseModels = (raw: string | null | undefined): string[] => {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String).map(m => m.trim()).filter(Boolean);
  } catch {
    /* Not JSON. Fall through to the comma-separated reading. */
  }
  return raw.split(/[,\n]/).map(m => m.trim()).filter(Boolean);
};

const toProvider = (r: ProviderRow): Provider => ({
  slug: r.slug,
  label: r.label,
  baseUrl: r.base_url,
  apiKey: r.api_key,
  model: r.model,
  assistModel: r.assist_model,
  fallbackModels: parseModels(r.fallback_models),
  params: clampParams(r.params),
  /* Clamped on read, like `params` and for the same reason: what comes out of
     here becomes `max_tokens` in a request body, and the column is written by a
     form and editable by hand. */
  maxOutputTokens: clampOutputCeiling(r.max_output_tokens),
  reasoningEffort: clampEffort(r.reasoning_effort),
  /* Both default to on for a row written before the columns existed — the
     migration's DEFAULT covers new writes, and `null` here is the read of a
     row from a database that has not been migrated yet. */
  promptCache: r.prompt_cache !== 0,
  toolsEnabled: r.tools_enabled !== 0,
  active: r.active === 1,
  priority: r.priority,
  updatedAt: r.updated_at,
});

/**
 * Enough of a key to recognise, not enough to use.
 *
 * Four leading characters and four trailing, which distinguishes "the key I
 * pasted last week" from "the key I pasted this morning" without being a
 * meaningful fraction of the secret. A short key is reported as present and
 * nothing else — masking `sk-abc` by showing six of its characters is not
 * masking.
 */
export function maskKey(key: string | null | undefined): string | null {
  if (!key) return null;
  const trimmed = key.trim();
  if (trimmed.length < 12) return '••••';
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

/**
 * A provider as the admin listing may describe it.
 *
 * Built key by key and never by spreading the row, for the same reason the
 * OAuth Worker builds its token response that way: a spread carries whatever
 * was added to the source since anyone last looked, and the thing that would be
 * carried here is the credential. `scripts/test-ai.mjs` pins it.
 */
export const summarise = (p: Provider): ProviderSummary => ({
  slug: p.slug,
  label: p.label,
  baseUrl: p.baseUrl,
  model: p.model,
  assistModel: p.assistModel,
  fallbackModels: p.fallbackModels,
  /* Safe to show, unlike the key: these are knobs the same screen sets, and
     they have already been through the allowlist on the way out of the row. */
  params: p.params,
  maxOutputTokens: p.maxOutputTokens,
  reasoningEffort: p.reasoningEffort,
  promptCache: p.promptCache,
  toolsEnabled: p.toolsEnabled,
  active: p.active,
  priority: p.priority,
  updatedAt: p.updatedAt,
  hasKey: Boolean(p.apiKey && p.apiKey.trim()),
  keyHint: maskKey(p.apiKey),
});

/** Every configured provider, in the order they would be tried. */
export async function getProviders(db: D1Database): Promise<Provider[]> {
  const { results } = await db
    .prepare('SELECT * FROM ai_providers ORDER BY priority ASC, slug ASC')
    .all<ProviderRow>();
  return (results ?? []).map(toProvider);
}

/**
 * The providers that could actually answer, best first.
 *
 * Active *and* holding a key. A row missing its key is skipped rather than
 * tried, because trying it produces a 401 from the vendor and a visitor sees
 * "the assistant is unavailable" for a reason nobody can diagnose from the
 * outside. Returning an empty list is the honest state, and the endpoints
 * report it as "not configured".
 */
export async function usableProviders(db: D1Database): Promise<Provider[]> {
  return (await getProviders(db)).filter(p => p.active && p.apiKey && p.apiKey.trim());
}

/* ---------- the call ---------- */

/** A tool call a model asked for, assembled from its streamed fragments. */
export interface ToolCall {
  id: string;
  name: string;
  /** The model's own JSON, verbatim. Parsed by the caller, never by this file. */
  arguments: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /**
   * Mark this message as the end of the reusable prefix.
   *
   * Set on the one system message that is identical between requests — the
   * rules and the content index — and turned into an Anthropic-style
   * `cache_control` breakpoint by `callProvider`, but only for a provider whose
   * API reads them. Everywhere else it is dropped, and the same message goes
   * out as a plain string.
   *
   * A flag rather than the content-array shape itself, because the shape is a
   * wire detail of two vendors and the *intent* — "this part does not change" —
   * is what the prompt builders actually know.
   */
  cache?: boolean;
  /** `assistant` only: the calls it asked for. Sent back verbatim next round. */
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  /** `tool` only: which call this answers. */
  tool_call_id?: string;
  /** `tool` only: which tool answered. Some providers require it, none mind it. */
  name?: string;
}

/** The `tools` array, in the shape every OpenAI-compatible provider accepts. */
export interface ToolDefinition {
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
}

export interface CallOptions {
  messages: ChatMessage[];
  maxTokens: number;
  /** Low for the public chat — it is answering from a corpus, not composing. */
  temperature?: number;
  stream?: boolean;
  /** Bounds the upstream call so a hung vendor cannot pin a Worker invocation. */
  timeoutMs?: number;
  /** What the model may look up. Omitted entirely when there is nothing. */
  tools?: ToolDefinition[];
  /**
   * Overrides the provider row's effort for this call.
   *
   * The panel's picker writes here. `null` is meaningful and different from
   * absent: it is "send no effort field for this run", which is how a
   * conversation opts out of a provider-wide setting.
   */
  effort?: ReasoningEffort | null;
  /**
   * Use exactly this model, skipping the walk.
   *
   * Only ever set from a value that was already on the provider row — see
   * `pickModel()` in `/api/ai/assist`. A model id is a request-body field, and
   * one that came from a caller would be a caller choosing what the owner's key
   * pays for.
   */
  model?: string;
}

/** Raised when every usable provider refused. Carries a status for the route. */
export class ProviderError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
  }
}

const CHAT_TIMEOUT_MS = 30_000;

/**
 * One provider, one attempt.
 *
 * `HTTP-Referer` and `X-Title` are OpenRouter's attribution headers. They are
 * harmless everywhere else — an unknown header is ignored by every other
 * provider — and they are what makes the spend on OpenRouter's dashboard say
 * which site incurred it rather than appearing as an anonymous key.
 *
 * `X-Title` is built from `site.name`, which is the owner's own text and may
 * hold anything. A header value is a *ByteString*: one code point above 255 in
 * it makes `fetch()` throw `TypeError` before a request is ever sent, which
 * `callChat` below cannot distinguish from a provider being unreachable — so
 * every provider "fails", and the visitor is told the assistant could not
 * answer. That is not a hypothetical: the em dash this comment is written with
 * was in that template string, and it took the whole feature down on both
 * endpoints. `asciiHeader` is the guard, and it belongs here rather than in
 * `site.ts` because this is the only place a site field becomes a header.
 */

/**
 * Latin-1-safe, so a name with a dash, an accent or an emoji cannot throw.
 *
 * Exported only so `scripts/test-ai.mjs` can pin it against the real `site.name`
 * — the value that actually reaches the header, and the one a rename can break.
 */
export const asciiHeader = (value: string) => value.replace(/[^ -~]+/g, ' ').trim();

/**
 * What a model may be given for thinking *and* answering, over and above what
 * the caller asked for.
 *
 * A reasoning model spends `max_tokens` before it writes anything, so a ceiling
 * sized to the answer is a task that streams nothing — that is the failure
 * `ai_providers.max_output_tokens` was added to end, and this is how much
 * headroom ending it actually takes. Roughly a thousand tokens of deliberation
 * and three thousand of prose: enough for a model that narrates its way into a
 * long answer, and nowhere near a model's own maximum.
 *
 * The number matters because the raise used to go all the way to whatever the
 * vendor's listing reported. That made the Answer length field on the AI screen
 * decorative — a row filled in from a 32k model lifted every call to 32k
 * whatever the owner had typed, on the endpoint the owner cannot see being
 * used. "Nothing is billed for a ceiling that is not reached" is true, and it
 * is beside the point: a model told it has 32,000 tokens and asked to think
 * hard will use them, and *that* is billed.
 */
export const THINKING_HEADROOM = 4000;

/**
 * The ceiling one call actually gets.
 *
 * Three rules, in this order:
 *
 *   1. **The caller's number wins when it is larger.** A row holding 512 must
 *      not quietly shrink a task that needs 2,000 — that is the silent
 *      truncation this whole mechanism exists to end, reintroduced from the
 *      other direction.
 *   2. **A provider row raises a ceiling that is too small to work**, up to
 *      `THINKING_HEADROOM` and no further. The row says the model *accepts*
 *      more; it has never said the owner wants to pay for more.
 *   3. **Never past `MAX_OUTPUT_CEILING`**, whatever anything says.
 *
 * A task that genuinely needs a long answer says so in its own `maxTokens` and
 * gets it — `/write-whole-post` still asks for what it asks for. What no longer
 * happens is a two-line answer to a visitor being given a novel's worth of
 * budget to think in.
 */
export const effectiveMaxTokens = (provider: Provider, requested: number): number =>
  Math.min(
    Math.max(requested, Math.min(provider.maxOutputTokens ?? 0, THINKING_HEADROOM)),
    MAX_OUTPUT_CEILING,
  );

/**
 * The messages, in the shape this particular provider wants them.
 *
 * Two vendors read `cache_control` on a content *block*, which means the string
 * form every other provider takes has to become a one-element array for them
 * and stay a string everywhere else. Doing it here rather than in the prompt
 * builders is what keeps `assistPrompt()` and `scopePrompt()` free of any
 * knowledge of who is going to answer.
 *
 * Note the flag is dropped either way: `cache` is this repo's word and no
 * vendor has heard of it.
 */
function wireMessages(provider: Provider, messages: ChatMessage[]): unknown[] {
  const breakpoints = provider.promptCache && supportsCacheControl(provider.baseUrl);

  return messages.map(({ cache, ...message }) => {
    if (!cache || !breakpoints || !message.content) return message;
    return {
      ...message,
      content: [{ type: 'text', text: message.content, cache_control: { type: 'ephemeral' } }],
    };
  });
}

async function callProvider(
  provider: Provider,
  model: string,
  options: CallOptions,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? CHAT_TIMEOUT_MS);

  /* `undefined` on the row *and* on the call means "send nothing"; `null` on
     the call means "send nothing even though the row says otherwise". The
     distinction matters because an effort field is not free — a model with no
     notion of it may still reject the key. */
  const effort = options.effort === undefined ? provider.reasoningEffort : options.effort;

  try {
    return await fetch(`${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': site.url,
        'X-Title': asciiHeader(`${site.name} portfolio assistant`),
      },
      body: JSON.stringify({
        model,
        messages: wireMessages(provider, options.messages),
        max_tokens: effectiveMaxTokens(provider, options.maxTokens),
        /* Only when there is something to say. An empty `tools: []` is a body
           field several providers validate and one or two refuse, and it says
           nothing a missing field does not. */
        ...(options.tools?.length ? { tools: options.tools, tool_choice: 'auto' } : {}),
        ...(effort ? { reasoning_effort: effort } : {}),
        temperature: options.temperature ?? 0.3,
        stream: options.stream ?? false,
        /* The owner's tuning, last, so it wins.

           `temperature` above is what the *task* asked for — low for answering
           from a corpus, higher for drafting — and a provider that sets one
           here overrides all of them. That is the intended reading of a knob on
           the provider row: it is the setting for this endpoint, and a model
           that needs to be run at 0.2 needs it for every task.

           Nothing else in the body can be reached this way. The keys come from
           `PARAM_SPECS` in source and `max_tokens` is deliberately not one of
           them, so the ceiling above cannot be lifted from a settings screen —
           the same rule `clampSettings()` enforces one field up. */
        ...provider.params,
        /* Nothing is sent to suppress reasoning any more.

           This used to carry `reasoning: { exclude: true }` for OpenRouter, on
           the argument that a token never generated cannot leak. Two things
           were wrong with it. It did not work: the models that hurt narrate in
           `content`, which that switch has no reach into, so the leak it was
           meant to stop happened anyway and `thinkStripper()` is what actually
           catches it. And it was expensive in the one currency that mattered —
           the deliberation a reader is now *shown* was being generated, billed
           and then thrown away by the router before it ever reached this
           Worker, so the disclosure had nothing to open.

           Omitting the field is also one less body-field gamble: the request
           is now plain OpenAI-compatible JSON that no strict provider can
           refuse for a key it does not recognise. Decision 29. */
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The models to try for one provider, best first.
 *
 * The primary for the role, then whatever the row lists as fallbacks. De-duped,
 * because "the fallback is the same as the model" is the most likely thing to
 * be typed into that field and retrying the model that just refused is a wasted
 * round trip.
 */
export const modelsFor = (provider: Provider, which: 'chat' | 'assist'): string[] => {
  const primary = which === 'assist' && provider.assistModel ? provider.assistModel : provider.model;
  return [primary, ...provider.fallbackModels]
    .map(m => m?.trim())
    .filter((m, i, all): m is string => Boolean(m) && all.indexOf(m) === i);
};

/**
 * Every model any configured provider could be asked for, with its provider.
 *
 * The panel's model picker is built from this, and the endpoint validates a
 * caller's choice against it — which is what makes "the author picked a model"
 * a selection from the owner's own rows rather than a model id in a request
 * body. Ordered as they would be tried, so the first entry is the default.
 */
export const modelChoices = (providers: Provider[], which: 'chat' | 'assist') =>
  providers.flatMap(provider =>
    modelsFor(provider, which).map((model, index) => ({
      provider: provider.slug,
      label: provider.label,
      model,
      /* The one that would answer anyway, so a picker can say "default"
         against it rather than repeating the id in two places. */
      primary: index === 0,
    })),
  );

/**
 * Ask the first model that answers, walking models and then providers.
 *
 * Two nested walks, because there are two different outages. A model that is
 * overloaded, deprecated overnight or rate-limited on its own is the common
 * one, and the recovery for it is a second model on the same key — no second
 * account, no second row. A provider that is unreachable, out of credit or
 * holding a rejected key is the rarer one, and only a second row fixes that.
 *
 * `401` and `403` are the credential rather than the model, so they end that
 * provider's inner walk immediately: every model on it will refuse identically.
 * Everything else — `400` naming a model that does not exist, `402`, `404`,
 * `429`, a `5xx`, a timeout, a DNS failure — moves to the next model and then
 * to the next provider, which is the whole point of the table allowing more
 * than one of either.
 *
 * The `Response` is returned unread so the caller can stream it. Every early
 * return here has already consumed the error body, so nothing leaks a reader.
 */
export async function callChat(
  providers: Provider[],
  options: CallOptions,
  /** `assist` uses each provider's `assist_model` where it has one. */
  which: 'chat' | 'assist' = 'chat',
): Promise<{ response: Response; provider: Provider }> {
  if (!providers.length) {
    throw new ProviderError('No AI provider is configured and active.', 503);
  }

  let lastError = 'Every configured provider refused.';
  /* A 4xx from a model that was given tools is very often *about* the tools:
     a model with no function-calling support, a provider that validates the
     schema more strictly than the spec, a router that will not accept
     `tool_choice`. Recorded here and acted on after the walk, because it is
     only worth a second walk once the first has failed everywhere. */
  let refusedWithTools = false;

  for (const base of providers) {
    /* A model the caller chose, when it is one of this provider's own. The
       walk still runs — a chosen model that is rate-limited should fall
       through to the fallbacks rather than ending the answer. */
    const wanted = options.model && modelsFor(base, which).includes(options.model)
      ? [options.model, ...modelsFor(base, which).filter(m => m !== options.model)]
      : modelsFor(base, which);

    for (const model of wanted) {
      const provider = { ...base, model };

      let response: Response;
      try {
        response = await callProvider(provider, model, options);
      } catch (error) {
        /* An abort is the timeout above; anything else is DNS or transport.
           Both are worth trying the next model, then the next provider, for. */
        lastError = error instanceof Error && error.name === 'AbortError'
          ? `${base.label} (${model}) did not answer in time.`
          : `${base.label} (${model}) could not be reached.`;
        continue;
      }

      if (response.ok) return { response, provider };

      /* Read it here so the connection is released either way, and so the
         message below is the vendor's own rather than a status code.
         Truncated: an error body is occasionally an entire HTML page. */
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      lastError = `${base.label} (${model}) refused (${response.status}). ${detail}`.trim();

      if (options.tools?.length && response.status >= 400 && response.status < 500) {
        refusedWithTools = true;
      }

      /* The key, not the model. Trying its other models spends latency to
         collect the same 401 once per entry in the list. */
      if (response.status === 401 || response.status === 403) break;
    }
  }

  /* One more walk, without the tools, before giving up.

     A model that cannot be given tools is a configuration mistake with a
     recovery — answer from the index alone, which is what this endpoint did
     before retrieval existed — and it is not one the author should have to
     diagnose from "every provider refused". The provider row's `toolsEnabled`
     is the way to make it permanent; this is what makes the first request after
     a model change still produce an answer. */
  if (refusedWithTools) {
    const { tools, ...withoutTools } = options;
    return callChat(providers, withoutTools, which);
  }

  throw new ProviderError(lastError);
}

/**
 * Pull the assistant's text out of a non-streamed completion.
 *
 * Tolerant of shape because "OpenAI-compatible" is a spectrum: some providers
 * answer with `content` as an array of parts, and a couple put reasoning in a
 * sibling field. Anything unrecognised becomes an empty string rather than
 * `undefined` printed into a post.
 */
export function completionText(payload: unknown): string {
  const choice = (payload as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(part => (typeof part === 'string' ? part : ((part as { text?: string })?.text ?? '')))
      .join('');
  }
  return '';
}

/* ---------- reasoning ---------- */

/**
 * The tags a model wraps inline chain-of-thought in.
 *
 * Providers that *separate* reasoning put it in `delta.reasoning` (OpenRouter)
 * or `delta.reasoning_content` (DeepSeek's own API), and routing those is one
 * line. The models that hurt are the ones that emit thinking as **content** —
 * either fenced in one of these tags, or as bare prose ("Here's a thinking
 * process:") with nothing at all marking it. Both are handled below, and both
 * end in the same place: the `reasoning` half of the split, which the frame
 * protocol carries as `{"thinking":…}` and every UI shows collapsed beside the
 * answer rather than inside it.
 */
const THINK_OPEN = /<(?:think|thinking|thought|reason|reasoning|reflection|scratchpad|analysis)>/i;
const THINK_CLOSE = /<\/(?:think|thinking|thought|reason|reasoning|reflection|scratchpad|analysis)>/i;

/** `</scratchpad>` is the longest of them, at 13. Nothing longer can be partial. */
const TAG_MAX = 14;

/** A candidate tag start: `<`, an optional slash, then letters and nothing else. */
const PARTIAL_TAG = /^<\/?[a-zA-Z]*$/;

/**
 * How a model that marks nothing opens its chain-of-thought.
 *
 * Tested **once**, against the first line (or first ninety characters) of the
 * content and never again, which is what keeps this from reclassifying an
 * answer halfway through. Every pattern here is an opener a model that is
 * *answering* would not use: an assistant told to be brief and to start at the
 * first character of the answer does not begin "The user is asking", and the
 * writing assistant is told in as many words never to begin with "Here's my
 * thinking process".
 *
 * Deliberately short. A false positive hides real prose behind a disclosure —
 * recoverable, but wrong — so the rule is the one `screenQuestion()` follows:
 * precision over recall, and when in doubt leave it out. Anything not caught
 * here is treated as the answer, which is where this started.
 */
const NARRATION: RegExp[] = [
  /^\s*(?:here|this)\s*(?:'|’)?s?\s+(?:is\s+)?(?:my|a|the)\s+(?:thinking|thought|reasoning|analysis|plan)\b/i,
  /^\s*(?:thinking|thought|reasoning|analysis)\s*(?:process)?\s*:/i,
  /^\s*\**\s*(?:thinking|reasoning|thought process)\s*\**\s*$/i,
  /^\s*let\s*(?:'|’)?s?\s+(?:me\s+)?(?:think|analy|break\s+(?:this|it)\s+down|work\s+through|unpack|start\s+by)/i,
  /^\s*(?:okay|ok|alright|right|so)\s*,?\s+(?:let|i\s+need|first|the\s+user)\b/i,
  /^\s*the\s+user\s+(?:is\s+)?(?:asking|asks|wants|said|says|gave|provided)\b/i,
  /^\s*i\s+need\s+to\s+(?:analy|understand|figure|work\s+out|carefully|first)/i,
  /^\s*(?:first|step)\s*,?\s*(?:1\s*[.:)]|i\s+(?:need|should|must|will))/i,
];

/**
 * A complete line saying the deliberation is over and the answer starts.
 *
 * Line-anchored, which is why unmarked narration is routed a line at a time:
 * only a finished line can be tested, and holding back the partial one is the
 * whole of the state that needs. The line itself is a label rather than prose
 * and is dropped.
 */
const NARRATION_STOP =
  /^\s*(?:\**|#{1,6}\s*)?(?:final\s+answer|final\s+response|final|answer|response|output|result|draft|here(?:'|’)?s\s+the\s+\w+)\b\s*\**\s*:?\s*$/i;

/** A horizontal rule, which is how several models separate notes from output. */
const NARRATION_RULE = /^\s*(?:-{3,}|={3,}|\*{3,})\s*$/;

/**
 * A labelled field line — `TITLE:`, `READ TIME:`, `BODY:`.
 *
 * The strongest end-of-thinking signal the authoring assistant has, because a
 * `document` task's entire output contract is these labels (`POST_KEYS` and
 * friends in `assist-tasks.ts`). Unlike the two above, this line **is** the
 * answer's first line, so it is kept.
 */
const FIELD_LABEL = /^[A-Z][A-Z ]{1,14}:/;

/** Enough of the opening to decide on, when no newline arrives first. */
const HEAD_WINDOW = 90;

export interface ThoughtSplit {
  /** What belongs in the answer. */
  text: string;
  /** What the model was thinking. Shown beside the answer, never inside it. */
  reasoning: string;
}

const NOTHING: ThoughtSplit = { text: '', reasoning: '' };

/**
 * Prose that arrived *before* a tagged block, classified once.
 *
 * A model that marks its thinking has already said where its thinking is, so
 * the opening it wrote before the tag is almost always the answer — but not
 * always: "Here's my thinking process: <think>…" is a real shape, and without
 * this that first fragment would be the one line of narration that got through.
 * It is judged and routed, and narration mode is deliberately **not** entered:
 * after a tag, the tags govern.
 */
const judged = (opening: string): ThoughtSplit =>
  NARRATION.some(pattern => pattern.test(opening))
    ? { text: '', reasoning: opening }
    : { text: opening, reasoning: '' };

const both = (a: ThoughtSplit, b: ThoughtSplit): ThoughtSplit => ({
  text: a.text + b.text,
  reasoning: a.reasoning + b.reasoning,
});

/**
 * Split streamed content into prose and chain-of-thought, marked or not.
 *
 * Stateful across chunks, because it has to be: `<think>` is seven characters
 * and a TCP read can end after two of them. The carry buffer holds back any
 * trailing run that could still become a tag — which is why `split()` sometimes
 * returns less text than it was handed, and why `flush()` has to be called when
 * upstream ends or the last few characters of an answer go missing.
 *
 * The carry is restricted to a run of letters after the `<`, so a post
 * containing `a < b` is not held hostage waiting for a tag that never arrives.
 *
 * Two passes, in this order:
 *
 *   1. **Tags.** An opening tag with no closer swallows the remainder, which is
 *      correct: a model that opened one and then ran out of tokens produced no
 *      answer, and the caller's "it wrote nothing" is the honest report of it.
 *      A closing tag with no opener passes through as ordinary text.
 *   2. **Narration.** The opening of the *prose* is held back until a newline
 *      or ninety characters, then tested against `NARRATION` once. A match
 *      routes everything into `reasoning` a line at a time until a line says
 *      the answer has begun. This is what catches the model that writes "Here's
 *      a thinking process:" with no tag anywhere — the case the first three
 *      defences all miss, and the one that put a numbered analysis of a
 *      visitor's own question on the public site. A response carrying a tagged
 *      block is never sniffed: it has already said where its thinking is.
 *
 * The ninety-character delay applies once, to the first line of an answer, with
 * a thinking or waiting state on screen throughout it.
 *
 * Exported so `scripts/test-ai.mjs` can feed it a tag one character at a time,
 * which is the case that matters and the one no manual test will produce.
 */
export function thinkStripper() {
  let carry = '';
  let inTag = false;
  /** The opening prose, until there is enough of it to classify. */
  let head = '';
  let decided = false;
  let narrating = false;
  /** The partial last line, while narration is routed line by line. */
  let partial = '';

  /* Forward complete lines to `reasoning` until one of them ends the thinking. */
  const narrate = (text: string): ThoughtSplit => {
    let reasoning = '';
    partial += text;

    for (;;) {
      const cut = partial.indexOf('\n');
      if (cut === -1) return { text: '', reasoning };

      const one = partial.slice(0, cut);
      partial = partial.slice(cut + 1);

      if (FIELD_LABEL.test(one)) {
        /* The answer's own first line. Kept, along with everything after it. */
        narrating = false;
        const rest = `${one}\n${partial}`;
        partial = '';
        return { text: rest, reasoning };
      }
      if (NARRATION_STOP.test(one) || NARRATION_RULE.test(one)) {
        narrating = false;
        const rest = partial;
        partial = '';
        return { text: rest, reasoning };
      }
      reasoning += `${one}\n`;
    }
  };

  /* Classify the opening, once there is enough of it. */
  const settle = (): ThoughtSplit => {
    decided = true;
    const opening = head;
    head = '';
    if (!NARRATION.some(pattern => pattern.test(opening))) return { text: opening, reasoning: '' };
    narrating = true;
    return narrate(opening);
  };

  const route = (text: string): ThoughtSplit => {
    if (!decided) {
      head += text;
      /* A newline is enough to judge an opener by; ninety characters is the
         backstop for a model that writes its first paragraph unbroken. */
      if (head.length < HEAD_WINDOW && !head.includes('\n')) return NOTHING;
      return settle();
    }
    return narrating ? narrate(text) : { text, reasoning: '' };
  };

  return {
    split(chunk: string): ThoughtSplit {
      let buffer = carry + chunk;
      carry = '';
      let text = '';
      let reasoning = '';

      for (;;) {
        const match = (inTag ? THINK_CLOSE : THINK_OPEN).exec(buffer);
        if (!match) break;
        if (inTag) reasoning += buffer.slice(0, match.index);
        else text += buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        inTag = !inTag;
      }

      const open = buffer.lastIndexOf('<');
      if (open !== -1 && buffer.length - open < TAG_MAX && PARTIAL_TAG.test(buffer.slice(open))) {
        carry = buffer.slice(open);
        buffer = buffer.slice(0, open);
      }

      if (inTag) reasoning += buffer;
      else text += buffer;

      /* A tag settles the question the sniffer asks, so the opening still held
         back is released here rather than being stranded in `head` for the rest
         of the response — which is exactly what a first `<think>` arriving four
         characters into an answer used to do to the four characters. */
      if (reasoning && !decided) {
        decided = true;
        const opening = judged(head);
        head = '';
        text = opening.text + text;
        reasoning = opening.reasoning + reasoning;
      }

      return both({ text: '', reasoning }, route(text));
    },

    /** Whatever is still held back when upstream ends. */
    flush(): ThoughtSplit {
      const rest = carry;
      carry = '';
      if (inTag) {
        /* Still inside a block that never closed. Whatever preceded it is the
           only thing that could be an answer. */
        const opening = judged(head);
        head = '';
        return both(opening, { text: '', reasoning: rest + partial });
      }

      let out = route(rest);
      /* Nothing more is coming, so an undecided opening has to be judged on
         what there is — a two-word answer never reaches the window. */
      if (!decided) out = both(out, settle());

      const last = partial;
      partial = '';
      return both(out, narrating ? { text: '', reasoning: last } : { text: last, reasoning: '' });
    },
  };
}

/**
 * Turn an upstream SSE stream into newline-delimited JSON.
 *
 * The browser gets `{"delta":"…"}` per chunk of the answer, `{"thinking":"…"}`
 * per chunk of the model's deliberation, and `{"done":true}` at the end, which
 * is four lines of client code to read. The two text channels are separate all
 * the way down so no UI has to guess which is which: an answer renders, a
 * thought goes behind a disclosure, and nothing can put one where the other
 * belongs. Decision 29. Re-emitting the vendor's SSE
 * verbatim would work too, and would also forward whatever else the vendor
 * chose to put in a frame — model names, token accounting, occasionally the
 * whole request echoed back. This is a re-encode, not a proxy, and only the
 * text ever crosses.
 *
 * Errors mid-stream become a `{"error":…}` line rather than a torn connection:
 * the response status was already sent as 200 by then, so a thrown exception
 * shows a visitor a half-finished sentence and nothing else.
 *
 * ## `pull` must not return without enqueueing, and the loop below is why
 *
 * A `pull` that queues nothing is not called again. The stream machinery
 * re-pulls only if a *new* read request arrives while the pull is running, so a
 * pull that reads a chunk, finds nothing to emit and returns leaves the
 * consumer's pending `read()` unresolved for good — the response deadlocks with
 * the upstream socket still open and the tokens still being billed.
 *
 * That is not an edge case, it is the *first* case. The opening frame of every
 * OpenAI-compatible stream is `delta: {"role":"assistant"}` carrying no content;
 * a reasoning model then sends nothing but content-free frames for its entire
 * thinking phase, and several providers interleave keep-alive comments. Any one
 * of those landing alone in a TCP read used to hang the whole answer. So the
 * read sits in a loop that returns only once a line has been queued or upstream
 * has ended.
 */
export function ndjsonFromSSE(upstream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  return linesToStream(
    (async function* () {
      /* Carried to the end rather than emitted where it arrives. `length` is
         the difference between "the model had nothing more to add" and "the
         ceiling cut it off mid-sentence", and nothing else on either surface
         can tell those apart — so it rides on the `done` frame, which is the
         one every reader already waits for. */
      let stopReason = '';
      for await (const event of sseEvents(upstream)) {
        if (event.kind === 'stop') {
          stopReason = event.reason;
          continue;
        }
        const frame = frameFor(event);
        if (frame) yield frame;
      }
      yield stopReason ? { done: true, stopReason } : { done: true };
    })(),
  );
}

/* ---------- the decoder both stream builders run on ---------- */

/** One thing that happened upstream, already separated into its channel. */
type SseEvent =
  | { kind: 'thinking'; text: string }
  | { kind: 'delta'; text: string }
  | { kind: 'error'; message: string }
  | { kind: 'stop'; reason: string }
  /** Emitted once, at the end of a round, when the model asked to call something. */
  | { kind: 'tools'; calls: ToolCall[] };

/** The NDJSON line an event becomes, or `null` for the ones that are state. */
function frameFor(event: SseEvent): Record<string, unknown> | null {
  switch (event.kind) {
    case 'thinking':
      return { thinking: event.text };
    case 'delta':
      return { delta: event.text };
    case 'error':
      return { error: event.message };
    default:
      /* `stop` and `tools` are not text and belong to whoever is orchestrating
         the round; `ndjsonFromSSE` has no orchestrator and drops them. */
      return null;
  }
}

/**
 * One upstream SSE body, as a sequence of events.
 *
 * The decoding half of the old `ndjsonFromSSE`, lifted out so the tool loop can
 * run on exactly the same reader rather than on a second one written to match.
 * Everything it knew is still here: the buffer held across chunk boundaries
 * (a JSON payload split across two TCP reads is the normal case), the three
 * places reasoning arrives, and the tolerance for frames that are keep-alives
 * rather than JSON.
 *
 * What it adds is `tool_calls`, which arrive the same way text does — a name in
 * one frame and its arguments a character at a time across the next twenty —
 * and are therefore accumulated by `index` and yielded once, at the end.
 *
 * The generator's `finally` cancels the reader, so a consumer that stops
 * reading stops the tokens. That is the same guarantee the old `cancel()` gave
 * and it is the one that costs money to lose.
 */
async function* sseEvents(upstream: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder();
  const reader = upstream.getReader();
  const thoughts = thinkStripper();
  let buffer = '';
  /* The last non-empty `finish_reason` upstream sent. `length` is the one worth
     carrying: it is the difference between "the model had nothing more to add"
     and "the ceiling cut it off mid-sentence", and nothing else on either
     surface can tell those apart. */
  let stopReason = '';
  /* Keyed by the `index` every provider stamps on a tool-call fragment, because
     a model may ask for two things at once and the fragments interleave. */
  const calls = new Map<number, ToolCall>();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      /* SSE frames are separated by a blank line, but every provider observed
         puts one `data:` per frame, so splitting on newlines and ignoring
         everything that is not a `data:` is both simpler and more tolerant of
         the comment lines some send as keep-alives. The final partial line is
         kept for the next chunk. */
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const raw of lines) {
        const trimmed = raw.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') continue;

        let parsed: {
          choices?: {
            delta?: {
              content?: string;
              reasoning?: string;
              reasoning_content?: string;
              tool_calls?: {
                index?: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }[];
            };
            finish_reason?: string | null;
          }[];
          error?: { message?: string };
        };
        try {
          parsed = JSON.parse(data);
        } catch {
          /* A frame that is not JSON is a keep-alive or a vendor's own
             commentary. Skipping it is correct; failing on it is not. */
          continue;
        }

        if (parsed.error) {
          yield { kind: 'error', message: parsed.error.message ?? 'The model stopped.' };
          continue;
        }

        const choice = parsed.choices?.[0];
        if (choice?.finish_reason) stopReason = choice.finish_reason;

        for (const fragment of choice?.delta?.tool_calls ?? []) {
          const index = typeof fragment.index === 'number' ? fragment.index : 0;
          const call = calls.get(index) ?? { id: '', name: '', arguments: '' };
          /* First non-empty wins for the identifiers and everything
             concatenates for the arguments — which is exactly how the vendors
             send them, and the reason a tool call cannot be read frame by
             frame the way text can. */
          if (fragment.id) call.id = fragment.id;
          if (fragment.function?.name) call.name = fragment.function.name;
          if (fragment.function?.arguments) call.arguments += fragment.function.arguments;
          calls.set(index, call);
        }

        /* Reasoning arrives three ways and all three land in the same channel:
           `delta.reasoning` (OpenRouter), `delta.reasoning_content` (DeepSeek),
           and — through the stripper — thinking a model wrote into `content`,
           tagged or bare. It is its own event so a UI can show it collapsed; it
           is never mixed into `delta`, which is the answer. */
        const separated = choice?.delta?.reasoning || choice?.delta?.reasoning_content || '';
        const content = choice?.delta?.content;
        const split = thoughts.split(typeof content === 'string' ? content : '');
        const thinking = `${separated}${split.reasoning}`;

        if (thinking) yield { kind: 'thinking', text: thinking };
        if (split.text) yield { kind: 'delta', text: split.text };
      }
    }

    /* Whatever the tag guard was still holding back. A response that ends
       mid-`<thi` is not a tag, it is those four characters. */
    const tail = thoughts.flush();
    if (tail.reasoning) yield { kind: 'thinking', text: tail.reasoning };
    if (tail.text) yield { kind: 'delta', text: tail.text };

    const asked = [...calls.values()].filter(call => call.name);
    if (asked.length) yield { kind: 'tools', calls: asked };
    if (stopReason) yield { kind: 'stop', reason: stopReason };
  } finally {
    /* The visitor closed the panel or navigated away. Releasing the upstream
       reader is what stops the tokens — and the billing — rather than letting a
       completion nobody will read run to its natural end. */
    void reader.cancel().catch(() => {});
  }
}

/**
 * A sequence of JSON-able objects, as an NDJSON response body.
 *
 * `pull` enqueues exactly one line per call and never returns empty-handed,
 * which is the property the old hand-written `pull` needed a loop to maintain:
 * a pull that queues nothing is not called again, so the consumer's pending
 * `read()` never resolves and the response deadlocks with the upstream socket
 * still open and the tokens still billing. A generator that only yields lines
 * makes that unrepresentable rather than merely handled.
 */
function linesToStream(lines: AsyncGenerator<unknown>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await lines.next();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
      } catch (error) {
        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({ error: error instanceof Error ? error.message : 'Stream failed.' })}\n`,
          ),
        );
        controller.close();
      }
    },
    cancel() {
      void lines.return(undefined);
    },
  });
}

/* ---------- the tool loop ---------- */

/** What a tool run reports back. `text` goes to the model, `detail` to the UI. */
export interface ToolOutcome {
  text: string;
  detail: string;
  ok: boolean;
}

export interface AgentOptions {
  /** The provider that answered the first round, and its open response. */
  first: { response: Response; provider: Provider };
  /** For the rounds after the first. Pinned to the provider that answered. */
  which: 'chat' | 'assist';
  /** The call as it was made, minus the messages, which this rebuilds. */
  call: Omit<CallOptions, 'messages'>;
  /** The conversation as sent. Appended to, once per round of tool calls. */
  messages: ChatMessage[];
  runTool: (name: string, args: unknown) => Promise<ToolOutcome>;
  /** How many times the model may come back asking for more. */
  maxRounds?: number;
  /** How many tool calls one answer may make in total. */
  maxCalls?: number;
}

/**
 * Stream one answer, running whatever the model asks to look up along the way.
 *
 * This is the loop decision 31 declined to build, and it is worth being precise
 * about what changed and what did not. What that decision refused was a model
 * choosing **actions**: an endpoint on the owner's key where the next thing to
 * happen is whatever the model decided. What this does is let a model choose
 * **which published page to read**, out of a table of five read-only functions
 * that cannot reach a row a logged-out stranger could not already load. The
 * task table is still closed, nothing here writes, and a stolen session still
 * buys exactly what `curl` buys.
 *
 * The reason to do it at all is cost, and it is not marginal: the alternative
 * is the entire site in the system prompt of every message of every
 * conversation, which is what crowded a reasoning model's whole token ceiling
 * out with reference material it did not need — the failure that started this.
 *
 * Three bounds, and they are the design rather than defensive extras:
 *
 *   - **Rounds.** The model may come back `maxRounds` times. A model that wants
 *     one more after that is looping, and it is told so in a tool result rather
 *     than being cut off mid-sentence.
 *   - **Calls.** A hard total across all rounds, from `MAX_TOOL_CALLS`.
 *   - **The provider.** Later rounds go back to the provider *that answered*,
 *     not to the list. Half an answer from one vendor and half from another is
 *     not a fallback, it is two conversations spliced together.
 *
 * Every round is a fresh `thinkStripper()`, because the narration sniffing is a
 * judgement about the *opening* of a response and a second round is a second
 * opening.
 */
export function agentStream(options: AgentOptions): ReadableStream<Uint8Array> {
  /* No tools were sent, so there is no loop to run — one round, one encoder,
     and exactly the frames every reader already handles. Not an optimisation:
     it is what says out loud that the loop exists *only* for lookups, and it
     keeps `ndjsonFromSSE` the thing both paths agree the frame protocol is. */
  if (!options.call.tools?.length && options.first.response.body) {
    return ndjsonFromSSE(options.first.response.body);
  }
  return linesToStream(agentLines(options));
}

async function* agentLines(options: AgentOptions): AsyncGenerator<unknown> {
  const { first, which, runTool } = options;
  const maxRounds = options.maxRounds ?? 3;
  const maxCalls = options.maxCalls ?? 8;

  const messages = [...options.messages];
  let response = first.response;
  let spent = 0;
  let stopReason = '';
  /* Withdrawn rather than refused, once the budget is gone.

     Telling a model it is out of lookups and then handing it the tools again
     is a model that asks again, is told again, and is told again — a loop
     bounded only by the round count, every turn of it billed. Taking the
     `tools` field off the next request makes the last round *unable* to ask,
     which is the difference between a limit and a request to observe one. */
  let call = options.call;

  for (let round = 0; ; round += 1) {
    if (!response.body) {
      yield { error: 'The model returned nothing.' };
      return;
    }

    /* The answer text of this round, kept because a model that both spoke and
       asked for a tool has to have what it said carried into the next round —
       otherwise it repeats itself, having no record of having spoken. */
    let said = '';
    let asked: ToolCall[] = [];

    for await (const event of sseEvents(response.body)) {
      if (event.kind === 'delta') said += event.text;
      if (event.kind === 'stop') {
        stopReason = event.reason;
        continue;
      }
      if (event.kind === 'tools') {
        asked = event.calls;
        continue;
      }
      const frame = frameFor(event);
      if (frame) yield frame;
    }

    if (!asked.length) break;

    /* `tool_calls` is a stop reason, not a truncation. Carrying it into the
       `done` frame would have every surface report a complete answer as having
       been cut off by the ceiling. */
    if (stopReason === 'tool_calls') stopReason = '';

    /* It asked for something it was not offered — either a provider echoing
       the shape of a previous turn, or one that ignores the absence of the
       field after the budget was withdrawn above. There is nothing to run and
       nothing another round could add, so what it has already said is the
       answer. This is the termination guarantee: the loop cannot continue
       without tools, and the two budgets are the only things that grant them. */
    if (!call.tools?.length) break;

    if (round >= maxRounds) {
      /* Told, *and* disarmed. The model is given a plain answer about why its
         lookup did not run — one that knows it is out writes the best answer it
         has, where one that is simply stopped leaves a blank bubble — and the
         next request goes out with no `tools` field, so this is the last round
         whatever it would have preferred. */
      yield {
        tool: {
          id: 'limit',
          name: asked[0]?.name ?? 'tool',
          status: 'error',
          detail: `no more lookups (limit ${maxRounds})`,
        },
      };
      messages.push({ role: 'assistant', content: said, tool_calls: toolCallsFor(asked) });
      for (const wanted of asked) {
        messages.push({
          role: 'tool',
          tool_call_id: wanted.id,
          name: wanted.name,
          content:
            'You have reached the limit on lookups for this answer. Answer now from what you already have, and say plainly if something is missing.',
        });
      }
      const { tools, ...disarmed } = call;
      call = disarmed;
      response = await nextRound(messages, which, call, first.provider);
      continue;
    }

    messages.push({ role: 'assistant', content: said, tool_calls: toolCallsFor(asked) });

    for (const wanted of asked) {
      if (spent >= maxCalls) {
        messages.push({
          role: 'tool',
          tool_call_id: wanted.id,
          name: wanted.name,
          content: 'That is more lookups than one answer may make. Answer from what you have.',
        });
        /* Same reasoning as the round limit: a model that may still ask, will. */
        const { tools, ...disarmed } = call;
        call = disarmed;
        continue;
      }
      spent += 1;

      /* Announced before it runs, so a slow lookup reads as work rather than
         as a stall — the same reasoning as showing a model's deliberation
         while it deliberates. */
      const args = parseArguments(wanted.arguments);
      yield { tool: { id: wanted.id, name: wanted.name, args, status: 'running' } };

      const started = Date.now();
      let outcome: ToolOutcome;
      try {
        outcome = await runTool(wanted.name, args);
      } catch (error) {
        /* A tool that throws is this site's bug, and the model is told in
           words rather than the answer being abandoned: it can still say what
           it knows, and the alternative is a dead conversation. */
        outcome = {
          ok: false,
          text: `That lookup failed: ${error instanceof Error ? error.message : 'unknown error'}.`,
          detail: 'failed',
        };
      }

      yield {
        tool: {
          id: wanted.id,
          name: wanted.name,
          status: outcome.ok ? 'done' : 'error',
          detail: outcome.detail,
          ms: Date.now() - started,
        },
      };

      messages.push({
        role: 'tool',
        tool_call_id: wanted.id,
        name: wanted.name,
        content: outcome.text,
      });
    }

    response = await nextRound(messages, which, call, first.provider);
  }

  yield stopReason ? { done: true, stopReason } : { done: true };
}

/** The assistant turn to replay, in the shape the API expects it back. */
const toolCallsFor = (calls: ToolCall[]) =>
  calls.map(call => ({
    id: call.id,
    type: 'function' as const,
    function: { name: call.name, arguments: call.arguments || '{}' },
  }));

/**
 * A model's tool arguments, as an object.
 *
 * Never trusted: this is a third party's JSON, generated a token at a time and
 * truncated whenever the ceiling lands mid-object. Anything unparseable becomes
 * an empty object, which every tool in `ai-tools.ts` answers with a message
 * about what it needed rather than an exception.
 */
function parseArguments(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * The next round, on the provider that answered the first one.
 *
 * A single-element provider list rather than the full walk, and the element is
 * the provider *with the model that answered* already substituted in by
 * `callChat`. Falling through to a different vendor halfway through an answer
 * would mean the second half was written by a model that never saw the tool
 * results the first half asked for.
 */
async function nextRound(
  messages: ChatMessage[],
  which: 'chat' | 'assist',
  call: Omit<CallOptions, 'messages'>,
  provider: Provider,
): Promise<Response> {
  const { response } = await callChat([provider], { ...call, messages }, which);
  return response;
}
