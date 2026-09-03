/**
 * The daily journal job — when it runs, what it is asked for, and what it did.
 *
 * Every other thing the assistant does is started by a person: a command typed
 * into the panel, a button on an editor, a question in the widget. This one is
 * started by a clock, and that difference is the whole of what this file is
 * about. Three properties hold it together, and none of them is optional:
 *
 *   - **It writes a `draft`, never a `published` row.** Nothing an unattended
 *     model produces reaches a visitor with the owner's name on it until the
 *     owner has read it and pressed publish. That is decision 13's rule applied
 *     to a machine with a timer, and it is the same rule `/api/ai/assist`
 *     already follows by never writing at all.
 *   - **The hour is a function of the date, not a stored roll.** The job is
 *     driven by an hourly tick, so "post at a random time each day" needs a
 *     time that every tick of that day agrees on — otherwise two ticks roll two
 *     different hours and the post lands at whichever the last one happened to
 *     like. Hashing the date gives every tick the same answer without a write,
 *     without a lock, and without a scheduled row to go stale.
 *   - **A failure is not the end of the day.** The tick after a failed attempt
 *     tries again, and so does the one after that, up to `maxAttempts`. A
 *     provider that is rate-limited at 14:00 is very often fine at 15:00, and
 *     the alternative — one attempt, one chance — is a feature that silently
 *     does nothing on the days its vendor is busy. This is the retry, and
 *     `callChat`'s walk across models and providers is the fallback inside a
 *     single attempt; they are two different failures and both are worth
 *     handling.
 *
 * The settings and the run record are two `documents` singletons rather than
 * one, because they have two writers: the AI screen writes the settings whole,
 * and the endpoint writes the run record on every tick. One row would mean each
 * writer overwriting the other's half on a schedule.
 *
 * **This module imports nothing**, and that is load-bearing twice over. It is
 * reached from `ai-store.ts`, which runs in the browser, so a value import of
 * anything server-side here would pull Astro's markdown processor into the
 * admin bundle — the rule `content-store.ts` already follows by importing
 * `./content` type-only. And it is what lets `scripts/test-ai.mjs` load the
 * schedule directly and drive a year of days through it. The two functions that
 * genuinely need a database live in `/api/ai/daily` beside their only caller.
 */

/** The owner's configuration. Written by `/admin/ai`, read by `/api/ai/daily`. */
export const AUTO_KEY = 'journal-auto';

/** What the job did, and when. Written only by the endpoint. */
export const AUTO_RUN_KEY = 'journal-auto-run';

export interface AutoJournalSettings {
  enabled: boolean;
  /** First UTC hour the post may land in, inclusive. */
  windowStart: number;
  /** Last UTC hour it may land in, exclusive. Always greater than the start. */
  windowEnd: number;
  /**
   * Subjects to rotate through, one per day, chosen by the same hash as the
   * hour.
   *
   * Empty is a supported state and is not a broken configuration: with no list
   * the model is told to find its own angle out of the index of what is already
   * published, which is what it would do for `/write-whole-post` with a vague
   * steer. A list is how the owner points it at what they actually want written
   * about this month.
   */
  topics: string[];
  /**
   * How many attempts one day gets before the job gives up until tomorrow.
   *
   * The ceiling on what a bad day costs. Every attempt is a whole post's worth
   * of generation, so an unbounded retry against a provider that is refusing
   * everything is a bill with nothing to show for it.
   */
  maxAttempts: number;
  /** A model from the configured rows, or empty for the usual walk. */
  model: string;
  /** A standing steer appended to every day's prompt. Capped like a persona. */
  instruction: string;
}

/** Off, with a sane window, so an unconfigured site does nothing at all. */
export const AUTO_DEFAULTS: AutoJournalSettings = {
  enabled: false,
  /* Morning through evening UTC. Not midnight-to-midnight: a journal entry
     stamped 03:00 reads as a machine wrote it, which is true and is not the
     impression the feature is for. */
  windowStart: 8,
  windowEnd: 20,
  topics: [],
  maxAttempts: 3,
  model: '',
  instruction: '',
};

/** What a saved setting cannot exceed. Same reasoning as `CEILINGS` in `ai.ts`. */
const LIMITS = {
  topics: 24,
  topicChars: 200,
  maxAttempts: 6,
  instructionChars: 1000,
} as const;

export const AUTO_LIMITS = LIMITS;

const clampHour = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(Math.floor(n), max));
};

/**
 * Whatever was in the column, as settings that cannot hurt anyone.
 *
 * Re-derived key by key rather than spread, exactly like `clampSettings()`: this
 * row is written by one screen but it is also the kind of row someone edits by
 * hand in `wrangler d1 execute`, and a garbage value must produce a job that
 * does nothing rather than a 500 on a schedule nobody is watching.
 */
export function clampAutoSettings(raw: unknown): AutoJournalSettings {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const start = clampHour(source.windowStart, AUTO_DEFAULTS.windowStart, 0, 23);
  /* At least one hour wide, whatever was typed. A window whose end is at or
     before its start has no hours in it, and `hourFor` below would divide by a
     span of zero and schedule the post at `NaN` — which is never, silently. */
  const end = clampHour(source.windowEnd, AUTO_DEFAULTS.windowEnd, start + 1, 24);

  return {
    enabled: source.enabled === true,
    windowStart: start,
    windowEnd: end,
    topics: (Array.isArray(source.topics) ? source.topics : [])
      .filter((t): t is string => typeof t === 'string' && Boolean(t.trim()))
      .slice(0, LIMITS.topics)
      .map(t => t.trim().slice(0, LIMITS.topicChars)),
    maxAttempts: clampHour(source.maxAttempts, AUTO_DEFAULTS.maxAttempts, 1, LIMITS.maxAttempts),
    model: typeof source.model === 'string' ? source.model.slice(0, 200) : '',
    instruction:
      typeof source.instruction === 'string'
        ? source.instruction.slice(0, LIMITS.instructionChars)
        : '',
  };
}

/** The last attempt, whatever came of it. */
export interface AutoJournalRun {
  /** The UTC date the record belongs to, `YYYY-MM-DD`. */
  day: string;
  /** Attempts made on that day, successful or not. */
  attempts: number;
  /** The slug written that day, or empty if none has landed yet. */
  slug: string;
  /** One line for the admin screen: what happened. */
  note: string;
  /** When the last attempt ran, ISO with a `Z`. */
  at: string;
}

export const EMPTY_RUN: AutoJournalRun = { day: '', attempts: 0, slug: '', note: '', at: '' };

export function clampAutoRun(raw: unknown): AutoJournalRun {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const text = (key: string, limit: number) =>
    typeof source[key] === 'string' ? (source[key] as string).slice(0, limit) : '';
  const attempts = Number(source.attempts);
  return {
    day: text('day', 10),
    attempts: Number.isFinite(attempts) ? Math.max(0, Math.floor(attempts)) : 0,
    slug: text('slug', 200),
    note: text('note', 500),
    at: text('at', 40),
  };
}

/* ---------- when ---------- */

/** The UTC date of an instant, as the `YYYY-MM-DD` a `journal.date` holds. */
export const dayOf = (now: Date): string => now.toISOString().slice(0, 10);

/**
 * FNV-1a, over a string, as an unsigned 32-bit number.
 *
 * A hash rather than `Math.random()` because the answer has to be the *same*
 * for every tick of a day and different between days — which is what makes "a
 * random time each day" survive being asked twenty-four times a day by a
 * stateless endpoint. Nothing here is cryptographic and nothing needs to be:
 * the property wanted is spread, not unpredictability, and an attacker who
 * knows when the post lands learns that a post landed.
 */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The UTC hour this day's post is due at, inside the configured window. */
export const hourFor = (day: string, settings: AutoJournalSettings): number =>
  settings.windowStart + (hash(`${day}:hour`) % (settings.windowEnd - settings.windowStart));

/** The topic for a day, or empty for "find your own angle". */
export const topicFor = (day: string, settings: AutoJournalSettings): string =>
  settings.topics.length ? (settings.topics[hash(`${day}:topic`) % settings.topics.length] ?? '') : '';

/** Whether to generate now, and — either way — why. */
export type AutoVerdict =
  | { act: false; day: string; reason: string }
  | { act: true; day: string; hour: number; topic: string };

/**
 * The whole schedule, as one pure function of the clock and two rows.
 *
 * Pure so it is testable without a database and without waiting for an hour to
 * pass, which is the only way a once-a-day behaviour is testable at all.
 */
export function decide(
  now: Date,
  settings: AutoJournalSettings,
  run: AutoJournalRun,
): AutoVerdict {
  const day = dayOf(now);
  if (!settings.enabled) return { act: false, day, reason: 'The daily journal is switched off.' };

  const today = run.day === day ? run : EMPTY_RUN;
  if (today.slug) {
    return { act: false, day, reason: `Already written today: ${today.slug}.` };
  }
  if (today.attempts >= settings.maxAttempts) {
    return {
      act: false,
      day,
      reason: `${today.attempts} attempts failed today; the next one is tomorrow.`,
    };
  }

  const hour = hourFor(day, settings);
  if (now.getUTCHours() < hour) {
    return { act: false, day, reason: `Due at ${String(hour).padStart(2, '0')}:00 UTC.` };
  }

  return { act: true, day, hour, topic: topicFor(day, settings) };
}

/* ---------- what to ask for ---------- */

/**
 * The steer the job sends in place of the topic a person would have typed.
 *
 * `/write-whole-post` is `needsTopic`, and this is that topic. It is built here
 * rather than in the endpoint so the wording is testable, and it is built from
 * the owner's own settings and the date — there is no caller and nothing from a
 * request reaches it.
 */
export function autoInstruction(day: string, settings: AutoJournalSettings): string {
  const parts = [
    topicFor(day, settings)
      ? `Today's subject is: ${topicFor(day, settings)}`
      : 'Choose the subject yourself, from the work in the index above.',
    'Pick a specific angle that none of the existing posts already covers — check the index ' +
      'before you commit to one, and prefer a narrow account of one real thing over a survey. ' +
      'If the closest existing post is about the same subject, write the part it left out ' +
      'rather than a second version of it.',
    'Write it as an entry in an ongoing journal, not as an article introducing a topic to ' +
      'strangers. No preamble about why the subject matters.',
  ];
  if (settings.instruction.trim()) parts.push(settings.instruction.trim());
  return parts.join('\n\n');
}

/* ---------- what to write ---------- */

/** A title, as the slug a `journal` row is keyed by. Matches `SLUG`. */
export const slugify = (title: string): string =>
  title
    .toLowerCase()
    .normalize('NFKD')
    /* Anything that is not a letter, a digit or a separator is dropped rather
       than transliterated: `SLUG` accepts `[a-z0-9-]` and nothing else, and a
       title with a curly apostrophe in it must not produce a slug the write
       endpoint then refuses. */
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
