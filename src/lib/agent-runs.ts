import { cleanSection, parsePlan, sectionContext, type PlannedSection } from './assist-tasks';

/**
 * The daily post as a run of steps — the pure half.
 *
 * A run is persisted state advanced one bounded step at a time: `plan` (decide
 * the entry and gather its facts, with lookups), one `section:<i>` per planned
 * section (no lookups), then `finish` (assemble and insert, no model). A step
 * that fails leaves the phase where it was and counts a failure; a finished
 * step is never redone, so a tick that runs out of time leaves the next one
 * exactly where to continue. `agent-runner.ts` is the server half: the row,
 * the lock, the model calls and the insert.
 *
 * No I/O and no secret here, so `check:ai` drives it directly. Design:
 * `docs/superpowers/specs/2026-09-21-agent-runs-design.md`, Phase 1.
 */

export type RunPhase = 'plan' | 'write' | 'finish' | 'done' | 'failed' | 'declined';
export type RunCaller = 'cron' | 'owner';

export interface PostPlan {
  title: string;
  summary: string;
  tags: string[];
  angle: string;
  facts: string[];
  sections: PlannedSection[];
}

export interface StepRecord {
  step: string;
  label: string;
  ok: boolean;
  ms: number;
  model: string;
  note?: string;
  at: string;
}

export interface PostRun {
  kind: 'journal-post';
  /** The UTC day, `YYYY-MM-DD`. */
  key: string;
  phase: RunPhase;
  plan: PostPlan | null;
  /** Finished, cleaned, in order. */
  sections: string[];
  /** Failed steps so far — what `maxAttempts` bounds. */
  failures: number;
  trail: StepRecord[];
  slug?: string;
  error?: string;
  lock?: { by: RunCaller; at: string };
  startedAt: string;
  updatedAt: string;
}

export interface RunStep {
  id: string;
  label: string;
  kind: 'plan' | 'section' | 'finish';
  /** `section` only. */
  index?: number;
}

/** A lock younger than this is held; older is a killed isolate's, and is taken over. */
export const LOCK_MS = 4 * 60_000;
const TRAIL_CAP = 40;
const PHASES: readonly RunPhase[] = ['plan', 'write', 'finish', 'done', 'failed', 'declined'];

/** The journal's default arc, when a plan names too few sections to be one. */
export const POST_SECTIONS: readonly PlannedSection[] = [
  { heading: 'What I was trying to do', brief: 'The goal, and the constraint that made it interesting.' },
  { heading: 'What I tried first, and what broke', brief: 'The first approach and exactly how it failed.' },
  { heading: 'What worked', brief: 'The fix, how it works, and what it cost.' },
  { heading: 'What is still open', brief: 'What is not working yet, and what gets tried next.' },
];

/** About 300 words a section; an entry is not a long-form case study. */
const SECTION_WORDS = 300;

export function newRun(key: string, now: Date): PostRun {
  const at = now.toISOString();
  return { kind: 'journal-post', key, phase: 'plan', plan: null, sections: [], failures: 0, trail: [], startedAt: at, updatedAt: at };
}

/* ---------- reading a row ---------- */

const str = (v: unknown, cap: number) => (typeof v === 'string' ? v.slice(0, cap) : '');
const strs = (v: unknown, n: number, cap: number) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, n).map(x => x.slice(0, cap)) : [];

function clampPlan(raw: unknown): PostPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const sections = (Array.isArray(p.sections) ? p.sections : [])
    .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object')
    .map(x => ({ heading: str(x.heading, 120), brief: str(x.brief, 400) }))
    .filter(x => x.heading)
    .slice(0, 9);
  const title = str(p.title, 200);
  if (!title || !sections.length) return null;
  return {
    title,
    summary: str(p.summary, 300),
    tags: strs(p.tags, 6, 40),
    angle: str(p.angle, 400),
    facts: strs(p.facts, 40, 400),
    sections,
  };
}

/**
 * Whatever the JSON column holds, as a run that cannot hurt anything.
 *
 * Every field re-derived, nothing spread. A phase that needs a plan and has
 * none falls back to `plan`; sections beyond the plan are dropped; a lock is
 * kept only when it names a known caller and a parseable time. A corrupt row
 * is a fresh run, not a 500.
 */
export function clampRun(raw: unknown, key: string, now: Date): PostRun {
  if (!raw || typeof raw !== 'object') return newRun(key, now);
  const r = raw as Record<string, unknown>;
  if (r.kind !== 'journal-post' || r.key !== key) return newRun(key, now);
  const plan = clampPlan(r.plan);
  let phase: RunPhase = (PHASES as readonly string[]).includes(r.phase as string) ? (r.phase as RunPhase) : 'plan';
  if ((phase === 'write' || phase === 'finish') && !plan) phase = 'plan';
  const sections = strs(r.sections, plan?.sections.length ?? 0, 20_000);
  if (phase === 'finish' && plan && sections.length < plan.sections.length) phase = 'write';
  const failures = Number(r.failures);
  const lock = r.lock as { by?: unknown; at?: unknown } | undefined;
  const lockAt = typeof lock?.at === 'string' ? Date.parse(lock.at) : NaN;
  const trail = (Array.isArray(r.trail) ? r.trail : [])
    .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object')
    .slice(-TRAIL_CAP)
    .map(x => ({
      step: str(x.step, 40),
      label: str(x.label, 200),
      ok: x.ok === true,
      ms: Number.isFinite(Number(x.ms)) ? Math.max(0, Math.floor(Number(x.ms))) : 0,
      model: str(x.model, 200),
      ...(typeof x.note === 'string' ? { note: x.note.slice(0, 300) } : {}),
      at: str(x.at, 40),
    }));
  return {
    kind: 'journal-post',
    key,
    phase,
    plan,
    sections,
    failures: Number.isFinite(failures) ? Math.max(0, Math.min(99, Math.floor(failures))) : 0,
    trail,
    ...(str(r.slug, 200) ? { slug: str(r.slug, 200) } : {}),
    ...(str(r.error, 300) ? { error: str(r.error, 300) } : {}),
    ...((lock?.by === 'cron' || lock?.by === 'owner') && Number.isFinite(lockAt)
      ? { lock: { by: lock.by, at: new Date(lockAt).toISOString() } }
      : {}),
    startedAt: str(r.startedAt, 40) || now.toISOString(),
    updatedAt: str(r.updatedAt, 40) || now.toISOString(),
  };
}

/** Whether someone else's lock is still live. Your own stale lock is no lock. */
export const lockHeld = (run: PostRun, now: Date): boolean =>
  Boolean(run.lock && now.getTime() - Date.parse(run.lock.at) < LOCK_MS);

export const isFinished = (run: PostRun): boolean =>
  run.phase === 'done' || run.phase === 'failed' || run.phase === 'declined';

/* ---------- the steps ---------- */

export function nextStep(run: PostRun): RunStep | null {
  if (run.phase === 'plan') return { id: 'plan', label: 'Plan the entry', kind: 'plan' };
  if (run.phase === 'finish') return { id: 'finish', label: 'Assemble and save', kind: 'finish' };
  if (run.phase !== 'write' || !run.plan) return null;
  const index = run.sections.length;
  const section = run.plan.sections[index];
  if (!section) return { id: 'finish', label: 'Assemble and save', kind: 'finish' };
  return {
    id: `section:${index + 1}`,
    label: `Section ${index + 1} of ${run.plan.sections.length}: ${section.heading}`,
    kind: 'section',
    index,
  };
}

/** The context fields a section step sends, from the plan and the previous section. */
export function sectionFields(run: PostRun, index: number): Record<string, string> {
  const plan = run.plan!;
  const ctx = sectionContext(
    { facts: plan.facts, sections: plan.sections, planned: true },
    index,
    run.sections[index - 1] ?? '',
    SECTION_WORDS * plan.sections.length,
  );
  return { title: plan.title, summary: plan.summary, ...ctx };
}

const LABEL = (name: string) => new RegExp(`^\\s*\\**${name}\\**\\s*:\\s*(.*)$`, 'im');

/**
 * A plan step's answer, read. `declined` for `NOTHING:`, `null` when unusable.
 *
 * Unusable is no title, or no facts *and* fewer than three planned sections —
 * a plan with facts and a thin outline still writes, on `POST_SECTIONS`.
 */
export function readPlan(text: string): PostPlan | { declined: string } | null {
  const body = text.replace(/^\s*```[a-z]*\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();
  const nothing = body.match(/^\**NOTHING\**\s*:\s*(.*)$/i);
  if (nothing && !LABEL('TITLE').test(body)) return { declined: nothing[1].trim().slice(0, 300) || 'Nothing new to write about.' };
  const title = (body.match(LABEL('TITLE'))?.[1] ?? '').replace(/[*_]/g, '').trim();
  if (!title) return null;
  const parsed = parsePlan(body, { min: 3, fallback: POST_SECTIONS });
  if (!parsed.facts.length && !parsed.planned) return null;
  return {
    title: title.slice(0, 200),
    summary: (body.match(LABEL('SUMMARY'))?.[1] ?? '').trim().slice(0, 300),
    tags: (body.match(LABEL('TAGS'))?.[1] ?? '')
      .split(',')
      .map(t => t.replace(/[*_#]/g, '').trim())
      .filter(Boolean)
      .slice(0, 6),
    angle: (body.match(LABEL('ANGLE'))?.[1] ?? '').trim().slice(0, 400),
    facts: parsed.facts,
    sections: parsed.sections.slice(0, 6),
  };
}

export interface StepMeta {
  ms: number;
  model: string;
  now: Date;
  maxAttempts: number;
}

const record = (step: RunStep, meta: StepMeta, ok: boolean, note?: string): StepRecord => ({
  step: step.id,
  label: step.label,
  ok,
  ms: meta.ms,
  model: meta.model,
  ...(note ? { note: note.slice(0, 300) } : {}),
  at: meta.now.toISOString(),
});

const withTrail = (run: PostRun, entry: StepRecord) => [...run.trail, entry].slice(-TRAIL_CAP);

/** A failed step: same phase, one more failure, `failed` at the ceiling. Never throws. */
export function failStep(run: PostRun, step: RunStep, note: string, meta: StepMeta): PostRun {
  const failures = run.failures + 1;
  return {
    ...run,
    failures,
    phase: failures >= meta.maxAttempts ? 'failed' : run.phase,
    error: note.slice(0, 300),
    trail: withTrail(run, record(step, meta, false, note)),
    updatedAt: meta.now.toISOString(),
  };
}

/** A model step's answer, folded in. An unusable answer is a failed step. */
export function applyStep(run: PostRun, step: RunStep, text: string, meta: StepMeta): PostRun {
  if (step.kind === 'plan') {
    const plan = readPlan(text);
    if (!plan) return failStep(run, step, 'The plan came back without a title, facts or sections.', meta);
    if ('declined' in plan) {
      return { ...run, phase: 'declined', error: plan.declined, trail: withTrail(run, record(step, meta, true, plan.declined)), updatedAt: meta.now.toISOString() };
    }
    const { error: _e, ...rest } = run;
    return {
      ...rest,
      phase: 'write',
      plan,
      sections: [],
      trail: withTrail(run, record(step, meta, true, plan.angle || plan.title)),
      updatedAt: meta.now.toISOString(),
    };
  }
  if (step.kind === 'section' && run.plan && step.index === run.sections.length) {
    const heading = run.plan.sections[step.index].heading;
    const section = cleanSection(text, heading, Math.round(SECTION_WORDS * 1.6));
    if (!section) return failStep(run, step, 'The section came back empty.', meta);
    const sections = [...run.sections, section];
    const { error: _e, ...rest } = run;
    return {
      ...rest,
      sections,
      phase: sections.length >= run.plan.sections.length ? 'finish' : 'write',
      trail: withTrail(run, record(step, meta, true)),
      updatedAt: meta.now.toISOString(),
    };
  }
  return failStep(run, step, 'That step does not belong to this run any more.', meta);
}

/** The finished entry, as the row `insertPost()` writes. */
export function assemblePost(run: PostRun): { title: string; summary: string; tags: string[]; readTime: string; body: string } {
  const plan = run.plan!;
  const body = run.sections.join('\n\n').trim();
  const words = body.split(/\s+/).filter(Boolean).length;
  return {
    title: plan.title,
    summary: plan.summary || `${plan.title}.`.slice(0, 200),
    tags: plan.tags,
    readTime: `${Math.max(1, Math.round(words / 200))} min`,
    body,
  };
}

/** Finished: `done` with its slug. */
export const finishRun = (run: PostRun, slug: string, meta: StepMeta): PostRun => ({
  ...run,
  phase: 'done',
  slug,
  trail: withTrail(run, record({ id: 'finish', label: 'Assemble and save', kind: 'finish' }, meta, true, slug)),
  updatedAt: meta.now.toISOString(),
});

/**
 * What a route answers and the screen renders. Never the facts or the
 * sections — those are the row's business, and the draft is where to read them.
 */
export function summariseRun(run: PostRun, now: Date = new Date()) {
  const step = nextStep(run);
  return {
    key: run.key,
    phase: run.phase,
    next: step?.label ?? null,
    done: run.sections.length,
    total: run.plan?.sections.length ?? 0,
    title: run.plan?.title ?? null,
    failures: run.failures,
    error: run.error ?? null,
    slug: run.slug ?? null,
    lockedBy: lockHeld(run, now) ? run.lock!.by : null,
    updatedAt: run.updatedAt,
    trail: run.trail.map(({ step: s, label, ok, ms, model, note, at }) => ({ step: s, label, ok, ms, model, note, at })),
  };
}

export type RunSummaryView = ReturnType<typeof summariseRun>;
