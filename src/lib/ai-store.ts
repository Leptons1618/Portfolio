/**
 * The browser half of the AI screen, and the streaming reader both agents use.
 *
 * `content-store.ts` is the model this follows: every write is a
 * `POST /api/content` carrying the admin's GitHub token, through the same
 * tested column allowlist as a project or a post. Nothing here invents a second
 * write path, and the only thing this module adds on top is the one rule that
 * cannot live in a column map — **an untouched key field must not clear the
 * stored key**.
 *
 * Browser-only. The type imports are erased at compile time.
 */

import type { AiSettings, ProviderSummary } from './ai';
import { AI_SETTINGS_KEY } from './ai';
import type { ModelInfo } from './ai-catalog';
import { clampParams } from './ai-catalog';
import { ContentError, type WriteResult } from './content-store';
import { getToken } from './github';

export type { ProviderSummary, AiSettings };

/* ---------- reading ---------- */

export interface AiOverview {
  providers: ProviderSummary[];
  /** The stored settings, clamped — what the form edits. */
  settings: AiSettings;
  corpus: { chars: number; approxTokens: number };
  usage: { day: string; answered: number; activeCallers: number };
}

const authorized = (): HeadersInit => {
  const token = getToken();
  if (!token) throw new ContentError('Sign in with GitHub to manage AI settings.', 401);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
};

async function read<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, headers: authorized() });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new ContentError(data.error ?? `Request failed (${response.status}).`, response.status);
  }
  return data as T;
}

/** Providers (masked), settings, corpus size and today's usage, in one request. */
export const loadOverview = (): Promise<AiOverview> => read<AiOverview>('/api/ai/providers');

/**
 * What a provider will serve, for the picker.
 *
 * `error` is a *message*, not a failure: the endpoint answers 200 with an empty
 * list and a sentence for every ordinary reason a listing does not arrive — a
 * base URL still being typed, a local server that is not running, a key the
 * vendor will not accept. Throwing for those would mean the picker had to
 * distinguish "no models" from "could not ask", which is the one thing the
 * sentence already does.
 *
 * `baseUrl` is for a provider that has not been saved yet, which is the normal
 * way this is called: the dialog asks what models exist *before* there is a row
 * to ask about.
 */
export const listModels = (where: { slug?: string; baseUrl?: string }): Promise<{ models: ModelInfo[]; error?: string }> => {
  const query = new URLSearchParams();
  if (where.slug) query.set('slug', where.slug);
  if (where.baseUrl) query.set('baseUrl', where.baseUrl);
  return read<{ models: ModelInfo[]; error?: string }>(`/api/ai/models?${query.toString()}`);
};

export interface TestResult {
  ok: boolean;
  status?: number;
  ms: number;
  message: string;
}

/** Send one eight-token completion through a provider and report the result. */
export const testProvider = (slug: string): Promise<TestResult> =>
  read<TestResult>('/api/ai/providers', { method: 'POST', body: JSON.stringify({ slug }) });

/* ---------- writing ---------- */

/** A provider as the form edits it. `apiKey` absent means "leave it alone". */
export interface ProviderFields {
  label: string;
  baseUrl: string;
  model: string;
  assistModel?: string;
  /** Tried in order when `model` will not answer. Same key, same base URL. */
  fallbackModels?: string[];
  /**
   * Sampling parameters, as the form's number fields left them.
   *
   * Sent as a JSON string because the write endpoint has no object encoder —
   * `documents.json` is stored the same way, for the same reason. Clamped here
   * as well as on the server: the ranges are the same table either side, and a
   * form that sends a value it knows is out of range only to have it silently
   * corrected is a form that lies about what it saved.
   */
  params?: Record<string, number>;
  active: boolean;
  priority: number;
  /**
   * Only present when the author typed a new one.
   *
   * This is the rule the whole module exists for. The key field renders empty
   * with the stored fingerprint as its placeholder, because there is nothing to
   * render — the server never sends the key back. So an untouched field is an
   * empty string, and an empty string sent as `apiKey` writes NULL: editing a
   * provider's model would silently delete its credential and the next visitor
   * would get "the assistant is unavailable" with nothing on the screen having
   * gone wrong.
   *
   * `saveProvider()` therefore omits the key rather than sending `''`, and a
   * deliberate removal goes through `clearKey()` — which is a different button
   * that says what it does.
   */
  apiKey?: string;
}

async function write(
  slug: string,
  op: 'create' | 'patch' | 'delete',
  fields: Record<string, unknown> = {},
): Promise<WriteResult> {
  const response = await fetch('/api/content', {
    method: 'POST',
    headers: authorized(),
    body: JSON.stringify({ table: 'ai_providers', slug, op, fields }),
  });

  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new ContentError(data.error ?? `Save failed (${response.status}).`, response.status);
  }
  /* Unlike content, a provider has no public page. The AI screen is where it is
     readable, and the caller reloads the overview rather than following a link. */
  return { slug, url: '/admin/ai' };
}

/** Strip the key when it is blank, so an untouched field changes nothing. */
const payload = (fields: ProviderFields): Record<string, unknown> => {
  const { apiKey, params, ...rest } = fields;
  const body: Record<string, unknown> = { ...rest };
  if (apiKey && apiKey.trim()) body.apiKey = apiKey.trim();
  /* An empty object is written as `{}` rather than omitted: clearing every knob
     has to actually clear them, and the key rule above — omit rather than blank
     — exists for a credential that cannot be read back, which this is not. */
  if (params) body.params = JSON.stringify(clampParams(params));
  return body;
};

export const createProvider = (slug: string, fields: ProviderFields): Promise<WriteResult> =>
  write(slug, 'create', payload(fields));

export const saveProvider = (slug: string, fields: ProviderFields): Promise<WriteResult> =>
  write(slug, 'patch', payload(fields));

export const removeProvider = (slug: string): Promise<WriteResult> => write(slug, 'delete');

/** Turn one provider on or off without touching anything else about it. */
export const setProviderActive = (slug: string, active: boolean): Promise<WriteResult> =>
  write(slug, 'patch', { active });

/**
 * Delete the stored key, deliberately.
 *
 * The one place an empty `apiKey` is sent. It is a separate function with a
 * separate button because "I am removing this credential" and "I did not type
 * in this field" must never be the same gesture.
 */
export const clearKey = (slug: string): Promise<WriteResult> => write(slug, 'patch', { apiKey: '' });

/**
 * Save the assistant's settings.
 *
 * A patch on one row of `documents`, exactly like `saveResume` — same table,
 * same tested allowlist, same reason. The server clamps every number in it
 * again on read (`clampSettings`), so this form cannot lift its own ceilings
 * however it is edited.
 */
export async function saveAiSettings(settings: AiSettings): Promise<WriteResult> {
  const response = await fetch('/api/content', {
    method: 'POST',
    headers: authorized(),
    body: JSON.stringify({
      table: 'documents',
      slug: AI_SETTINGS_KEY,
      op: 'patch',
      fields: { json: JSON.stringify(settings) },
    }),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new ContentError(data.error ?? `Save failed (${response.status}).`, response.status);
  }
  return { slug: AI_SETTINGS_KEY, url: '/admin/ai' };
}

/* ---------- conversations ---------- */

/**
 * The authoring assistant's saved conversations.
 *
 * A thin wrapper over `/api/ai/chats`, and thin on purpose: every write is one
 * request, nothing is batched, and nothing is cached. A transcript is written a
 * message at a time while a reply streams, so the failure that matters is a
 * lost message rather than a slow one — and the way to lose one is to hold it
 * in a buffer waiting for company.
 *
 * Every call here is best-effort from the panel's point of view. Losing the
 * *record* of an exchange must never take the exchange itself down: the reply
 * is on screen and in the editor whether or not the row was written, so the
 * panel reports a save failure and carries on rather than throwing away a
 * finished run. See `remember()` in `assist-panel.ts`.
 */
export interface ChatSummary {
  id: string;
  surface: string;
  doc_slug: string | null;
  title: string;
  created_at: string;
  updated_at: string;
  messages: number;
}

export interface ChatMessageRow {
  id: number;
  role: 'user' | 'assistant' | 'note';
  content: string;
  thinking: string | null;
  task: string | null;
  created_at: string;
}

export const listChats = (surface: string): Promise<{ chats: ChatSummary[] }> =>
  read<{ chats: ChatSummary[] }>(`/api/ai/chats?surface=${encodeURIComponent(surface)}`);

export const loadChat = (id: string): Promise<{ chat: ChatSummary; messages: ChatMessageRow[] }> =>
  read<{ chat: ChatSummary; messages: ChatMessageRow[] }>(`/api/ai/chats?id=${encodeURIComponent(id)}`);

const chatWrite = (body: Record<string, unknown>): Promise<{ ok?: boolean }> =>
  read<{ ok?: boolean }>('/api/ai/chats', { method: 'POST', body: JSON.stringify(body) });

export const createChat = (
  id: string,
  surface: string,
  docSlug: string,
  title: string,
): Promise<{ ok?: boolean }> => chatWrite({ op: 'create', id, surface, docSlug, title });

export const appendMessage = (
  id: string,
  message: { role: 'user' | 'assistant' | 'note'; content: string; thinking?: string; task?: string },
): Promise<{ ok?: boolean }> => chatWrite({ op: 'append', id, ...message });

export const renameChat = (id: string, title: string): Promise<{ ok?: boolean }> =>
  chatWrite({ op: 'rename', id, title });

/** Replace a transcript with one summary of it. Destructive, and says so. */
export const compactChat = (id: string, summary: string): Promise<{ ok?: boolean }> =>
  chatWrite({ op: 'compact', id, summary });

export const deleteChat = (id: string): Promise<{ ok?: boolean }> => chatWrite({ op: 'delete', id });

/* ---------- streaming ---------- */

export interface StreamHandlers {
  onDelta: (text: string) => void;
  /**
   * A chunk of the model's deliberation.
   *
   * Its own channel, never mixed into `onDelta` — the server separates
   * `<think>`-family tags, `delta.reasoning` and bare narrated prose out of the
   * answer and sends them as `{"thinking":…}`. Show it behind a disclosure;
   * never write it into a field. See the header of `src/lib/ai.ts`.
   */
  onThinking?: (text: string) => void;
  /** Why the generation ended, when upstream said. `length` means truncated. */
  onDone?: (stopReason?: string) => void;
}

/**
 * Read an NDJSON stream from either AI endpoint.
 *
 * The server re-encodes the vendor's SSE into one JSON object per line
 * (`src/lib/ai.ts`), so this is a decoder, a split on newlines, and a held
 * remainder. The remainder matters: a chunk boundary lands mid-object often
 * enough that dropping the tail loses roughly one word in twenty, which reads
 * as a model with a stutter rather than as a bug.
 *
 * An `{"error":…}` line throws, so a failure that arrived *after* the 200 —
 * which is every upstream failure once streaming has started — surfaces the
 * same way as one that arrived before it.
 *
 * Returns the assembled text as well as streaming it, because most callers want
 * both: the editor renders progress and then inserts the whole thing.
 */
export async function readStream(response: Response, handlers: StreamHandlers): Promise<string> {
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ContentError(data.error ?? `The assistant failed (${response.status}).`, response.status);
  }
  if (!response.body) throw new ContentError('The assistant returned nothing.', 502);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const raw of lines) {
      if (!raw.trim()) continue;
      let frame: {
        delta?: string;
        thinking?: string;
        error?: string;
        done?: boolean;
        stopReason?: string;
      };
      try {
        frame = JSON.parse(raw);
      } catch {
        continue;
      }
      if (frame.error) throw new ContentError(frame.error, 502);
      if (frame.thinking) handlers.onThinking?.(frame.thinking);
      if (frame.delta) {
        text += frame.delta;
        handlers.onDelta(frame.delta);
      }
      if (frame.done) handlers.onDone?.(frame.stopReason);
    }
  }

  return text;
}

/**
 * Run one assistant task and stream its output back.
 *
 * `history` is the conversation so far, and it is the only thing about this
 * call that changed when the panel became a chat. It is optional because most
 * of the twelve commands do not want it — "suggest five titles" is a function
 * of the draft, not of what was said ten minutes ago — and the panel sends it
 * only for the ones that are conversational. The server caps and trims it; see
 * `/api/ai/assist`.
 */
export async function runAssist(
  task: string,
  context: Record<string, unknown>,
  instruction: string,
  handlers: StreamHandlers,
  signal?: AbortSignal,
  history?: { role: 'user' | 'assistant'; content: string }[],
): Promise<string> {
  const response = await fetch('/api/ai/assist', {
    method: 'POST',
    headers: authorized(),
    body: JSON.stringify({ task, context, instruction, history }),
    signal,
  });
  return readStream(response, handlers);
}
