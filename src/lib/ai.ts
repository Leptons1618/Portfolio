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
 */

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
  maxOutputTokens: 1500,
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
  maxOutputTokens: 600,
  perIpPerHour: 15,
  perDayTotal: 300,
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
  active: number;
  priority: number;
  updated_at: string;
};

const toProvider = (r: ProviderRow): Provider => ({
  slug: r.slug,
  label: r.label,
  baseUrl: r.base_url,
  apiKey: r.api_key,
  model: r.model,
  assistModel: r.assist_model,
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

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CallOptions {
  messages: ChatMessage[];
  maxTokens: number;
  /** Low for the public chat — it is answering from a corpus, not composing. */
  temperature?: number;
  stream?: boolean;
  /** Bounds the upstream call so a hung vendor cannot pin a Worker invocation. */
  timeoutMs?: number;
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

async function callProvider(provider: Provider, options: CallOptions): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? CHAT_TIMEOUT_MS);

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
        model: provider.model,
        messages: options.messages,
        max_tokens: options.maxTokens,
        temperature: options.temperature ?? 0.3,
        stream: options.stream ?? false,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask the first provider that answers, walking the list on failure.
 *
 * A 4xx that is not 429 stops the walk: a malformed request or a rejected key
 * will be rejected identically by the next provider, and retrying it just
 * spends latency to arrive at the same answer. A 429, a 5xx, a timeout or a
 * network error moves on — those are the failures a second provider actually
 * fixes, which is the entire reason the table allows more than one active row.
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

  for (const base of providers) {
    const provider =
      which === 'assist' && base.assistModel ? { ...base, model: base.assistModel } : base;

    let response: Response;
    try {
      response = await callProvider(provider, options);
    } catch (error) {
      /* An abort is the timeout above; anything else is DNS or transport. Both
         are worth trying the next provider for. */
      lastError = error instanceof Error && error.name === 'AbortError'
        ? `${provider.label} did not answer in time.`
        : `${provider.label} could not be reached.`;
      continue;
    }

    if (response.ok) return { response, provider };

    /* Read it here so the connection is released either way, and so the message
       below is the vendor's own rather than a status code. Truncated: an error
       body is occasionally an entire HTML page. */
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    lastError = `${provider.label} refused (${response.status}). ${detail}`.trim();

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable) break;
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

/**
 * Turn an upstream SSE stream into newline-delimited JSON.
 *
 * The browser gets `{"delta":"…"}` per chunk and `{"done":true}` at the end,
 * which is three lines of client code to read. Re-emitting the vendor's SSE
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
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const reader = upstream.getReader();
  let buffer = '';

  const line = (object: unknown) => encoder.encode(`${JSON.stringify(object)}\n`);

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        /* One turn per upstream chunk, returning the moment this pull has
           produced a line. Returning empty-handed is what stalls the stream. */
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            controller.enqueue(line({ done: true }));
            controller.close();
            return;
          }

          let emitted = false;
          buffer += decoder.decode(value, { stream: true });

          /* SSE frames are separated by a blank line, but every provider
             observed puts one `data:` per frame, so splitting on newlines and
             ignoring everything that is not a `data:` is both simpler and more
             tolerant of the comment lines some send as keep-alives. The final
             partial line is kept for the next chunk — a JSON payload split
             across two TCP reads is the normal case, not an edge one. */
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const raw of lines) {
            const trimmed = raw.trim();
            if (!trimmed.startsWith('data:')) continue;
            const data = trimmed.slice(5).trim();
            if (!data || data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data) as {
                choices?: { delta?: { content?: string } }[];
                error?: { message?: string };
              };
              if (parsed.error) {
                controller.enqueue(line({ error: parsed.error.message ?? 'The model stopped.' }));
                emitted = true;
                continue;
              }
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                controller.enqueue(line({ delta }));
                emitted = true;
              }
            } catch {
              /* A frame that is not JSON is a keep-alive or a vendor's own
                 commentary. Skipping it is correct; failing on it is not. */
            }
          }

          if (emitted) return;
        }
      } catch (error) {
        controller.enqueue(line({ error: error instanceof Error ? error.message : 'Stream failed.' }));
        controller.close();
      }
    },
    cancel() {
      /* The visitor closed the panel or navigated away. Releasing the upstream
         reader is what stops the tokens — and the billing — rather than letting
         a completion nobody will read run to its natural end. */
      void reader.cancel();
    },
  });
}
