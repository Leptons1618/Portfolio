/**
 * The browser half of the log: read it, clear it, and file a screen fault.
 *
 * Same shape as `ai-store.ts` — every call carries the GitHub token and every
 * refusal becomes a `ContentError` the screen can show. `reportFault()` is the
 * one writer here and it is *bounded*: the error boundary calls it, an error
 * boundary can fire in a loop, and a loop of faults must not become a loop of
 * D1 writes. Five per page view, then silence — the platform log still has
 * the rest, and the first five say what is wrong.
 */

import { ContentError } from './content-store';
import { getToken } from './github';
import type { LogRow } from './log';

export type { LogRow };

export interface LogPage {
  rows: LogRow[];
  total: number;
  cap: number;
  page: number;
}

const authorized = (): HeadersInit => {
  const token = getToken();
  if (!token) throw new ContentError('Sign in with GitHub to read the log.', 401);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
};

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, headers: authorized() });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new ContentError(data.error ?? `Request failed (${response.status}).`, response.status);
  return data as T;
}

export function listLogs(filter: { source?: string; level?: string; before?: number } = {}): Promise<LogPage> {
  const query = new URLSearchParams();
  if (filter.source) query.set('source', filter.source);
  if (filter.level) query.set('level', filter.level);
  if (filter.before) query.set('before', String(filter.before));
  const qs = query.toString();
  return call<LogPage>(`/api/logs${qs ? `?${qs}` : ''}`);
}

export const clearLogs = (): Promise<{ ok: boolean; removed: number }> =>
  call('/api/logs', { method: 'DELETE' });

let faultsFiled = 0;
const FAULT_CAP = 5;

/** File a screen fault, if signed in. Never throws, never more than five a page. */
export function reportFault(message: string, context: string): void {
  if (faultsFiled >= FAULT_CAP || !getToken()) return;
  faultsFiled += 1;
  void call('/api/logs', {
    method: 'POST',
    body: JSON.stringify({ message, context, path: window.location.pathname }),
  }).catch(() => {
    /* A fault about a fault is where this stops. */
  });
}
