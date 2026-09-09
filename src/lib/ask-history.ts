/**
 * Past public conversations, kept in this browser and nowhere else.
 *
 * The public API has no authenticated caller to file a transcript under —
 * unlike the admin panel, which stores its own threads in D1 — so
 * `localStorage` is the only shelf available, and the history view says so
 * out loud. This module is the whole of that shelf: shape, caps, and
 * pruning, with no DOM in it, which is what makes it testable without a
 * browser (`scripts/test-ai.mjs` pins it). `src/lib/ask-widget.ts` owns the
 * rendering and calls in here for everything it remembers.
 *
 * Everything is best-effort by contract: denied or full storage degrades to
 * memory-only for the page, and a corrupt entry reads as no history rather
 * than a throw. Callers never need their own `try/catch` around these.
 */

export interface AskStoredTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AskStoredChat {
  id: string;
  title: string;
  updatedAt: number;
  turns: AskStoredTurn[];
}

export const ASK_CHATS_KEY = 'om-ask-chats';
export const ASK_CURRENT_KEY = 'om-ask-current';

/** Threads kept. A visitor with more past conversations than this is keeping
    conversations they will never reopen; the oldest go first. */
export const MAX_CHATS = 20;
/** Turns per thread. Past this the server has long since trimmed the context
    anyway (`boundTurns`), so keeping more would be storage spent on text no
    answer is ever read against. */
export const MAX_TURNS = 60;
/** Characters per turn. A pasted log ten thousand characters long is kept as
    its opening slice — enough to recognise the thread by. */
export const MAX_TURN_CHARS = 4000;
/** Characters of the first question a thread is titled with. */
export const TITLE_CHARS = 60;

/** The storage surface these functions need. `localStorage` in the widget, a
    `Map` in tests. */
export interface AskStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const isTurn = (turn: unknown): turn is AskStoredTurn => {
  if (!turn || typeof turn !== 'object') return false;
  const { role, content } = turn as Record<string, unknown>;
  return (role === 'user' || role === 'assistant') && typeof content === 'string';
};

const isChat = (chat: unknown): chat is AskStoredChat => {
  if (!chat || typeof chat !== 'object') return false;
  const { id, turns } = chat as Record<string, unknown>;
  return typeof id === 'string' && Array.isArray(turns);
};

/**
 * Whatever was stored, as threads that can actually be shown.
 *
 * Defensive because the bytes are the visitor's own to corrupt — another
 * version's shape, a half-written quota failure, an extension's idea of a
 * joke. Garbage becomes an empty list; a thread with no turns is dropped
 * rather than rendered as a row that opens onto nothing.
 */
export function sanitizeChats(raw: unknown): AskStoredChat[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isChat)
    .map(chat => ({
      id: chat.id,
      title: typeof chat.title === 'string' && chat.title ? chat.title : 'Conversation',
      updatedAt: typeof chat.updatedAt === 'number' ? chat.updatedAt : 0,
      turns: chat.turns
        .filter(isTurn)
        .slice(-MAX_TURNS)
        .map(turn => ({ role: turn.role, content: turn.content.slice(0, MAX_TURN_CHARS) })),
    }))
    .filter(chat => chat.turns.length > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CHATS);
}

/** Read the threads, newest first. Never throws. */
export function readChats(store: AskStore): AskStoredChat[] {
  let raw: string | null = null;
  try {
    raw = store.getItem(ASK_CHATS_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    return sanitizeChats(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** Write the threads. A quota failure drops this write; the next exchange
    tries again rather than the conversation being lost mid-sentence. */
export function writeChats(store: AskStore, chats: AskStoredChat[]): void {
  try {
    store.setItem(ASK_CHATS_KEY, JSON.stringify(chats.slice(0, MAX_CHATS)));
  } catch {
    /* As above. */
  }
}

/**
 * File a thread at the front, newest first, capped.
 *
 * Pure — takes the list and returns the next one — so the widget reads,
 * upserts and writes without a second opinion about ordering.
 */
export function upsertChat(chats: AskStoredChat[], chat: AskStoredChat): AskStoredChat[] {
  return [chat, ...chats.filter(entry => entry.id !== chat.id)].slice(0, MAX_CHATS);
}

/** A live transcript, cut to what the shelf keeps. */
export function fileTurns(turns: AskStoredTurn[]): AskStoredTurn[] {
  return turns
    .slice(-MAX_TURNS)
    .map(turn => ({ role: turn.role, content: turn.content.slice(0, MAX_TURN_CHARS) }));
}

/** Drop one thread. Forgetting the open one is the caller's decision, not
    this one's — it only edits the list. */
export function forgetChat(chats: AskStoredChat[], id: string): AskStoredChat[] {
  return chats.filter(entry => entry.id !== id);
}

/** What to call a thread with no name yet: its first question, shortened. */
export function titleFor(
  turns: AskStoredTurn[],
  previous?: string,
  limit: number = TITLE_CHARS,
): string {
  if (previous) return previous;
  const first = turns.find(turn => turn.role === 'user');
  const text = first?.content.trim().slice(0, limit) ?? '';
  return text || 'Conversation';
}

/** Which thread was open, if the browser still admits to one. */
export function readCurrent(store: AskStore): string | null {
  try {
    return store.getItem(ASK_CURRENT_KEY);
  } catch {
    return null;
  }
}

/** Point at the open thread, or at none. Never throws. */
export function rememberCurrent(store: AskStore, id: string | null): void {
  try {
    if (id) store.setItem(ASK_CURRENT_KEY, id);
    else store.removeItem(ASK_CURRENT_KEY);
  } catch {
    /* As above. */
  }
}

/** A thread id. Lowercase hex and hyphens, like the admin panel's. */
export function newChatId(): string {
  return (
    crypto.randomUUID?.() ?? `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  ).toLowerCase();
}

/** `2 minutes ago`, `yesterday`, `12 Mar`. Short enough for a list row. */
export function ago(stamp: number, now: number = Date.now()): string {
  if (!stamp) return '';
  const minutes = Math.round((now - stamp) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(stamp).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
