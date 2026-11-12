/**
 * An application, read rather than typed: the fit assessment, the contacts and
 * the kept drafts turned into the pieces the Jobs screen renders.
 *
 * Everything here is derived on read from the same columns the CLI and the MCP
 * server already write — one source of truth, and no schema for what a person
 * reads. That is the arrangement `chapters.ts` uses for a case-study body, and
 * the reason the `jobs` skill keeps writing plain markdown.
 *
 * It imports nothing, for the reason `content-schema.ts` and `job-boards.ts`
 * import nothing: `scripts/test-cli.mjs` loads it directly and lets Node strip
 * the types. There is no DOM in this file.
 *
 * ## The two shapes of `fit`
 *
 * Assessments were written by the screen's own task and by a model working
 * through the `jobs` skill, and the two differ in small ways that a parser has
 * to take: a bold requirement with an em dash inside it, `⚠️` with and without
 * the variation selector, a continuation line under an item, a keywords line
 * with a "True and missing:" lead-in, and `###` sections that are neither of the
 * four the template names. The screen falls back to showing the text as written
 * when this cannot recognise it — losing an assessment is worse than rendering
 * it plainly.
 */

export type Mark = 'met' | 'adjacent' | 'missing';

export interface FitItem {
  mark: Mark;
  requirement: string;
  evidence: string;
}

export interface FitView {
  /** false → the screen shows the text as prose instead of a comparison. */
  recognised: boolean;
  verdict: { level: 'Strong' | 'Reasonable' | 'Stretch' | 'Poor' | null; why: string };
  score: { value: number | null; why: string };
  /** The advert's own facts, from an optional "Role at a glance" section. */
  facts: Record<string, string>;
  must: FitItem[];
  nice: FitItem[];
  gaps: string[];
  keywords: string[];
  projects: { slug: string; line: string }[];
  extra: { title: string; markdown: string }[];
}

/* A mark is the first thing on an item line. `\u26A0\uFE0F?` accepts ⚠ with or
   without the variation selector, which is the difference between two models'
   output and not a difference in meaning. */
const MARK = /^(\u2705|\u26A0\uFE0F?|\u274C)\s*/;

/** The slug shape `content-schema.ts` owns. Copied as a literal because this
    file imports nothing; `check:schema` and `check:cli` both pin it there. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const isWeb = (value: string): boolean => /^https?:\/\//i.test(value.trim());

const stripListMarker = (line: string): string => line.replace(/^\s*[-*+]\s+/, '').trim();

/** The separator a verdict or score puts between its value and its sentence. */
const stripSeparator = (value: string): string => value.replace(/^\s*(?:[—–\-:;,.]|\s)\s*/, '');

function markAt(value: string): { mark: Mark; rest: string } | null {
  const text = value.trimStart();
  const match = MARK.exec(text);
  if (!match) return null;
  const mark: Mark = match[1].startsWith('\u2705')
    ? 'met'
    : match[1].startsWith('\u26A0')
      ? 'adjacent'
      : 'missing';
  return { mark, rest: text.slice(match[0].length) };
}

/**
 * `✅ **requirement** — evidence` into its two halves.
 *
 * The bold form is checked first and deliberately: a requirement is allowed to
 * contain an em dash (`**AI-native — orchestrate agents**`), so splitting at the
 * first separator before looking for the closing `**` would cut it in two.
 * Anything after the bold is evidence, with a leading separator removed; a line
 * that is not bold splits at the first ` — `, then ` – `, ` - ` or `: `.
 */
function splitRequirement(value: string): { requirement: string; evidence: string } {
  const text = value.trim();
  const bold = /^\*\*(.+?)\*\*\s*([\s\S]*)$/.exec(text);
  if (bold) {
    return { requirement: bold[1].trim(), evidence: stripSeparator(bold[2].trim()) };
  }
  for (const separator of [' — ', ' – ', ' - ', ': ']) {
    const at = text.indexOf(separator);
    if (at > 0) {
      return { requirement: text.slice(0, at).trim(), evidence: text.slice(at + separator.length).trim() };
    }
  }
  return { requirement: text, evidence: '' };
}

/** A line's worth of keywords: comma-separated, with the template's lead-in gone. */
function parseKeywords(lines: string[]): string[] {
  let text = lines.map(stripListMarker).filter(Boolean).join(', ');
  if (!text) return [];
  const colon = text.indexOf(':');
  const comma = text.indexOf(',');
  /* "True and missing: edge computing, D1" → the label is not a keyword. Only
     when the colon comes before the first comma, so a keyword that contains a
     colon ("C++: templates") is left alone. */
  if (colon >= 0 && (comma < 0 || colon < comma)) text = text.slice(colon + 1);
  return text
    .split(',')
    .map(value => value.trim().replace(/[.;]+$/, ''))
    .filter(Boolean);
}

/**
 * Parse a fit assessment. Pure, total, and never throws — it is called on every
 * streamed delta while the assessment is being written, so a half-arrived line
 * is the normal case rather than the exceptional one.
 */
export function parseFit(markdown: string | null | undefined): FitView {
  const view: FitView = {
    recognised: false,
    verdict: { level: null, why: '' },
    score: { value: null, why: '' },
    facts: {},
    must: [],
    nice: [],
    gaps: [],
    keywords: [],
    projects: [],
    extra: [],
  };

  if (typeof markdown !== 'string' || !markdown) return view;
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');

  /* The verdict and the score are found wherever they sit, not only before the
     first `###`: an assessment may lead with `### Role at a glance`, and that
     section used to swallow the two lines below it. An emphasis pass rather than
     a pattern per arrangement: `**Verdict:**` is `Verdict` wrapped around every
     character, and stripping the wrappers is more honest than spelling out each
     one. */
  let sawVerdict = false;
  let sawScore = false;
  for (const line of lines) {
    if (sawVerdict && sawScore) break;
    const plain = line.replace(/\*{1,2}|_{1,2}/g, '');

    if (!sawVerdict) {
      const match = /^\s*Verdict\s*:\s*(.*)$/i.exec(plain);
      if (match) {
        sawVerdict = true;
        const raw = match[1].trim();
        const level = /^(strong|reasonable|stretch|poor)\b/i.exec(raw);
        if (level) {
          const word = level[1].toLowerCase();
          view.verdict.level = (word[0].toUpperCase() + word.slice(1)) as FitView['verdict']['level'];
          view.verdict.why = stripSeparator(raw.slice(level[0].length));
        } else {
          view.verdict.why = raw;
        }
        continue;
      }
    }

    if (!sawScore) {
      const match = /^\s*Score\s*:\s*(.*)$/i.exec(plain);
      if (match) {
        sawScore = true;
        const raw = match[1].trim();
        const value = /(\d+(?:\.\d+)?)\s*\/\s*10\b/.exec(raw);
        if (value) {
          view.score.value = Number(value[1]);
          view.score.why = stripSeparator(raw.slice(value[0].length));
        } else {
          view.score.why = raw;
        }
      }
    }
  }

  type Section = 'must' | 'nice' | 'gaps' | 'keywords' | 'projects' | 'facts' | 'extra';
  let section: Section | null = null;
  let lastItem: FitItem | null = null;
  let lastGap = -1;
  const keywordLines: string[] = [];
  let extra: { title: string; markdown: string } | null = null;

  for (const line of lines) {
    const heading = /^###\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const title = heading[1].replace(/\s*#+\s*$/, '').trim();
      lastItem = null;
      lastGap = -1;
      extra = null;
      if (/must/i.test(title)) section = 'must';
      else if (/nice/i.test(title)) section = 'nice';
      else if (/gap/i.test(title)) section = 'gaps';
      else if (/keyword/i.test(title)) section = 'keywords';
      else if (/role at a glance|at a glance|facts/i.test(title)) section = 'facts';
      else if (/projects?.*lead/i.test(title)) section = 'projects';
      else {
        extra = { title, markdown: '' };
        view.extra.push(extra);
        section = 'extra';
      }
      continue;
    }

    if (section === 'must' || section === 'nice') {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const indented = /^\s/.test(line);
      const isListItem = /^\s*[-*+]\s+/.test(line);
      /* A continuation line (indented, no dash) belongs to the item above it.
         It reads as evidence in every real assessment, including one whose
         requirement never had a separator. */
      if (indented && !isListItem && lastItem) {
        lastItem.evidence = lastItem.evidence ? `${lastItem.evidence} ${trimmed}` : trimmed;
        continue;
      }
      if (!isListItem) continue;
      const marked = markAt(stripListMarker(line));
      if (!marked) continue;
      const { requirement, evidence } = splitRequirement(marked.rest);
      const item: FitItem = { mark: marked.mark, requirement, evidence };
      (section === 'must' ? view.must : view.nice).push(item);
      lastItem = item;
    } else if (section === 'gaps') {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const isListItem = /^\s*[-*+]\s+/.test(line);
      if (isListItem) {
        view.gaps.push(stripListMarker(line));
        lastGap = view.gaps.length - 1;
      } else if (/^\s/.test(line) && lastGap >= 0) {
        view.gaps[lastGap] = `${view.gaps[lastGap]} ${trimmed}`;
      }
    } else if (section === 'keywords') {
      keywordLines.push(line);
    } else if (section === 'projects') {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const body = stripListMarker(line);
      const at = [' — ', ' – ', ' - '].map(separator => body.indexOf(separator)).filter(index => index > 0);
      const cut = at.length ? Math.min(...at) : -1;
      const slug = (cut >= 0 ? body.slice(0, cut) : body).trim();
      const text = cut >= 0 ? body.slice(cut + 3).trim() : '';
      if (SLUG.test(slug)) view.projects.push({ slug, line: text });
    } else if (section === 'facts') {
      /* The glance is a short block: a blank line, the next heading, or a bold
         line ends it. That last rule is what keeps a `**Verdict:**` written
         directly under it from becoming a fact in an assessment that leads with
         the glance. A key is a plain word; anything else is not a fact. */
      if (!line.trim() || /^\s*\*\*/.test(line)) {
        section = null;
        continue;
      }
      const body = stripListMarker(line);
      if (!body) continue;
      for (const piece of body.split('·')) {
        const at = piece.indexOf(':');
        if (at <= 0) continue;
        const key = piece.slice(0, at).trim();
        const value = piece.slice(at + 1).trim();
        if (/^[A-Za-z][A-Za-z ]*$/.test(key) && value) view.facts[key] = value;
      }
    } else if (section === 'extra' && extra) {
      extra.markdown += `${line}\n`;
    }
  }

  for (const entry of view.extra) entry.markdown = entry.markdown.trim();
  view.keywords = parseKeywords(keywordLines);
  view.recognised =
    (view.verdict.level !== null || view.score.value !== null) && view.must.length + view.nice.length > 0;
  return view;
}

/**
 * The score the marks themselves imply, independent of the model's own number.
 *
 * Must-haves weigh three and nice-to-haves one, because a missing must-have is
 * the thing that decides an application and a missing nice-to-have is a talking
 * point. Met is worth all of its weight, adjacent half, missing nothing. The
 * result is scaled to ten and rounded to the nearest half — which is the
 * resolution a person reads, not a false precision.
 *
 * `null` when the assessment has no recognised requirements: there is nothing
 * to score, and zero would read as "Poor" rather than "not assessed".
 *
 * Pure and import-free, so `check:cli` pins it and the Fit tab computes the
 * same number the harness's `fitScore` validator compares against.
 */
export function scoreFromMarks(view: FitView): number | null {
  const total = view.must.length * 3 + view.nice.length;
  if (!total) return null;
  const credit = (items: FitItem[], weight: number): number =>
    items.reduce(
      (sum, item) =>
        sum + weight * (item.mark === 'met' ? 1 : item.mark === 'adjacent' ? 0.5 : 0),
      0,
    );
  const earned = credit(view.must, 3) + credit(view.nice, 1);
  return Math.round((earned / total) * 20) / 2;
}

/* ---------- contacts ---------- */

export interface Contact {
  name: string;
  title: string;
  url: string | null;
  /** The address the owner typed, pulled out wherever it sat in the line. */
  email: string | null;
  raw: string;
}

/**
 * One contacts line: `Name — title — profile URL`.
 *
 * The URL is set only when it is absolute http(s), because it becomes an `href`
 * on the origin that holds the owner's token — the rule `job-boards.ts` applies
 * to a board's link. Anything else stays text: a relative path is not a profile,
 * and `javascript:` is not a link at all.
 *
 * The em dash is the separator the form writes, so it is tried first: a title
 * can itself contain a spaced hyphen (`Recruiter - India`), and splitting on any
 * dash before looking for the URL lost the link entirely. The URL is any part
 * that is http(s); the rest is name and title, with any email-shaped part taken
 * out as `email`.
 */
export function parseContact(line: string): Contact {
  const raw = typeof line === 'string' ? line.trim() : '';
  if (!raw) return { name: '', title: '', url: null, email: null, raw };

  const byDash = raw.split(/\s+[—–]\s+/);
  let parts = byDash.length > 1 ? byDash : raw.split(/\s+-\s+/);

  /* The address is a part of its own wherever the owner put it — before the
     title, after the link, or inside the name. Pulling it out first is what
     keeps it out of `title`, and it is why a four-part line no longer loses its
     link to a "last part is the URL" rule. */
  const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
  let email: string | null = null;
  parts = parts.flatMap(part => {
    const found = EMAIL.exec(part);
    if (!found) return [part];
    if (!email) email = found[0];
    const rest = part.replace(found[0], '').trim();
    return rest ? [rest] : [];
  });

  /* The link may be any part, not only the last. */
  const urlAt = parts.findIndex(part => isWeb(part.trim()));
  let url: string | null = null;
  if (urlAt >= 0) {
    url = parts[urlAt].trim();
    parts.splice(urlAt, 1);
  }

  const name = (parts[0] ?? '').trim();
  const title = parts.slice(1).map(part => part.trim()).filter(Boolean).join(' — ');
  return { name, title, url, email, raw };
}

/** The inverse of `parseContact`, for what the Add / Edit dialog writes back. */
export function formatContact(contact: Omit<Contact, 'raw'>): string {
  const name = contact.name.trim();
  const title = contact.title.trim();
  const url = contact.url && isWeb(contact.url) ? contact.url.trim() : '';
  const email = contact.email?.trim() ?? '';
  return [name, title, url, email].filter(Boolean).join(' — ');
}

/* ---------- outreach ---------- */

/**
 * The channels, closed — and the limits are the ones `jobOutreach`'s
 * instructions already state in `assist-tasks.ts`; keep the two in agreement.
 * The instructions there name each limit so a model writes to it; `measure()`
 * below counts on the page, because a model's own count is not trusted.
 */
export const OUTREACH_CHANNELS = {
  note: {
    label: 'LinkedIn note',
    limit: 200,
    unit: 'characters',
    instruction: (who: string, _appliedOn?: string) => `LinkedIn connection note to ${who}`,
  },
  message: {
    label: 'LinkedIn message',
    limit: 600,
    unit: 'characters',
    instruction: (who: string, _appliedOn?: string) => `LinkedIn message to ${who}`,
  },
  referral: {
    label: 'Referral ask',
    limit: 600,
    unit: 'characters',
    instruction: (who: string, _appliedOn?: string) =>
      `LinkedIn message to ${who} — ask whether they would refer me for this role`,
  },
  email: {
    label: 'Email',
    limit: 150,
    unit: 'words',
    instruction: (who: string, _appliedOn?: string) => `Email to ${who}`,
  },
  cover: {
    label: 'Cover email',
    limit: 220,
    unit: 'words',
    instruction: (who: string, _appliedOn?: string) => `Application email to ${who}`,
  },
  followup: {
    label: 'Follow-up',
    limit: 150,
    unit: 'words',
    instruction: (who: string, appliedOn?: string) =>
      `Short follow-up email to ${who}${appliedOn ? `; I applied on ${appliedOn}` : ''}`,
  },
} as const;

export type Channel = keyof typeof OUTREACH_CHANNELS;

export interface Draft {
  contact: string;
  channel: string;
  text: string;
  /** The day it was sent, from the heading's optional `· sent YYYY-MM-DD`. */
  sent?: string;
}

/**
 * A draft's own `Subject:` line, split off for a `mailto:` link.
 *
 * An email draft opens with `Subject: …` by the task's contract. Leaving that
 * line in the body duplicates the subject the link already carries, so the
 * mailto builder removes it — and only falls back to a generated subject when
 * the draft has none. Leading blank lines are ignored; the blank line after the
 * subject is dropped; `Subject:` alone is a subject with an empty body.
 */
export function splitSubject(text: string): { subject: string; body: string } {
  const clean = typeof text === 'string' ? text.trim() : '';
  if (!clean) return { subject: '', body: '' };
  const lines = clean.split('\n');
  const match = /^\s*Subject\s*:\s*(.*)$/i.exec(lines[0]);
  if (!match) return { subject: '', body: clean };
  const rest = lines.slice(1);
  if (rest.length && !rest[0].trim()) rest.shift();
  return { subject: match[1].trim(), body: rest.join('\n').trim() };
}

/**
 * The `outreach` column: one `## Contact · Channel` section per kept draft.
 *
 * Known limit, pinned by `check:cli`: a `## ` line inside a draft's body starts
 * a new draft. The heading is the only delimiter the format has, and a body
 * that itself begins a line with `## ` is a body written in markdown headers,
 * which these drafts are not.
 */
export function parseOutreach(markdown: string | null | undefined): Draft[] {
  if (typeof markdown !== 'string' || !markdown.trim()) return [];
  const drafts: Draft[] = [];
  let current: Draft | null = null;
  let body: string[] = [];

  const commit = () => {
    if (!current) return;
    current.text = body.join('\n').trim();
    drafts.push(current);
    body = [];
  };

  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.startsWith('## ')) {
      commit();
      const heading = line.slice(3).trim();
      const parts = heading.split('·').map(part => part.trim());
      const sentMatch = /^sent\s+(\d{4}-\d{2}-\d{2})$/i.exec(parts[parts.length - 1] ?? '');
      /* A heading without the optional part parses exactly as it did before:
         the first `·` splits the contact from everything else. With the third
         part and only the third, `sent` is read and the channel is the middle. */
      if (parts.length >= 3 && sentMatch) {
        current = {
          contact: parts[0] ?? '',
          channel: parts.slice(1, -1).join(' · '),
          text: '',
          sent: sentMatch[1],
        };
      } else {
        const at = heading.indexOf('·');
        current =
          at < 0
            ? { contact: heading, channel: '', text: '' }
            : { contact: heading.slice(0, at).trim(), channel: heading.slice(at + 1).trim(), text: '' };
      }
      continue;
    }
    if (current) body.push(line);
  }
  commit();
  return drafts;
}

export function formatOutreach(drafts: Draft[]): string {
  return drafts
    .map(draft => {
      const heading = [draft.contact.trim(), draft.channel.trim(), draft.sent ? `sent ${draft.sent}` : '']
        .filter(Boolean)
        .join(' · ');
      return `## ${heading}\n${draft.text.trim()}`;
    })
    .join('\n\n');
}

const firstName = (name: string): string => (name.trim().split(/\s+/)[0] ?? '').trim();

/** What the owner asked the message to do, beyond the channel. */
export type OutreachAsk = 'process' | 'team' | 'referral' | 'fifteen';
export type OutreachTone = 'direct' | 'warm';

export interface OutreachOptions {
  ask?: OutreachAsk;
  tone?: OutreachTone;
  /** One line of the owner's own, quoted into the draft. */
  note?: string;
}

const ASKS: Record<OutreachAsk, string> = {
  process: 'Ask about the hiring process and what the team is looking for in this role.',
  team: 'Ask about the team’s hardest current problem, and how the role touches it.',
  referral: 'Ask whether they would refer me for this role.',
  fifteen: 'Ask for fifteen minutes to hear how the team works.',
};

const TONES: Record<OutreachTone, string> = {
  direct: 'Write plainly and directly, with no throat-clearing.',
  warm: 'Write warmly, but without flattery or exclamation marks.',
};

/**
 * What a model is told to write for, and for whom — never a prompt of its own.
 *
 * The first argument set is the channel and the contact; `options` is the
 * composer's ask, tone and the owner's own line. Every part is data, and the
 * result is a fixed sentence pattern, so nothing a caller supplies can become
 * an instruction of its own beyond the four things the composer offers.
 */
export function outreachInstruction(
  contact: Contact,
  channel: Channel,
  appliedOn?: string,
  options: OutreachOptions = {},
): string {
  const who = [firstName(contact.name), contact.title.trim()].filter(Boolean).join(', ') || 'the contact';
  const parts = [OUTREACH_CHANNELS[channel].instruction(who, appliedOn)];
  if (options.ask) parts.push(ASKS[options.ask]);
  if (options.tone) parts.push(TONES[options.tone]);
  if (options.note?.trim()) parts.push(`Include this line from me: ${options.note.trim().slice(0, 300)}`);
  return parts.join(' ');
}

/**
 * `YYYY-MM-DD` plus N working days — the follow-up date.
 *
 * Monday-to-Friday only, and the start day does not count: a note sent on
 * Friday with five days is due the following Friday, which is the interval a
 * person means. A malformed date is returned unchanged rather than guessed at.
 */
export function workingDaysAfter(date: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!match) return date;
  const at = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (!Number.isFinite(at.getTime())) return date;
  let left = Math.max(0, Math.trunc(days));
  while (left > 0) {
    at.setUTCDate(at.getUTCDate() + 1);
    const day = at.getUTCDay();
    if (day !== 0 && day !== 6) left -= 1;
  }
  return at.toISOString().slice(0, 10);
}

/** Counted here rather than trusted from the model. Over is `>`: at the limit is inside it. */
export function measure(
  text: string,
  channel: Channel,
): { count: number; limit: number; unit: 'characters' | 'words'; over: boolean } {
  const { limit, unit } = OUTREACH_CHANNELS[channel];
  const value = typeof text === 'string' ? text : '';
  const words = value.trim() ? value.trim().split(/\s+/).length : 0;
  const count = unit === 'characters' ? value.length : words;
  return { count, limit, unit, over: count > limit };
}

/* ---------- what to do next ---------- */

export interface NextAction {
  text: string;
  /** Empty when there is nothing to press. */
  button: string;
  tab: 'overview' | 'fit' | 'resume' | 'outreach';
  /**
   * What the button does, named here rather than inferred from its label — a
   * page that matched on button copy silently stopped working the first time a
   * label was reworded.
   */
  act?: 'assess' | 'draft' | 'applied' | 'details' | 'notes' | 'followup';
}

/** The fields this reads. A subset of `ApplicationFields`, so the screen can pass its holder. */
export interface NextActionFields {
  jobDescription?: string | null;
  fit?: string | null;
  status?: string | null;
  resumeVariant?: string | null;
  contacts?: readonly string[] | string | null;
  outreach?: string | null;
  appliedOn?: string | null;
  nextStep?: string | null;
  nextOn?: string | null;
}

const textOf = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const contactLines = (value: NextActionFields['contacts']): string[] => {
  if (Array.isArray(value)) return value.map(line => String(line).trim()).filter(Boolean);
  if (typeof value === 'string') return value.split('\n').map(line => line.trim()).filter(Boolean);
  return [];
};

/** UTC day number, so two `YYYY-MM-DD` strings compare without a timezone. */
function dayNumber(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(time) ? Math.floor(time / 86_400_000) : null;
}

/**
 * The first rule that applies, in the order the owner works: understand the
 * role, see how they compare, pick what to send, find a way in, apply, follow
 * up. `today` is a parameter — never `new Date()` inside — which is what makes
 * every rule testable.
 */
export function nextAction(fields: NextActionFields, today: string): NextAction {
  const status = textOf(fields.status) || 'saved';
  const fit = parseFit(fields.fit);
  const contacts = contactLines(fields.contacts);
  const drafts = parseOutreach(fields.outreach);
  const nextOn = textOf(fields.nextOn);
  const appliedOn = textOf(fields.appliedOn);
  const todayNumber = dayNumber(today);

  if (!textOf(fields.jobDescription)) {
    return {
      text: 'Paste the advert — everything else is read against it.',
      button: 'Paste the advert',
      tab: 'overview',
      act: 'details',
    };
  }
  if (!textOf(fields.fit)) {
    return {
      text: 'See how you compare before spending time on it.',
      button: 'Assess fit',
      tab: 'fit',
      act: 'assess',
    };
  }
  if (fit.verdict.level === 'Poor' && status === 'saved') {
    return {
      text: 'This one scored Poor. Withdraw it, or keep it and say why in the notes.',
      button: 'Open the notes',
      tab: 'overview',
      act: 'notes',
    };
  }
  if (status === 'saved' && !textOf(fields.resumeVariant)) {
    return {
      text: 'Pick the resume you will send, or build one for this advert.',
      button: 'Choose a resume',
      tab: 'resume',
    };
  }
  if (status === 'saved' && contacts.length > 0 && drafts.length === 0) {
    return {
      text: 'You know someone here. Ask before you apply.',
      button: 'Draft the ask',
      tab: 'outreach',
      act: 'draft',
    };
  }
  if (status === 'saved') {
    return {
      text: 'Ready to apply. Mark it applied when you have.',
      button: 'Mark applied',
      tab: 'overview',
      act: 'applied',
    };
  }

  if (status === 'rejected' || status === 'withdrawn') {
    /* A closed row has no next step, whatever `nextOn` still says. Checking it
       before the date rules is the point: a withdrawn application kept a due
       follow-up forever, because nothing clears the date when the status moves. */
    return { text: 'Nothing due.', button: '', tab: 'overview' };
  }

  const due = dayNumber(nextOn);
  /* A sent message with nothing after it is the conversation's open end. Its
     date is the next step the owner set, or five working days after it went —
     whichever is stored — and the offer is the follow-up task, not "open the
     outreach tab". */
  const lastSent = drafts
    .map((draft, index) => ({ draft, index }))
    .filter(entry => entry.draft.sent)
    .at(-1);
  if (lastSent && !drafts.slice(lastSent.index + 1).length) {
    const followUpOn = textOf(fields.nextOn) || workingDaysAfter(lastSent.draft.sent!, 5);
    const when = dayNumber(followUpOn);
    if (when !== null && todayNumber !== null && when <= todayNumber) {
      return {
        text: `Follow up with ${firstName(lastSent.draft.contact)} — the ${lastSent.draft.channel.toLowerCase()} was sent ${lastSent.draft.sent}.`,
        button: 'Draft the follow-up',
        tab: 'outreach',
        act: 'followup',
      };
    }
  }

  if (due !== null && todayNumber !== null && due <= todayNumber) {
    const step = textOf(fields.nextStep);
    return {
      text: step ? `Follow-up is due: ${step}.` : 'Follow-up is due.',
      button: 'Open outreach',
      tab: 'outreach',
    };
  }

  const applied = dayNumber(appliedOn);
  if (
    status === 'applied' &&
    applied !== null &&
    todayNumber !== null &&
    todayNumber - applied >= 7 &&
    !nextOn
  ) {
    return {
      text: 'A week since you applied — send a follow-up.',
      button: 'Draft the follow-up',
      tab: 'outreach',
    };
  }

  return { text: 'Nothing due.', button: '', tab: 'overview' };
}

/**
 * Plain searches the owner can paste into a search box themselves. The screen
 * never runs one — nothing here fetches, and nothing touches LinkedIn.
 */
export function peopleSearches(company: string, role: string): string[] {
  const name = textOf(company);
  const words = textOf(role).split(/\s+/).filter(Boolean).slice(0, 2).join(' ');
  return [
    `${name} technical recruiter`,
    `${name} engineering manager${words ? ` ${words}` : ''}`,
    `${name} talent acquisition`,
  ]
    .map(search => search.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}
