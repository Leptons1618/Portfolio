/**
 * The long case study, written in steps the page can see and resume.
 *
 * `/write-case-study-body` used to be one request for the whole write-up. On
 * the free OpenRouter models this site runs on, a request that long does not
 * finish inside the time one request gets — 1,500 words was still streaming at
 * ninety seconds — and a failure anywhere in it lost all of it. So the job is
 * a sequence of short requests, driven from here:
 *
 *   1. **Plan** (`casestudyplan`): read the repository, return the facts and
 *      six to eight section headings. The only step that looks anything up.
 *   2. **Sections** (`casestudysection`): one request per section, each given
 *      the facts, the whole outline, its own heading and length, and the end
 *      of the section before it. No lookups — the facts are the source.
 *
 * Every step is an ordinary `/api/ai/assist` call on a closed task, so nothing
 * here widens what the endpoint can be asked to do. A step that fails is tried
 * once more after a pause (the free pool's usual failure is a momentary
 * "rate-limited upstream"); a second failure stops the run with its progress
 * kept in `LongRunStopped.state`, which the page hands back to resume from the
 * section that failed rather than from the start. Decision **60**.
 *
 * Browser code: it streams through `runAssist`, which carries the owner's
 * token. Nothing here saves — the page writes the markdown into the body field
 * and the author presses Save, the same as every other task.
 */

import { runAssist, type ToolFrame } from './ai-store';
import {
  LONG_CASE_STUDY_WORDS,
  cleanSection,
  parsePlan,
  sectionContext,
  sectionWords,
  type CaseStudyPlan,
} from './assist-tasks';

/** Everything a stopped run had finished, so it can carry on. */
export interface LongRunState {
  plan: CaseStudyPlan | null;
  /** Finished sections, cleaned, in order. */
  sections: string[];
}

export interface LongRunOptions {
  /**
   * The case study's material: `repo`, `readme`, `title`, `summary` (the
   * subtitle), `stack`, `highlights` (the achievements), `problem`, `solution`.
   */
  context: Record<string, string>;
  /** The author's steer, passed to every step. */
  instruction?: string;
  signal: AbortSignal;
  /** What the panel's toolbar was set to. `tools` is honoured for the plan only. */
  run?: { model?: string; effort?: string; tools?: boolean };
  /** A stopped run's progress, to carry on from. */
  resume?: LongRunState;
  /** One line of progress: which step, which section. */
  onPhase: (text: string) => void;
  /** The write-up so far — finished sections plus the one arriving. */
  onDraft: (markdown: string) => void;
  onThinking?: (chunk: string) => void;
  onTool?: (frame: ToolFrame) => void;
  /** How long the whole thing aims to be. */
  totalWords?: number;
  /** Called whenever a step finishes, so a run stopped by hand can resume too. */
  onState?: (state: LongRunState) => void;
}

/** A run that could not finish. `state` is what it got done. */
export class LongRunStopped extends Error {
  readonly state: LongRunState;
  /** Which step failed, for the resume button's label. */
  readonly step: string;
  constructor(message: string, state: LongRunState, step: string) {
    super(message);
    this.name = 'LongRunStopped';
    this.state = state;
    this.step = step;
  }
}

const words = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

/** Wait, unless the run is stopped first. */
const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Stopped.', 'AbortError'));
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Stopped.', 'AbortError'));
      },
      { once: true },
    );
  });

/**
 * One step, tried twice.
 *
 * The pause is longer when the vendor said it was rate-limited, because a
 * second request inside the same minute is the thing it just refused.
 */
async function attempt(
  label: string,
  once: () => Promise<string>,
  accept: (text: string) => boolean,
  options: LongRunOptions,
): Promise<string> {
  let lastError = '';
  for (let tries = 0; tries < 2; tries += 1) {
    if (tries) {
      const limited = /429|rate[- ]?limit|overloaded|temporarily/i.test(lastError);
      options.onPhase(`${label} — retrying${limited ? ' after the rate limit clears' : ''}…`);
      await pause(limited ? 12_000 : 3_000, options.signal);
    }
    try {
      const text = await once();
      if (accept(text)) return text;
      lastError = 'The model returned nothing usable.';
    } catch (error) {
      if (isAbort(error)) throw error;
      lastError = error instanceof Error ? error.message : 'The request failed.';
    }
  }
  throw new Error(lastError);
}

export async function writeLongCaseStudy(options: LongRunOptions): Promise<{
  markdown: string;
  state: LongRunState;
  words: number;
}> {
  const { context, signal } = options;
  const instruction = options.instruction ?? '';
  const state: LongRunState = {
    plan: options.resume?.plan ?? null,
    sections: [...(options.resume?.sections ?? [])],
  };
  const handlers = {
    onThinking: options.onThinking,
    onTool: options.onTool,
  };
  const joined = (extra = '') => [...state.sections, extra].filter(Boolean).join('\n\n');

  /* — 1. the plan — */
  if (!state.plan) {
    options.onPhase('Planning — reading the repository…');
    try {
      const raw = await attempt(
        'Planning',
        () =>
          runAssist(
            'casestudyplan',
            {
              repo: context.repo ?? '',
              readme: context.readme ?? '',
              title: context.title ?? '',
              summary: context.summary ?? '',
              stack: context.stack ?? '',
              highlights: context.highlights ?? '',
              problem: context.problem ?? '',
              solution: context.solution ?? '',
            },
            instruction,
            { onDelta: () => {}, ...handlers },
            signal,
            undefined,
            options.run,
          ),
        /* A plan that does not parse — no sections, or prose instead of the
           two lists — is worth one more try before the default arc stands in:
           measured live, the free pool's router sometimes lands on a model
           that answers in its own shape. */
        text => parsePlan(text).planned,
        options,
      );
      state.plan = parsePlan(raw);
      options.onState?.(state);
    } catch (error) {
      if (isAbort(error)) throw error;
      /* A plan that failed twice still leaves a write-up worth attempting:
         the default arc, with the README and header as the only source. */
      state.plan = parsePlan('');
      options.onState?.(state);
      options.onPhase(
        `Planning failed (${error instanceof Error ? error.message : 'unknown error'}) — writing from the README with a standard outline.`,
      );
    }
  }

  const plan = state.plan;
  const total = plan.sections.length;
  /* With no facts from the plan, a section request has nothing to write from
     — measured live, it narrates or returns a paragraph. The README is the
     next best source, so it stands in for the list. */
  const readmeFacts = plan.facts.length
    ? null
    : (context.readme ?? '').trim()
      ? `No fact list was gathered. Work only from this README:\n\n${(context.readme ?? '').slice(0, 5_500)}`
      : null;
  /* A section may run long; past this it is trimmed at a paragraph. */
  const cap = Math.round(sectionWords(plan, options.totalWords ?? LONG_CASE_STUDY_WORDS) * 1.8);

  /* — 2. the sections — */
  for (let index = state.sections.length; index < total; index += 1) {
    const heading = plan.sections[index].heading;
    const label = `Section ${index + 1} of ${total}: ${heading}`;
    options.onPhase(`${label}… ${words(joined())} words so far.`);

    try {
      const raw = await attempt(
        label,
        () => {
          let partial = '';
          return runAssist(
            'casestudysection',
            {
              title: context.title ?? '',
              summary: context.summary ?? '',
              stack: context.stack ?? '',
              problem: context.problem ?? '',
              solution: context.solution ?? '',
              ...sectionContext(plan, index, state.sections[index - 1] ?? '', options.totalWords ?? LONG_CASE_STUDY_WORDS),
              ...(readmeFacts ? { facts: readmeFacts } : {}),
            },
            instruction,
            {
              ...handlers,
              onDelta: chunk => {
                partial += chunk;
                options.onDraft(joined(cleanSection(partial, heading, cap)));
              },
            },
            signal,
            undefined,
            /* Sections look nothing up; saying so saves the route a decision. */
            { ...options.run, tools: false },
          );
        },
        text => cleanSection(text, heading, cap).length > heading.length + 20,
        options,
      );
      state.sections.push(cleanSection(raw, heading, cap));
      options.onState?.(state);
      options.onDraft(joined());
    } catch (error) {
      if (isAbort(error)) {
        options.onDraft(joined());
        throw error;
      }
      options.onDraft(joined());
      throw new LongRunStopped(
        `${label} failed twice: ${error instanceof Error ? error.message : 'unknown error'}`,
        state,
        `section ${index + 1}`,
      );
    }
  }

  const markdown = joined();
  return { markdown, state, words: words(markdown) };
}
