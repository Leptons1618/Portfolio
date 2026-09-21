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
  /** Rows matching the filter, not only the ones on this page. */
  total: number;
  /** Rows in the whole table, against `cap`. */
  kept: number;
  cap: number;
  page: number;
}

export interface LogFilter {
  source?: string;
  level?: string;
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

const query = (filter: LogFilter & { before?: number; after?: number; id?: number }): string => {
  const params = new URLSearchParams();
  if (filter.source) params.set('source', filter.source);
  if (filter.level) params.set('level', filter.level);
  if (filter.before) params.set('before', String(filter.before));
  if (filter.after) params.set('after', String(filter.after));
  if (filter.id) params.set('id', String(filter.id));
  const qs = params.toString();
  return `/api/logs${qs ? `?${qs}` : ''}`;
};

/** One page, newest first. `before` reads the older page, `after` the newer. */
export const listLogs = (filter: LogFilter & { before?: number; after?: number } = {}): Promise<LogPage> =>
  call<LogPage>(query(filter));

/** Every row the filter matches, newest first — for the export. */
export async function listAllLogs(filter: LogFilter = {}): Promise<LogRow[]> {
  const rows: LogRow[] = [];
  let before: number | undefined;
  for (;;) {
    const page = await listLogs({ ...filter, before });
    rows.push(...page.rows);
    if (page.rows.length < page.page) return rows;
    before = page.rows[page.rows.length - 1].id;
  }
}

/** Remove what the filter shows — or, with no filter, everything. */
export const clearLogs = (filter: LogFilter = {}): Promise<{ ok: boolean; removed: number }> =>
  call(query(filter), { method: 'DELETE' });

export const deleteLog = (id: number): Promise<{ ok: boolean; removed: number }> =>
  call(query({ id }), { method: 'DELETE' });

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
