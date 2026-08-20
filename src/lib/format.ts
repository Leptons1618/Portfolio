/** Long form ("January 5, 2026") by default; `short` gives "Jan 5, 2026". */
export function formatDate(iso: string, month: 'long' | 'short' = 'long'): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month, day: 'numeric' });
}

export const formatShortDate = (iso: string) => formatDate(iso, 'short');

/** Journal tags render as `#UPPER_SNAKE` labels in the design. */
export function formatTag(tag: string): string {
  return `#${tag.trim().toUpperCase().replace(/\s+/g, '_')}`;
}

/**
 * Coarse "how long ago", for timestamps GitHub hands back. Deliberately
 * low-resolution: the admin cares whether a push was today or last month, not
 * whether it was 43 or 44 minutes ago.
 */
export function relativeTime(iso: string): string {
  const hours = (Date.now() - new Date(iso).getTime()) / 36e5;
  if (hours < 1) return 'under an hour ago';
  if (hours < 48) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Meta line under a post title: date · read time · video duration. */
export function metaLine(data: { date: string; readTime?: string; videoDuration?: string }): string {
  return [formatShortDate(data.date), data.readTime && `${data.readTime} read`, data.videoDuration && `${data.videoDuration} video`]
    .filter(Boolean)
    .join(' · ');
}

/* ---------- month ranges, for the resume ---------- */

/**
 * A `YYYY-MM` month, or `Present`.
 *
 * The resume stores months rather than a typed-out string because the string
 * goes stale: the row that shipped said "July 2024 - Present (1 year 10
 * months)", which stopped being true a month after it was written and would
 * have gone on being wrong on a document sent to employers. Everything below
 * derives from two months and the clock.
 *
 * Built by hand rather than through `toLocaleDateString`, because `new
 * Date('2024-07')` is parsed as UTC midnight and rendered in the local zone —
 * which is June for anyone west of Greenwich.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `[year, month]` from `YYYY-MM`, or `null` for anything else. */
function monthParts(value: string | null | undefined): [number, number] | null {
  const match = /^(\d{4})-(\d{1,2})$/.exec((value ?? '').trim());
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return [Number(match[1]), month];
}

/** `2024-07` → `Jul 2024`. An empty end date means the role is current. */
export function formatMonth(value: string | null | undefined): string {
  const parts = monthParts(value);
  return parts ? `${MONTHS[parts[1] - 1]} ${parts[0]}` : 'Present';
}

/** `Jul 2024 — Present`. Returns `''` when the start is not a month. */
export function formatRange(start: string, end?: string | null): string {
  if (!monthParts(start)) return '';
  return `${formatMonth(start)} — ${formatMonth(end)}`;
}

/**
 * Inclusive month count, so Jul 2024 → Aug 2026 reads as `2 yr 2 mo`.
 *
 * Inclusive because that is how a person counts a job: someone who started and
 * left in the same month worked there for a month, not for zero.
 */
export function formatDuration(start: string, end?: string | null): string {
  const from = monthParts(start);
  if (!from) return '';
  const to = monthParts(end);
  const now = new Date();
  const [ey, em] = to ?? [now.getFullYear(), now.getMonth() + 1];

  const months = Math.max(0, (ey - from[0]) * 12 + (em - from[1])) + 1;
  const years = Math.floor(months / 12);
  const rest = months % 12;

  const parts: string[] = [];
  if (years) parts.push(`${years} yr`);
  if (rest) parts.push(`${rest} mo`);
  return parts.join(' ') || '1 mo';
}

/**
 * Best effort at the months behind a hand-typed date string.
 *
 * The resume's rows predate the structured fields, so this exists to read what
 * is already stored: `"July 2024 - Present (1 year 10 months)"` and
 * `"December 2022 - July 2024"` are the shapes actually in the database. It is
 * called once on read, and the first save writes the structured fields back —
 * so it is a ratchet, not a permanent second format.
 *
 * Returns `null` when it cannot tell, and the caller keeps the original string
 * as the thing to display. Guessing a date onto a resume is worse than
 * rendering the text the author typed.
 */
export function parseLegacyDates(input: string): { start: string; end: string | null } | null {
  /* The parenthesised duration is derived from the two dates and is exactly
     the part that goes stale, so it is dropped before anything is read. */
  const text = input.replace(/\([^)]*\)/g, ' ').trim();
  if (!text) return null;

  const NAMES = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
  ];

  const month = (name: string): string | null => {
    const wanted = name.trim().toLowerCase();
    if (wanted.length < 3) return null;
    const index = NAMES.findIndex(full => full.startsWith(wanted.slice(0, 3)));
    return index === -1 ? null : String(index + 1).padStart(2, '0');
  };

  /* An en or em dash may hug its neighbours; an ASCII hyphen and the word "to"
     may not. That asymmetry is load-bearing: `2024-07` is one of the shapes
     `asMonth` reads, and a hyphen splitter that did not require whitespace
     would tear it into a year and a month before anything looked at it. */
  const halves = text.split(/\s*[–—]\s*|\s+(?:-|to)\s+/i).filter(Boolean);
  if (!halves.length) return null;

  const asMonth = (half: string): string | null => {
    const named = /^([A-Za-z]{3,9})\.?\s+(\d{4})$/.exec(half.trim());
    if (named) {
      const mm = month(named[1]);
      return mm ? `${named[2]}-${mm}` : null;
    }
    const numeric = /^(\d{4})[-/](\d{1,2})$/.exec(half.trim());
    if (numeric) return `${numeric[1]}-${String(Number(numeric[2])).padStart(2, '0')}`;
    /* A bare year is a real thing people write, and January is the only
       defensible reading of it. */
    const year = /^(\d{4})$/.exec(half.trim());
    return year ? `${year[1]}-01` : null;
  };

  const start = asMonth(halves[0]);
  if (!start) return null;

  const second = halves[1]?.trim() ?? '';
  if (!second || /^(present|current|now|ongoing)$/i.test(second)) return { start, end: null };

  const end = asMonth(second);
  return end ? { start, end } : { start, end: null };
}
