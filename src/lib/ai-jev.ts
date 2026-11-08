import { getProviders, maskKey, type AiSettings, type Provider } from './ai';

/**
 * Jev — a typed decision model, asked once which kinds of context a
 * conversational run needs, so the answer model can be sent less.
 *
 * Jev answers yes/no questions with a probability rather than writing text
 * (OpenRouter's Decisions API, `POST /api/alpha/decisions`; the System One API
 * takes the same body). It is a **router, not a gate**: everything here can
 * only *narrow* what the route was already going to send. The tool list it
 * produces is intersected with `toolsFor()`'s (`ToolOptions.only`), so a
 * route can remove a tool and never add one; `runTool()` still validates every
 * call; and every failure — off, unconfigured, slow, malformed, unsure — falls
 * back to the full route the run would have had without it.
 *
 * What it is sent is the last four turns, capped, plus fixed descriptions of
 * the categories. Never a page body, a key or a repository file. What comes
 * back never reaches a visitor; the owner's log row keeps the route, the
 * probabilities and the usage, never the text. Decision record: the
 * 2026-10-05 design in `docs/superpowers/specs/`.
 */

export type JevCategory = 'work' | 'writing' | 'resume' | 'repo';

/** At or above: include the category. At or below: exclude it. Between: unsure. */
export const JEV_YES = 0.9;
export const JEV_NO = 0.1;
/** One attempt, shortened to what the run has left; never retried. */
export const JEV_TIMEOUT_MS = 3_000;
const JEV_TURNS = 4;
const JEV_STATE_CHARS = 3_000;

/** Which tools each category may keep. A route offers the union of its yeses. */
export const CATEGORY_TOOLS: Record<JevCategory, readonly string[]> = {
  work: ['search_content', 'read_project', 'read_case_study'],
  writing: ['search_content', 'read_post'],
  resume: ['read_resume'],
  repo: ['list_repo_files', 'read_repo_docs', 'read_repo_file'],
};

const QUESTIONS: Record<JevCategory, { instructions: string; criteria: { true: string; false: string } }> = {
  work: {
    instructions: 'Does a good answer need details of the projects or case studies published on this portfolio?',
    criteria: {
      true: 'It asks about something the owner built, a project, its stack or how it works, or a case study.',
      false: 'It does not depend on any particular project or case study.',
    },
  },
  writing: {
    instructions: 'Does a good answer need the journal posts published on this portfolio?',
    criteria: {
      true: 'It asks about something the owner wrote, a post, or what they think about a topic they wrote on.',
      false: 'It does not depend on anything the owner has written.',
    },
  },
  resume: {
    instructions: 'Does a good answer need the owner’s professional background?',
    criteria: {
      true: 'It asks about roles, employers, experience, skills, education or certifications.',
      false: 'It does not depend on the owner’s career history or skills.',
    },
  },
  repo: {
    instructions: 'Does a good answer need to read a project’s source code repository?',
    criteria: {
      true: 'It asks about code, files, a README or how something is implemented in a repository.',
      false: 'It can be answered without opening a repository.',
    },
  },
};

/* ---------- configuration ---------- */

export type DecisionKind = 'openrouter' | 'systemone' | 'custom';
const KINDS: readonly DecisionKind[] = ['openrouter', 'systemone', 'custom'];

/** A row of `ai_decision_providers`, key included. Never leaves the server. */
export interface DecisionProvider {
  slug: string;
  label: string;
  kind: DecisionKind;
  baseUrl: string | null;
  model: string;
  apiKey: string | null;
  credentialProvider: string | null;
  updatedAt: string | null;
}

interface DecisionRow {
  slug: string;
  label: string;
  kind: string;
  base_url: string | null;
  model: string;
  api_key: string | null;
  credential_provider: string | null;
  updated_at: string | null;
}

/** Rows whose `kind` is not one this file knows are dropped, not trusted. */
export async function getDecisionProviders(db: D1Database): Promise<DecisionProvider[]> {
  const { results } = await db
    .prepare(
      'SELECT slug, label, kind, base_url, model, api_key, credential_provider, updated_at FROM ai_decision_providers ORDER BY slug',
    )
    .all<DecisionRow>();
  return (results ?? [])
    .filter(r => (KINDS as readonly string[]).includes(r.kind))
    .map(r => ({
      slug: r.slug,
      label: r.label,
      kind: r.kind as DecisionKind,
      baseUrl: r.base_url,
      model: r.model,
      apiKey: r.api_key,
      credentialProvider: r.credential_provider,
      updatedAt: r.updated_at,
    }));
}

/** The admin's view of a row, built key by key — never a spread of it. */
export const summariseDecision = (row: DecisionProvider) => ({
  slug: row.slug,
  label: row.label,
  kind: row.kind,
  baseUrl: row.baseUrl,
  model: row.model,
  credentialProvider: row.credentialProvider,
  hasKey: Boolean(row.apiKey?.trim()),
  keyHint: maskKey(row.apiKey),
  updatedAt: row.updatedAt,
});

/** An `https:` URL, or `null`. */
const https = (raw: string | null | undefined): string | null => {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim());
    return url.protocol === 'https:' && !url.username && !url.password ? url.href.replace(/\/+$/, '') : null;
  } catch {
    return null;
  }
};

const OPENROUTER_DECISIONS = 'https://openrouter.ai/api/alpha/decisions';

/**
 * Where a row sends its request and with which key, or `null` when it cannot.
 *
 * An `openrouter` row borrows the key of the chat row it names, and only when
 * that row really points at openrouter.ai — the key goes to one host, the one
 * it was issued by. The other two kinds need their own key and an HTTPS URL.
 */
export function decisionTarget(
  row: DecisionProvider,
  chat: Provider[],
): { url: string; key: string; model: string } | null {
  if (row.kind === 'openrouter') {
    const owner = chat.find(p => p.slug === row.credentialProvider);
    const base = https(owner?.baseUrl);
    if (!owner?.apiKey?.trim() || !base || new URL(base).hostname !== 'openrouter.ai') return null;
    return { url: OPENROUTER_DECISIONS, key: owner.apiKey.trim(), model: row.model.trim() || 'typesafe/jev-1.13' };
  }
  const base = https(row.baseUrl);
  if (!base || !row.apiKey?.trim() || !row.model.trim()) return null;
  return {
    url: row.kind === 'systemone' ? `${base}/v1/systemone` : base,
    key: row.apiKey.trim(),
    model: row.model.trim(),
  };
}

/* ---------- the request ---------- */

/** The last turns, newest kept whole, as one string no longer than the cap. */
export function jevState(turns: { role: string; content: string }[]): string {
  const text = turns
    .slice(-JEV_TURNS)
    .map(t => `${t.role === 'assistant' ? 'Assistant' : 'Visitor'}: ${t.content}`)
    .join('\n\n');
  return text.length > JEV_STATE_CHARS ? text.slice(-JEV_STATE_CHARS) : text;
}

export function jevRequest(model: string, turns: { role: string; content: string }[], categories: JevCategory[]) {
  return {
    model,
    state: jevState(turns),
    questions: Object.fromEntries(categories.map(c => [c, { type: 'noul', ...QUESTIONS[c] }])),
  };
}

/**
 * The route, or `null` for "use the full one".
 *
 * Strict: every asked category must come back as a `noul` with a probability
 * in [0, 1], and every one must be confident one way or the other. One unsure
 * answer makes the whole route unsure — a route that is half a guess is still
 * a guess about which context to withhold.
 */
export function readRoute(body: unknown, categories: JevCategory[]): Set<JevCategory> | null {
  const answers = (body as { answers?: unknown } | null)?.answers;
  if (!answers || typeof answers !== 'object') return null;
  const route = new Set<JevCategory>();
  for (const category of categories) {
    const answer = (answers as Record<string, unknown>)[category] as { type?: unknown; noul?: unknown } | undefined;
    const p = typeof answer?.noul === 'number' ? answer.noul : NaN;
    if (answer?.type !== 'noul' || !Number.isFinite(p) || p < 0 || p > 1) return null;
    if (p >= JEV_YES) route.add(category);
    else if (p > JEV_NO) return null;
  }
  return route;
}

/** The tool names a route keeps. Intersected with the allowed list by `toolsFor()`. */
export const toolNamesFor = (route: Set<JevCategory>): Set<string> =>
  new Set([...route].flatMap(c => CATEGORY_TOOLS[c]));

/** Whether a run on this route needs a category's content. No route needs everything. */
export const needs = (route: Set<JevCategory> | null, category: JevCategory): boolean =>
  !route || route.has(category);

/* ---------- the call ---------- */

const num = (raw: unknown): number | null => (typeof raw === 'number' && Number.isFinite(raw) ? raw : null);

export interface JevOutcome {
  /** The narrowed route, or `null` to use the full one. */
  route: Set<JevCategory> | null;
  /** For the owner's log row only. No input text, no answer text. */
  detail: Record<string, unknown>;
}

/**
 * Ask Jev once, or decide not to. Never throws, never retries.
 *
 * `null` route unless the feature is on, its row resolves, the request
 * finishes inside both its own timeout and the run's deadline, and every
 * answer is confident. A decision POST is not replayed after an uncertain
 * outcome: it may have been billed, and the fallback costs nothing.
 */
export async function jevRoute(options: {
  db: D1Database;
  settings: AiSettings;
  turns: { role: string; content: string }[];
  categories: JevCategory[];
  deadline: number;
  fetcher?: typeof fetch;
}): Promise<JevOutcome> {
  const { settings, categories } = options;
  if (!settings.jevEnabled || !settings.jevProvider) return { route: null, detail: {} };
  const started = Date.now();
  const fail = (error: string): JevOutcome => ({ route: null, detail: { jev: { error, ms: Date.now() - started } } });

  const budget = Math.min(JEV_TIMEOUT_MS, options.deadline - Date.now());
  if (budget < 250) return fail('no time');

  let target: ReturnType<typeof decisionTarget> = null;
  try {
    const [rows, chat] = await Promise.all([getDecisionProviders(options.db), getProviders(options.db)]);
    const row = rows.find(r => r.slug === settings.jevProvider);
    target = row ? decisionTarget(row, chat) : null;
  } catch {
    return fail('configuration unreadable');
  }
  if (!target) return fail('not configured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budget);
  let body: unknown;
  let status = 0;
  try {
    const response = await (options.fetcher ?? fetch)(target.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${target.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(jevRequest(target.model, options.turns, categories)),
      signal: controller.signal,
    });
    status = response.status;
    body = await response.json().catch(() => null);
  } catch (error) {
    return fail(error instanceof Error && error.name === 'AbortError' ? 'timed out' : 'unreachable');
  } finally {
    clearTimeout(timer);
  }
  if (status < 200 || status >= 300) return fail(`HTTP ${status}`);

  const answers = (body as { answers?: Record<string, { noul?: unknown }> } | null)?.answers ?? {};
  const usage = (body as { usage?: Record<string, unknown> } | null)?.usage;
  const route = readRoute(body, categories);
  return {
    route,
    detail: {
      jev: {
        route: route ? [...route] : 'full',
        p: Object.fromEntries(categories.map(c => [c, typeof answers[c]?.noul === 'number' ? answers[c].noul : null])),
        ms: Date.now() - started,
        ...(usage && typeof usage === 'object'
          ? { usage: { input: num(usage.input_tokens), output: num(usage.output_tokens), cost: num(usage.cost) } }
          : {}),
      },
    },
  };
}
